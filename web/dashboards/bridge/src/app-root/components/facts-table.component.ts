import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import { FactsService, type Facts, type SnapshotFact } from '../services/facts.service.js';
import { blockText, blockUrl, clock } from '../utils/format.js';
import type { SnapshotRowView } from './facts-table/snapshot-row.component.js';
import './facts-table/snapshot-row.component.js';
import styles from './facts-table.component.css';

/**
 * A snapshot as its row shows it.
 *
 * @param snapshot The snapshot, from its event.
 * @param facts The read it came in, for the queue cursor.
 * @returns The row's text and link.
 */
const rowOf = (snapshot: SnapshotFact, { queueCursor }: Facts): SnapshotRowView => {
    const proven = snapshot.requestId < queueCursor;
    return {
        key: snapshot.index.toString(),
        index: `#${snapshot.index.toString()}`,
        block: blockText(snapshot.blockNumber),
        blockUrl: blockUrl(snapshot.blockNumber),
        time: clock(Number(snapshot.timestamp)),
        queries: snapshot.queryIds.length.toString(),
        status: proven ? 'Proven' : 'Waiting',
        statusStyle: `color: ${proven ? 'var(--nori-light-green)' : 'var(--nori-muted)'}`,
    };
};

/**
 * What each NoriSnapshot transaction recorded: the newest snapshots, newest
 * first, with their Ethereum block and time, and whether Nori has proven
 * them. Read once when the tab opens and again on `[ Read again ]`.
 */
@Component({
    selector: 'facts-table',
    directives: [RxFor],
    template: `
        <p class="title">PROVEN FACTS: what each NoriSnapshot recorded</p>
        <p class="summary">{{ summary }}</p>
        <div class="head">
            <span></span>
            <span>SNAPSHOT</span>
            <span>ETH BLOCK</span>
            <span>TIME</span>
            <span>QUERIES</span>
            <span>STATUS</span>
        </div>
        <div rx-for="rows by key">
            <snapshot-row></snapshot-row>
        </div>
        <p class="status">{{ status }}</p>
        <button type="button" class="again" onclick="readAgain">[ Read again ]</button>
        <p class="note">
            A snapshot is one NoriSnapshot transaction: up to 256 view calls, one results root, one
            proof request. Verify simulates nori-read-example against the proven batch, as Prove
            balance does: no wallet, no fee.
        </p>
    `,
    styles,
})
export class FactsTable extends RxElement {
    @Inject(FactsService) private readonly facts!: FactsService;

    get rows$(): Observable<SnapshotRowView[]> {
        return this.facts.facts$.pipe(
            map((facts) =>
                facts === undefined || typeof facts === 'string'
                    ? []
                    : facts.snapshots.map((snapshot) => rowOf(snapshot, facts)),
            ),
        );
    }

    /** How many snapshots are shown, and the newest one's block. */
    get summary$(): Observable<string> {
        return this.facts.facts$.pipe(
            map((facts) => {
                if (facts === undefined || typeof facts === 'string') return '';
                const [newest] = facts.snapshots;
                if (newest === undefined) return '';
                const count = facts.snapshots.length;
                return `${count.toString()} newest snapshot${count === 1 ? '' : 's'} · newest at block ${blockText(newest.blockNumber)}`;
            }),
        );
    }

    /** Why there are no rows, or nothing. */
    get status$(): Observable<string> {
        return this.facts.facts$.pipe(
            map((facts) =>
                facts === undefined
                    ? 'Reading the newest snapshots'
                    : typeof facts === 'string'
                      ? `Reading failed: ${facts}`
                      : facts.snapshots.length === 0
                        ? 'No snapshots yet'
                        : '',
            ),
        );
    }

    readAgain(): void {
        this.facts.readAgain();
    }
}
