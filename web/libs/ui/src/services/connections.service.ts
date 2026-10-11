import { Injectable } from '@yaw-rx/core';
import { combineLatest, distinctUntilChanged, EMPTY, map, Observable } from 'rxjs';
import {
    type ConnectionStatusState,
    createConnections,
    DEFAULT_NORI_WEBSOCKET_URL,
    type Connections,
    type ConnectionsOptions as TransportOptions,
    type EthereumWalletState,
    type HttpConnectionState,
    type ProofRequestHistoryAddresses,
    type SolanaHealth,
    type WalletAccountState,
    walletStatus,
} from '@nori-zk/nori-bridge-solana-sdk';

/** The options `ConnectionsService` starts the connections with. */
export type ConnectionsOptions = TransportOptions & {
    /** The proof request queue and the Solana program the reading machines read. */
    proofRequests: ProofRequestHistoryAddresses;
};

/** DI token for the options `ConnectionsService` starts the connections with. */
export const PROOF_REQUEST_CONNECTIONS_OPTIONS = Symbol('PROOF_REQUEST_CONNECTIONS_OPTIONS');

/** A pin along the bottom of the page: a connection, the colour of its status, and its page if it has one. */
export interface ConnectionPin {
    label: string;
    colour: 'green' | 'red' | 'blue';
    /** The connection's page, for a pin that links to one; `''` otherwise. */
    href: string;
}

/**
 * How often each connection is checked, and how long a check may take, unless
 * the app sets its own: a connection that stops answering turns its pin blue
 * within 5 seconds (2s to the next check, 3s for the check that gets no answer).
 */
const PIN_HEALTH_CHECKS = { intervalMs: 2000, timeoutMs: 3000 };

/** The colour of each node of a connection's status machine. */
const COLOUR: Record<ConnectionStatusState['node'], ConnectionPin['colour']> = {
    connected: 'green',
    unsure: 'blue',
    down: 'red',
    closed: 'red',
};

/**
 * A connection's pin, from its status.
 *
 * @param label What the pin names.
 * @param status$ The connection's status.
 * @param href The connection's page, or `''`.
 * @returns The pin, each time its colour changes.
 */
const pin$ = (
    label: string,
    status$: Observable<{ node: ConnectionStatusState['node'] }>,
    href = '',
): Observable<ConnectionPin> =>
    status$.pipe(
        map(({ node }) => ({ label, colour: COLOUR[node], href })),
        distinctUntilChanged((a, b) => a.colour === b.colour),
    );

/**
 * The network, the Ethereum wallet, the Solana RPC that every proof request
 * read goes through, and Nori's websocket, all from `createConnections`. One
 * instance per providing component; the connections close with it.
 */
@Injectable([PROOF_REQUEST_CONNECTIONS_OPTIONS])
export class ConnectionsService {
    /** Everything `createConnections` opened: network, Ethereum, Solana and Nori. */
    readonly connections: Connections;
    /** The account machine's states: the account the wallet shares, and asking it to share one. */
    readonly accountState$: Observable<WalletAccountState>;

    /**
     * @param options The Ethereum chain, the Solana cluster, Nori's websocket, the queue and program, and optional timings.
     */
    constructor(readonly options: ConnectionsOptions) {
        this.connections = createConnections({
            ...options,
            healthChecks: { ...PIN_HEALTH_CHECKS, ...options.healthChecks },
        });
        this.accountState$ = this.wallet.account?.state$ ?? EMPTY;
    }

    /**
     * Asks the wallet to share an account, while it shares none or after the
     * user declined. The account arrives in the account machine's state.
     * @returns {void}
     */
    connectAccount(): void {
        this.wallet.account?.shareAccount();
    }

    /** The user's wallet, which Ethereum reads and the snapshot transaction go through. */
    get wallet(): Connections['ethereum']['wallet'] {
        return this.connections.ethereum.wallet;
    }

    /** The wallet machine's states. */
    get walletState$(): Observable<EthereumWalletState> {
        return this.wallet.connection?.state$ ?? EMPTY;
    }

    /** Solana's http connection machine's states. */
    get solanaHttpState$(): Observable<HttpConnectionState<SolanaHealth>> {
        return this.connections.solana.http.connection.state$;
    }

    /** Whether reads can run on both chains: both are connected. */
    get ready$(): Observable<boolean> {
        return combineLatest([
            this.connections.ethereum.status.connection.state$,
            this.connections.solana.status.connection.state$,
        ]).pipe(
            map(
                ([ethereum, solana]) =>
                    ethereum.node === 'connected' && solana.node === 'connected',
            ),
            distinctUntilChanged(),
        );
    }

    /**
     * The connection pins, in order, each from its connection's status: the
     * network, Ethereum, Solana, Nori's websocket (linked to its page), and
     * the wallet when the app configures one.
     */
    get pins$(): Observable<ConnectionPin[]> {
        const { network, ethereum, solana, nori } = this.connections;
        const { connection: wallet } = ethereum.wallet;
        return combineLatest([
            pin$('Network', network.status.connection.state$),
            pin$('Ethereum', ethereum.status.connection.state$),
            pin$('Solana', solana.status.connection.state$),
            // Nori's websocket page: its `wss://` URL over `https://`.
            pin$('Nori', nori.status.connection.state$, this.noriUrl.replace(/^ws/, 'http')),
            ...(wallet === undefined
                ? []
                : [pin$('Wallet', wallet.state$.pipe(walletStatus('ethereum.wallet')))]),
        ]);
    }

    /** The public cluster Solana reads go to, or `custom` for the app's own endpoints. */
    get solanaCluster(): string {
        return 'cluster' in this.options.solana ? this.options.solana.cluster : 'custom';
    }

    /** Nori's websocket URL. */
    get noriUrl(): string {
        return this.options.nori?.websocket?.url ?? DEFAULT_NORI_WEBSOCKET_URL;
    }

    /**
     * Closes the network, Ethereum, Solana and Nori connections.
     * @returns {void}
     */
    onDestroy(): void {
        this.connections.close();
    }
}
