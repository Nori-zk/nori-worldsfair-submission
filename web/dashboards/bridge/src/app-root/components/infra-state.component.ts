import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, interval, map, type Observable, startWith } from 'rxjs';
import { ETHEREUM_EPOCH_SEC, getCommitTimes } from '@nori-zk/nori-bridge-solana-sdk';
import { NORI_BRIDGE_INFRA_STAGE_TEXT, NoriBridgeInfraService } from '@nori-zk/solana-web-ui';
import { timeLeft } from '../utils/ascii.js';
import styles from './infra-state.component.css';

/** How many blocks Nori's loop bar holds: more than the card's width shows. */
const LOOP_CELLS = 300;

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
            <p class="stage">{{ loop.text }}</p>
            <div class="bar">
                <span class="done" [style]="loop.done">${'▓'.repeat(LOOP_CELLS)}</span>
                <span class="rest">${'░'.repeat(LOOP_CELLS)}</span>
            </div>
        </div>
    `,
    styles,
})
export class InfraState extends RxElement {
    @Inject(NoriBridgeInfraService) private readonly noriBridgeInfra!: NoriBridgeInfraService;

    get open$(): Observable<boolean> {
        return this.noriBridgeInfra.open$;
    }

    /** Nori's stage with the time to its next job, and the bar's fill. */
    get loop$(): Observable<{ text: string; done: string }> {
        const { state$, stage$, timings$ } = this.noriBridgeInfra;
        return combineLatest([
            state$.pipe(map((state) => ({ state, atMs: Date.now() }))),
            stage$,
            timings$.pipe(startWith(undefined)),
            interval(1000).pipe(startWith(0)),
        ]).pipe(
            map(([{ state, atMs }, stage, timings]) => {
                const elapsed_sec = state.elapsed_sec + (Date.now() - atMs) / 1000;
                const { nextJobSec, jobSec } = getCommitTimes(
                    { stage_name: state.stage_name, elapsed_sec },
                    timings,
                );
                const untilNextJob = nextJobSec - jobSec;
                const fill = Math.min(1, Math.max(0, 1 - untilNextJob / ETHEREUM_EPOCH_SEC));
                return {
                    text: `${NORI_BRIDGE_INFRA_STAGE_TEXT[stage]} · next job ${timeLeft(untilNextJob)}`,
                    done: `width: ${(fill * 100).toFixed(1)}%`,
                };
            }),
        );
    }
}
