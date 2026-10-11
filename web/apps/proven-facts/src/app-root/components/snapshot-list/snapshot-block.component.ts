import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { combineLatest, filter, map, type Observable, type Subscription, take } from 'rxjs';
import { createProofRequestStateMachine } from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService, verifiedText, verifyFailedText } from '@nori-zk/solana-web-ui';
import {
    createProvenRequestMachine,
    createSnapshotVerificationMachine,
    followedStates$,
    type SnapshotVerificationState,
} from '@nori-zk/backstop-keeper/read';
import { verdictSentence } from '../../utils/verdict.js';
import styles from './snapshot-block.component.css';

/** The verification's nodes that give the verdict. */
type Outcome = 'verified' | 'readFailed';

/**
 * One snapshot, in sentences: its Ethereum time and block, whether Nori has
 * proven it on Solana, and what its view calls returned. Once proven,
 * `[ Verify on Solana ]` builds one result's witness and simulates
 * nori-read-example with it, as the dashboard's fact line does: no wallet,
 * no fee. One click, one verify: the verdict is set from that one
 * verification's first outcome, and its machines close with it.
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
    /** The running verification, from the last click until its verdict. */
    private verification: Subscription | undefined;

    /** Hides `[ Verify on Solana ]` until Nori has proven the snapshot, or when it has no result. */
    get unverifiable$(): Observable<boolean> {
        return combineLatest([this.proven$, this.verifyQueryId$]).pipe(
            map(([proven, queryId]) => !proven || queryId === ''),
        );
    }

    /** Verifies the snapshot's backing, or its first result, on Solana once and says how it went. */
    verify(): void {
        if (!this.proven || this.verifying || this.verifyQueryId === '') return;
        this.verifying = true;
        this.verdict = 'Verifying…';
        this.verdictStyle = 'color: var(--nori-muted)';
        const word = this.verifyWord;
        const { connections } = this.connections;
        const { snapshotAddress, proofQueueAddress } = NORI_WEB_ENV.ethereum;
        const snapshotTxHash = this.txHash;
        const queryId = this.verifyQueryId;
        this.verification?.unsubscribe();
        this.verification = followedStates$(() => {
            const proofRequest = createProofRequestStateMachine(connections, {
                proofQueueAddress,
                proofRequestTxHash: snapshotTxHash,
                programAddress: NORI_WEB_ENV.solana.programAddress,
            });
            const proven = createProvenRequestMachine(connections, proofQueueAddress, proofRequest);
            const verification = createSnapshotVerificationMachine(
                connections,
                { noriSnapshot: snapshotAddress, feePayer: NORI_WEB_ENV.solana.feePayer },
                { snapshotTxHash, queryId },
                proven,
            );
            return {
                state$: verification.state$,
                close: () => {
                    verification.close();
                    proven.close();
                    proofRequest.close();
                },
            };
        })
            .pipe(
                filter(
                    (
                        verification,
                    ): verification is Extract<SnapshotVerificationState, { node: Outcome }> =>
                        verification.node === 'verified' || verification.node === 'readFailed',
                ),
                take(1),
            )
            .subscribe((verification) => {
                const verdict = verdictSentence(
                    verification.node === 'verified'
                        ? verifiedText(
                              verification.data.read.result,
                              word,
                              verification.data.unitsConsumed,
                          )
                        : verifyFailedText(verification.data.error),
                );
                this.verdict = verdict.text;
                this.verdictStyle = verdict.style;
                this.verifying = false;
            });
    }

    override onDestroy(): void {
        this.verification?.unsubscribe();
    }
}
