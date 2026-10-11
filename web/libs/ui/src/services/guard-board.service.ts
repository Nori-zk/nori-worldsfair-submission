import { Injectable } from '@yaw-rx/core';
import { type Observable } from 'rxjs';
import { ConnectionsService } from './connections.service.js';
import { createGuardBoardMachine } from '../machines/guardBoard.impl.js';
import { type GuardBoardState } from '../machines/guardBoard.js';

/**
 * Owns the guard board machine: every Backstop guard on the cluster with
 * its mint's live supply, read through Solana's connection and again on
 * each transaction calling Backstop and every 30 s.
 */
@Injectable([ConnectionsService])
export class GuardBoardService {
    /** The running guard board machine. */
    readonly board: ReturnType<typeof createGuardBoardMachine>;

    /**
     * @param connections The connections; the guards are read over Solana's.
     */
    constructor(connections: ConnectionsService) {
        this.board = createGuardBoardMachine(connections.connections);
    }

    /** The guard board's states. */
    get state$(): Observable<GuardBoardState> {
        return this.board.state$;
    }

    /**
     * Closes the guard board with the app.
     * @returns {void}
     */
    onDestroy(): void {
        this.board.close();
    }
}
