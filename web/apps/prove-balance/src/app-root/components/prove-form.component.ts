import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, map, type Observable, take } from 'rxjs';
import { formatEther, formatUnits } from 'ethers';
import { ConnectionsService, TokenListService } from '@nori-zk/solana-web-ui';
import { NORI_READ_EXAMPLE_PROGRAM } from '@nori-zk/backstop-client/read';
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

/** The nodes that follow a snapshot transaction once it is sent. */
const FOLLOWING: ProveBalanceState['node'][] = ['proving', 'verifying', 'verifyFailed', 'verified'];

/** Each Ethereum chain's block explorer. */
const ETHEREUM_EXPLORERS: Record<number, string> = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
};

/** The Ethereum block explorer of the chain this build reads. */
const ETHEREUM_EXPLORER =
    ETHEREUM_EXPLORERS[NORI_WEB_ENV.ethereum.chainId] ?? 'https://etherscan.io';

/**
 * An account's page on the Solana explorer, for the cluster this build reads.
 *
 * @param address The account.
 * @returns The URL.
 */
const solanaAccountUrl = (address: string): string =>
    `https://explorer.solana.com/address/${address}` +
    (NORI_WEB_ENV.solana.cluster === 'mainnet' ? '' : `?cluster=${NORI_WEB_ENV.solana.cluster}`);

/**
 * A short form of a long hex string or address.
 *
 * @param text The string.
 * @returns `0x8a1f…9c2d`.
 */
const shortened = (text: string): string =>
    text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;

/** The verified node's data, while the machine is there. */
type Verified = Extract<ProveBalanceState, { node: 'verified' }>['data'];

/**
 * The form for proving a balance: the token and the address, the balance and
 * fee read as soon as both are valid, the snapshot sent from the wallet, the
 * proof followed to Solana, and the result verified there. It opens once the
 * wallet has shared an account, with that account as the address.
 */
@Component({
    selector: 'prove-form',
    directives: [RxIf],
    template: `
        <p class="message" rx-if="disconnected">
            Connect your Ethereum wallet above to prove a balance.
        </p>
        <div rx-if="editable">
            <div class="label">Token</div>
            <token-select [asset]="asset" [disabled]="locked"></token-select>
            <div rx-if="isOther">
                <label
                    >Token address
                    <input
                        [value]="tokenAddress"
                        [disabled]="locked"
                        placeholder="0x…"
                        oninput="onTokenAddress($event)"
                    />
                </label>
            </div>
            <label
                >Address
                <input
                    [value]="holder"
                    [disabled]="locked"
                    placeholder="0x…"
                    oninput="onHolder($event)"
                />
            </label>
        </div>
        <div rx-if="editable">
            <div class="summary">
                <div class="stat">
                    <span class="stat-label">Balance now (latest block)</span>
                    <span class="stat-value"
                        ><span rx-if="reading"><span class="spinner"></span></span
                        >{{ balance }}</span
                    >
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
            <section class="verify" rx-if="verifyShown">
                <p class="verify-status">
                    <span rx-if="verifying"><span class="spinner"></span></span>{{ verifyStatus }}
                </p>
                <div rx-if="verified">
                    <dl class="facts">
                        <div class="fact wide">
                            <dt>Balance verified by nori-read</dt>
                            <dd class="balance">{{ provenBalance }}</dd>
                        </div>
                        <div class="fact">
                            <dt>Ethereum block</dt>
                            <dd>
                                <a [href]="ethBlockUrl" target="_blank" rel="noopener"
                                    >{{ ethBlock }} ↗</a
                                >
                            </dd>
                        </div>
                        <div class="fact">
                            <dt>Block time</dt>
                            <dd>{{ ethTime }}</dd>
                        </div>
                        <div class="fact">
                            <dt>Nori batch</dt>
                            <dd>
                                <a [href]="batchUrl" target="_blank" rel="noopener"
                                    >{{ batch }} ↗</a
                                >
                            </dd>
                        </div>
                        <div class="fact">
                            <dt>Compute units</dt>
                            <dd>{{ computeUnits }}</dd>
                        </div>
                    </dl>
                    <p class="note">
                        Checked by
                        <a [href]="readProgramUrl" target="_blank" rel="noopener"
                            >nori-read-example ↗</a
                        >
                        in a simulated Solana transaction: no wallet, no fee. Any Solana program can
                        make the same check with nori-read.
                    </p>
                </div>
                <div class="actions" rx-if="verifyFailed">
                    <button onclick="retry">Verify again</button>
                </div>
            </section>
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
        return this.state$.pipe(map(atNode('awaitingSignature', ...FOLLOWING)));
    }

    /** The one button stays in place until the proof is under way. */
    get actionShown$(): Observable<boolean> {
        return this.state$.pipe(map((state) => !atNode(...FOLLOWING)(state)));
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
                    case 'verifying':
                    case 'verifyFailed':
                    case 'verified':
                        return '';
                }
            }),
        );
    }

    get proving$(): Observable<boolean> {
        return this.state$.pipe(map(atNode(...FOLLOWING)));
    }

    get txHash$(): Observable<string> {
        return this.state$.pipe(map((state) => ('txHash' in state.data ? state.data.txHash : '')));
    }

    /** The verification shows once a batch on Solana covers the proof request. */
    get verifyShown$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('verifying', 'verifyFailed', 'verified')));
    }

    get verifying$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('verifying')));
    }

    get verifyFailed$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('verifyFailed')));
    }

    get verified$(): Observable<boolean> {
        return this.state$.pipe(map(atNode('verified')));
    }

    /** What verifying the result on Solana is doing, found, or why it failed. */
    get verifyStatus$(): Observable<string> {
        return this.state$.pipe(
            map((state) =>
                state.node === 'verifying'
                    ? `Verifying the balance on Solana against batch #${state.data.proofQueueBatchIndex.toString()}`
                    : state.node === 'verifyFailed'
                      ? `Verifying failed: ${state.data.error}`
                      : state.node === 'verified'
                        ? 'Verified on Solana'
                        : '',
            ),
        );
    }

    /**
     * One fact of the verified result, or `''` before there is one.
     *
     * @param fact The fact, from the verified node's data.
     * @returns The fact while verified.
     */
    private verifiedFact$(fact: (verified: Verified) => string): Observable<string> {
        return this.state$.pipe(
            map((state) => (state.node === 'verified' ? fact(state.data) : '')),
        );
    }

    get provenBalance$(): Observable<string> {
        return this.verifiedFact$(
            ({ provenBalance, decimals, symbol }) =>
                `${formatUnits(provenBalance, decimals)} ${symbol}`,
        );
    }

    get ethBlock$(): Observable<string> {
        return this.verifiedFact$(({ ethBlockNumber }) => ethBlockNumber.toLocaleString('en-US'));
    }

    get ethBlockUrl$(): Observable<string> {
        return this.verifiedFact$(
            ({ ethBlockNumber }) => `${ETHEREUM_EXPLORER}/block/${ethBlockNumber.toString()}`,
        );
    }

    get ethTime$(): Observable<string> {
        return this.verifiedFact$(({ ethTimestamp }) =>
            new Date(Number(ethTimestamp) * 1000).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'long',
                timeZone: 'UTC',
            }),
        );
    }

    get batch$(): Observable<string> {
        return this.verifiedFact$(
            ({ proofQueueBatchIndex, proofQueueBatchAddress }) =>
                `#${proofQueueBatchIndex.toString()} · ${shortened(proofQueueBatchAddress)}`,
        );
    }

    get batchUrl$(): Observable<string> {
        return this.verifiedFact$(({ proofQueueBatchAddress }) =>
            solanaAccountUrl(proofQueueBatchAddress),
        );
    }

    get computeUnits$(): Observable<string> {
        return this.verifiedFact$(({ unitsConsumed }) => unitsConsumed.toLocaleString('en-US'));
    }

    get readProgramUrl(): string {
        return solanaAccountUrl(NORI_READ_EXAMPLE_PROGRAM);
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

    /** Verifies again after a failure. */
    retry(): void {
        this.control((machine) => machine.retry());
    }

    /** The one button: reads again after a failed read, otherwise proves. */
    act(): void {
        this.state$
            .pipe(take(1))
            .subscribe((state) =>
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
