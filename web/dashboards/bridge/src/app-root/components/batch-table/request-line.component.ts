import { Component, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import styles from './request-line.component.css';

/**
 * One request inside an opened batch, or waiting in the run now: its id,
 * the contract that submitted it, the contract's address and the
 * transaction that enqueued it, each linked to the explorer.
 */
@Component({
    selector: 'request-line',
    directives: [RxIf],
    template: `
        <span class="id">{{ request }}</span>
        <span class="contract">{{ contract }}</span>
        <a class="detail" [href]="detailUrl" target="_blank" rel="noopener">{{ detail }} ↗</a>
        <span rx-if="transaction">
            <a [href]="transactionUrl" target="_blank" rel="noopener">{{ transaction }} ↗</a>
        </span>
    `,
    styles,
})
export class RequestLine extends RxElement {
    @state request = '';
    @state contract = '';
    @state detail = '';
    @state detailUrl = '';
    @state transaction = '';
    @state transactionUrl = '';
}
