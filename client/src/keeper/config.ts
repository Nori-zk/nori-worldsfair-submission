import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
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

/**
 * Loads the repo's .env and the deploy outputs (ethereum/.env.nori-eth-*,
 * .env.nori-sol-demo). The shell environment wins, then the first file that
 * sets a variable; an empty value counts as unset.
 */
export function loadEnv() {
    for (const file of [
        '.env',
        'ethereum/.env.nori-eth-snapshot',
        'ethereum/.env.nori-eth-demo',
        '.env.nori-sol-demo',
    ]) {
        const path = fileURLToPath(
            new URL(`../../../${file}`, import.meta.url)
        );
        if (!existsSync(path)) continue;
        const values = dotenv.parse(readFileSync(path));
        for (const [name, value] of Object.entries(values)) {
            if (!process.env[name]) process.env[name] = value;
        }
    }
}

/**
 * Reads the keeper config, replacing each ${VAR} in its strings with that
 * environment variable. The Ethereum key comes from ETH_PRIVATE_KEY.
 */
export function loadConfig(path: string): KeeperConfig {
    const expand = (value: unknown): unknown => {
        if (typeof value === 'string')
            return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
                const env = process.env[name];
                if (!env) throw new Error(`Missing env: ${name} (in ${path})`);
                return env;
            });
        if (Array.isArray(value)) return value.map(expand);
        if (value && typeof value === 'object')
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, expand(item)])
            );
        return value;
    };
    const config = expand(
        JSON.parse(readFileSync(path, 'utf8'))
    ) as KeeperConfig;
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
