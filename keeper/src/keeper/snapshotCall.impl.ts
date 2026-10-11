import { map, switchMap } from 'rxjs';
import {
    changesOf$,
    createChainChangesMachine,
    ethRpcRead$,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { SnapshotCallGraph } from './snapshotCall.js';

/** One query a snapshot makes: the contract and its calldata. */
export interface SnapshotQuery {
    target: string;
    data: string;
}

/**
 * Starts reading what one NoriSnapshot transaction covering `queries` would
 * commit now, through the Ethereum connection, and again on each new block.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param noriSnapshot The `NoriSnapshot` address.
 * @param queries The queries the snapshot makes.
 * @param from The keeper's Ethereum address, which sends the snapshot.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the fee and the results root. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createSnapshotCallMachine = (
    connections: ProofRequestConnections,
    noriSnapshot: string,
    queries: SnapshotQuery[],
    from: string,
    backoff: ReadRetryBackoff = {}
) => {
    const newBlocks = createChainChangesMachine(connections.ethereum);
    return startReadThroughConnectionsMachine(SnapshotCallGraph, {
        connections,
        read: (clients) =>
            clients.ethereum((provider) => {
                const contract = NoriSnapshot__factory.connect(
                    noriSnapshot,
                    provider
                );
                return ethRpcRead$(
                    () => contract.snapshotFee(),
                    'Failed to read the snapshot fee.'
                ).pipe(
                    switchMap((fee) =>
                        ethRpcRead$(
                            () =>
                                contract.snapshot.staticCall(queries, {
                                    value: fee,
                                    from,
                                }),
                            'Failed to call NoriSnapshot.snapshot.'
                        ).pipe(map(({ resultsRoot }) => ({ fee, resultsRoot })))
                    )
                );
            }),
        refreshOn: () => changesOf$(newBlocks),
        needs: ['ethereum'],
        backoff,
        owns: [newBlocks],
    });
};
