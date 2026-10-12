import {
    type Facts,
    type SnapshotFact,
    ago,
    batchOf,
    blockText,
    blockUrl,
    clock,
    labelOf,
    solanaTransactionUrl,
    valueOf,
} from '@nori-zk/solana-web-ui';
import { factLinesOf, mintOf, verifyTargetOf, type LabelledLine } from './sentences.js';

/** One line of a snapshot's block, with the keeper's transactions that verified it on Solana. */
export interface FactLineView {
    /** `Demo lockbox · held 116,723.52 · not paused`. */
    text: string;
    /** `↗` to each of the keeper's transactions that verified it on the explorer; none when none is found. */
    links: { url: string; text: string }[];
}

/** One snapshot as its block on the page shows it. */
export interface SnapshotView {
    key: string;
    /** `21:21:12 UTC · 14 min ago`: the snapshot block's time and age. */
    when: string;
    /** `Ethereum block 11,880,006 ↗`. */
    block: string;
    blockUrl: string;
    /** Whether Nori has proven the snapshot on Solana. */
    proven: boolean;
    /** `Proven on Solana` or `Waiting for proof`. */
    status: string;
    /** What the snapshot recorded, one line per mint, then one per other query. */
    lines: FactLineView[];
    /** The snapshot transaction, for building a result's witness. */
    txHash: string;
    /** The result `[ Verify on Solana ]` checks (`verifyTargetOf`): its query id, `''` when none. */
    verifyQueryId: string;
    /** That result as the `Snapshot` event recorded it, 0x-hex. */
    verifyWord: string;
}

/**
 * A snapshot's results, each named by the guard that reads it.
 *
 * @param snapshot The snapshot, from its event.
 * @param guards The guards, for naming their queries.
 * @returns Its results in order.
 */
export const linesOf = (snapshot: SnapshotFact, guards: Facts['guards']): LabelledLine[] =>
    snapshot.queryIds.flatMap((queryId, i): LabelledLine[] => {
        const word = snapshot.results[i];
        if (word === undefined) return [];
        const label = labelOf(queryId, guards);
        const mint = label.kind === 'unknown' ? undefined : mintOf(queryId, guards);
        return [{ queryId, word, label, value: valueOf(word, label), ...(mint ? { mint } : {}) }];
    });

/**
 * A snapshot as its block shows it.
 *
 * @param snapshot The snapshot, from its event.
 * @param facts The read it came in, for the queue cursor, the guards, the batches and the keeper's reads.
 * @param nowSecs The time of the read, unix seconds, for the snapshot's age.
 * @returns The block's text and link.
 */
export function snapshotViewOf(
    snapshot: SnapshotFact,
    { queueCursor, guards, batches, keeperReads }: Facts,
    nowSecs: number,
): SnapshotView {
    const proven = snapshot.requestId < queueCursor;
    const secs = Number(snapshot.timestamp);
    const lines = linesOf(snapshot, guards);
    const target = verifyTargetOf(lines);
    // The reads found on the snapshot's batch account. Two snapshots in one batch share them.
    const batch = batchOf(snapshot.requestId, batches)?.proofQueueBatchAddress;
    const reads = keeperReads.filter((read) => read.batch === batch);
    return {
        key: snapshot.index.toString(),
        when: `${clock(secs)} UTC · ${ago(Math.max(0, nowSecs - secs))}`,
        block: `Ethereum block ${blockText(snapshot.blockNumber)} ↗`,
        blockUrl: blockUrl(snapshot.blockNumber),
        proven,
        status: proven ? 'Proven on Solana' : 'Waiting for proof',
        lines: factLinesOf(lines, reads).map((line) => ({
            text: line.text,
            links: line.reads.map((signature) => ({
                url: solanaTransactionUrl(signature),
                text: '↗',
            })),
        })),
        txHash: snapshot.txHash,
        verifyQueryId: target?.queryId ?? '',
        verifyWord: target?.word ?? '',
    };
}
