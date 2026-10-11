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
        /** A public Ethereum RPC for reads, tried before the wallet. */
        rpcUrl: string;
        /** The `NoriProofRequestQueue` address. */
        proofQueueAddress: string;
        /** The first block to read proof requests from: the queue's deploy block. */
        proofQueueDeployBlock: number;
        /** The `NoriSnapshot` address. */
        snapshotAddress: string;
    };
    solana: {
        /** The cluster; its genesis is checked against `rpcUrl`'s. */
        cluster: SolanaCluster;
        /** A dedicated RPC for the cluster, or `''` for its public endpoint. */
        rpcUrl: string;
        /** The Nori program that commits proof queue batches. */
        programAddress: Address;
        /**
         * Any existing system account holding SOL. Verifying a result simulates
         * a transaction, which names it as fee payer; it signs and pays nothing.
         */
        feePayer: Address;
    };
    bridge: {
        /** The bridge's websocket, for the live processing stages. */
        wssUrl: string;
    };
    /** Each app's and dashboard's address, for the links along the top of every page. */
    urls: {
        proveBalance: string;
        guardStatus: string;
        provenFacts: string;
        dashboard: string;
        /** The Tempo submission's bridge dashboard, or `''` to leave its link out. */
        tempoDashboard: string;
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

    const readHttpUrl = (name: string): string => {
        const url = read(name);
        if (!/^https?:\/\//.test(url))
            throw new WebEnvError(name, 'is not an http:// or https:// URL');
        return url;
    };

    const readSolanaAddress = (name: string): Address => {
        try {
            return address(read(name));
        } catch (error) {
            if (error instanceof WebEnvError) throw error;
            throw new WebEnvError(name, 'is not a Solana address');
        }
    };

    const cluster = read('NORI_WEB_SOLANA_CLUSTER');
    if (!isSolanaCluster(cluster))
        throw new WebEnvError(
            'NORI_WEB_SOLANA_CLUSTER',
            `is not one of ${SOLANA_CLUSTERS.join(', ')}`,
        );
    const rpcUrl = readHttpUrl('NORI_WEB_ETH_RPC_URL');
    const solanaRpcUrl = process.env.NORI_WEB_SOLANA_RPC_URL || file.NORI_WEB_SOLANA_RPC_URL || '';
    if (solanaRpcUrl !== '' && !/^https?:\/\//.test(solanaRpcUrl))
        throw new WebEnvError('NORI_WEB_SOLANA_RPC_URL', 'is not an http:// or https:// URL');
    const wssUrl = read('NORI_WEB_BRIDGE_WSS_URL');
    if (!/^wss?:\/\//.test(wssUrl))
        throw new WebEnvError('NORI_WEB_BRIDGE_WSS_URL', 'is not a ws:// or wss:// URL');

    return {
        ethereum: {
            chainId: readInteger('NORI_WEB_ETH_CHAIN_ID'),
            rpcUrl,
            proofQueueAddress: readEthAddress('NORI_ETH_PROOF_QUEUE_ADDRESS'),
            proofQueueDeployBlock: readInteger('NORI_WEB_PROOF_QUEUE_DEPLOY_BLOCK'),
            snapshotAddress: readEthAddress('NORI_ETH_SNAPSHOT_ADDRESS'),
        },
        solana: {
            cluster,
            rpcUrl: solanaRpcUrl,
            programAddress: readSolanaAddress('NORI_SOL_TOKEN_PROGRAM_ID'),
            feePayer: readSolanaAddress('NORI_WEB_SOLANA_FEE_PAYER'),
        },
        bridge: { wssUrl },
        urls: {
            proveBalance: readHttpUrl('NORI_WEB_PROVE_BALANCE_URL'),
            guardStatus: readHttpUrl('NORI_WEB_GUARD_STATUS_URL'),
            provenFacts: readHttpUrl('NORI_WEB_PROVEN_FACTS_URL'),
            dashboard: readHttpUrl('NORI_WEB_DASHBOARD_URL'),
            tempoDashboard:
                process.env.NORI_WEB_TEMPO_DASHBOARD_URL || file.NORI_WEB_TEMPO_DASHBOARD_URL
                    ? readHttpUrl('NORI_WEB_TEMPO_DASHBOARD_URL')
                    : '',
        },
    };
}
