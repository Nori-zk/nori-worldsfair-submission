import {
    type EnqueuedProofRequest,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type BatchLanding } from './batch-landing.js';
import {
    clock,
    minutes,
    solanaAccountUrl,
    solanaTransactionUrl,
    transactionUrl,
} from './format.js';

/** One read as its latency row shows it. */
export interface LatencyRowView {
    key: string;
    request: string;
    /** The snapshot transaction on Etherscan. */
    requestUrl: string;
    /** The snapshot block's time of day, UTC. */
    ethTime: string;
    batch: string;
    batchUrl: string;
    /** The landing's time of day with its link mark, `…` while it is read, `—` when unknown. */
    landed: string;
    landedUrl: string;
    /** Minutes from the Ethereum block to the landing, one decimal, or `''`. */
    minutes: string;
    /** The minutes against the shown reads' median: `+2.1 min`, `−0.8 min`, `median`, or `''`. */
    vsMedian: string;
    /** Slower than the shown reads' p90, both to one decimal as shown. */
    aboveP90: boolean;
}

/** The mask of a time key's low 64 bits: the block's timestamp. */
const LOW_64 = (1n << 64n) - 1n;

/**
 * The Ethereum time a snapshot's proof request read at, from its second
 * collection key, `blockNumber << 64 | timestamp`, as `parseTimeKey`
 * (`@nori-zk/ethereum-snapshot`) splits it; the dashboard does not depend
 * on that package.
 *
 * @param timeKey The key, a 0x-prefixed word.
 * @returns The timestamp, unix seconds, or `undefined` when the key is missing or not a time key.
 */
export function ethTimeOf(timeKey: string | undefined): number | undefined {
    if (timeKey === undefined) return undefined;
    let word: bigint;
    try {
        word = BigInt(timeKey);
    } catch {
        return undefined;
    }
    if (word === 0n || word >> 128n !== 0n) return undefined;
    return Number(word & LOW_64);
}

/**
 * The batch holding a request.
 *
 * @param requestId The request's id.
 * @param batches The batches.
 * @returns The batch with `inputQueueCursor ≤ requestId < outputQueueCursor`, if any.
 */
export const batchOf = (
    requestId: bigint,
    batches: readonly ProofQueueBatchSummary[],
): ProofQueueBatchSummary | undefined =>
    batches.find(
        ({ inputQueueCursor, outputQueueCursor }) =>
            inputQueueCursor <= requestId && requestId < outputQueueCursor,
    );

/** A read with its batch and Ethereum time, before it is shown. */
interface Read {
    request: EnqueuedProofRequest;
    batch: ProofQueueBatchSummary;
    ethTime: number;
}

/**
 * The reads the tab shows: each request in one of the batches with a time
 * key, newest first.
 *
 * @param batches The batches.
 * @param requests The NoriSnapshot requests over the batches' blocks.
 * @returns The reads.
 */
export function readsOf(
    batches: readonly ProofQueueBatchSummary[],
    requests: readonly EnqueuedProofRequest[],
): Read[] {
    return requests
        .flatMap((request): Read[] => {
            const batch = batchOf(request.requestId, batches);
            const ethTime = ethTimeOf(request.collectionKeys[1]);
            return batch === undefined || ethTime === undefined
                ? []
                : [{ request, batch, ethTime }];
        })
        .sort((a, b) =>
            a.request.requestId < b.request.requestId
                ? 1
                : a.request.requestId > b.request.requestId
                  ? -1
                  : 0,
        );
}

/**
 * The latency at a quantile, picked as the soak report does
 * (`keeper/src/bin/soakReport.ts`): `sorted[min(n − 1, floor(q × n))]`.
 *
 * @param sorted Minutes, ascending.
 * @param q The quantile, from 0 to 1.
 * @returns The minutes, or 0 when there are none.
 */
const quantile = (sorted: readonly number[], q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

/**
 * Minutes in tenths, as they are shown, so rows compare as the reader sees them.
 *
 * @param mins Minutes.
 * @returns The tenths of a minute `toFixed(1)` shows.
 */
const tenthsOf = (mins: number): number => Math.round(Number(mins.toFixed(1)) * 10);

/**
 * A read's minutes against the median, as both are shown, to one decimal.
 *
 * @param mins The read's minutes.
 * @param median The median's minutes.
 * @returns `+2.1 min`, `−0.8 min`, or `median` when both show the same.
 */
function vsMedianOf(mins: number, median: number): string {
    const tenths = tenthsOf(mins) - tenthsOf(median);
    if (tenths === 0) return 'median';
    return `${tenths > 0 ? '+' : '−'}${(Math.abs(tenths) / 10).toFixed(1)} min`;
}

/**
 * Each read's latency: from its Ethereum block to the Solana transaction
 * that landed its batch, newest first, against the median of those shown.
 *
 * @param batches The batches.
 * @param requests The NoriSnapshot requests over the batches' blocks.
 * @param landings Each batch's landing by index, or `undefined` while they are read.
 * @returns The rows.
 */
export function rowsOf(
    batches: readonly ProofQueueBatchSummary[],
    requests: readonly EnqueuedProofRequest[],
    landings: ReadonlyMap<bigint, BatchLanding> | undefined,
): LatencyRowView[] {
    const reads = readsOf(batches, requests).map((read) => {
        const landing = landings?.get(read.batch.proofQueueBatchIndex);
        return { ...read, landing, secs: landing ? landing.atSecs - read.ethTime : undefined };
    });
    const landed = reads
        .flatMap(({ secs }) => (secs === undefined ? [] : [secs / 60]))
        .sort((a, b) => a - b);
    const median = quantile(landed, 0.5);
    const p90 = quantile(landed, 0.9);
    return reads.map(({ request, batch, ethTime, landing, secs }) => ({
        key: request.requestId.toString(),
        request: `#${request.requestId.toString()}`,
        requestUrl: transactionUrl(request.transactionHash),
        ethTime: clock(ethTime),
        batch: `#${batch.proofQueueBatchIndex.toString()}`,
        batchUrl: solanaAccountUrl(batch.proofQueueBatchAddress),
        landed: landing ? `${clock(landing.atSecs)} ↗` : landings ? '—' : '…',
        landedUrl: landing ? solanaTransactionUrl(landing.signature) : '',
        minutes: secs === undefined ? '' : minutes(secs),
        vsMedian: secs === undefined ? '' : vsMedianOf(secs / 60, median),
        aboveP90: secs !== undefined && tenthsOf(secs / 60) > tenthsOf(p90),
    }));
}
/**
 * Each read's latency in minutes, for the summary.
 *
 * @param batches The batches.
 * @param requests The NoriSnapshot requests over the batches' blocks.
 * @param landings Each batch's landing by index.
 * @returns The minutes of each read whose batch has a landing.
 */
export const latencyMinutes = (
    batches: readonly ProofQueueBatchSummary[],
    requests: readonly EnqueuedProofRequest[],
    landings: ReadonlyMap<bigint, BatchLanding>,
): number[] =>
    readsOf(batches, requests).flatMap(({ batch, ethTime }) => {
        const landing = landings.get(batch.proofQueueBatchIndex);
        return landing ? [(landing.atSecs - ethTime) / 60] : [];
    });

/**
 * The median and spread of some latencies, picked as `quantile` does.
 *
 * @param latencies Minutes, in any order.
 * @returns `24 reads · median 18.1 min · p90 20.7 · min 15.2 · max 22.4`, or `''` when empty.
 */
export function summaryOf(latencies: readonly number[]): string {
    const n = latencies.length;
    if (n === 0) return '';
    const sorted = [...latencies].sort((a, b) => a - b);
    const pick = (q: number): string => quantile(sorted, q).toFixed(1);
    return `${n.toString()} read${n === 1 ? '' : 's'} · median ${pick(0.5)} min · p90 ${pick(0.9)} · min ${pick(0)} · max ${pick(1)}`;
}
