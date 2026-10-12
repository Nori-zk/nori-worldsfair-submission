import {
    catchError,
    concat,
    concatMap,
    from,
    map,
    type Observable,
    of,
    reduce,
    switchMap,
} from 'rxjs';
import { type Address } from '@solana/kit';
import {
    type ProofRequestConnections,
    readMachineChanged$,
    readMachineValue$,
    type ReadRetryBackoff,
    type SolanaRpc,
    solanaRpcRead$,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    type SnapshotReadTransaction,
    snapshotReadTransactionsOf,
} from '@nori-zk/backstop-keeper/read';
import { type GuardRead } from './guardBoard.js';
import { type GuardBoardMachine } from './guardBoard.impl.js';
import { KeeperReadsGraph } from './keeperReads.js';

/**
 * How many signatures one guard's read covers: about 13 hours of a keeper's
 * transactions (a checkpoint every 2 min, two reads every 15 min), more than
 * the 25 snapshots the page shows span.
 */
const GUARD_SIGNATURES = 500;

/**
 * The keeper's reads on some guards: one signature read per guard, one at a time.
 *
 * @param rpc The Solana RPC.
 * @param guards The guard accounts.
 * @returns The transactions whose memo names a snapshot, once.
 */
const keeperReads$ = (rpc: SolanaRpc, guards: Address[]): Observable<SnapshotReadTransaction[]> =>
    from(guards).pipe(
        concatMap((guard) =>
            solanaRpcRead$(
                async (abortSignal) =>
                    rpc
                        .getSignaturesForAddress(guard, { limit: GUARD_SIGNATURES })
                        .send({ abortSignal }),
                `Failed to read guard ${guard}'s transactions.`,
            ),
        ),
        reduce(
            (found: SnapshotReadTransaction[], signatures) => [
                ...found,
                ...snapshotReadTransactionsOf(signatures),
            ],
            [],
        ),
    );

/**
 * Each guard and the Ethereum blocks of its last reads, which move with each read applied.
 *
 * @param guards The guards the guard board holds.
 * @returns `<address>:<backing block>:<pause block>` per guard.
 */
const readBlocksOf = (guards: GuardRead[]): string[] =>
    guards.map(
        ({ address, guard }) =>
            `${address}:${guard.backingEthBlock.toString()}:${guard.pauseEthBlock.toString()}`,
    );

/** The running keeper reads machine, with its controls. */
export type KeeperReadsMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof KeeperReadsGraph.nodes,
        typeof KeeperReadsGraph.edges
    >
>;

/**
 * Starts reading the keeper's reads on each guard the guard board holds,
 * through the Solana connection, and reading again each time a guard's last
 * backing or pause read moves.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param guardBoard The running guard board machine, from `createGuardBoardMachine`, which its creator owns.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the transactions. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createKeeperReadsMachine = (
    connections: ProofRequestConnections,
    guardBoard: GuardBoardMachine,
    backoff: ReadRetryBackoff = {},
): KeeperReadsMachine =>
    startReadThroughConnectionsMachine(KeeperReadsGraph, {
        connections,
        read: (clients) =>
            readMachineValue$(guardBoard).pipe(
                switchMap(({ guards }) =>
                    clients
                        .solana((rpc) =>
                            keeperReads$(
                                rpc,
                                guards.map(({ address }) => address),
                            ),
                        )
                        .pipe(
                            map((transactions) => ({
                                readBlocks: readBlocksOf(guards),
                                transactions,
                            })),
                        ),
                ),
            ),
        // Following once the guard board holds its guards (or failed, which fails the read):
        // the reads wait in `loading` until then. A refresh is due when a guard's reads move.
        refreshOn: ({ readBlocks }) =>
            concat(
                readMachineValue$(guardBoard).pipe(
                    map((): void => undefined),
                    catchError(() => of(undefined)),
                ),
                readMachineChanged$(
                    guardBoard,
                    ({ guards }) => readBlocksOf(guards).join() !== readBlocks.join(),
                ),
            ),
        needs: ['solana'],
        backoff,
    });
