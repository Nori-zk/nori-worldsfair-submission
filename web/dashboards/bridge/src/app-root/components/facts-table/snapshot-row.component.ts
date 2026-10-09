import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './snapshot-row.component.css';

/** One snapshot row's text and link. */
export interface SnapshotRowView {
    key: string;
    index: string;
    block: string;
    blockUrl: string;
    time: string;
    queries: string;
    status: string;
    statusStyle: string;
}

/**
 * One snapshot: its index, the Ethereum block and time its view calls ran
 * at, how many it made, and whether Nori has proven it.
 */
@Component({
    selector: 'snapshot-row',
    template: `
        <div class="row">
            <span></span>
            <span>{{ index }}</span>
            <a [href]="blockUrl" target="_blank" rel="noopener">{{ block }} ↗</a>
            <span>{{ time }}</span>
            <span>{{ queries }}</span>
            <span [style]="statusStyle">{{ status }}</span>
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
}
