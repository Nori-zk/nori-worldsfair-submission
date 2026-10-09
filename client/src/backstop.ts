import {
    AccountRole,
    address,
    getAddressDecoder,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Address,
    type Instruction,
} from '@solana/kit';
import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';
import { findStatePda } from '@nori-zk/nori-bridge-solana-sdk/program';
import type { SnapshotResultWitnessArgs } from './snapshotWitness.js';

export const BACKSTOP_PROGRAM = address(
    'JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9'
);

export const ReadKind = { Backing: 0, Pause: 1 } as const;
export type ReadKind = (typeof ReadKind)[keyof typeof ReadKind];

/** Anchor's instruction discriminator: sha256("global:<name>")[..8]. */
function discriminator(name: string): Uint8Array {
    return getBytes(sha256(toUtf8Bytes(`global:${name}`))).slice(0, 8);
}

function le(value: bigint, bytes: number): Uint8Array {
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
    return out;
}

function words(list: Array<readonly [Uint8Array]>): Uint8Array {
    return getBytes(
        concat([le(BigInt(list.length), 4), ...list.map(([w]) => w)])
    );
}

/** `submit_read(kind, witness)` instruction data, Borsh as Anchor encodes it. */
export function encodeSubmitRead(
    kind: ReadKind,
    witness: SnapshotResultWitnessArgs
): Uint8Array {
    const { request } = witness;
    return getBytes(
        concat([
            discriminator('submit_read'),
            new Uint8Array([kind]),
            words(request.path),
            le(request.index, 8),
            request.value.target[0],
            new Uint8Array([request.value.collectionKeysCount]),
            request.value.collectionKeys[0][0],
            request.value.collectionKeys[1][0],
            request.value.value[0],
            witness.result[0],
            le(BigInt(witness.resultIndex), 2),
            words(witness.resultPath),
        ])
    );
}

export function submitReadInstruction(accounts: {
    guard: Address;
    mint: Address;
    proofQueueBatch: Address;
    kind: ReadKind;
    witness: SnapshotResultWitnessArgs;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.WRITABLE },
            { address: accounts.mint, role: AccountRole.READONLY },
            { address: accounts.proofQueueBatch, role: AccountRole.READONLY },
        ],
        data: encodeSubmitRead(accounts.kind, accounts.witness),
    };
}

/** `checkpoint()`: records the mint's supply; crank about once a minute. */
export function checkpointInstruction(accounts: {
    guard: Address;
    mint: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.WRITABLE },
            { address: accounts.mint, role: AccountRole.READONLY },
        ],
        data: discriminator('checkpoint'),
    };
}

/** The `Status` enum's variants, in Borsh order (the program's return data). */
export const STATUS_NAMES = [
    'HEALTHY',
    'WARN',
    'STALE',
    'PAUSED_AT_SOURCE',
    'TRIPPED',
] as const;

/** `status()`: returns the guard's status in the transaction's return data. */
export function statusInstruction(accounts: {
    guard: Address;
    mint: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.READONLY },
            { address: accounts.mint, role: AccountRole.READONLY },
        ],
        data: discriminator('status'),
    };
}

/** `assert_healthy()`: fails unless the guard is HEALTHY (what a lender CPIs). */
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

/** `unlatch()`: clears a trip. Only the guard's admin may sign it. */
export function unlatchInstruction(accounts: {
    admin: Address;
    guard: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.admin, role: AccountRole.READONLY_SIGNER },
            { address: accounts.guard, role: AccountRole.WRITABLE },
        ],
        data: discriminator('unlatch'),
    };
}

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

const addressBytes = (value: Address) =>
    new Uint8Array(getAddressEncoder().encode(value));

/** `create_guard(config)` instruction data. */
export function encodeCreateGuard(config: GuardConfig): Uint8Array {
    return getBytes(
        concat([
            discriminator('create_guard'),
            addressBytes(config.noriProgram),
            getBytes(config.noriSnapshot),
            getBytes(config.backingQuery),
            getBytes(config.pauseQuery),
            new Uint8Array([config.backingDecimals]),
            le(config.tolerance, 8),
            le(BigInt(config.windowSecs), 4),
            le(BigInt(config.skewSecs), 4),
            le(BigInt(config.checkpointIntervalSecs), 4),
            le(BigInt(config.maxStalenessSecs), 4),
        ])
    );
}

/** The guard PDA: `[b"guard", mint, admin]`. */
export async function findGuardAddress(
    mint: Address,
    admin: Address
): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
        programAddress: BACKSTOP_PROGRAM,
        seeds: [toUtf8Bytes('guard'), addressBytes(mint), addressBytes(admin)],
    });
    return pda;
}

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/** `create_guard`: `admin` pays and becomes the guard's admin. */
export async function createGuardInstruction(accounts: {
    admin: Address;
    mint: Address;
    config: GuardConfig;
}): Promise<Instruction> {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.admin, role: AccountRole.WRITABLE_SIGNER },
            { address: accounts.mint, role: AccountRole.READONLY },
            {
                address: (
                    await findStatePda({
                        programAddress: accounts.config.noriProgram,
                    })
                )[0],
                role: AccountRole.READONLY,
            },
            {
                address: await findGuardAddress(accounts.mint, accounts.admin),
                role: AccountRole.WRITABLE,
            },
            { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
        data: encodeCreateGuard(accounts.config),
    };
}

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
}

/** Decodes a Guard account (Anchor discriminator + Borsh). */
export function decodeGuard(data: Uint8Array): GuardState {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u64 = (at: number) => view.getBigUint64(at, true);
    const u32 = (at: number) => view.getUint32(at, true);
    const hex = (from: number, to: number) =>
        '0x' + Buffer.from(data.subarray(from, to)).toString('hex');
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
    };
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
