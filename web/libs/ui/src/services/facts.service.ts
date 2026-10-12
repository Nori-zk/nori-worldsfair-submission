import { Injectable } from '@yaw-rx/core';
import { combineLatest, map, type Observable, shareReplay } from 'rxjs';
import { createBridgeStateMachine } from '@nori-zk/nori-bridge-solana-sdk';
import { type GuardState } from '@nori-zk/backstop-keeper/guard';
import { type SnapshotReadTransaction } from '@nori-zk/backstop-keeper/read';
import { ConnectionsService } from './connections.service.js';
import { GuardBoardService } from './guard-board.service.js';
import { createKeeperReadsMachine } from '../machines/keeperReads.impl.js';
import { createSnapshotFactsMachine } from '../machines/snapshotFacts.impl.js';
import { type SnapshotFact, type SnapshotFactsState } from '../machines/snapshotFacts.js';

export type { SnapshotFact } from '../machines/snapshotFacts.js';

/** The snapshots, how far Nori has proven, the guards that name queries, and the keeper's reads. */
export interface Facts {
    /** The newest snapshots, newest first. */
    snapshots: SnapshotFact[];
    /** The first request id Nori has not proven yet. */
    queueCursor: bigint;
    /** The guards, for naming their backing and pause queries. */
    guards: GuardState[];
    /** The keeper's transactions on the guards that name a snapshot; none before the first read. */
    keeperReads: SnapshotReadTransaction[];
}

/**
 * The facts tab's reads, each a machine kept current: the newest snapshots
 * (again on each `Snapshot` event), the bridge's state on Solana (again on
 * each change of its state account), the guards (the guard board's), and
 * the keeper's reads on them (again as their reads move).
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
        this.keeperReads = createKeeperReadsMachine(connections.connections, guardBoard.board);
        this.state$ = this.snapshots.state$;
        this.facts$ = combineLatest([
            this.snapshots.state$,
            this.bridgeState.state$,
            guardBoard.state$,
            this.keeperReads.state$,
        ]).pipe(
            map(([snapshots, bridge, board, reads]) =>
                'bridgeState' in bridge.data && bridge.data.bridgeState !== undefined
                    ? {
                          snapshots: 'snapshots' in snapshots.data ? snapshots.data.snapshots : [],
                          queueCursor: bridge.data.bridgeState.queueCursor,
                          guards:
                              'guards' in board.data
                                  ? board.data.guards.map(({ guard }) => guard)
                                  : [],
                          keeperReads: 'transactions' in reads.data ? reads.data.transactions : [],
                      }
                    : undefined,
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
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
