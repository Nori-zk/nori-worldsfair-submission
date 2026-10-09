import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './fact-line.component.css';

/** One query of a snapshot and its recorded result, as its line shows it. */
export interface FactLineView {
    key: string;
    /** `Fhw5…cbhi backing`, `Fhw5…cbhi paused`, or the short query id. */
    what: string;
    value: string;
    /** Whether Nori has proven the snapshot, so the result can be verified. */
    proven: boolean;
    snapshotTxHash: string;
    queryId: string;
    /** The 32-byte result the `Snapshot` event recorded, 0x-hex. */
    word: string;
    blockNumber: bigint;
    requestId: bigint;
}

/** One query of an opened snapshot: what it is and the value it recorded. */
@Component({
    selector: 'fact-line',
    template: `
        <div class="line">
            <span class="what">{{ what }}</span>
            <span class="value">{{ value }}</span>
        </div>
    `,
    styles,
})
export class FactLine extends RxElement {
    @state what = '';
    @state value = '';
    @state proven = false;
    @state snapshotTxHash = '';
    @state queryId = '';
    @state word = '';
    @state blockNumber = 0n;
    @state requestId = 0n;
}
