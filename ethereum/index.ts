import noriSnapshotRaw from './artifacts/contracts/NoriSnapshot.sol/NoriSnapshot.json' with { type: 'json' };
import type { Artifact } from '@nori-zk/ethereum-solana-bridge';

export const noriSnapshotJson: Artifact = noriSnapshotRaw as Artifact;

export * from './queries.js';
export * from './snapshotProof.js';
export * from './types/ethers-contracts/index.js';
