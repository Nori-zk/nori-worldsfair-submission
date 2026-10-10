import { Component, RxElement, state } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { type LatencyRowView } from '@nori-zk/solana-web-ui';
import styles from './latency-row.component.css';

export type { LatencyRowView };

/**
 * One NoriSnapshot read: its request, the Ethereum time it read at, the
 * batch that holds it and when that batch landed on Solana, and the minutes
 * between, against the median of those shown: in the warning colour above p90.
 */
@Component({
    selector: 'latency-row',
    template: `
        <div class="row">
            <a [href]="requestUrl" target="_blank" rel="noopener">{{ request }} ↗</a>
            <span>{{ ethTime }}</span>
            <a [href]="batchUrl" target="_blank" rel="noopener">{{ batch }} ↗</a>
            <a [href]="landedUrl" [class.pending]="pending" target="_blank" rel="noopener">{{
                landed
            }}</a>
            <span class="minutes">{{ minutes }}</span>
            <span class="vs" [class.slow]="aboveP90">{{ vsMedian }}</span>
        </div>
    `,
    styles,
})
export class LatencyRow extends RxElement {
    @state request = '';
    @state requestUrl = '';
    @state ethTime = '';
    @state batch = '';
    @state batchUrl = '';
    @state landed = '';
    @state landedUrl = '';
    @state minutes = '';
    @state vsMedian = '';
    @state aboveP90 = false;

    /** While the landing is read or unknown: nothing to link to. */
    get pending$(): Observable<boolean> {
        return this.landedUrl$.pipe(map((url) => url === ''));
    }
}
