import { map, NEVER } from 'rxjs';
import { address, type Address } from '@solana/kit';
import {
    dueOn,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { snapshotResultSimulation$ } from './noriRead.js';
import { SnapshotResultSimulationGraph } from './snapshotResultSimulation.js';
import { type SnapshotResultWitnessArgs } from './snapshotWitness.js';

/** The result a simulation is made for. */
export interface SnapshotResultSimulationRequest {
    /** The proof queue batch Nori proved the snapshot in, base58. */
    proofQueueBatchAddress: string;
    /** The query whose result is verified. */
    queryId: string;
    /** The result's witness, from the snapshot's event and the request's path in the batch. */
    witness: SnapshotResultWitnessArgs;
}

/**
 * Starts verifying one snapshot result on Solana through the Solana
 * connection: a simulation of nori-read-example's `read_snapshot_result`
 * with the result's witness. A simulation against a committed batch never
 * changes, so it is never run again once it verifies.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param noriSnapshot The `NoriSnapshot` address.
 * @param feePayer An existing system account holding SOL: the simulation's fee payer, which pays nothing.
 * @param request The batch, the query and its witness.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries what the program verified and what it cost. Its controls:
 *   - `retry()`: simulates again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createSnapshotResultSimulationMachine = (
    connections: ProofRequestConnections,
    noriSnapshot: string,
    feePayer: Address,
    request: SnapshotResultSimulationRequest,
    backoff: ReadRetryBackoff = {}
) =>
    startReadThroughConnectionsMachine(SnapshotResultSimulationGraph, {
        connections,
        read: (clients, { proofQueueBatchAddress, queryId, witness }) =>
            clients
                .solana((rpc) =>
                    snapshotResultSimulation$(rpc, {
                        proofQueueBatch: address(proofQueueBatchAddress),
                        noriSnapshot,
                        queryId,
                        witness,
                        feePayer,
                    })
                )
                .pipe(
                    map(({ read, unitsConsumed }) => ({
                        proofQueueBatchAddress,
                        queryId,
                        witness,
                        read,
                        unitsConsumed,
                    }))
                ),
        refreshOn: () => dueOn(NEVER),
        needs: ['solana'],
        backoff,
        // The batch, the query and the witness it is made for are its starting data.
        start: {
            node: 'loading',
            data: {
                ...request,
                read: undefined,
                unitsConsumed: undefined,
                failedReads: 0,
            },
        },
    });
