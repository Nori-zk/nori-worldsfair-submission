import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './guard-row.component.css';

/** One guard row's text and links. */
export interface GuardRowView {
    key: string;
    mint: string;
    mintUrl: string;
    status: string;
    statusStyle: string;
    backing: string;
    supply: string;
    ratio: string;
    block: string;
    blockUrl: string;
    age: string;
}

/** One guard: its mint, status, backing, supply and ratio, and the Ethereum block it was proven at. */
@Component({
    selector: 'guard-row',
    template: `
        <div class="row">
            <a [href]="mintUrl" target="_blank" rel="noopener">{{ mint }} ↗</a>
            <span class="status" [style]="statusStyle">{{ status }}</span>
            <span>{{ backing }}</span>
            <span>{{ supply }}</span>
            <span>{{ ratio }}</span>
            <a [href]="blockUrl" target="_blank" rel="noopener">{{ block }} ↗</a>
            <span>{{ age }}</span>
        </div>
    `,
    styles,
})
export class GuardRow extends RxElement {
    @state mint = '';
    @state mintUrl = '';
    @state status = '';
    @state statusStyle = '';
    @state backing = '';
    @state supply = '';
    @state ratio = '';
    @state block = '';
    @state blockUrl = '';
    @state age = '';
}
