import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import { FactsService } from '@nori-zk/solana-web-ui';
import { snapshotViewOf, type SnapshotView } from '../utils/snapshots.js';
import './snapshot-list/snapshot-block.component.js';
import styles from './snapshot-list.component.css';

/**
 * The newest snapshots, newest first, each told in sentences: when and at
 * which Ethereum block its view calls ran, what they returned, and whether
 * Nori has proven it on Solana. Read once when the page opens.
 */
@Component({
    selector: 'snapshot-list',
    directives: [RxFor],
    template: `
        <div rx-for="snapshots by key">
            <snapshot-block></snapshot-block>
        </div>
        <p class="status">
            <span>{{ status }}</span>
            <button type="button" [class.hidden]="readable" onclick="readAgain">
                [ Read again ]
            </button>
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

    get snapshots$(): Observable<SnapshotView[]> {
        return this.facts.facts$.pipe(
            map((facts) => {
                if (facts === undefined || typeof facts === 'string') return [];
                const now = Math.floor(Date.now() / 1000);
                return facts.snapshots.map((snapshot) => snapshotViewOf(snapshot, facts, now));
            }),
        );
    }

    /** What the list is doing while it has no snapshots to show, or nothing. */
    get status$(): Observable<string> {
        return this.facts.facts$.pipe(
            map((facts) =>
                facts === undefined
                    ? 'Reading the newest snapshots…'
                    : typeof facts === 'string'
                      ? `Reading failed: ${facts}`
                      : facts.snapshots.length === 0
                        ? 'No snapshots yet.'
                        : '',
            ),
        );
    }

    /** Hides `[ Read again ]` unless the read failed. */
    get readable$(): Observable<boolean> {
        return this.facts.facts$.pipe(map((facts) => typeof facts !== 'string'));
    }

    readAgain(): void {
        this.facts.readAgain();
    }
}
