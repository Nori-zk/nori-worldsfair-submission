import { map, NEVER } from 'rxjs';
import {
    changesOf$,
    createChainChangesMachine,
    dueOn,
    ethRpcRead$,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { SnapshotEventGraph } from './snapshotEvent.js';
import { parseSnapshotEvent } from './snapshotWitness.js';

/**
 * Starts reading a snapshot transaction's `Snapshot` event from its receipt
 * through the Ethereum connection: again on each new block until the
 * transaction is mined, then never again. A mined transaction without
 * `noriSnapshot`'s `Snapshot` event fails the read.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param noriSnapshot The `NoriSnapshot` address.
 * @param snapshotTxHash The transaction that called `NoriSnapshot.snapshot`.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the event once mined. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createSnapshotEventMachine = (
    connections: ProofRequestConnections,
    noriSnapshot: string,
    snapshotTxHash: string,
    backoff: ReadRetryBackoff = {}
) => {
    const newBlocks = createChainChangesMachine(connections.ethereum);
    return startReadThroughConnectionsMachine(SnapshotEventGraph, {
        connections,
        read: (clients, { snapshotTxHash: held }) =>
            clients
                .ethereum((provider) =>
                    ethRpcRead$(
                        () => provider.getTransactionReceipt(held),
                        `Failed to read the receipt of ${held}.`
                    )
                )
                .pipe(
                    map((receipt) => ({
                        snapshotTxHash: held,
                        event:
                            receipt === null
                                ? undefined
                                : parseSnapshotEvent(receipt, noriSnapshot),
                    }))
                ),
        refreshOn: ({ event }) =>
            event ? dueOn(NEVER) : changesOf$(newBlocks),
        needs: ['ethereum'],
        backoff,
        owns: [newBlocks],
        // The transaction it is made for is its starting data.
        start: {
            node: 'loading',
            data: { snapshotTxHash, event: undefined, failedReads: 0 },
        },
    });
};
