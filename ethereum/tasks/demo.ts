import { writeFileSync } from 'fs';
import { task } from 'hardhat/config';
import path from 'path';
import { fileURLToPath } from 'url';
import '../logger.js';
import { Logger } from 'esm-iso-logger';
import { encodeQueryData, queryIdOf } from '../queries.js';

const logger = new Logger('Demo');
// NORI_ETH_ENV_DIR redirects the output (scripts/dry-run.sh uses it)
const ENV_FILE = path.join(
    process.env.NORI_ETH_ENV_DIR ??
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    '.env.nori-eth-demo'
);

export const deployDemo = task(
    'deployDemo',
    'Deploy a DemoLockbox for a live drain demo (testnet only)'
)
    .addPositionalArgument({
        name: 'locked',
        description: 'Initial locked amount, in tokens (18 decimals)',
        defaultValue: '116723.52',
    })
    .setAction(async () => ({
        default: async ({ locked }, hre) => {
            const { ethers } = await hre.network.getOrCreate();
            const factory = await ethers.getContractFactory('DemoLockbox');
            const lockbox = await factory.deploy(ethers.parseEther(locked));
            await lockbox.waitForDeployment();
            const address = await lockbox.getAddress();
            writeFileSync(
                ENV_FILE,
                `NORI_ETH_DEMO_LOCKBOX_ADDRESS=${address}\n`
            );

            logger.log(`DemoLockbox deployed to ${address}, locked ${locked}`);
            for (const signature of ['locked()', 'paused()']) {
                const data = encodeQueryData({ signature, args: [] });
                logger.log(
                    `query ${signature}: target ${address}, queryId ${queryIdOf(address, data)}`
                );
            }
            logger.log(`Wrote ${ENV_FILE}`);
        },
    }))
    .build();

export const demoSet = task(
    'demoSet',
    "Set the DemoLockbox's locked amount and pause flag"
)
    .addPositionalArgument({
        name: 'locked',
        description:
            'Locked amount, in tokens (e.g. 223.52 to replay the Kelp drain)',
    })
    .addFlag({ name: 'paused', description: 'Pause the lockbox' })
    .setAction(async () => ({
        default: async ({ locked, paused }, hre) => {
            const { ethers } = await hre.network.getOrCreate();
            const address = process.env.NORI_ETH_DEMO_LOCKBOX_ADDRESS;
            if (!address)
                throw new Error(
                    'Missing env: NORI_ETH_DEMO_LOCKBOX_ADDRESS (run deployDemo)'
                );
            const lockbox = await ethers.getContractAt('DemoLockbox', address);
            const tx = await lockbox.set(ethers.parseEther(locked), paused);
            const receipt = await tx.wait();
            logger.log(
                `DemoLockbox: locked ${locked}, paused ${paused} (block ${receipt?.blockNumber})`
            );
        },
    }))
    .build();
