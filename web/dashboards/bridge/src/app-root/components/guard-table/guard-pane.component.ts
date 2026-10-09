import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { filter, map, type Observable } from 'rxjs';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { type GuardRead } from '../../services/guard-board.service.js';
import {
    addressUrl,
    amount,
    blockText,
    blockUrl,
    dateTime,
    duration,
    shortHex,
    solanaAccountUrl,
} from '../../utils/format.js';
import { checkpointLines, windowOf } from '../../utils/guard-rule.js';
import { depositTransaction, simulationFailed, verdictText } from '../../utils/lender.js';
import styles from './guard-pane.component.css';

/**
 * A Solana address cut to its start and end.
 *
 * @param address The address.
 * @returns `E8M7…7PYD`.
 */
const short = (address: string): string => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * What an opened guard row shows. First the lender sandbox, a button that
 * simulates a lender's deposit against the guard (one `assert_healthy`, no
 * wallet, no fee) and shows what it got. One click, one simulation: the
 * result is set from that one promise, never derived from a getter. Then the
 * guard itself, all from the row's read (no request of its own): its
 * settings, its backing, the trip rule re-run on the checkpoints it keeps,
 * and those checkpoints.
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
        <div class="facts">
            <span class="fact">
                <span class="label">GUARD</span>
                <a [href]="guardUrl" target="_blank" rel="noopener">{{ guard }} ↗</a>
            </span>
            <span class="fact">
                <span class="label">ADMIN</span>
                <a [href]="adminUrl" target="_blank" rel="noopener">{{ admin }} ↗</a>
            </span>
            <span class="fact">
                <span class="label">NORI PROGRAM</span>
                <a [href]="programUrl" target="_blank" rel="noopener">{{ program }} ↗</a>
            </span>
            <span class="fact">
                <span class="label">NORISNAPSHOT</span>
                <a [href]="snapshotUrl" target="_blank" rel="noopener">{{ snapshot }} ↗</a>
            </span>
            <span class="fact">
                <span class="label">TOLERANCE</span>
                <span>{{ tolerance }}</span>
            </span>
            <span class="fact">
                <span class="label">WINDOW / SKEW</span>
                <span>{{ windowSkew }}</span>
            </span>
            <span class="fact">
                <span class="label">CHECKPOINTS</span>
                <span>{{ checkpointCount }}</span>
            </span>
            <span class="fact">
                <span class="label">STALENESS</span>
                <span>{{ staleness }}</span>
            </span>
            <span class="fact wide">
                <span class="label">BACKING</span>
                <span>{{ backing }}</span>
                <span [class.hidden]="unproven">
                    at block
                    <a [href]="backingBlockUrl" target="_blank" rel="noopener"
                        >{{ backingBlock }} ↗</a
                    >
                    · {{ backingTime }}
                </span>
            </span>
            <span class="fact wide" [class.hidden]="notPaused">
                <span class="label">PAUSED</span>
                <span>
                    at block
                    <a [href]="pauseBlockUrl" target="_blank" rel="noopener">{{ pauseBlock }} ↗</a>
                </span>
            </span>
            <span class="fact wide" [class.hidden]="notTripped">
                <span class="label">TRIPPED</span>
                <span [style]="trippedStyle">
                    at block
                    <a [href]="tripBlockUrl" target="_blank" rel="noopener">{{ tripBlock }} ↗</a>
                    · deficit {{ tripDeficit }}
                </span>
            </span>
        </div>
        <div class="rule">
            <span class="label">RULE</span>
            <span>{{ rule }}</span>
        </div>
        <pre class="checkpoints">{{ checkpoints }}</pre>
        <p class="note">
            The rule is re-run on the checkpoints the guard keeps now (64, about 2 h). It matches
            the on-chain verdict only when the read landed more than a window after its Ethereum
            time.
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

    get guard$(): Observable<string> {
        return this.fact$(({ address }) => short(address));
    }

    get guardUrl$(): Observable<string> {
        return this.fact$(({ address }) => solanaAccountUrl(address));
    }

    get admin$(): Observable<string> {
        return this.fact$(({ guard }) => short(guard.admin));
    }

    get adminUrl$(): Observable<string> {
        return this.fact$(({ guard }) => solanaAccountUrl(guard.admin));
    }

    get program$(): Observable<string> {
        return this.fact$(({ guard }) => short(guard.config.noriProgram));
    }

    get programUrl$(): Observable<string> {
        return this.fact$(({ guard }) => solanaAccountUrl(guard.config.noriProgram));
    }

    get snapshot$(): Observable<string> {
        return this.fact$(({ guard }) => shortHex(guard.config.noriSnapshot));
    }

    get snapshotUrl$(): Observable<string> {
        return this.fact$(({ guard }) => addressUrl(guard.config.noriSnapshot));
    }

    get tolerance$(): Observable<string> {
        return this.fact$(({ guard, decimals }) => amount(guard.config.tolerance, decimals));
    }

    get windowSkew$(): Observable<string> {
        return this.fact$(
            ({ guard }) =>
                `${duration(guard.config.windowSecs)} / ${duration(guard.config.skewSecs)}`,
        );
    }

    /** `70 (64 kept) · every 2 min`. */
    get checkpointCount$(): Observable<string> {
        return this.fact$(({ guard }) => {
            const kept = guard.checkpoints.length;
            const count = guard.checkpointCount.toLocaleString('en-US');
            const every = `every ${duration(guard.config.checkpointIntervalSecs)}`;
            return guard.checkpointCount > BigInt(kept)
                ? `${count} (${kept.toString()} kept) · ${every}`
                : `${count} · ${every}`;
        });
    }

    get staleness$(): Observable<string> {
        return this.fact$(({ guard }) => duration(guard.config.maxStalenessSecs));
    }

    get backing$(): Observable<string> {
        return this.fact$(({ guard, decimals }) =>
            guard.backingEthTime === 0n ? 'none proven yet' : amount(guard.backing, decimals),
        );
    }

    get unproven$(): Observable<boolean> {
        return this.fact$(({ guard }) => guard.backingEthTime === 0n);
    }

    get backingBlock$(): Observable<string> {
        return this.fact$(({ guard }) => blockText(guard.backingEthBlock));
    }

    get backingBlockUrl$(): Observable<string> {
        return this.fact$(({ guard }) => blockUrl(guard.backingEthBlock));
    }

    get backingTime$(): Observable<string> {
        return this.fact$(({ guard }) => dateTime(Number(guard.backingEthTime)));
    }

    get notPaused$(): Observable<boolean> {
        return this.fact$(({ guard }) => !guard.paused);
    }

    get pauseBlock$(): Observable<string> {
        return this.fact$(({ guard }) => blockText(guard.pauseEthBlock));
    }

    get pauseBlockUrl$(): Observable<string> {
        return this.fact$(({ guard }) => blockUrl(guard.pauseEthBlock));
    }

    get notTripped$(): Observable<boolean> {
        return this.fact$(({ guard }) => !guard.tripped);
    }

    get trippedStyle$(): Observable<string> {
        return this.statusColour$.pipe(map((colour) => `color: ${colour}`));
    }

    get tripBlock$(): Observable<string> {
        return this.fact$(({ guard }) => blockText(guard.tripEthBlock));
    }

    get tripBlockUrl$(): Observable<string> {
        return this.fact$(({ guard }) => blockUrl(guard.tripEthBlock));
    }

    get tripDeficit$(): Observable<string> {
        return this.fact$(({ guard, decimals }) => amount(guard.tripDeficit, decimals));
    }

    /** The trip rule's verdict on the latest backing. */
    get rule$(): Observable<string> {
        return this.fact$(({ guard, decimals }) => windowOf(guard, decimals).verdict);
    }

    /** The window's checkpoints, one per line, newest first. */
    get checkpoints$(): Observable<string> {
        return this.fact$(({ guard, decimals }) =>
            checkpointLines(windowOf(guard, decimals), decimals).join('\n'),
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

    /**
     * One fact of the guard, once the row has set its read.
     *
     * @param of The fact, from the read.
     * @returns It, again on every refresh.
     */
    private fact$<T>(of: (read: GuardRead) => T): Observable<T> {
        return this.read$.pipe(
            filter((read): read is GuardRead => read !== undefined),
            map(of),
        );
    }
}
