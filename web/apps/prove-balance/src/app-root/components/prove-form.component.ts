import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, map, type Observable, take } from 'rxjs';
import { formatEther, formatUnits } from 'ethers';
import { ConnectionsService, TokenListService } from '@nori-zk/solana-web-ui';
import { TOKEN_CHOSEN } from './prove-form/token-option.component.js';
import './prove-form/token-select.component.js';
import type { BalanceRequest } from '../ystate/prove-balance.impl.js';
import type { ProveBalanceState } from '../ystate/prove-balance.js';
import {
    type ProveBalanceMachine,
    ProveBalanceService,
} from '../services/prove-balance.service.js';
import styles from './prove-form.component.css';

/**
 * Whether the machine is at one of `nodes`.
 *
 * @param nodes The nodes.
 * @returns A predicate on states.
 */
const atNode =
    (...nodes: ProveBalanceState['node'][]) =>
    (state: ProveBalanceState): boolean =>
        nodes.includes(state.node);

/**
 * The form for proving a balance: the token and the address, the balance and
 * fee read as soon as both are valid, the snapshot sent from the wallet, and
 * the proof followed to Solana. It opens once the wallet has shared an
 * account, with that account as the address.
 */
@Component({
    selector: 'prove-form',
    directives: [RxIf],
    template: `
        <p class="message" rx-if="disconnected">Connect your Ethereum wallet above to prove a balance.</p>
        <div rx-if="editable">
            <div class="label">Token</div>
            <token-select [asset]="asset" [disabled]="locked"></token-select>
            <div rx-if="isOther">
                <label>Token address
                    <input [value]="tokenAddress" [disabled]="locked" placeholder="0x…" oninput="onTokenAddress($event)" />
                </label>
            </div>
            <label>Address
                <input [value]="holder" [disabled]="locked" placeholder="0x…" oninput="onHolder($event)" />
            </label>
        </div>
        <div rx-if="editable">
            <div class="summary">
                <div class="stat">
                    <span class="stat-label">Balance</span>
                    <span class="stat-value"><span rx-if="reading"><span class="spinner"></span></span>{{ balance }}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Fee</span>
                    <span class="stat-value">{{ fee }}</span>
                </div>
            </div>
            <div class="actions" rx-if="actionShown">
                <button [disabled]="actionDisabled" onclick="act">{{ actionLabel }}</button>
            </div>
            <p class="message">{{ message }}</p>
        </div>
        <div rx-if="proving">
            <proof-progress [txHash]="txHash"></proof-progress>
            <div class="actions">
                <button class="secondary" onclick="another">Prove another</button>
            </div>
        </div>
    `,
    styles,
})
export class ProveForm extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;
    @Inject(TokenListService) private readonly tokenList!: TokenListService;
    @Inject(ProveBalanceService) private readonly proveBalance!: ProveBalanceService;

    private get state$(): Observable<ProveBalanceState> {
        return this.proveBalance.state$;
    }

    override onInit(): void {
        this.addEventListener(TOKEN_CHOSEN, this.onTokenChosen);
    }

    get disconnected$(): Observable<boolean> {
        return combineLatest([this.connections.ready$, this.connections.account$]).pipe(
            map(([ready, account]) => !ready || account === ''),
        );
    }

    get editable$(): Observable<boolean> {
        return combineLatest([this.disconnected$, this.state$]).pipe(
            map(([disconnected]) => !disconnected),
        );
    }

    /** Whether the form is fixed: the transaction is being confirmed, or the proof is under way. */
    get locked$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('awaitingSignature', 'proving')));
    }

    /** The one button stays in place until the proof is under way. */
    get actionShown$(): Observable<boolean> {
        return this.state$.pipe(map((state) => !atNode('proving')(state)));
    }

    /** "Read again" after a failed read, else "Prove on Solana", or confirming while the wallet asks. */
    get actionLabel$(): Observable<string> {
        return this.state$.pipe(
            map((state) =>
                state.node === 'readFailed'
                    ? 'Read again'
                    : state.node === 'awaitingSignature'
                      ? 'Confirming in your wallet…'
                      : 'Prove on Solana',
            ),
        );
    }

    /** Enabled when there is something to do: prove a read balance, or read again. */
    get actionDisabled$(): Observable<boolean> {
        return this.state$.pipe(
            map((state) => !atNode('balanceRead', 'declined', 'sendFailed', 'readFailed')(state)),
        );
    }

    get asset$(): Observable<string> {
        return this.state$.pipe(map(({ data }) => data.asset));
    }

    /** Whether the asset is a token the list does not have: its address is typed in. */
    get isOther$(): Observable<boolean> {
        return combineLatest([this.state$, this.tokenList.tokens$]).pipe(
            map(
                ([{ data }, tokens]) =>
                    data.asset !== 'eth' &&
                    !tokens.some(
                        (token) => token.address.toLowerCase() === data.asset.toLowerCase(),
                    ),
            ),
        );
    }

    get tokenAddress$(): Observable<string> {
        return this.state$.pipe(map(({ data }) => (data.asset === 'eth' ? '' : data.asset)));
    }

    get holder$(): Observable<string> {
        return this.state$.pipe(map(({ data }) => data.holder));
    }

    get reading$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('reading')));
    }

    /** The balance read, nothing while reading, or "—" before there is one. */
    get balance$(): Observable<string> {
        return this.state$.pipe(
            map((state) =>
                'balance' in state.data
                    ? `${formatUnits(state.data.balance, state.data.decimals)} ${state.data.symbol}`
                    : state.node === 'reading'
                      ? ''
                      : '—',
            ),
        );
    }

    /** The snapshot fee read, or "—" before there is one. */
    get fee$(): Observable<string> {
        return this.state$.pipe(
            map((state) => ('fee' in state.data ? `${formatEther(state.data.fee)} ETH` : '—')),
        );
    }

    /** What the user is waiting on or what went wrong, for the node the machine is at. */
    get message$(): Observable<string> {
        return this.state$.pipe(
            map((state) => {
                switch (state.node) {
                    case 'editing':
                        return 'Enter a token and an Ethereum address';
                    case 'waitingForConnection':
                        return `Waiting for ${state.data.waitingOn.join(' and ')}`;
                    case 'readFailed':
                        return state.data.error;
                    case 'declined':
                        return 'You cancelled the transaction in your wallet';
                    case 'sendFailed':
                        return state.data.error;
                    case 'reading':
                    case 'balanceRead':
                    case 'awaitingSignature':
                    case 'proving':
                        return '';
                }
            }),
        );
    }

    get proving$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('proving')));
    }

    get txHash$(): Observable<string> {
        return this.state$.pipe(
            map((state) => (state.node === 'proving' ? state.data.txHash : '')),
        );
    }

    onTokenAddress(event: Event): void {
        const asset = (event.target as HTMLInputElement).value.trim();
        this.editRequest((request) => ({ ...request, asset }));
    }

    /**
     * A token picked in the dropdown: ETH or a listed token's address, or an
     * empty address to type in for "Other token…".
     *
     * @param event The option's `token-chosen` event.
     * @returns {void}
     */
    private readonly onTokenChosen = (event: Event): void => {
        const chosen = (event as CustomEvent<string>).detail;
        this.editRequest((request) => ({ ...request, asset: chosen === 'other' ? '' : chosen }));
    };

    onHolder(event: Event): void {
        const holder = (event.target as HTMLInputElement).value.trim();
        this.editRequest((request) => ({ ...request, holder }));
    }

    /** The one button: reads again after a failed read, otherwise proves. */
    act(): void {
        this.state$.pipe(take(1)).subscribe((state) =>
            this.control((machine) =>
                state.node === 'readFailed' ? machine.retry() : machine.prove(),
            ),
        );
    }

    another(): void {
        this.control((machine) => machine.another());
    }

    /**
     * Calls one of the running machine's controls.
     *
     * @param call The control to call.
     * @returns {void}
     */
    private control(call: (machine: ProveBalanceMachine) => void): void {
        this.proveBalance.machine$.pipe(take(1)).subscribe(call);
    }

    /**
     * Edits the request the machine holds.
     *
     * @param change The new request, from the current one.
     * @returns {void}
     */
    private editRequest(change: (request: BalanceRequest) => BalanceRequest): void {
        this.proveBalance.edit(change);
    }

    override onDestroy(): void {
        this.removeEventListener(TOKEN_CHOSEN, this.onTokenChosen);
    }
}
