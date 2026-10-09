import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';
import { resolveQueries } from './resolveQueries.js';

const logger = new Logger('PreviewSnapshot');

export const previewSnapshot = task(
    'previewSnapshot',
    'Call each query read-only and report whether NoriSnapshot can commit to it'
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
            const queries = resolveQueries(args);
            const blockNumber = await ethers.provider.getBlockNumber();

            logger.log(
                `Previewing ${queries.length} queries at block ${blockNumber}`
            );
            for (const query of queries) {
                let verdict: string;
                try {
                    const returned = await ethers.provider.call({
                        to: query.target,
                        data: query.data,
                        blockTag: blockNumber,
                    });
                    const length = ethers.dataLength(returned);
                    verdict =
                        length === 32
                            ? `ok: ${BigInt(returned)}`
                            : `rejected: returns ${length} bytes`;
                } catch (error) {
                    verdict = `rejected: call reverts (${(error as Error).message})`;
                }
                logger.log(`${query.name} ${query.queryId} ${verdict}`);
            }
        },
    }))
    .build();
