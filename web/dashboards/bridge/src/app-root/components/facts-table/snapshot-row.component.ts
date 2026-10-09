import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, map, type Observable } from 'rxjs';
import type { FactLineView } from './fact-line.component.js';
import './fact-line.component.js';
import styles from './snapshot-row.component.css';

/** One snapshot row's text and link, and the lines it opens to. */
export interface SnapshotRowView {
    key: string;
    index: string;
    block: string;
    blockUrl: string;
    time: string;
    queries: string;
    status: string;
    statusStyle: string;
    /** Each query and what the snapshot recorded for it, in order. */
    facts: FactLineView[];
}

/**
 * One snapshot: its index, the Ethereum block and time its view calls ran
 * at, how many it made, and whether Nori has proven it. Opening it (▸ to ▾)
 * lists what it recorded, each line built fresh through `rx-for`. `open` is
 * the row's own, not a view field, so a read again keeps it.
 */
@Component({
    selector: 'snapshot-row',
    directives: [RxIf, RxFor],
    template: `
        <div class="row">
            <button type="button" class="marker" onclick="toggle">{{ marker }}</button>
            <span>{{ index }}</span>
            <a [href]="blockUrl" target="_blank" rel="noopener">{{ block }} ↗</a>
            <span>{{ time }}</span>
            <span>{{ queries }}</span>
            <span [style]="statusStyle">{{ status }}</span>
        </div>
        <div rx-if="open">
            <div class="lines-head">
                <span>WHAT</span>
                <span>VALUE</span>
            </div>
        </div>
        <div rx-for="lines by key">
            <fact-line></fact-line>
        </div>
    `,
    styles,
})
export class SnapshotRow extends RxElement {
    @state index = '';
    @state block = '';
    @state blockUrl = '';
    @state time = '';
    @state queries = '';
    @state status = '';
    @state statusStyle = '';
    @state facts: FactLineView[] = [];
    @state open = false;

    get marker$(): Observable<string> {
        return this.open$.pipe(map((open) => (open ? '▾' : '▸')));
    }

    /** The snapshot's lines while the row is open. */
    get lines$(): Observable<FactLineView[]> {
        return combineLatest([this.open$, this.facts$]).pipe(
            map(([open, facts]) => (open ? facts : [])),
        );
    }

    toggle(): void {
        this.open = !this.open;
    }
}
