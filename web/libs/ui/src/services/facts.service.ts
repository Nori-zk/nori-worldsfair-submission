import { Injectable } from '@yaw-rx/core';
import {
    BehaviorSubject,
    combineLatest,
    distinctUntilChanged,
    filter,
    map,
    type Observable,
    scan,
    shareReplay,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import {
    createBridgeStateMachine,
    createCommittedProofQueueBatchesMachine,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type GuardState } from '@nori-zk/backstop-keeper/guard';
import { followedStates$ } from '@nori-zk/backstop-keeper/read';
import { ConnectionsService } from './connections.service.js';
import { GuardBoardService } from './guard-board.service.js';
import { createKeeperReadsMachine } from '../machines/keeperReads.impl.js';
import { createSnapshotFactsMachine } from '../machines/snapshotFacts.impl.js';
import { type SnapshotFact, type SnapshotFactsState } from '../machines/snapshotFacts.js';
import { batchAddressesOf, type KeeperRead, lowestBatchOf } from '../utils/keeper-reads.js';

export type { SnapshotFact } from '../machines/snapshotFacts.js';

/** The snapshots, how far Nori has proven, the guards that name queries, and the keeper's reads. */
export interface Facts {
    /** The newest snapshots, newest first. */
    snapshots: SnapshotFact[];
    /** The first request id Nori has not proven yet. */
    queueCursor: bigint;
    /** The guards, for naming their backing and pause queries. */
    guards: GuardState[];
    /** The committed batches from the oldest snapshot's on, for each snapshot's batch (`batchOf`). */
    batches: ProofQueueBatchSummary[];
    /** The keeper's reads of the shown snapshots' batches; none before the first read. */
    keeperReads: KeeperRead[];
}

/**
 * The snapshots a snapshot facts state holds: none before the first read.
 *
 * @param state The snapshot facts machine's state.
 * @returns The snapshots, newest first.
 */
const snapshotsOf = (state: SnapshotFactsState): SnapshotFact[] =>
    'snapshots' in state.data ? state.data.snapshots : [];

/**
 * The facts tab's reads, each a machine kept current: the newest snapshots
 * (again on each `Snapshot` event), the bridge's state on Solana (again on
 * each change of its state account), the guards (the guard board's), and
 * the committed batches from the oldest snapshot's on (again as each is
 * committed), and the keeper's reads of the snapshots shown, found through
 * their batch accounts and the guards (again as the guards' reads move or the
 * snapshots shown change).
 */
@Injectable([ConnectionsService, GuardBoardService])
export class FactsService {
    /** The snapshot facts machine's states. */
    readonly state$: Observable<SnapshotFactsState>;
    /**
     * The facts, as the machines hold them: the snapshots read so far (none
     * before the first read), once the bridge's state is read; `undefined`
     * until it is, as which snapshots are proven is not known yet.
     */
    readonly facts$: Observable<Facts | undefined>;
    private readonly snapshots: ReturnType<typeof createSnapshotFactsMachine>;
    private readonly bridgeState: ReturnType<typeof createBridgeStateMachine>;
    private readonly keeperReads: ReturnType<typeof createKeeperReadsMachine>;
    /** How many of the newest snapshots the page shows (`show`). */
    private readonly shown$ = new BehaviorSubject(0);

    /**
     * @param connections The connections: snapshots from Ethereum, the queue cursor from Solana.
     * @param guardBoard The guards, to name their queries and find the keeper's reads on.
     */
    constructor(connections: ConnectionsService, guardBoard: GuardBoardService) {
        this.snapshots = createSnapshotFactsMachine(connections.connections, {
            snapshotAddress: NORI_WEB_ENV.ethereum.snapshotAddress,
            deployBlock: NORI_WEB_ENV.ethereum.proofQueueDeployBlock,
        });
        this.bridgeState = createBridgeStateMachine(
            connections.connections,
            NORI_WEB_ENV.solana.programAddress,
        );
        // The committed batches from the lowest that can hold the oldest snapshot of the first
        // read (later reads only add newer ones), each kept as the sdk's machine brings it.
        const batches$: Observable<ProofQueueBatchSummary[]> = combineLatest([
            this.snapshots.state$,
            this.bridgeState.state$,
        ]).pipe(
            map(([snapshots, bridge]) => {
                const oldest = snapshotsOf(snapshots).at(-1);
                const state = 'bridgeState' in bridge.data ? bridge.data.bridgeState : undefined;
                return oldest === undefined || state === undefined
                    ? undefined
                    : lowestBatchOf(
                          oldest.requestId,
                          state.queueCursor,
                          state.proofQueueBatchCount,
                      );
            }),
            filter((fromIndex) => fromIndex !== undefined),
            take(1),
            switchMap((fromIndex) =>
                followedStates$(() =>
                    createCommittedProofQueueBatchesMachine(
                        connections.connections,
                        fromIndex,
                        NORI_WEB_ENV.solana.programAddress,
                    ),
                ),
            ),
            scan(
                (held: ProofQueueBatchSummary[], state) =>
                    state.node === 'current'
                        ? [
                              ...held,
                              ...state.data.committed.filter(
                                  ({ proofQueueBatchIndex }) =>
                                      !held.some(
                                          (b) => b.proofQueueBatchIndex === proofQueueBatchIndex,
                                      ),
                              ),
                          ]
                        : held,
                [],
            ),
            distinctUntilChanged((a, b) => a.length === b.length),
            startWith([]),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        // One batch read per shown snapshot a committed batch holds, i.e. each proven one.
        const shownBatches$ = combineLatest([this.snapshots.state$, batches$, this.shown$]).pipe(
            map(([snapshots, batches, shown]) =>
                batchAddressesOf(
                    snapshotsOf(snapshots)
                        .slice(0, shown)
                        .map(({ requestId }) => requestId),
                    batches,
                ),
            ),
            distinctUntilChanged((a, b) => a.join() === b.join()),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        this.keeperReads = createKeeperReadsMachine(
            connections.connections,
            guardBoard.board,
            shownBatches$,
        );
        this.state$ = this.snapshots.state$;
        this.facts$ = combineLatest([
            this.snapshots.state$,
            this.bridgeState.state$,
            guardBoard.state$,
            batches$,
            this.keeperReads.state$,
        ]).pipe(
            map(([snapshots, bridge, board, batches, reads]) =>
                'bridgeState' in bridge.data && bridge.data.bridgeState !== undefined
                    ? {
                          snapshots: snapshotsOf(snapshots),
                          queueCursor: bridge.data.bridgeState.queueCursor,
                          guards:
                              'guards' in board.data
                                  ? board.data.guards.map(({ guard }) => guard)
                                  : [],
                          batches,
                          keeperReads: 'reads' in reads.data ? reads.data.reads : [],
                      }
                    : undefined,
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    /**
     * Says how many of the newest snapshots the page shows, whose keeper reads are read.
     * @param count How many.
     * @returns {void}
     */
    show(count: number): void {
        this.shown$.next(count);
    }

    /**
     * Closes the reads with the app.
     * @returns {void}
     */
    onDestroy(): void {
        this.keeperReads.close();
        this.snapshots.close();
        this.bridgeState.close();
    }
}
