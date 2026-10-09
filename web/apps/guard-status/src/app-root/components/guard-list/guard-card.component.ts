import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import {
    ConnectionsService,
    depositTransaction,
    STATUS_COLOUR,
    verdictText,
    type GuardRead,
} from '@nori-zk/solana-web-ui';
import { checkFailed, depositSentence, type GuardStatus } from '../../utils/status-text.js';
import styles from './guard-card.component.css';

/**
 * One guard, in plain words: its status and what it means, its mint, the
 * backing Nori last proved on Ethereum against the mint's live supply on
 * Solana, and what a lender's deposit would get now. The view's fields are
 * set by the list's `rx-for` on each read.
 *
 * `[ Check my deposit ]` simulates a lender's deposit against the guard: one
 * `assert_healthy` by CPI, no wallet, no fee. One click, one simulation; its
 * result is the card's own state, not a view field, so a refresh keeps it.
 */
@Component({
    selector: 'guard-card',
    template: `
        <div class="top">
            <span class="status" [style]="statusStyle">
                <span class="dot"></span>{{ statusWord }}
            </span>
            <a class="mint" [href]="mintUrl" target="_blank" rel="noopener">{{ mintLabel }} ↗</a>
        </div>
        <p class="sentence">
            {{ sentence }}
            <a
                [class.hidden]="noSentenceLink"
                [href]="sentenceLinkUrl"
                target="_blank"
                rel="noopener"
                >{{ sentenceLink }} ↗</a
            >{{ sentenceEnd }}
        </p>
        <div class="figures">
            <span class="label">Backing on Ethereum</span>
            <span class="number">{{ backing }}</span>
            <span class="detail">
                {{ backingDetail }}
                <span [class.hidden]="unproven">
                    at block
                    <a [href]="backingBlockUrl" target="_blank" rel="noopener"
                        >{{ backingBlock }} ↗</a
                    >
                </span>
            </span>
            <span class="label">Supply on Solana</span>
            <span class="number">{{ supply }}</span>
            <span class="detail">live</span>
        </div>
        <p class="coverage">{{ coverage }}</p>
        <div class="lender">
            <span>{{ lender }}</span>
            <button type="button" [disabled]="simulating" onclick="checkDeposit">
                {{ buttonLabel }}
            </button>
        </div>
        <p class="result" [style]="resultStyle">{{ result }}</p>
        <p class="note">Simulated assert_healthy by CPI: no wallet, no fee.</p>
    `,
    styles,
})
export class GuardCard extends RxElement {
    @state read: GuardRead | undefined = undefined;
    @state status: GuardStatus = 'STALE';
    @state statusWord = '';
    @state statusStyle = '';
    @state sentence = '';
    @state sentenceLink = '';
    @state sentenceLinkUrl = '';
    @state sentenceEnd = '';
    @state noSentenceLink = true;
    @state mintLabel = '';
    @state mintUrl = '';
    @state backing = '';
    @state backingDetail = '';
    @state backingBlock = '';
    @state backingBlockUrl = '';
    @state unproven = true;
    @state supply = '';
    @state coverage = '';
    @state lender = '';
    /** The deposit check's own state. */
    @state result = '';
    @state resultStyle = '';
    @state simulating = false;

    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;

    get buttonLabel$(): Observable<string> {
        return this.simulating$.pipe(
            map((simulating) => (simulating ? '[ Simulating… ]' : '[ Check my deposit ]')),
        );
    }

    /** Simulates the deposit once and says what it got. */
    async checkDeposit(): Promise<void> {
        const read = this.read;
        if (read === undefined || this.simulating) return;
        this.simulating = true;
        try {
            const rpc = await this.connections.connections.solana.http.ready();
            const { value } = await rpc
                .simulateTransaction(
                    depositTransaction(read.address, read.guard.mint, NORI_WEB_ENV.solana.feePayer),
                    {
                        encoding: 'base64',
                        sigVerify: false,
                        replaceRecentBlockhash: true,
                        commitment: 'confirmed',
                    },
                )
                .send();
            this.result = depositSentence(value);
            this.resultStyle = verdictText(value, STATUS_COLOUR[read.status]).style;
        } catch (error: unknown) {
            this.result = checkFailed(error);
            this.resultStyle = 'color: var(--nori-muted)';
        } finally {
            this.simulating = false;
        }
    }
}
