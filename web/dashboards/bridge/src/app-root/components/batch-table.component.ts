import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { filter, map, type Observable } from 'rxjs';
import { type ShownProofQueueBatch } from '@nori-zk/nori-bridge-solana-sdk';
import { contractName, ScrollThumb } from '@nori-zk/solana-web-ui';
import {
    BridgeDashboardService,
    type FilteredBatches,
    viewOf,
} from '../services/bridge-dashboard.service.js';
import { type WaitingRow } from '../utils/waiting-rows.js';
import './batch-table/batch-row.component.js';
import './batch-table/now-row.component.js';
import styles from './batch-table.component.css';

/**
 * The status line under the table: what there is to show. Until the first
 * read lands it is being read; the machine reads again by itself, and the
 * pins show the connections.
 *
 * @param batches The batches machine's state, or `undefined` while the filter is not an address.
 * @returns The status, or nothing while batches are shown.
 */
const batchesStatus = (batches: FilteredBatches | undefined): string => {
    if (batches === undefined) return 'The filter is not an Ethereum address';
    const { target, state } = batches;
    switch (state.node) {
        case 'loading':
        case 'waitingForConnectionWhileLoading':
        case 'failedWhileLoading':
            return 'Reading the newest batches';
        case 'closed':
            return '';
        case 'current':
        case 'refreshing':
        case 'waitingForConnectionWhileRefreshing':
        case 'failedWhileRefreshing':
            if (viewOf(state).batches.length > 0) return '';
            return target === '' ? 'No batches yet' : 'No proven requests from this contract yet';
    }
};

/**
 * The bridge's batches, newest first, under the run Nori is on now, for
 * every contract or the one `?target=` names. Each batch opens onto its
 * requests.
 */
@Component({
    selector: 'batch-table',
    directives: [RxFor, ScrollThumb],
    template: `
        <form class="filter" onsubmit="applyFilter($event)">
            <input
                #targetInput
                name="target"
                placeholder="Filter by contract address (0x…)"
                spellcheck="false"
                autocomplete="off"
                [value]="targetText"
            />
            <button type="submit">[ Filter ]</button>
            <button type="button" onclick="clearFilter">[ All ]</button>
        </form>
        <p class="summary">{{ summary }}</p>
        <div class="head">
            <span>BATCH</span>
            <span>REQUESTS</span>
            <span>ETH BLOCK</span>
            <span>TO SOLANA</span>
            <span></span>
        </div>
        <div class="rows" scroll-thumb>
            <now-row [row]="finalityRow"></now-row>
            <now-row [row]="scheduledRow"></now-row>
            <now-row [row]="processingRow"></now-row>
            <div rx-for="rows by key">
                <batch-row></batch-row>
            </div>
        </div>
        <p class="status">{{ status }}</p>
    `,
    styles,
})
export class BatchTable extends RxElement {
    @Inject(BridgeDashboardService) private readonly dashboard!: BridgeDashboardService;
    targetInput!: HTMLInputElement;

    get targetText$(): Observable<string> {
        return this.dashboard.target$.pipe(map((target) => target ?? ''));
    }

    /** The requests waiting for Ethereum finality: the longest wait, at the top. */
    get finalityRow$(): Observable<WaitingRow> {
        return this.waitingRow$('finality');
    }

    /** The finalized requests scheduled for a later job. */
    get scheduledRow$(): Observable<WaitingRow> {
        return this.waitingRow$('scheduled');
    }

    /** The requests in the job Nori is processing. */
    get processingRow$(): Observable<WaitingRow> {
        return this.waitingRow$('processing');
    }

    /**
     * One of the rows above the batches.
     *
     * @param key Which row.
     * @returns The row, each time it changes.
     */
    private waitingRow$(key: WaitingRow['key']): Observable<WaitingRow> {
        return this.dashboard.waitingRows$.pipe(
            map((rows) => rows.find((row) => row.key === key)),
            filter((row): row is WaitingRow => row !== undefined),
        );
    }

    get rows$(): Observable<{ key: string; batch: ShownProofQueueBatch; target: string }[]> {
        return this.dashboard.batches$.pipe(
            map((batches) =>
                batches === undefined
                    ? []
                    : viewOf(batches.state).batches.map((batch) => ({
                          key: batch.proofQueueBatchIndex.toString(),
                          batch,
                          target: batches.target,
                      })),
            ),
        );
    }

    get summary$(): Observable<string> {
        return this.dashboard.batches$.pipe(
            map((batches) => {
                if (batches === undefined) return '';
                const view = viewOf(batches.state);
                if (view.batchCount === 0n) return '';
                const waiting = `${view.waiting.length.toString()} waiting`;
                return batches.target === ''
                    ? `Batch #${(view.batchCount - 1n).toString()} is the newest · ${waiting}`
                    : `Showing ${contractName(batches.target)}'s requests · ${waiting}`;
            }),
        );
    }

    get status$(): Observable<string> {
        return this.dashboard.batches$.pipe(map(batchesStatus));
    }

    applyFilter(event: SubmitEvent): void {
        event.preventDefault();
        this.dashboard.filter(this.targetInput.value);
    }

    clearFilter(): void {
        this.targetInput.value = '';
        this.dashboard.filter('');
    }
}
