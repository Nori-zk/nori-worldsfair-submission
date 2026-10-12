import { type ProofQueueBatchSummary } from '@nori-zk/nori-bridge-solana-sdk';
import { type SignatureEntry } from './batch-landing.js';
import { batchOf } from './latency.js';

/** One entry of `getSignaturesForAddress`, as far as the match reads it. */
export type ReadSignature = Pick<SignatureEntry, 'signature' | 'err'>;

/** A keeper read of a snapshot: a guard's transaction that also names the snapshot's batch. */
export interface KeeperRead {
    /** The proof queue batch account the read verified against. */
    batch: string;
    /** The backing and pause queries of the guard that read it, 0x-hex, lowercase. */
    queryIds: string[];
    signature: string;
}

/**
 * The keeper's reads of some batches: each successful transaction found on
 * both a guard and a batch. A `submit_read` names exactly those two accounts
 * besides the mint and the program, so no memo is needed to find it.
 *
 * @param guards Each guard's backing and pause queries (lowercase) and signatures.
 * @param batches Each batch account and its signatures, newest first.
 * @returns The reads, by batch in the order given, each batch's newest first.
 */
export function keeperReadsOf(
    guards: readonly { queryIds: string[]; signatures: readonly ReadSignature[] }[],
    batches: readonly { batch: string; signatures: readonly ReadSignature[] }[],
): KeeperRead[] {
    const queriesOf = new Map<string, string[]>();
    for (const { queryIds, signatures } of guards)
        for (const { signature, err } of signatures)
            if (err === null) queriesOf.set(signature, queryIds);
    return batches.flatMap(({ batch, signatures }) =>
        signatures.flatMap(({ signature, err }) => {
            const queryIds = err === null ? queriesOf.get(signature) : undefined;
            return queryIds === undefined ? [] : [{ batch, queryIds, signature }];
        }),
    );
}

/**
 * The batch accounts that hold some proof requests, each once.
 *
 * @param requestIds The requests, e.g. the snapshots shown.
 * @param batches The batches known (`batchOf`); a request in none of them is left out.
 * @returns The batch addresses, in the requests' order.
 */
export const batchAddressesOf = (
    requestIds: readonly bigint[],
    batches: readonly ProofQueueBatchSummary[],
): string[] => [
    ...new Set(
        requestIds.flatMap(
            (requestId) => batchOf(requestId, batches)?.proofQueueBatchAddress ?? [],
        ),
    ),
];

/**
 * The lowest batch that can hold a proof request: every committed batch holds
 * at least one request, so the requests from `requestId` to the queue cursor
 * fill at most that many of the newest batches.
 *
 * @param requestId The request.
 * @param queueCursor The bridge's queue cursor: the first request no batch holds.
 * @param batchCount How many batches the bridge holds.
 * @returns The batch index to read from, between 0 and `batchCount`.
 */
export function lowestBatchOf(requestId: bigint, queueCursor: bigint, batchCount: bigint): bigint {
    const index = batchCount - (queueCursor - requestId);
    return index < 0n ? 0n : index > batchCount ? batchCount : index;
}
