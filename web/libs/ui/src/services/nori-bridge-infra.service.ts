import { Injectable } from '@yaw-rx/core';
import {
    distinctUntilChanged,
    filter,
    map,
    merge,
    type Observable,
    type ObservedValueOf,
    shareReplay,
} from 'rxjs';
import {
    getNoriBridgeInfraEthState$,
    getNoriBridgeInfraState$,
    getNoriBridgeInfraTimings$,
    startNoriBridgeInfraTransitions,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from './connections.service.js';
import {
    NORI_BRIDGE_INFRA_STAGE_TEXT,
    type NoriBridgeInfraStage,
} from '../text/noriBridgeInfraStages.js';

/** The bridge's state from Nori's `state.bridge`: its stage, the Ethereum blocks it proves and the time in the stage. */
export type NoriBridgeInfraState = ObservedValueOf<ReturnType<typeof getNoriBridgeInfraState$>>;

/** Ethereum's finality as Nori reports it: the finalized block and its slot. */
export type NoriBridgeInfraFinality = ObservedValueOf<
    ReturnType<typeof getNoriBridgeInfraEthState$>
>;

/**
 * Whether a stage name is a node of Nori's bridge infra transition graph.
 *
 * @param name A stage name from `state.bridge` or a transition notice.
 * @returns `true` for a node.
 */
const isStage = (name: string): name is NoriBridgeInfraStage =>
    name in NORI_BRIDGE_INFRA_STAGE_TEXT;

/**
 * Nori's bridge from its websocket, one for the app: whether the websocket
 * is open, the bridge's state, the same with the time left in its stage, and
 * the node of the transition graph it is at.
 */
@Injectable([ConnectionsService])
export class NoriBridgeInfraService {
    /** Whether Nori's websocket is open. */
    readonly open$: Observable<boolean>;
    /** The bridge's state; replays the latest. */
    readonly state$: Observable<NoriBridgeInfraState>;
    /**
     * The node the bridge is at: its stage from `state.bridge` as soon as the
     * websocket opens, then each transition notice, the failures and
     * `BridgeHeadAdvanced` among them.
     */
    readonly stage$: Observable<NoriBridgeInfraStage>;
    /** The seconds each stage of the bridge's last job took, from Nori's timings; replays the latest. */
    readonly timings$: Observable<Partial<Record<string, number>>>;
    /** Ethereum's finalized block and its slot, from Nori's `state.eth`; replays the latest. */
    readonly finality$: Observable<NoriBridgeInfraFinality>;

    /**
     * @param connections The connections, Nori's websocket among them.
     */
    constructor(connections: ConnectionsService) {
        const { nori } = connections.connections;
        this.open$ = nori.websocket.connection.state$.pipe(map((state) => state.node === 'open'));
        this.state$ = getNoriBridgeInfraState$(nori);
        this.timings$ = getNoriBridgeInfraTimings$(nori).pipe(
            map((message): Partial<Record<string, number>> => message.extension),
        );
        this.finality$ = getNoriBridgeInfraEthState$(nori);
        this.stage$ = merge(
            this.state$.pipe(map((state) => state.stage_name)),
            startNoriBridgeInfraTransitions(nori).noriBridgeInfraTransitions.state$.pipe(
                map((state) => state.node),
            ),
        ).pipe(
            filter(isStage),
            distinctUntilChanged(),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }
}
