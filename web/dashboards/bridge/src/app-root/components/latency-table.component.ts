import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import { LatencyService } from '../services/latency.service.js';
import { latencyMinutes, rowsOf, summaryOf, type LatencyRowView } from '../utils/latency.js';
import './latency-table/latency-row.component.js';
import styles from './latency-table.component.css';

/**
 * How long each NoriSnapshot read took from its Ethereum block to the Solana
 * transaction that landed its batch: the reads in the newest 30 batches,
 * newest first. Read once when the tab opens and again on `[ Read again ]`;
 * the rows show first, then their landings.
 */
@Component({
    selector: 'latency-table',
    directives: [RxFor],
    template: `
        <p class="title">READ LATENCY: Ethereum block → landed on Solana</p>
        <p class="summary">{{ summary }}</p>
        <div class="head">
            <span>REQUEST</span>
            <span>ETH TIME</span>
            <span>BATCH</span>
            <span>LANDED</span>
            <span class="min">MIN</span>
            <span></span>
        </div>
        <div rx-for="rows by key">
            <latency-row></latency-row>
        </div>
        <p class="status">{{ status }}</p>
        <button type="button" class="again" onclick="readAgain">[ Read again ]</button>
        <p class="note">The keeper applies a read to a guard 30–50 s after its batch lands.</p>
    `,
    styles,
})
export class LatencyTable extends RxElement {
    @Inject(LatencyService) private readonly latency!: LatencyService;

    get rows$(): Observable<LatencyRowView[]> {
        return this.latency.latency$.pipe(
            map((latency) =>
                latency === undefined || typeof latency === 'string'
                    ? []
                    : rowsOf(latency.batches, latency.requests, latency.landings),
            ),
        );
    }

    /** How many reads landed, and the median and spread of their minutes. */
    get summary$(): Observable<string> {
        return this.latency.latency$.pipe(
            map((latency) =>
                latency === undefined ||
                typeof latency === 'string' ||
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
        return this.latency.latency$.pipe(
            map((latency) => {
                if (latency === undefined) return 'Reading the newest reads';
                if (typeof latency === 'string') return `Reading failed: ${latency}`;
                if (rowsOf(latency.batches, latency.requests, undefined).length === 0) {
                    return 'No reads yet';
                }
                if (latency.landings !== undefined) return '';
                const count = latency.batches.length;
                return `Reading when ${count.toString()} batch${count === 1 ? '' : 'es'} landed`;
            }),
        );
    }

    readAgain(): void {
        this.latency.readAgain();
    }
}
