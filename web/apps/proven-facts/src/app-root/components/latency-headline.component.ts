import { Component, Inject, RxElement } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { FactsService, LatencyService, latencyMinutes, type Latency } from '@nori-zk/solana-web-ui';
import { headlineOf, type Headline } from '../utils/headline.js';
import styles from './latency-headline.component.css';

/**
 * The bridge dashboard's latency tab, where every read is listed with its
 * batch and landing transaction. In dev the dashboard runs on :7400
 * (`web/README.md`); there is no build constant for it, so a hosted build
 * points at the same local URL until one is added.
 */
const DASHBOARD_LATENCY_URL = 'http://localhost:7400/?view=latency';

/** One read of the latency headline: what it says while it reads, has read, or failed. */
interface HeadlineView {
    line: string;
    spread: string;
}

/**
 * The headline for one emission of `latency$`.
 *
 * @param latency The read: `undefined` while it runs, the reads, or why it failed.
 * @returns The big line and its muted spread.
 */
function viewOf(latency: Latency | string | undefined): HeadlineView {
    if (latency === undefined || (typeof latency !== 'string' && latency.landings === undefined)) {
        return { line: 'Measuring the last reads…', spread: '' };
    }
    if (typeof latency === 'string') return { line: '', spread: `Reading failed: ${latency} ·` };
    const headline: Headline | undefined = headlineOf(
        latencyMinutes(latency.batches, latency.requests, latency.landings),
    );
    return headline
        ? { line: headline.line, spread: `${headline.spread} ·` }
        : { line: 'No read has landed on Solana yet.', spread: '' };
}

/**
 * How fast a read gets from Ethereum to Solana, in one line: the median
 * minutes from each NoriSnapshot read's Ethereum block to the Solana
 * transaction that landed its batch, over the newest 30 batches, with the
 * spread under it. Read once when the page opens; `[ Read again ]` reads
 * it and the snapshots again, so the whole page is from one moment.
 */
@Component({
    selector: 'latency-headline',
    template: `
        <p class="line">{{ line }}</p>
        <p class="spread">
            <span>{{ spread }}</span>
            <button type="button" onclick="readAgain">[ Read again ]</button>
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
    @Inject(FactsService) private readonly facts!: FactsService;

    private get view$(): Observable<HeadlineView> {
        return this.latency.latency$.pipe(map(viewOf));
    }

    get line$(): Observable<string> {
        return this.view$.pipe(map(({ line }) => line));
    }

    get spread$(): Observable<string> {
        return this.view$.pipe(map(({ spread }) => spread));
    }

    readAgain(): void {
        this.latency.readAgain();
        this.facts.readAgain();
    }
}
