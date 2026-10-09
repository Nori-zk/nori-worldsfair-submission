import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { map, type Observable } from 'rxjs';
import { type WaitingRow } from '../../utils/waiting-rows.js';
import './request-line.component.js';
import styles from './now-row.component.css';

/** A row with nothing in it, before the table sets one. */
const EMPTY_ROW: WaitingRow = {
    key: 'finality',
    requests: '',
    block: '',
    bar: '',
    status: '',
    lines: [],
    shown: false,
};

/**
 * One row above the batches: a set of the requests no batch covers yet,
 * where they wait, and a bar for that wait, hidden while it has none.
 * Opening it lists its requests, as a batch does.
 */
@Component({
    selector: 'now-row',
    directives: [RxIf, RxFor],
    template: `
        <div rx-if="row.shown">
            <button type="button" class="row" onclick="toggle">
                <span class="batch">{{ marker }} now</span>
                <span class="requests">{{ row.requests }}</span>
                <span class="block">{{ row.block }}</span>
                <span class="bar">{{ row.bar }}</span>
                <span class="status">{{ row.status }}</span>
            </button>
            <div rx-if="open">
                <div class="nested" rx-for="row.lines by key">
                    <request-line></request-line>
                </div>
            </div>
        </div>
    `,
    styles,
})
export class NowRow extends RxElement {
    @state row: WaitingRow = EMPTY_ROW;
    @state open = false;

    get marker$(): Observable<string> {
        return this.open$.pipe(map((open) => (open ? '▾' : '▸')));
    }

    toggle(): void {
        this.open = !this.open;
    }
}
