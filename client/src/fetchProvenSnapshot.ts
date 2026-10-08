import {
    address,
    type Address,
    type GetAccountInfoApi,
    type GetMultipleAccountsApi,
    type Rpc,
} from '@solana/kit';
import type { Provider } from 'ethers';
import {
    ProofRequestState,
    fetchProofRequestWitness,
    getProofRequestStateSnapshot,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    parseSnapshotEvent,
    snapshotResultWitness,
    type SnapshotEvent,
    type SnapshotResultWitnessArgs,
} from './snapshotWitness.js';

export interface ProvenSnapshotRequest {
    rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
    provider: Provider;
    noriSnapshot: string;
    proofQueue: string;
    /** The transaction that called `NoriSnapshot.snapshot`. */
    snapshotTxHash: string;
    /** The Nori program; defaults to the sdk's. */
    noriProgram?: Address;
}

export type ProvenSnapshot =
    | { proven: false; event: SnapshotEvent }
    | {
          proven: true;
          event: SnapshotEvent;
          proofQueueBatch: Address;
          /** The witness a Solana program verifies for one query's result. */
          witnessFor(queryId: string): SnapshotResultWitnessArgs;
      };

/**
 * A snapshot transaction and, once Nori has proven its batch, everything
 * needed to verify any of its results: the batch account, and the request's
 * path in it (fetched once, shared by every query).
 */
export async function fetchProvenSnapshot(
    request: ProvenSnapshotRequest
): Promise<ProvenSnapshot> {
    const receipt = await request.provider.getTransactionReceipt(
        request.snapshotTxHash
    );
    if (!receipt) throw new Error(`No receipt for ${request.snapshotTxHash}`);
    const event = parseSnapshotEvent(receipt, request.noriSnapshot);

    const state = await getProofRequestStateSnapshot({
        rpc: request.rpc,
        provider: request.provider,
        proofQueueAddress: request.proofQueue,
        proofRequestTxHash: request.snapshotTxHash,
        programAddress: request.noriProgram,
    });
    if (state.state !== ProofRequestState.ProofAvailable)
        return { proven: false, event };

    const requestWitness = await fetchProofRequestWitness(state, {
        provider: request.provider,
        proofQueueAddress: request.proofQueue,
    });
    return {
        proven: true,
        event,
        proofQueueBatch: address(state.proofQueueBatchAddress),
        witnessFor: (queryId) =>
            snapshotResultWitness(
                request.noriSnapshot,
                event,
                queryId,
                requestWitness
            ),
    };
}
