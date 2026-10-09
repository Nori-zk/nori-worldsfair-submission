import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { filter, map, type Observable } from 'rxjs';
import { BridgeDashboardService } from '../services/bridge-dashboard.service.js';
import { type ShownBatch, type BridgeBatchesState } from '../ystate/bridge-batches.js';
import { contractName } from '../utils/format.js';
import { type WaitingRow } from '../utils/waiting-rows.js';
import './batch-table/batch-row.component.js';
import './batch-table/now-row.component.js';
import styles from './batch-table.component.css';

/**
 * The status line under the table for each node of the batches machine.
 *
 * @param state The machine's state, or `undefined` while the filter is not an address.
 * @returns The status, or nothing while the view is up to date.
 */
const batchesStatus = (state: BridgeBatchesState | undefined): string => {
    if (state === undefined) return 'The filter is not an Ethereum address';
    const { view, target } = state.data;
    switch (state.node) {
        case 'loading':
            return view.batches.length === 0 ? 'Reading the newest batches' : '';
        case 'watching':
        case 'refreshing':
            if (view.batches.length > 0) return '';
            return target === '' ? 'No batches yet' : 'No proven requests from this contract yet';
        case 'waitingForConnection':
            return `Waiting for ${state.data.waitingOn.join(' and ')}`;
        case 'failed':
            return `Reading failed: ${state.data.error}`;
    }
};

/**
 * The bridge's batches, newest first, under the run Nori is on now, for
 * every contract or the one `?target=` names. Each batch opens onto its
 * requests.
 */
@Component({
    selector: 'batch-table',
    directives: [RxIf, RxFor],
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
            <span>PROVEN</span>
            <span></span>
        </div>
        <div class="rows">
            <now-row [row]="finalityRow"></now-row>
            <now-row [row]="scheduledRow"></now-row>
            <now-row [row]="processingRow"></now-row>
            <div rx-for="rows by key">
                <batch-row></batch-row>
            </div>
        </div>
        <p class="status">{{ status }}</p>
        <div rx-if="failed">
            <button type="button" class="retry" onclick="retry">[ Read again ]</button>
        </div>
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

    get rows$(): Observable<{ key: string; batch: ShownBatch; target: string }[]> {
        return this.dashboard.batches$.pipe(
            map((state) =>
                state === undefined
                    ? []
                    : state.data.view.batches.map((batch) => ({
                          key: batch.proofQueueBatchIndex.toString(),
                          batch,
                          target: state.data.target,
                      })),
            ),
        );
    }

    get summary$(): Observable<string> {
        return this.dashboard.batches$.pipe(
            map((state) => {
                if (state === undefined || state.data.view.batchCount === 0n) return '';
                const { view, target } = state.data;
                const waiting = `${view.waiting.length.toString()} waiting`;
                return target === ''
                    ? `Batch #${(view.batchCount - 1n).toString()} is the newest · ${waiting}`
                    : `Showing ${contractName(target)}'s requests · ${waiting}`;
            }),
        );
    }

    get status$(): Observable<string> {
        return this.dashboard.batches$.pipe(map(batchesStatus));
    }

    get failed$(): Observable<boolean> {
        return this.dashboard.batches$.pipe(map((state) => state?.node === 'failed'));
    }

    applyFilter(event: SubmitEvent): void {
        event.preventDefault();
        this.dashboard.filter(this.targetInput.value);
    }

    clearFilter(): void {
        this.targetInput.value = '';
        this.dashboard.filter('');
    }

    retry(): void {
        this.dashboard.retry();
    }
}
