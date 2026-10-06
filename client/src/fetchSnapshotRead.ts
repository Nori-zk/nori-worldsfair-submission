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

export interface SnapshotReadRequest {
    rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
    provider: Provider;
    noriSnapshot: string;
    proofQueue: string;
    /** The transaction that called `NoriSnapshot.snapshot`. */
    snapshotTxHash: string;
    queryId: string;
    /** The Nori program; defaults to the sdk's. */
    noriProgram?: Address;
}

export type SnapshotRead =
    | { proven: false; event: SnapshotEvent }
    | {
          proven: true;
          event: SnapshotEvent;
          proofQueueBatch: Address;
          witness: SnapshotResultWitnessArgs;
      };

/**
 * From a snapshot transaction to the witness a Solana program verifies, once
 * Nori has proven its batch; until then `proven` is false.
 */
export async function fetchSnapshotRead(
    request: SnapshotReadRequest
): Promise<SnapshotRead> {
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
        witness: snapshotResultWitness(
            request.noriSnapshot,
            event,
            request.queryId,
            requestWitness
        ),
    };
}
