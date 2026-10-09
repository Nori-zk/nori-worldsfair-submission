import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './snapshot-block.component.css';

/**
 * One snapshot, in sentences: its Ethereum time and block, whether Nori has
 * proven it on Solana, and what its view calls returned.
 */
@Component({
    selector: 'snapshot-block',
    template: `
        <div class="top">
            <span class="where">
                <span>{{ when }}</span>
                <span class="dot">·</span>
                <a [href]="blockUrl" target="_blank" rel="noopener">{{ block }}</a>
            </span>
            <span class="status" [class.proven]="proven">{{ status }}</span>
        </div>
        <p class="sentence">{{ sentence }}</p>
    `,
    styles,
})
export class SnapshotBlock extends RxElement {
    @state when = '';
    @state block = '';
    @state blockUrl = '';
    @state proven = false;
    @state status = '';
    @state sentence = '';
}
