import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable } from 'rxjs';
import { FactsService, addressUrl } from '@nori-zk/solana-web-ui';
import { snapshotViewOf, type SnapshotView } from '../utils/snapshots.js';
import {
    REVEAL_STEP,
    allShown,
    moreShown,
    olderLinkText,
    showOlderText,
    visibleOf,
} from '../utils/reveal.js';
import './snapshot-list/snapshot-block.component.js';
import styles from './snapshot-list.component.css';

/** NoriSnapshot's events on the explorer: every `Snapshot`, the older ones the list leaves out too. */
const OLDER_URL = `${addressUrl(NORI_WEB_ENV.ethereum.snapshotAddress)}#events`;
const OLDER_TEXT = olderLinkText(NORI_WEB_ENV.ethereum.chainId);

/**
 * The newest snapshots, newest first, each told in sentences: when and at
 * which Ethereum block its view calls ran, what they returned, and whether
 * Nori has proven it on Solana. Read when the page opens and again on each
 * new snapshot. It shows the
 * newest 8; `[ Show older ]` adds 8 more, and once every snapshot read shows,
 * a line links to NoriSnapshot on the explorer for the rest.
 */
@Component({
    selector: 'snapshot-list',
    directives: [RxFor],
    template: `
        <div rx-for="cards by key">
            <snapshot-block></snapshot-block>
        </div>
        <p class="older">
            <button type="button" [class.hidden]="olderHidden" onclick="showOlder">
                {{ showOlderText }}
            </button>
            <span class="line" [class.hidden]="olderLinkHidden">
                Older snapshots:
                <a href="${OLDER_URL}" target="_blank" rel="noopener">${OLDER_TEXT}</a>
            </span>
        </p>
        <p class="status">
            <span>{{ status }}</span>
        </p>
        <p class="note">
            A snapshot is one Ethereum transaction that runs up to 256 view calls and commits their
            results. Nori proves it; Verify re-checks one result on Solana by simulation: no wallet,
            no fee.
        </p>
    `,
    styles,
})
export class SnapshotList extends RxElement {
    @Inject(FactsService) private readonly facts!: FactsService;
    /** How many snapshots show; kept as the snapshots are read again, so a re-read never folds the list. */
    @state shown: number = REVEAL_STEP;

    get snapshots$(): Observable<SnapshotView[]> {
        return this.facts.facts$.pipe(
            map((facts) => {
                if (facts === undefined) return [];
                const now = Math.floor(Date.now() / 1000);
                return facts.snapshots.map((snapshot) => snapshotViewOf(snapshot, facts, now));
            }),
        );
    }

    /** The snapshots that show: the newest `shown`, so revealing more only appends cards. */
    get cards$(): Observable<SnapshotView[]> {
        return combineLatest([this.snapshots$, this.shown$]).pipe(
            map(([snapshots, shown]) => visibleOf(snapshots, shown)),
        );
    }

    /** How many snapshots were read, and how many show. */
    private get counts$(): Observable<{ total: number; shown: number }> {
        return combineLatest([this.snapshots$, this.shown$]).pipe(
            map(([snapshots, shown]) => ({ total: snapshots.length, shown })),
        );
    }

    get showOlderText$(): Observable<string> {
        return this.counts$.pipe(map(({ total, shown }) => showOlderText(total, shown)));
    }

    /** Hides `[ Show older ]` once every snapshot read shows. */
    get olderHidden$(): Observable<boolean> {
        return this.showOlderText$.pipe(map((text) => text === ''));
    }

    /** Hides the explorer line until every snapshot read shows. */
    get olderLinkHidden$(): Observable<boolean> {
        return this.counts$.pipe(map(({ total, shown }) => !allShown(total, shown)));
    }

    /** What the list is doing while it has no snapshots to show, or nothing. */
    get status$(): Observable<string> {
        return this.facts.state$.pipe(
            map((reading) => {
                // Until the first read lands; the machine reads again by itself, and the pins show the connections.
                switch (reading.node) {
                    case 'loading':
                    case 'waitingForConnectionWhileLoading':
                    case 'failedWhileLoading':
                        return 'Reading the newest snapshots…';
                    case 'closed':
                        return '';
                    case 'current':
                    case 'refreshing':
                    case 'waitingForConnectionWhileRefreshing':
                    case 'failedWhileRefreshing':
                        return reading.data.snapshots.length === 0 ? 'No snapshots yet.' : '';
                }
            }),
        );
    }

    /** Shows the next 8 older snapshots; `visibleOf` stops at every one read. */
    showOlder(): void {
        this.shown = moreShown(this.shown);
    }
}
