// Reading Backstop guards: browser-safe, as nothing here loads the sdk's
// generated program client (`@nori-zk/nori-bridge-solana-sdk/program`).
import { address, getAddressDecoder, type Address } from '@solana/kit';
import { hexlify } from 'ethers';

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
