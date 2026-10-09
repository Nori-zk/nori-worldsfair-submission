// Reading Backstop guards: browser-safe, as nothing here loads the sdk's
// generated program client (`@nori-zk/nori-bridge-solana-sdk/program`).
import {
    AccountRole,
    address,
    getAddressDecoder,
    type Address,
    type Instruction,
    type TransactionError,
} from '@solana/kit';
import { hexlify } from 'ethers';
import { discriminator } from './anchor.js';

export const BACKSTOP_PROGRAM = address(
    'JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9'
);

/** A guard's settings (Rust `GuardConfig`). */
export interface GuardConfig {
    noriProgram: Address;
    /** 20-byte Ethereum address, 0x-hex. */
    noriSnapshot: string;
    /** Query ids, 0x-hex; a zero pause query means none. */
    backingQuery: string;
    pauseQuery: string;
    backingDecimals: number;
    tolerance: bigint;
    windowSecs: number;
    skewSecs: number;
    checkpointIntervalSecs: number;
    maxStalenessSecs: number;
}

/** One supply checkpoint (Rust `Checkpoint`): the mint's supply at a Solana time. */
export interface Checkpoint {
    /** Unix seconds. */
    time: bigint;
    supply: bigint;
}

/** How many checkpoints a guard keeps (Rust `CHECKPOINTS`), as a ring. */
export const CHECKPOINTS = 64;

/** The parts of a Guard account a keeper or dashboard shows. */
export interface GuardState {
    admin: Address;
    mint: Address;
    config: GuardConfig;
    backing: bigint;
    backingEthBlock: bigint;
    backingEthTime: bigint;
    paused: boolean;
    pauseEthBlock: bigint;
    tripped: boolean;
    tripEthBlock: bigint;
    tripDeficit: bigint;
    checkpointCount: bigint;
    /** The checkpoints kept, oldest first: the last `min(count, 64)` written. */
    checkpoints: Checkpoint[];
}

/** Decodes a Guard account (Anchor discriminator + Borsh). */
export function decodeGuard(data: Uint8Array): GuardState {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u64 = (at: number) => view.getBigUint64(at, true);
    const u32 = (at: number) => view.getUint32(at, true);
    const hex = (from: number, to: number) => hexlify(data.subarray(from, to));
    const pubkey = (at: number) =>
        getAddressDecoder().decode(data.subarray(at, at + 32));
    return {
        admin: pubkey(8),
        mint: pubkey(40),
        config: {
            noriProgram: pubkey(72),
            noriSnapshot: hex(104, 124),
            backingQuery: hex(124, 156),
            pauseQuery: hex(156, 188),
            backingDecimals: data[188] ?? 0,
            tolerance: u64(189),
            windowSecs: u32(197),
            skewSecs: u32(201),
            checkpointIntervalSecs: u32(205),
            maxStalenessSecs: u32(209),
        },
        backing: u64(233),
        backingEthBlock: u64(241),
        backingEthTime: u64(249),
        paused: data[257] === 1,
        pauseEthBlock: u64(258),
        tripped: data[266] === 1,
        tripEthBlock: u64(267),
        tripDeficit: u64(275),
        checkpointCount: u64(1307),
        checkpoints: checkpointsOf(view, u64(1307)),
    };
}

/**
 * A guard's checkpoint ring, oldest first: entry `k` of the `written` kept
 * is at slot `(count - written + k) % 64`, each slot `{ time i64, supply u64 }`
 * from byte 283.
 */
function checkpointsOf(view: DataView, count: bigint): Checkpoint[] {
    const ring = BigInt(CHECKPOINTS);
    const written = count < ring ? count : ring;
    return Array.from({ length: Number(written) }, (_, k) => {
        const at = 283 + 16 * Number((count - written + BigInt(k)) % ring);
        return {
            time: view.getBigInt64(at, true),
            supply: view.getBigUint64(at + 8, true),
        };
    });
}

/** The guard's status, as the program's `status` computes it. */
export function guardStatus(
    guard: GuardState,
    liveSupply: bigint,
    nowSecs: bigint
): 'HEALTHY' | 'WARN' | 'STALE' | 'PAUSED_AT_SOURCE' | 'TRIPPED' {
    if (guard.tripped) return 'TRIPPED';
    if (guard.paused) return 'PAUSED_AT_SOURCE';
    if (
        guard.backingEthTime === 0n ||
        nowSecs - guard.backingEthTime > BigInt(guard.config.maxStalenessSecs)
    )
        return 'STALE';
    if (liveSupply > guard.backing + guard.config.tolerance) return 'WARN';
    return 'HEALTHY';
}

/** An SPL mint's supply (u64 at byte 36). */
export function mintSupply(data: Uint8Array): bigint {
    return new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
    ).getBigUint64(36, true);
}

/** An SPL mint's decimals (u8 at byte 44). */
export const mintDecimals = (data: Uint8Array): number => data[44] ?? 0;

/**
 * `assert_healthy()`: fails unless the guard is HEALTHY. The call a lender
 * makes (by CPI) before acting on the mint; read-only.
 */
export function assertHealthyInstruction(accounts: {
    guard: Address;
    mint: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.READONLY },
            { address: accounts.mint, role: AccountRole.READONLY },
        ],
        data: discriminator('assert_healthy'),
    };
}

/**
 * Backstop's custom error codes (Rust `BackstopError`), pinned by
 * programs/backstop/tests/instruction_fixture.rs.
 */
export const BackstopError = {
    InvalidConfig: 6000,
    InvalidNoriState: 6001,
    InvalidProofQueueBatch: 6002,
    InvalidSnapshotResult: 6003,
    NoPauseQuery: 6004,
    ReadNotNewer: 6005,
    CheckpointTooSoon: 6006,
    SupplyAboveBacking: 6007,
    Stale: 6008,
    PausedAtSource: 6009,
    Tripped: 6010,
    PauseResultNotBool: 6011,
} as const;

/** The `BackstopError` name of a custom error code, if it is one. */
export function backstopErrorName(code: number): string | undefined {
    return Object.entries(BackstopError).find(
        ([, value]) => value === code
    )?.[0];
}

/** The program's message for each error `assert_healthy` can fail with (its `#[msg]`). */
export const BACKSTOP_ERROR_MESSAGE: Record<number, string> = {
    [BackstopError.SupplyAboveBacking]: 'Supply is above proven backing',
    [BackstopError.Stale]: 'No recent proven backing',
    [BackstopError.PausedAtSource]: 'Paused on Ethereum',
    [BackstopError.Tripped]: 'Tripped: supply exceeded proven backing',
};

/** A transaction error as JSON (its numbers may be bigints). */
export function transactionErrorText(err: TransactionError): string {
    return JSON.stringify(err, (_, v: unknown) =>
        typeof v === 'bigint' ? Number(v) : v
    );
}

/** The custom program error code in a transaction error, if it has one. */
export function customErrorOf(err: TransactionError): number | undefined {
    if (typeof err !== 'object' || !('InstructionError' in err))
        return undefined;
    const [, error] = err.InstructionError;
    return typeof error === 'object' && 'Custom' in error
        ? Number(error.Custom)
        : undefined;
}
