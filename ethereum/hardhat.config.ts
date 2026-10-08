import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { type HardhatUserConfig } from 'hardhat/config';
import hardhatTypechain from '@nomicfoundation/hardhat-typechain';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import './logger.js';
import { Logger } from 'esm-iso-logger';

import { deploy } from './tasks/deploy.js';
import { snapshot } from './tasks/snapshot.js';
import { previewSnapshot } from './tasks/previewSnapshot.js';
import { deployDemo, demoSet } from './tasks/demo.js';

const logger = new Logger('HardhatConfig');

// The repo's one .env; the shell environment wins over it
dotenv.config({
    path: fileURLToPath(new URL('../.env', import.meta.url)),
    quiet: true,
});

const possibleNetworkName = process.env.ETH_NETWORK;
const possibleRpcUrl = process.env.ETH_RPC_URL;
const possiblePrivateKey = process.env.ETH_PRIVATE_KEY;

// Public, non-archive: forks at a recent block work, pinned old blocks do not.
const DEFAULT_MAINNET_FORK_RPC_URL = 'https://ethereum-rpc.publicnode.com';

const issues: string[] = [];

if (!possibleNetworkName) issues.push('Missing required env: ETH_NETWORK');
if (possibleNetworkName && possibleNetworkName !== 'hardhat') {
    if (!possibleRpcUrl) issues.push('Missing required env: ETH_RPC_URL');
    if (!possiblePrivateKey)
        issues.push('Missing required env: ETH_PRIVATE_KEY');
}

if (issues.length) {
    logger.error('HardhatConfig encountered errors:');
    issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
    logger.fatal(
        'Due to issues with environment variables hardhat cannot continue.'
    );
    process.exit(1);
}

const networkName = possibleNetworkName as string;

const networks: NonNullable<HardhatUserConfig['networks']> = {
    // Simulated network with a fixed start date, for reproducible test vectors
    vectors: {
        type: 'edr-simulated',
        chainType: 'l1',
        initialDate: '2026-10-06T00:00:00Z',
    },
    // Simulated network forked from Ethereum mainnet, for test/fork
    mainnetFork: {
        type: 'edr-simulated',
        chainType: 'l1',
        forking: {
            url:
                process.env.ETH_MAINNET_FORK_RPC_URL ||
                DEFAULT_MAINNET_FORK_RPC_URL,
            // Pin it for reproducible gas figures; needs an archive RPC
            ...(process.env.ETH_MAINNET_FORK_BLOCK && {
                blockNumber: BigInt(process.env.ETH_MAINNET_FORK_BLOCK),
            }),
        },
    },
};

if (networkName !== 'hardhat') {
    networks[networkName] = {
        url: possibleRpcUrl as string,
        accounts: [possiblePrivateKey as string],
        type: 'http',
    };
}

logger.log(`Running on network "${networkName}"`);
if (networkName === 'hardhat') {
    logger.log('Using built-in Hardhat network for local testing.');
} else {
    logger.log(`Using RPC URL: ${possibleRpcUrl}`);
    logger.log('One private key loaded for deployment.');
}

const config: HardhatUserConfig = {
    networks,
    tasks: [deploy, snapshot, previewSnapshot, deployDemo, demoSet],
    plugins: [
        hardhatMocha,
        hardhatTypechain,
        hardhatEthers,
        hardhatEthersChaiMatchers,
    ],
    // Same compiler settings as nori-solana-sdk/ethereum, whose
    // NoriProofRequestQueue artifact the tests and deploy task use
    solidity: {
        version: '0.8.28',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    test: {
        mocha: {
            rootHooks: {
                afterAll() {
                    // Force exit after tests — ethers .once() listeners keep the process alive.
                    // No code: keep the exitCode Hardhat sets when a test fails
                    setTimeout(() => process.exit(), 1000).unref();
                },
            },
        },
    },
    paths: {
        sources: './contracts',
        cache: './cache',
        artifacts: './artifacts',
    },
};

export default config;
