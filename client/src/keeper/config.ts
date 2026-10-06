import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { address, type Address } from '@solana/kit';
import { encodeQueryData, queryIdOf } from '@nori-zk/ethereum-snapshot';
import type { GuardConfig } from '../backstop.js';

export interface QueryConfig {
    target: string;
    signature: string;
    args: unknown[];
}

export interface GuardEntry {
    name: string;
    mint: Address;
    backing: QueryConfig;
    pause?: QueryConfig;
    backingDecimals: number;
    tolerance: string;
    windowSecs: number;
    skewSecs: number;
    checkpointIntervalSecs: number;
    maxStalenessSecs: number;
}

export interface KeeperConfig {
    ethereum: { rpcUrl: string; noriSnapshot: string; proofQueue: string };
    solana: {
        rpcUrl: string;
        wsUrl: string;
        keypair: string;
        noriProgram: Address;
    };
    intervals: {
        snapshotSecs: number;
        checkpointSecs: number;
        pollSecs: number;
    };
    stateFile: string;
    guards: GuardEntry[];
}

/** Reads the keeper config; the Ethereum key comes from ETH_PRIVATE_KEY. */
export function loadConfig(path: string): KeeperConfig {
    const config = JSON.parse(readFileSync(path, 'utf8')) as KeeperConfig;
    config.solana.keypair = config.solana.keypair.replace(/^~/, homedir());
    config.solana.noriProgram = address(config.solana.noriProgram);
    for (const guard of config.guards) guard.mint = address(guard.mint);
    return config;
}

export function queryOf(query: QueryConfig) {
    const data = encodeQueryData(query);
    return {
        target: query.target,
        data,
        queryId: queryIdOf(query.target, data),
    };
}

const NO_QUERY = '0x' + '00'.repeat(32);

export function guardConfigOf(
    config: KeeperConfig,
    guard: GuardEntry
): GuardConfig {
    return {
        noriProgram: config.solana.noriProgram,
        noriSnapshot: config.ethereum.noriSnapshot,
        backingQuery: queryOf(guard.backing).queryId,
        pauseQuery: guard.pause ? queryOf(guard.pause).queryId : NO_QUERY,
        backingDecimals: guard.backingDecimals,
        tolerance: BigInt(guard.tolerance),
        windowSecs: guard.windowSecs,
        skewSecs: guard.skewSecs,
        checkpointIntervalSecs: guard.checkpointIntervalSecs,
        maxStalenessSecs: guard.maxStalenessSecs,
    };
}
