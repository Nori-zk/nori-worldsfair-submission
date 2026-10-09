import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { verifySnapshotResult } from '@nori-zk/backstop-client/read';
import { verifiedText, verifyFailedText } from '../../utils/facts.js';
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

/**
 * One query of an opened snapshot: what it is, the value it recorded and,
 * once Nori has proven the snapshot, `[ Verify ]`, which builds the
 * result's witness and simulates nori-read-example with it, as Prove
 * balance does: no wallet, no fee. One click, one verify: the verdict is
 * set from that one promise, never derived from a getter.
 */
@Component({
    selector: 'fact-line',
    template: `
        <div class="line">
            <span class="what">{{ what }}</span>
            <span class="value">{{ value }}</span>
            <span class="verify" [class.hidden]="unprovable">
                <button type="button" [disabled]="verifying" onclick="verify">[ Verify ]</button>
                <span class="verdict" [style]="verdictStyle">{{ verdict }}</span>
            </span>
        </div>
    `,
    styles,
})
export class FactLine extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;
    @state what = '';
    @state value = '';
    @state proven = false;
    @state snapshotTxHash = '';
    @state queryId = '';
    @state word = '';
    @state blockNumber = 0n;
    @state requestId = 0n;
    /** The line's own state: not fields of the row's view, so a read again keeps them. */
    @state verdict = '';
    @state verdictStyle = '';
    @state verifying = false;

    /** Hides `[ Verify ]` until Nori has proven the snapshot. */
    get unprovable$(): Observable<boolean> {
        return this.proven$.pipe(map((proven) => !proven));
    }

    /** Verifies the line's result on Solana once and shows how it went. */
    async verify(): Promise<void> {
        if (!this.proven || this.verifying) return;
        this.verifying = true;
        this.verdict = 'verifying…';
        this.verdictStyle = 'color: var(--nori-muted)';
        const word = this.word;
        try {
            const { read, unitsConsumed } = await verifySnapshotResult({
                connections: this.connections.connections,
                noriSnapshot: NORI_WEB_ENV.ethereum.snapshotAddress,
                proofQueue: NORI_WEB_ENV.ethereum.proofQueueAddress,
                snapshotTxHash: this.snapshotTxHash,
                noriProgram: NORI_WEB_ENV.solana.programAddress,
                queryId: this.queryId,
                feePayer: NORI_WEB_ENV.solana.feePayer,
            });
            const verdict = verifiedText(read.result, word, unitsConsumed);
            this.verdict = verdict.text;
            this.verdictStyle = verdict.style;
        } catch (error: unknown) {
            const verdict = verifyFailedText(error);
            this.verdict = verdict.text;
            this.verdictStyle = verdict.style;
        } finally {
            this.verifying = false;
        }
    }
}
