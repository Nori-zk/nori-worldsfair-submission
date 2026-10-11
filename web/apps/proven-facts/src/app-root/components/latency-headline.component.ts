import { Component, Inject, RxElement } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { LatencyService, latencyMinutes, type Latency } from '@nori-zk/solana-web-ui';
import { headlineOf, type Headline } from '../utils/headline.js';
import styles from './latency-headline.component.css';

/**
 * The bridge dashboard's latency tab, where every read is listed with its
 * batch and landing transaction. In dev the dashboard runs on :7400
 * (`web/README.md`). The dashboard is served from the same host as this app,
 * so the link follows the page's own hostname; there is no build constant for it.
 */
const DASHBOARD_LATENCY_URL = `${window.location.protocol}//${window.location.hostname}:7400/?view=latency`;

/** One read of the latency headline: what it says while it reads, has read, or failed. */
interface HeadlineView {
    line: string;
    spread: string;
}

/**
 * The headline for the reads: measuring until they are read, then kept as
 * they are read again.
 *
 * @param latency The reads.
 * @returns The big line and its muted spread.
 */
function viewOf(latency: Latency): HeadlineView {
    if (latency.landings === undefined) {
        return { line: 'Measuring the last reads…', spread: '' };
    }
    const headline: Headline | undefined = headlineOf(
        latencyMinutes(latency.batches, latency.requests, latency.landings),
    );
    return headline
        ? { line: headline.line, spread: headline.spread }
        : { line: 'No read has landed on Solana yet.', spread: '' };
}

/**
 * How fast a read gets from Ethereum to Solana, in one line: the median
 * minutes from each NoriSnapshot read's Ethereum block to the Solana
 * transaction that landed its batch, over the newest 30 batches, with the
 * spread under it. Kept current as batches land.
 */
@Component({
    selector: 'latency-headline',
    template: `
        <p class="line">{{ line }}</p>
        <p class="spread">
            <span>{{ spread }}</span>
        </p>
        <p class="more">
            Every read, with its batch and landing transaction:
            <a href="${DASHBOARD_LATENCY_URL}" target="_blank" rel="noopener">bridge dashboard ↗</a>
        </p>
    `,
    styles,
})
export class LatencyHeadline extends RxElement {
    @Inject(LatencyService) private readonly latency!: LatencyService;

    private get view$(): Observable<HeadlineView> {
        return this.latency.latency$.pipe(map(viewOf));
    }

    get line$(): Observable<string> {
        return this.view$.pipe(map(({ line }) => line));
    }

    get spread$(): Observable<string> {
        return this.view$.pipe(map(({ spread }) => spread));
    }
}
