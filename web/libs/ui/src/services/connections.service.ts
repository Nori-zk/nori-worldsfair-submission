import { Injectable } from '@yaw-rx/core';
import {
    catchError,
    combineLatest,
    distinctUntilChanged,
    EMPTY,
    filter,
    from,
    map,
    merge,
    Observable,
    shareReplay,
    startWith,
    Subject,
    switchMap,
} from 'rxjs';
import {
    createConnections,
    DEFAULT_NORI_WEBSOCKET_URL,
    type Connections,
    type ConnectionsOptions as TransportOptions,
    type EthereumWalletState,
    type ProofRequestHistoryAddresses,
} from '@nori-zk/nori-bridge-solana-sdk';

/** The options `ConnectionsService` starts the connections with. */
export type ConnectionsOptions = TransportOptions & {
    /** The proof request queue and the Solana program the reading machines read. */
    proofRequests: ProofRequestHistoryAddresses;
};

/** DI token for the options `ConnectionsService` starts the connections with. */
export const PROOF_REQUEST_CONNECTIONS_OPTIONS = Symbol('PROOF_REQUEST_CONNECTIONS_OPTIONS');

/**
 * The network, the Ethereum wallet, the Solana RPC that every proof request
 * read goes through, and Nori's websocket, all from `createConnections`. One
 * instance per providing component; the connections close with it.
 */
@Injectable([PROOF_REQUEST_CONNECTIONS_OPTIONS])
export class ConnectionsService {
    /** Everything `createConnections` opened: network, Ethereum, Solana and Nori. */
    readonly connections: Connections;
    /**
     * The wallet's first account, or an empty string while it has shared
     * none. Read on each entry into the wallet's `ready` and each background
     * check there, and as soon as the user shares one.
     */
    readonly account$: Observable<string>;
    /** The accounts the wallet returned when the user was asked to share one. */
    private readonly accountsShared$ = new Subject<unknown>();

    /**
     * @param options The Ethereum chain, the Solana cluster, Nori's websocket, the queue and program, and optional timings.
     */
    constructor(readonly options: ConnectionsOptions) {
        this.connections = createConnections(options);
        this.account$ = merge(
            this.walletState$.pipe(
                filter((state) => state.node === 'ready'),
                switchMap(() => this.walletRequest$('eth_accounts')),
            ),
            this.accountsShared$,
        ).pipe(
            map((accounts) => (Array.isArray(accounts) ? String(accounts[0] ?? '') : '')),
            startWith(''),
            distinctUntilChanged(),
            shareReplay({ bufferSize: 1, refCount: false }),
        );
    }

    /**
     * Asks the wallet to share an account (`eth_requestAccounts`). The
     * account arrives through `account$`; a refusal leaves it empty.
     * @returns {void}
     */
    connectAccount(): void {
        this.walletRequest$('eth_requestAccounts').subscribe((accounts) =>
            this.accountsShared$.next(accounts),
        );
    }

    /** The user's wallet, which Ethereum reads and the snapshot transaction go through. */
    get wallet(): Connections['ethereum']['wallet'] {
        return this.connections.ethereum.wallet;
    }

    /** The wallet machine's states. */
    get walletState$(): Observable<EthereumWalletState> {
        return this.wallet.connection?.state$ ?? EMPTY;
    }

    /** Whether Ethereum's public RPC is `ready`; always `false` when the app gives none. */
    get ethereumHttpReady$(): Observable<boolean> {
        const http = this.connections.ethereum.http.connection;
        return (http?.state$ ?? EMPTY).pipe(
            map((state) => state.node === 'ready'),
            startWith(false),
            distinctUntilChanged(),
        );
    }

    /** Whether reads can run on both chains: Ethereum's RPC or wallet, and Solana's http, are `ready`. */
    get ready$(): Observable<boolean> {
        return combineLatest([
            this.ethereumHttpReady$,
            this.walletState$,
            this.connections.solana.http.connection.state$,
        ]).pipe(
            map(
                ([ethereumHttp, wallet, solana]) =>
                    (ethereumHttp || wallet.node === 'ready') && solana.node === 'ready',
            ),
            distinctUntilChanged(),
        );
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
     * One request to the wallet while it is `ready`.
     *
     * @param method The request's method; it takes no params.
     * @returns The wallet's answer, or nothing when it is not ready or refuses.
     */
    private walletRequest$(method: string): Observable<unknown> {
        return from(this.wallet.ready().then((provider) => provider.send(method, []))).pipe(
            catchError(() => EMPTY),
        );
    }

    /**
     * Closes the network, Ethereum, Solana and Nori connections.
     * @returns {void}
     */
    onDestroy(): void {
        this.connections.close();
    }
}
