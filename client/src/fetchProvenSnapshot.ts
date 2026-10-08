import { address, type Address } from '@solana/kit';
import {
    ProofRequestState,
    forCalls,
    getProofRequestStateSnapshot,
    getProofRequestWitness,
    type Ethereum,
    type EthereumProvider,
    type Solana,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    parseSnapshotEvent,
    snapshotResultWitness,
    type SnapshotEvent,
    type SnapshotResultWitnessArgs,
} from './snapshotWitness.js';

export interface ProvenSnapshotRequest {
    /** The sdk's chains, from `createConnections`. */
    connections: { ethereum: Ethereum; solana: Solana };
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

const fetchReceipt = (provider: EthereumProvider, hash: string) =>
    provider.getTransactionReceipt(hash);

/**
 * A snapshot transaction and, once Nori has proven its batch, everything
 * needed to verify any of its results: the batch account, and the request's
 * path in it (fetched once, shared by every query).
 */
export async function fetchProvenSnapshot(
    request: ProvenSnapshotRequest
): Promise<ProvenSnapshot> {
    const { ethereum } = request.connections;
    const receipt = await forCalls(
        ethereum,
        fetchReceipt,
        request.snapshotTxHash
    );
    if (!receipt) throw new Error(`No receipt for ${request.snapshotTxHash}`);
    const event = parseSnapshotEvent(receipt, request.noriSnapshot);

    const state = await getProofRequestStateSnapshot(request.connections, {
        proofQueueAddress: request.proofQueue,
        proofRequestTxHash: request.snapshotTxHash,
        programAddress: request.noriProgram,
    });
    if (state.state !== ProofRequestState.ProofAvailable)
        return { proven: false, event };

    const requestWitness = await getProofRequestWitness(
        ethereum,
        state,
        request.proofQueue
    );
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
