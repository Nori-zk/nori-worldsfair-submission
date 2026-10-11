import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, interval, map, type Observable, startWith } from 'rxjs';
import { ETHEREUM_EPOCH_SEC, getCommitTimes } from '@nori-zk/nori-bridge-solana-sdk';
import {
    NORI_BRIDGE_INFRA_STAGE_TEXT,
    NoriBridgeInfraService,
    timeLeft,
} from '@nori-zk/solana-web-ui';
import styles from './infra-state.component.css';

/**
 * Nori's loop: the stage it is in, over a bar filled with the time since its
 * job was created, out of the epoch until the next one. Recomputed each
 * second, so it moves while Nori waits for Ethereum finality.
 */
@Component({
    selector: 'infra-state',
    directives: [RxIf],
    template: `
        <div rx-if="open">
            <p class="title">INFRA BRIDGE STATE</p>
            <p class="loop-stage">{{ loop.text }}</p>
            <progress-bar [fill]="loop.fill"></progress-bar>
        </div>
    `,
    styles,
})
export class InfraState extends RxElement {
    @Inject(NoriBridgeInfraService) private readonly noriBridgeInfra!: NoriBridgeInfraService;

    get open$(): Observable<boolean> {
        return this.noriBridgeInfra.open$;
    }

    /** Nori's stage with the time to its next job, and the bar's fill, from 0 to 1. */
    get loop$(): Observable<{ text: string; fill: number }> {
        const { state$, stage$, timings$ } = this.noriBridgeInfra;
        return combineLatest([
            state$,
            stage$,
            timings$.pipe(startWith(undefined)),
            interval(1000).pipe(startWith(0)),
        ]).pipe(
            map(([{ value: state, atMs }, stage, timings]) => {
                const elapsed_sec = state.elapsed_sec + (Date.now() - atMs) / 1000;
                const { nextJobSec, jobSec } = getCommitTimes(
                    { stage_name: state.stage_name, elapsed_sec },
                    timings,
                );
                const untilNextJob = nextJobSec - jobSec;
                const fill = Math.min(1, Math.max(0, 1 - untilNextJob / ETHEREUM_EPOCH_SEC));
                return {
                    text: `${NORI_BRIDGE_INFRA_STAGE_TEXT[stage]} · next job ${timeLeft(untilNextJob)}`,
                    fill,
                };
            }),
        );
    }
}
