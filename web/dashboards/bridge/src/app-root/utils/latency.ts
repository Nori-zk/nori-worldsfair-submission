import {
    type EnqueuedProofRequest,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { asciiBar, UNKNOWN_BAR } from './ascii.js';
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
    bar: string;
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
 * Each read's latency: from its Ethereum block to the Solana transaction
 * that landed its batch, newest first, with a bar against the largest shown.
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
    const longest = Math.max(0, ...reads.map(({ secs }) => secs ?? 0));
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
        bar:
            secs === undefined
                ? landings
                    ? ''
                    : UNKNOWN_BAR
                : asciiBar(longest > 0 ? secs / longest : 0),
    }));
}
