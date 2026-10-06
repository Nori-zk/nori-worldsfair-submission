import {
    AbiCoder,
    concat,
    dataLength,
    isHexString,
    keccak256,
    sha256,
    toBeHex,
    zeroPadValue,
} from 'ethers';

/**
 * What a witness builder and a Solana consumer need to check a `NoriSnapshot`
 * result: the proof request leaf's keys, the results tree and the committed
 * word. Every function mirrors the contract's of the same name.
 */

/** Set on every committed word in place of the results root's top bit. */
export const SENTINEL = 1n << 255n;

/** Storage index of `NoriSnapshot.commitments`. */
export const COMMITMENTS_SLOT_INDEX = 0n;

/** Most queries in one snapshot. */
export const MAX_QUERIES = 256;

/** Longest results path: a tree over `MAX_QUERIES` leaves. */
export const MAX_RESULT_PATH = 8;

/** Prefixed to every results leaf so it can never pass for a node. */
export const RESULT_LEAF_PREFIX = '0x00';

const ZERO_LEAF = zeroPadValue('0x', 32);
const abi = AbiCoder.defaultAbiCoder();

/** `NoriSnapshot.slotKeyOf`: the storage key of `commitments[snapshotIndex]`. */
export function slotKeyOf(snapshotIndex: bigint): string {
    return keccak256(
        abi.encode(
            ['uint256', 'uint256'],
            [snapshotIndex, COMMITMENTS_SLOT_INDEX]
        )
    );
}

/** `NoriSnapshot.timeKeyOf`: the second collection key, `blockNumber << 64 | timestamp`. */
export function timeKeyOf(blockNumber: bigint, timestamp: bigint): string {
    return toBeHex((blockNumber << 64n) | timestamp, 32);
}

/**
 * Splits a second collection key back into its block number and timestamp,
 * rejecting keys NoriSnapshot never writes: zero, or wider than 128 bits.
 */
export function parseTimeKey(timeKey: string | bigint): {
    blockNumber: bigint;
    timestamp: bigint;
} {
    const word = BigInt(timeKey);
    if (word === 0n || word >> 128n !== 0n) {
        throw new Error(`Not a snapshot time key: 0x${word.toString(16)}`);
    }
    return {
        blockNumber: word >> 64n,
        timestamp: word & ((1n << 64n) - 1n),
    };
}

/** `NoriSnapshot.resultLeafOf`: `sha256(0x00 ++ queryId ++ result)`. */
export function resultLeafOf(queryId: string, result: string): string {
    return sha256(concat([RESULT_LEAF_PREFIX, queryId, result]));
}

/** Every level of the results tree, leaves first, root last. */
function resultsTreeOf(
    queryIds: readonly string[],
    results: readonly string[]
): string[][] {
    if (queryIds.length === 0)
        throw new Error('A snapshot has at least one query');
    if (queryIds.length !== results.length) {
        throw new Error(
            `${queryIds.length} query ids but ${results.length} results`
        );
    }

    let width = 1;
    while (width < queryIds.length) width *= 2;
    const leaves = queryIds.map((queryId, k) =>
        resultLeafOf(queryId, results[k])
    );
    const levels = [
        [...leaves, ...Array<string>(width - leaves.length).fill(ZERO_LEAF)],
    ];
    while (levels[levels.length - 1].length > 1) {
        const below = levels[levels.length - 1];
        const level: string[] = [];
        for (let i = 0; i < below.length; i += 2) {
            level.push(sha256(concat([below[i], below[i + 1]])));
        }
        levels.push(level);
    }
    return levels;
}

/** `NoriSnapshot.resultsRootOf`: the results root, with its original top bit. */
export function resultsRootOf(
    queryIds: readonly string[],
    results: readonly string[]
): string {
    const levels = resultsTreeOf(queryIds, results);
    return levels[levels.length - 1][0];
}

/** One result's place in a snapshot's results tree. */
export interface ResultWitness {
    /** The results root, with its original top bit. */
    root: string;
    /** The result's index among the snapshot's queries. */
    index: number;
    /** `resultLeafOf(queryId, result)`. */
    leaf: string;
    /** Sibling hashes from the leaf up to the root, bottom-up. */
    path: string[];
}

/** Builds the witness for result `index` of a snapshot, from its `Snapshot` event. */
export function resultWitnessOf(
    queryIds: readonly string[],
    results: readonly string[],
    index: number
): ResultWitness {
    const levels = resultsTreeOf(queryIds, results);
    if (index < 0 || index >= queryIds.length) {
        throw new Error(
            `Result index ${index} outside a snapshot of ${queryIds.length}`
        );
    }
    const path: string[] = [];
    let position = index;
    for (const level of levels.slice(0, -1)) {
        path.push(level[position ^ 1]);
        position >>= 1;
    }
    return {
        root: levels[levels.length - 1][0],
        index,
        leaf: levels[0][index],
        path,
    };
}

/** Recomputes a results root from a leaf, its index and its bottom-up path. */
export function rootFromResultPath(
    leaf: string,
    index: number,
    path: readonly string[]
): string {
    let node = leaf;
    path.forEach((sibling, level) => {
        node =
            (index >> level) & 1
                ? sha256(concat([sibling, node]))
                : sha256(concat([node, sibling]));
    });
    return node;
}

/** The word `NoriSnapshot` commits for a results root: its top bit replaced by `SENTINEL`. */
export function commitmentWordOf(resultsRoot: string): bigint {
    return BigInt(resultsRoot) | SENTINEL;
}

function isWord(hex: string): boolean {
    return isHexString(hex) && dataLength(hex) === 32;
}

/**
 * The results half of nori-read's `verify_snapshot_result`, with its bounds:
 * the proven commitment word carries the sentinel (so it is a snapshot, not a
 * false zero) and equals the root recomputed from the pinned `queryId`, the
 * result, its index and its path. A consumer also checks the proof request
 * leaf itself: its batch path, its target (the trusted NoriSnapshot), its two
 * collection keys (`parseTimeKey`) and the snapshot's age.
 */
export function verifyResult(
    provenWord: string | bigint,
    queryId: string,
    result: string,
    index: number,
    path: readonly string[]
): boolean {
    const word = BigInt(provenWord);
    if (word >> 256n !== 0n || (word & SENTINEL) === 0n) return false;
    if (!isWord(queryId) || !isWord(result) || !path.every(isWord))
        return false;
    if (path.length > MAX_RESULT_PATH) return false;
    if (!Number.isInteger(index) || index < 0 || index >= MAX_QUERIES)
        return false;
    if (index >> path.length !== 0) return false;
    const root = rootFromResultPath(resultLeafOf(queryId, result), index, path);
    return commitmentWordOf(root) === word;
}
