import {
    catchError,
    concatMap,
    forkJoin,
    from,
    map,
    merge,
    type Observable,
    of,
    skip,
    startWith,
    switchMap,
    take,
    toArray,
} from 'rxjs';
import { address, type Address } from '@solana/kit';
import {
    type ProofRequestConnections,
    readMachineChanged$,
    readMachineValue$,
    type ReadRetryBackoff,
    type SolanaRpc,
    solanaRpcRead$,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type KeeperRead, keeperReadsOf, type ReadSignature } from '../utils/keeper-reads.js';
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
 * How many signatures one batch's read covers. Once its update created it,
 * only reads name a batch account (the next update names the next batch),
 * so its reads are its newest signatures: a few per guard.
 */
const BATCH_SIGNATURES = 50;

/**
 * An account's newest signatures.
 *
 * @param rpc The Solana RPC.
 * @param account The account.
 * @param limit How many.
 * @param what The account, for the error.
 * @returns Its signatures, newest first, once.
 */
const signaturesOf$ = (
    rpc: SolanaRpc,
    account: Address,
    limit: number,
    what: string,
): Observable<readonly ReadSignature[]> =>
    solanaRpcRead$(
        async (abortSignal) =>
            rpc.getSignaturesForAddress(account, { limit }).send({ abortSignal }),
        `Failed to read ${what}'s transactions.`,
    );

/**
 * The keeper's reads of some batches: one signature read per guard, then one
 * per batch, one at a time.
 *
 * @param rpc The Solana RPC.
 * @param guards The guards.
 * @param batches The batch accounts.
 * @returns The reads (`keeperReadsOf`), once.
 */
const keeperReads$ = (
    rpc: SolanaRpc,
    guards: GuardRead[],
    batches: string[],
): Observable<KeeperRead[]> =>
    from(guards).pipe(
        concatMap(({ address: guard, guard: { config } }) =>
            signaturesOf$(rpc, guard, GUARD_SIGNATURES, `guard ${guard}`).pipe(
                map((signatures) => ({
                    queryIds: [config.backingQuery, config.pauseQuery].map((id) =>
                        id.toLowerCase(),
                    ),
                    signatures,
                })),
            ),
        ),
        toArray(),
        switchMap((guardSignatures) =>
            from(batches).pipe(
                concatMap((batch) =>
                    signaturesOf$(rpc, address(batch), BATCH_SIGNATURES, `batch ${batch}`).pipe(
                        map((signatures) => ({ batch, signatures })),
                    ),
                ),
                toArray(),
                map((batchSignatures) => keeperReadsOf(guardSignatures, batchSignatures)),
            ),
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
        ({ address: account, guard }) =>
            `${account}:${guard.backingEthBlock.toString()}:${guard.pauseEthBlock.toString()}`,
    );

/** The running keeper reads machine, with its controls. */
export type KeeperReadsMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof KeeperReadsGraph.nodes,
        typeof KeeperReadsGraph.edges
    >
>;

/**
 * Starts reading the keeper's reads of the batches shown, on each guard the
 * guard board holds, through the Solana connection, and reading again each
 * time a guard's last backing or pause read moves or the batches shown change.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param guardBoard The running guard board machine, from `createGuardBoardMachine`, which its creator owns.
 * @param batches$ The batch accounts of the snapshots shown (`batchAddressesOf`): it must replay its latest and emit only changes.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the reads. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createKeeperReadsMachine = (
    connections: ProofRequestConnections,
    guardBoard: GuardBoardMachine,
    batches$: Observable<string[]>,
    backoff: ReadRetryBackoff = {},
): KeeperReadsMachine =>
    startReadThroughConnectionsMachine(KeeperReadsGraph, {
        connections,
        read: (clients) =>
            forkJoin([readMachineValue$(guardBoard), batches$.pipe(take(1))]).pipe(
                switchMap(([{ guards }, batches]) =>
                    (batches.length === 0
                        ? of([])
                        : clients.solana((rpc) => keeperReads$(rpc, guards, batches))
                    ).pipe(map((reads) => ({ batches, reads }))),
                ),
            ),
        // Following once the guard board holds its guards (or failed, which fails the read):
        // the reads wait in `loading` until then. A refresh is due when a guard's reads move
        // past those the read takes, or when the batches shown change (the latest, which the
        // read takes, is skipped), so one change brings one read, not two.
        refreshOn: () =>
            readMachineValue$(guardBoard).pipe(
                map(({ guards }) => readBlocksOf(guards).join()),
                catchError(() => of('')),
                switchMap((readBlocks) =>
                    merge(
                        readMachineChanged$(
                            guardBoard,
                            ({ guards }) => readBlocksOf(guards).join() !== readBlocks,
                        ),
                        batches$.pipe(skip(1)),
                    ).pipe(startWith(undefined)),
                ),
            ),
        needs: ['solana'],
        backoff,
    });
