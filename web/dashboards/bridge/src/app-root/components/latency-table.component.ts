import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable } from 'rxjs';
import {
    LatencyService,
    latencyMinutes,
    rowsOf,
    ScrollThumb,
    summaryOf,
    type LatencyRowView,
} from '@nori-zk/solana-web-ui';
import './latency-table/latency-row.component.js';
import styles from './latency-table.component.css';

/**
 * How long each NoriSnapshot read took from its Ethereum block to the Solana
 * transaction that landed its batch: the reads in the newest 30 batches,
 * newest first. Kept current as batches land. The rows show first, then
 * their landings.
 */
@Component({
    selector: 'latency-table',
    directives: [RxFor, ScrollThumb],
    template: `
        <p class="title">READ LATENCY: Ethereum block → landed on Solana</p>
        <p class="explain">
            Each NoriSnapshot read, from its Ethereum block to the Solana transaction that landed
            its batch. Most of the wait is Ethereum finality (~15 min); the keeper applies a read
            30–50 s after its batch lands.
        </p>
        <p class="summary">{{ summary }}</p>
        <div class="table" scroll-thumb="x">
            <div class="head">
                <span>REQUEST</span>
                <span>ETH TIME</span>
                <span>BATCH</span>
                <span>LANDED</span>
                <span class="min">MIN</span>
                <span>VS MEDIAN</span>
            </div>
            <div rx-for="rows by key">
                <latency-row></latency-row>
            </div>
        </div>
        <p class="status">{{ status }}</p>
    `,
    styles,
})
export class LatencyTable extends RxElement {
    @Inject(LatencyService) private readonly latency!: LatencyService;

    get rows$(): Observable<LatencyRowView[]> {
        return this.latency.latency$.pipe(
            map((latency) => rowsOf(latency.batches, latency.requests, latency.landings)),
        );
    }

    /** How many reads landed, and the median and spread of their minutes. */
    get summary$(): Observable<string> {
        return this.latency.latency$.pipe(
            map((latency) =>
                latency.landings === undefined
                    ? ''
                    : summaryOf(
                          latencyMinutes(latency.batches, latency.requests, latency.landings),
                      ),
            ),
        );
    }

    /** Why there are no rows, what is still read, or nothing. */
    get status$(): Observable<string> {
        return combineLatest([this.latency.state$, this.latency.latency$]).pipe(
            map(([batches, latency]) => {
                // Until the batches' first read lands; the machine reads again by itself, and the pins show the connections.
                switch (batches.node) {
                    case 'loading':
                    case 'waitingForConnectionWhileLoading':
                    case 'failedWhileLoading':
                        return 'Reading the newest reads';
                    case 'closed':
                        return '';
                    case 'current':
                    case 'refreshing':
                    case 'waitingForConnectionWhileRefreshing':
                    case 'failedWhileRefreshing':
                        break;
                }
                if (rowsOf(latency.batches, latency.requests, undefined).length === 0) {
                    return 'No reads yet';
                }
                if (latency.landings !== undefined) return '';
                const count = latency.batches.length;
                return `Reading when ${count.toString()} batch${count === 1 ? '' : 'es'} landed`;
            }),
        );
    }
}
