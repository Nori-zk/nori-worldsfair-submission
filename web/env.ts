import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getAddress } from 'ethers';
import { address, type Address } from '@solana/kit';
import type { SolanaCluster } from '@nori-zk/nori-bridge-solana-sdk';

/** The constants every app and dashboard under web/ is built with. */
export interface WebEnv {
    ethereum: {
        /** The chain the wallet must be on. */
        chainId: number;
        /** The `NoriProofRequestQueue` address. */
        proofQueueAddress: string;
        /** The first block to read proof requests from: the queue's deploy block. */
        proofQueueDeployBlock: number;
        /** The `NoriSnapshot` address. */
        snapshotAddress: string;
    };
    solana: {
        /** The public cluster read through its public endpoint. */
        cluster: SolanaCluster;
        /** The Nori program that commits proof queue batches. */
        programAddress: Address;
    };
    bridge: {
        /** The bridge's websocket, for the live processing stages. */
        wssUrl: string;
    };
}

const SOLANA_CLUSTERS: readonly SolanaCluster[] = ['mainnet', 'devnet', 'testnet'];

/**
 * Whether `value` names a public Solana cluster.
 *
 * @param value The configured cluster name.
 * @returns Whether it is one of `SOLANA_CLUSTERS`.
 */
const isSolanaCluster = (value: string): value is SolanaCluster =>
    SOLANA_CLUSTERS.some((cluster) => cluster === value);

/** Thrown when a web/ build constant is missing or malformed. */
export class WebEnvError extends Error {
    /**
     * @param name The variable's name.
     * @param reason What is wrong with it.
     */
    constructor(name: string, reason: string) {
        super(`web/.env: ${name} ${reason}`);
    }
}

/**
 * Reads the build constants from the shell environment, then web/.env (the
 * shell wins; an empty value counts as unset), and checks each one.
 *
 * Only the names read here reach a browser: the result is built into the
 * page as `NORI_WEB_ENV`.
 *
 * @returns The checked constants.
 * @throws WebEnvError When a constant is missing or malformed.
 */
export function loadWebEnv(): WebEnv {
    const path = fileURLToPath(new URL('.env', import.meta.url));
    const file = existsSync(path) ? dotenv.parse(readFileSync(path)) : {};
    const read = (name: string): string => {
        const value = process.env[name] || file[name];
        if (!value) throw new WebEnvError(name, 'is not set');
        return value;
    };
    const readInteger = (name: string): number => {
        const value = Number(read(name));
        if (!Number.isSafeInteger(value) || value < 0)
            throw new WebEnvError(name, 'is not a non-negative integer');
        return value;
    };
    const readEthAddress = (name: string): string => {
        try {
            return getAddress(read(name));
        } catch (error) {
            if (error instanceof WebEnvError) throw error;
            throw new WebEnvError(name, 'is not an Ethereum address');
        }
    };

    const cluster = read('NORI_WEB_SOLANA_CLUSTER');
    if (!isSolanaCluster(cluster))
        throw new WebEnvError(
            'NORI_WEB_SOLANA_CLUSTER',
            `is not one of ${SOLANA_CLUSTERS.join(', ')}`,
        );
    let programAddress: Address;
    try {
        programAddress = address(read('NORI_SOL_TOKEN_PROGRAM_ID'));
    } catch (error) {
        if (error instanceof WebEnvError) throw error;
        throw new WebEnvError('NORI_SOL_TOKEN_PROGRAM_ID', 'is not a Solana address');
    }
    const wssUrl = read('NORI_WEB_BRIDGE_WSS_URL');
    if (!/^wss?:\/\//.test(wssUrl))
        throw new WebEnvError('NORI_WEB_BRIDGE_WSS_URL', 'is not a ws:// or wss:// URL');

    return {
        ethereum: {
            chainId: readInteger('NORI_WEB_ETH_CHAIN_ID'),
            proofQueueAddress: readEthAddress('NORI_ETH_PROOF_QUEUE_ADDRESS'),
            proofQueueDeployBlock: readInteger('NORI_WEB_PROOF_QUEUE_DEPLOY_BLOCK'),
            snapshotAddress: readEthAddress('NORI_ETH_SNAPSHOT_ADDRESS'),
        },
        solana: { cluster, programAddress },
        bridge: { wssUrl },
    };
}
