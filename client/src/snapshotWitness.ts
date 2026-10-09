import { Interface, getBytes, toBeHex, type TransactionReceipt } from 'ethers';
import {
    commitmentWordOf,
    noriSnapshotJson,
    resultWitnessOf,
    timeKeyOf,
} from '@nori-zk/ethereum-snapshot';
import {
    request_leaf_hash,
    type RequestLeaf,
    type RequestWitness,
} from '@nori-zk/ethereum-solana-proof-queue-utils-glam';

const snapshotInterface = new Interface(noriSnapshotJson.abi);

/** A NoriSnapshot `Snapshot` event: everything needed to rebuild witnesses. */
export interface SnapshotEvent {
    snapshotIndex: bigint;
    requestId: bigint;
    blockNumber: bigint;
    timestamp: bigint;
    resultsRoot: string;
    queryIds: string[];
    results: string[];
}

/**
 * nori-read's `SnapshotResultWitness`, in the shape of the program's Codama
 * types: 32- and 20-byte arrays wrapped in one-element tuples, the U256
 * value little-endian.
 */
export interface SnapshotResultWitnessArgs {
    request: {
        path: Array<readonly [Uint8Array]>;
        index: bigint;
        value: {
            target: readonly [Uint8Array];
            collectionKeysCount: number;
            collectionKeys: [readonly [Uint8Array], readonly [Uint8Array]];
            value: readonly [Uint8Array];
        };
    };
    result: readonly [Uint8Array];
    resultIndex: number;
    resultPath: Array<readonly [Uint8Array]>;
}

/** Reads the `Snapshot` event that `noriSnapshot` emitted in `receipt`. */
export function parseSnapshotEvent(
    receipt: TransactionReceipt,
    noriSnapshot: string
): SnapshotEvent {
    for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== noriSnapshot.toLowerCase()) continue;
        const parsed = snapshotInterface.parseLog(log);
        if (parsed?.name !== 'Snapshot') continue;
        return {
            snapshotIndex: parsed.args.snapshotIndex,
            requestId: parsed.args.requestId,
            blockNumber: parsed.args.blockNumber,
            timestamp: parsed.args.timestamp,
            resultsRoot: parsed.args.resultsRoot,
            queryIds: [...parsed.args.queryIds],
            results: [...parsed.args.results],
        };
    }
    throw new Error(
        `No Snapshot event from ${noriSnapshot} in ${receipt.hash}`
    );
}

/** The snapshot's proof request leaf, as the queue and NoriSnapshot's storage hold it. */
export function snapshotLeaf(
    noriSnapshot: string,
    event: SnapshotEvent
): RequestLeaf {
    return {
        target: noriSnapshot,
        collectionKeysCount: 2,
        collectionKeys: [
            toBeHex(event.snapshotIndex, 32),
            timeKeyOf(event.blockNumber, event.timestamp),
        ],
        value: toBeHex(commitmentWordOf(event.resultsRoot), 32),
    };
}

const word = (hex: string) => [getBytes(hex)] as const;

/**
 * Combines the request's path in its proof queue batch (from the sdk's
 * `fetchProofRequestWitness`) with the result's path in the snapshot, for
 * the result of `queryId`.
 */
export function snapshotResultWitness(
    noriSnapshot: string,
    event: SnapshotEvent,
    queryId: string,
    requestWitness: RequestWitness
): SnapshotResultWitnessArgs {
    const leaf = snapshotLeaf(noriSnapshot, event);
    if (request_leaf_hash(leaf) !== requestWitness.leaf) {
        throw new Error('The batch witness is not for this snapshot');
    }
    const resultIndex = event.queryIds.findIndex(
        (id) => id.toLowerCase() === queryId.toLowerCase()
    );
    if (resultIndex < 0)
        throw new Error(`Query ${queryId} is not in this snapshot`);
    const result = resultWitnessOf(event.queryIds, event.results, resultIndex);
    const [key0, key1] = leaf.collectionKeys;
    if (!key0 || !key1)
        throw new Error('A snapshot leaf has two collection keys');

    return {
        request: {
            path: requestWitness.path.map(word),
            index: BigInt(requestWitness.index),
            value: {
                target: [getBytes(noriSnapshot)],
                collectionKeysCount: 2,
                collectionKeys: [word(key0), word(key1)],
                value: [getBytes(leaf.value).reverse()],
            },
        },
        result: word(event.results[resultIndex] ?? '0x'),
        resultIndex,
        resultPath: result.path.map(word),
    };
}
