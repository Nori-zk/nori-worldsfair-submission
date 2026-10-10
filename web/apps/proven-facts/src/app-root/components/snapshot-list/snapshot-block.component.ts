import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { combineLatest, map, type Observable } from 'rxjs';
import { ConnectionsService, verifiedText, verifyFailedText } from '@nori-zk/solana-web-ui';
import { verifySnapshotResult } from '@nori-zk/backstop-client/read';
import { verdictSentence } from '../../utils/verdict.js';
import styles from './snapshot-block.component.css';

/**
 * One snapshot, in sentences: its Ethereum time and block, whether Nori has
 * proven it on Solana, and what its view calls returned. Once proven,
 * `[ Verify on Solana ]` builds one result's witness and simulates
 * nori-read-example with it, as the dashboard's fact line does: no wallet,
 * no fee. One click, one verify: the verdict is set from that one promise.
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
        <div class="verify" [class.hidden]="unverifiable">
            <button type="button" [disabled]="verifying" onclick="verify">
                [ Verify on Solana ]
            </button>
            <span class="verdict" [style]="verdictStyle">{{ verdict }}</span>
        </div>
    `,
    styles,
})
export class SnapshotBlock extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;
    @state when = '';
    @state block = '';
    @state blockUrl = '';
    @state proven = false;
    @state status = '';
    @state sentence = '';
    @state txHash = '';
    @state verifyQueryId = '';
    @state verifyWord = '';
    /** The block's own state: not fields of the list's view, so a read again keeps them. */
    @state verdict = '';
    @state verdictStyle = '';
    @state verifying = false;

    /** Hides `[ Verify on Solana ]` until Nori has proven the snapshot, or when it has no result. */
    get unverifiable$(): Observable<boolean> {
        return combineLatest([this.proven$, this.verifyQueryId$]).pipe(
            map(([proven, queryId]) => !proven || queryId === ''),
        );
    }

    /** Verifies the snapshot's backing, or its first result, on Solana once and says how it went. */
    async verify(): Promise<void> {
        if (!this.proven || this.verifying || this.verifyQueryId === '') return;
        this.verifying = true;
        this.verdict = 'Verifying…';
        this.verdictStyle = 'color: var(--nori-muted)';
        const word = this.verifyWord;
        try {
            const { read, unitsConsumed } = await verifySnapshotResult({
                connections: this.connections.connections,
                noriSnapshot: NORI_WEB_ENV.ethereum.snapshotAddress,
                proofQueue: NORI_WEB_ENV.ethereum.proofQueueAddress,
                snapshotTxHash: this.txHash,
                noriProgram: NORI_WEB_ENV.solana.programAddress,
                queryId: this.verifyQueryId,
                feePayer: NORI_WEB_ENV.solana.feePayer,
            });
            const verdict = verdictSentence(verifiedText(read.result, word, unitsConsumed));
            this.verdict = verdict.text;
            this.verdictStyle = verdict.style;
        } catch (error: unknown) {
            const verdict = verdictSentence(verifyFailedText(error));
            this.verdict = verdict.text;
            this.verdictStyle = verdict.style;
        } finally {
            this.verifying = false;
        }
    }
}
