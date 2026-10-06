import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';
import { resolveQueries } from './resolveQueries.js';

const logger = new Logger('Snapshot');

export const snapshot = task(
    'snapshot',
    'Snapshot queries on NoriSnapshot, committing every result under one proof request'
)
    .addVariadicArgument({
        name: 'names',
        description: 'Mainnet query names (queries.ts); all when omitted',
        defaultValue: [],
    })
    .addOption({
        name: 'target',
        description: 'Custom query target',
        defaultValue: '',
    })
    .addOption({
        name: 'signature',
        description: 'Custom query function, e.g. balanceOf(address)',
        defaultValue: '',
    })
    .addOption({
        name: 'args',
        description: 'Custom query arguments, comma-separated',
        defaultValue: '',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            const possibleSnapshotAddress =
                process.env.NORI_ETH_SNAPSHOT_ADDRESS;
            if (
                !possibleSnapshotAddress ||
                !/^0x[a-fA-F0-9]{40}$/.test(possibleSnapshotAddress)
            ) {
                logger.fatal(
                    'Missing or invalid env: NORI_ETH_SNAPSHOT_ADDRESS (expected 0x-prefixed 40 hex chars)'
                );
                process.exit(1);
            }

            const queries = resolveQueries(args);
            const noriSnapshot = await ethers.getContractAt(
                'NoriSnapshot',
                possibleSnapshotAddress
            );
            const fee = await noriSnapshot.snapshotFee();

            logger.log(
                `Snapshotting ${queries.length} queries on ${possibleSnapshotAddress}, fee ${ethers.formatEther(fee)} ETH`
            );
            const tx = await noriSnapshot.snapshot(
                queries.map(({ target, data }) => ({ target, data })),
                { value: fee }
            );
            logger.log(`Transaction: ${tx.hash}`);
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Snapshot receipt invalid');

            logger.log(
                `Mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`
            );
            for (const log of receipt.logs) {
                const parsed = noriSnapshot.interface.parseLog(log);
                if (parsed?.name !== 'Snapshot') continue;
                logger.log(
                    `Snapshot ${parsed.args.snapshotIndex}, proof request ${parsed.args.requestId}, results root ${parsed.args.resultsRoot}`
                );
                queries.forEach((query, k) => {
                    logger.log(
                        `  [${k}] ${query.name}: ${BigInt(parsed.args.results[k])}`
                    );
                });
            }
        },
    }))
    .build();
