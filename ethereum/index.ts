import noriSnapshotRaw from './artifacts/contracts/NoriSnapshot.sol/NoriSnapshot.json' with { type: 'json' };

export interface Artifact {
    _format: string;
    contractName: string;
    sourceName: string;
    abi: Array<{
        inputs: Array<{
            internalType: string;
            name: string;
            type: string;
            indexed?: boolean;
        }>;
        name?: string;
        outputs?: Array<{
            internalType: string;
            name: string;
            type: string;
        }>;
        stateMutability?: string;
        type: string;
        anonymous?: boolean;
    }>;
    bytecode: string;
    deployedBytecode: string;
    linkReferences: Record<
        string,
        Record<string, Array<{ start: number; length: number }>>
    >;
    deployedLinkReferences: Record<
        string,
        Record<string, Array<{ start: number; length: number }>>
    >;
}

export const noriSnapshotJson: Artifact = noriSnapshotRaw as Artifact;

export * from './queries.js';
export * from './snapshotProof.js';
export * from './types/ethers-contracts/index.js';
