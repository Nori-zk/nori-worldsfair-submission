import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { type GuardRead } from '../../services/guard-board.service.js';
import { depositTransaction, simulationFailed, verdictText } from '../../utils/lender.js';
import styles from './guard-pane.component.css';

/**
 * What an opened guard row shows: the lender sandbox, a button that
 * simulates a lender's deposit against the guard (one `assert_healthy`, no
 * wallet, no fee) and shows what it got. One click, one simulation: the
 * result is set from that one promise, never derived from a getter.
 */
@Component({
    selector: 'guard-pane',
    template: `
        <div class="lender">
            <span class="label">LENDER</span>
            <button type="button" [disabled]="simulating" onclick="tryDeposit">
                {{ buttonLabel }}
            </button>
            <span class="result" [style]="resultStyle">{{ result }}</span>
        </div>
        <p class="note">
            What a lender's deposit instruction would get from assert_healthy by CPI, simulated: no
            wallet, no fee.
        </p>
    `,
    styles,
})
export class GuardPane extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;
    /** The guard, set by the row's `rx-for` on every refresh. */
    @state read: GuardRead | undefined = undefined;
    /** The row's status colour, for a blocked deposit. */
    @state statusColour = '';
    /** The pane's own state: not fields of the row's view, so a refresh keeps them. */
    @state result = '';
    @state resultStyle = '';
    @state simulating = false;

    get buttonLabel$(): Observable<string> {
        return this.simulating$.pipe(
            map((simulating) => (simulating ? '[ Simulating… ]' : '[ Try deposit ]')),
        );
    }

    /** Simulates the deposit once and shows its verdict. */
    async tryDeposit(): Promise<void> {
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
            const verdict = verdictText(value, this.statusColour);
            this.result = verdict.text;
            this.resultStyle = verdict.style;
        } catch (error: unknown) {
            const verdict = simulationFailed(error);
            this.result = verdict.text;
            this.resultStyle = verdict.style;
        } finally {
            this.simulating = false;
        }
    }
}
