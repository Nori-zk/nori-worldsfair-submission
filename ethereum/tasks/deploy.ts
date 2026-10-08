import { writeFileSync } from 'fs';
import { task } from 'hardhat/config';
import path from 'path';
import { fileURLToPath } from 'url';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('Deploy');

// Mirrors NoriProofRequestQueue; validated here so a bad value fails before
// anything is deployed.
const PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI = 10n ** 12n;
const MAX_PROOF_REQUEST_QUEUE_FEE_WEI = 5n * 10n ** 16n; // 0.05 ETH

export const deploy = task(
    'deploy',
    'Deploy NoriSnapshot, and a dedicated NoriProofRequestQueue unless NORI_ETH_PROOF_QUEUE_ADDRESS is set'
)
    .setAction(async () => ({
        default: async (_args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            const [deployer] = await ethers.getSigners();
            const balance = await ethers.provider.getBalance(deployer.address);
            const network = await ethers.provider.getNetwork();

            const issues: string[] = [];

            const possibleProofQueueAddress =
                process.env.NORI_ETH_PROOF_QUEUE_ADDRESS;
            if (
                possibleProofQueueAddress &&
                !/^0x[a-fA-F0-9]{40}$/.test(possibleProofQueueAddress)
            )
                issues.push(
                    'Invalid env: NORI_ETH_PROOF_QUEUE_ADDRESS (expected 0x-prefixed 40 hex chars)'
                );

            const possibleProofRequestQueueFeeWei =
                process.env.NORI_ETH_SNAPSHOT_PROOF_REQUEST_QUEUE_FEE_WEI;
            let proofRequestQueueFeeWei = 0n;
            if (possibleProofRequestQueueFeeWei) {
                try {
                    proofRequestQueueFeeWei = BigInt(
                        possibleProofRequestQueueFeeWei
                    );
                } catch {
                    issues.push(
                        `NORI_ETH_SNAPSHOT_PROOF_REQUEST_QUEUE_FEE_WEI must be an integer amount of wei, got: ${possibleProofRequestQueueFeeWei}`
                    );
                }
                if (proofRequestQueueFeeWei > MAX_PROOF_REQUEST_QUEUE_FEE_WEI)
                    issues.push(
                        `NORI_ETH_SNAPSHOT_PROOF_REQUEST_QUEUE_FEE_WEI exceeds MAX_PROOF_REQUEST_QUEUE_FEE of ${MAX_PROOF_REQUEST_QUEUE_FEE_WEI.toString()} wei`
                    );
                if (
                    proofRequestQueueFeeWei %
                        PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI !==
                    0n
                )
                    issues.push(
                        `NORI_ETH_SNAPSHOT_PROOF_REQUEST_QUEUE_FEE_WEI must be a multiple of ${PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI.toString()} wei`
                    );
            }

            if (issues.length) {
                logger.error('Deploy encountered errors:');
                issues.forEach((issue, idx) =>
                    logger.warn(`  ${idx + 1}: ${issue}`)
                );
                logger.fatal(
                    'Due to issues with environment variables deploy cannot continue.'
                );
                process.exit(1);
            }

            logger.log(`Deploying with account: ${deployer.address}`);
            logger.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
            logger.log(
                `Network: ${network.name} (chainId: ${network.chainId})`
            );

            // A dedicated queue keeps snapshot requests apart from other consumers:
            // its batches only hold write-once snapshot words, so witnesses never
            // need archive reads, and its fee is set for snapshots alone.
            let proofQueueAddress = possibleProofQueueAddress;
            if (!proofQueueAddress) {
                const queueOperator =
                    process.env.NORI_ETH_SNAPSHOT_QUEUE_OPERATOR_ADDRESS ||
                    deployer.address;
                const queueFeeRecipient =
                    process.env.NORI_ETH_SNAPSHOT_QUEUE_FEE_RECIPIENT_ADDRESS ||
                    ethers.ZeroAddress;

                logger.log(
                    'Deploying NoriProofRequestQueue (nori-solana-sdk artifact)...'
                );
                logger.log(`  operator: ${queueOperator}`);
                logger.log(`  feeRecipient: ${queueFeeRecipient}`);
                logger.log(
                    `  proofRequestQueueFee: ${ethers.formatEther(proofRequestQueueFeeWei)} ETH`
                );
                const { NoriProofRequestQueue__factory } =
                    await import('@nori-zk/ethereum-solana-bridge');
                const proofQueue = await new NoriProofRequestQueue__factory(
                    deployer
                ).deploy(
                    queueOperator,
                    queueFeeRecipient,
                    proofRequestQueueFeeWei
                );
                const proofQueueReceipt = await proofQueue
                    .deploymentTransaction()
                    ?.wait();
                if (!proofQueueReceipt)
                    throw new Error('NoriProofRequestQueue receipt invalid');
                proofQueueAddress = await proofQueue.getAddress();
                logger.log(
                    `NoriProofRequestQueue deployed to: ${proofQueueAddress}`
                );
                logger.log(`Gas used: ${proofQueueReceipt.gasUsed.toString()}`);
            } else {
                logger.log(
                    `Using existing NoriProofRequestQueue: ${proofQueueAddress}`
                );
            }

            logger.log('Deploying NoriSnapshot...');
            const NoriSnapshot =
                await ethers.getContractFactory('NoriSnapshot');
            const noriSnapshot = await NoriSnapshot.deploy(proofQueueAddress);
            const noriSnapshotReceipt = await noriSnapshot
                .deploymentTransaction()
                ?.wait();
            if (!noriSnapshotReceipt)
                throw new Error('NoriSnapshot receipt invalid');
            logger.log(`NoriSnapshot deployed to: ${noriSnapshot.target}`);
            logger.log(`Deployed in block: ${noriSnapshotReceipt.blockNumber}`);
            logger.log(`Gas used: ${noriSnapshotReceipt.gasUsed.toString()}`);

            // Write deployment details to .env.nori-eth-snapshot, in
            // NORI_ETH_ENV_DIR if set (scripts/dry-run.sh uses it)
            const envFilePath = path.join(
                process.env.NORI_ETH_ENV_DIR ?? path.resolve(__dirname, '..'),
                '.env.nori-eth-snapshot'
            );
            const env = {
                NORI_ETH_SNAPSHOT_ADDRESS: noriSnapshot.target,
                NORI_ETH_PROOF_QUEUE_ADDRESS: proofQueueAddress,
                NORI_ETH_SNAPSHOT_DEPLOY_BLOCK: noriSnapshotReceipt.blockNumber,
            };
            const envContent = Object.entries(env)
                .map(([key, value]) => `${key}=${value}\n`)
                .join('');
            writeFileSync(envFilePath, envContent, { encoding: 'utf8' });
            logger.log(`Wrote ${envFilePath}:\n${envContent}`);
        },
    }))
    .build();
