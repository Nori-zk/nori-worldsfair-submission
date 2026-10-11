import { Injectable } from '@yaw-rx/core';
import { map, type Observable, type ObservedValueOf } from 'rxjs';
import {
    type Arrived,
    getNoriBridgeInfraTransitions,
    noriBridgeInfraEthState$,
    noriBridgeInfraState$,
    noriBridgeInfraTimings$,
    type NoriBridgeInfraStage,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from './connections.service.js';

/** The bridge's state from Nori's `state.bridge`: its stage, the Ethereum blocks it proves and the time in the stage. */
export type NoriBridgeInfraState = ObservedValueOf<ReturnType<typeof noriBridgeInfraState$>>;

/** Ethereum's finality as Nori reports it: the finalized block and its slot. */
export type NoriBridgeInfraFinality = ObservedValueOf<ReturnType<typeof noriBridgeInfraEthState$>>;

/**
 * The app's handle on Nori's bridge, which the sdk opens once with the
 * app's connections: whether the websocket is open, the bridge's state and
 * Ethereum's finality (stamped as they arrive), the stage the bridge is at,
 * and the stage timings.
 */
@Injectable([ConnectionsService])
export class NoriBridgeInfraService {
    /** Whether Nori's websocket is open. */
    readonly open$: Observable<boolean>;
    /** The bridge's state, stamped as it arrived; replays the latest. */
    readonly state$: Observable<Arrived<NoriBridgeInfraState>>;
    /** The node the bridge is at: from `state.bridge`, then each transition notice. */
    readonly stage$: Observable<NoriBridgeInfraStage>;
    /** The seconds each stage of the bridge's last job took, from Nori's timings; replays the latest. */
    readonly timings$: Observable<Partial<Record<string, number>>>;
    /** Ethereum's finalized block and its slot, from Nori's `state.eth`, stamped as they arrived; replays the latest. */
    readonly finality$: Observable<Arrived<NoriBridgeInfraFinality>>;

    /**
     * @param connections The connections, Nori's among them.
     */
    constructor(connections: ConnectionsService) {
        const { nori } = connections.connections;
        this.open$ = nori.websocket.connection.state$.pipe(map((state) => state.node === 'open'));
        this.state$ = nori.bridgeState$;
        this.finality$ = nori.finality$;
        this.stage$ = getNoriBridgeInfraTransitions(nori).stage$.pipe(map(({ stage }) => stage));
        this.timings$ = noriBridgeInfraTimings$(nori).pipe(
            map((message): Partial<Record<string, number>> => message.extension),
        );
    }
}
