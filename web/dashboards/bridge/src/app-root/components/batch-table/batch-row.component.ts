import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import {
    combineLatest,
    distinctUntilChanged,
    filter,
    map,
    type Observable,
    of,
    switchMap,
} from 'rxjs';
import { type ShownProofQueueBatch as Batch } from '@nori-zk/nori-bridge-solana-sdk';
import { asciiBar, blockText, cursorRange } from '@nori-zk/solana-web-ui';
import { BridgeDashboardService } from '../../services/bridge-dashboard.service.js';
import { type Line, lineOf } from '../../utils/request-line.js';
import './request-line.component.js';
import styles from './batch-row.component.css';

/** An opened batch's requests, or why they are not shown yet. */
interface Opened {
    lines: Line[];
    status: string;
}

/**
 * One committed batch: its index, its requests (with a filter, how many of
 * them are the contract's), the Ethereum block its proof read the queue at,
 * and a full bar. Opening it (▸ to ▾) lists its requests.
 */
@Component({
    selector: 'batch-row',
    directives: [RxIf, RxFor],
    template: `
        <button type="button" class="row" onclick="toggle">
            <span class="batch">{{ marker }} #{{ index }}</span>
            <span class="requests">{{ requests }}</span>
            <span class="block">{{ block }}</span>
            <span class="bar">{{ bar }}</span>
            <span class="status">Proven</span>
        </button>
        <div rx-if="open">
            <p class="opened-status">{{ openedStatus }}</p>
            <div class="nested" rx-for="lines by key">
                <request-line></request-line>
            </div>
        </div>
    `,
    styles,
})
export class BatchRow extends RxElement {
    @Inject(BridgeDashboardService) private readonly dashboard!: BridgeDashboardService;
    @state batch: Batch | undefined = undefined;
    /** The contract the page filters on, or `''`. */
    @state target = '';
    @state open = false;

    /** The batch, once the table has set it. */
    private get present$(): Observable<Batch> {
        return this.batch$.pipe(filter((batch): batch is Batch => batch !== undefined));
    }

    get marker$(): Observable<string> {
        return this.open$.pipe(map((open) => (open ? '▾' : '▸')));
    }

    get index$(): Observable<string> {
        return this.present$.pipe(map((batch) => batch.proofQueueBatchIndex.toString()));
    }

    get requests$(): Observable<string> {
        return this.present$.pipe(
            map(({ matching, inputQueueCursor, outputQueueCursor }) =>
                matching
                    ? `${matching.length.toString()} of ${(outputQueueCursor - inputQueueCursor).toString()}`
                    : cursorRange(inputQueueCursor, outputQueueCursor),
            ),
        );
    }

    get block$(): Observable<string> {
        return this.present$.pipe(map((batch) => blockText(batch.outputBlockNumber)));
    }

    get bar$(): Observable<string> {
        return of(asciiBar(1));
    }

    /**
     * The opened batch's requests, from the sdk's batch requests machine,
     * which runs while the batch is open and reads again by itself after a
     * failure.
     */
    private get opened$(): Observable<Opened> {
        return combineLatest([this.open$, this.present$, this.target$]).pipe(
            // Each refresh of the view brings a new object for the same batch, whose requests never change.
            distinctUntilChanged(
                ([wasOpen, was, wasTarget], [open, batch, target]) =>
                    wasOpen === open &&
                    was.proofQueueBatchIndex === batch.proofQueueBatchIndex &&
                    wasTarget === target,
            ),
            switchMap(([open, batch, target]) =>
                !open
                    ? of({ lines: [], status: '' })
                    : this.dashboard.batchRequests$(batch, target).pipe(
                          map((reading): Opened => {
                              // Until the first read lands; the machine reads again by itself, and the pins show the connections.
                              switch (reading.node) {
                                  case 'loading':
                                  case 'waitingForConnectionWhileLoading':
                                  case 'failedWhileLoading':
                                      return { lines: [], status: 'Reading requests…' };
                                  case 'closed':
                                      return { lines: [], status: '' };
                                  case 'current':
                                  case 'refreshing':
                                  case 'waitingForConnectionWhileRefreshing':
                                  case 'failedWhileRefreshing':
                                      return {
                                          lines: reading.data.requests.map(lineOf),
                                          status:
                                              reading.data.requests.length === 0
                                                  ? 'No requests found'
                                                  : '',
                                      };
                              }
                          }),
                      ),
            ),
        );
    }

    get lines$(): Observable<Line[]> {
        return this.opened$.pipe(map(({ lines }) => lines));
    }

    get openedStatus$(): Observable<string> {
        return this.opened$.pipe(map(({ status }) => status));
    }

    toggle(): void {
        this.open = !this.open;
    }
}
