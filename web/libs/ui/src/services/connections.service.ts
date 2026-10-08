import { Injectable } from '@yaw-rx/core';
import {
    combineLatest,
    distinctUntilChanged,
    EMPTY,
    from,
    map,
    merge,
    Observable,
    shareReplay,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import {
    type Eip1193EventProvider,
    createProofRequestConnections,
    getBridgeSocketWithConnectivity$,
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
    type EthereumWalletMachine,
    type ProofRequestConnectionsOptions,
    type ProofRequestHistoryAddresses,
    type UnprocessedProofRequestTopics,
} from '@nori-zk/nori-bridge-solana-sdk';

/** The running connections `createProofRequestConnections` starts. */
type StartedConnections = ReturnType<typeof createProofRequestConnections>;

/** The options `ConnectionsService` starts the connections with. */
export type ConnectionsOptions = ProofRequestConnectionsOptions & {
    /** The bridge's websocket, for the live processing stages. */
    bridge: { wssUrl: string };
    /** The proof request queue and the Solana program the reading machines read. */
    proofRequests: ProofRequestHistoryAddresses;
};

/**
 * Opens the bridge websocket and keeps it open until `close()`.
 *
 * @param wssUrl The bridge's websocket.
 * @returns
 *   - `connectivity`: the socket's running connectivity machine.
 *   - `topics`: the topics `createUnprocessedProofRequestStateMachine` reads.
 *   - `close()`: closes the socket and stops the machine.
 */
function startBridgeConnection(wssUrl: string) {
    const { bridgeSocket$, bridgeSocketConnectivity } = getBridgeSocketWithConnectivity$(wssUrl);
    const connectivity = bridgeSocketConnectivity.close().start('connecting');
    const topics: UnprocessedProofRequestTopics = {
        ethStateTopic$: getEthStateTopic$(bridgeSocket$),
        bridgeStateTopic$: getBridgeStateTopic$(bridgeSocket$),
        bridgeTimingsTopic$: getBridgeTimingsTopic$(bridgeSocket$),
    };
    const socketSubscription = bridgeSocket$.subscribe();
    return {
        connectivity,
        topics,
        close: () => {
            socketSubscription.unsubscribe();
            connectivity.stop();
        },
    };
}

/**
 * A wallet's `accountsChanged` events, for as long as it is subscribed.
 *
 * @param walletProvider The wallet's EIP-1193 provider.
 * @returns Each event's accounts.
 */
const accountsChanged$ = (walletProvider: Eip1193EventProvider): Observable<unknown> =>
    new Observable<unknown>((subscriber) => {
        const listener = (accounts: unknown) => subscriber.next(accounts);
        walletProvider.on?.('accountsChanged', listener);
        return () => {
            walletProvider.removeListener?.('accountsChanged', listener);
        };
    });

/** The bridge websocket: its running connectivity machine, its topics and `close()`. */
export type BridgeConnection = ReturnType<typeof startBridgeConnection>;

/** DI token for the options `ConnectionsService` starts the connections with. */
export const PROOF_REQUEST_CONNECTIONS_OPTIONS = Symbol('PROOF_REQUEST_CONNECTIONS_OPTIONS');

/**
 * The network, the Ethereum wallet and provider, the Solana RPC that every
 * proof request read goes through, and the bridge websocket. One instance
 * per providing component; the connections close with it.
 */
@Injectable([PROOF_REQUEST_CONNECTIONS_OPTIONS])
export class ConnectionsService {
    /** The running network machine. */
    readonly network: StartedConnections['network'];
    /** The Ethereum and Solana connections, for the reading machines. */
    readonly connections: StartedConnections['connections'];
    /** The bridge websocket. */
    readonly bridge: BridgeConnection;
    /** The wallet's first account, or an empty string while it has shared none. */
    readonly account$: Observable<string>;
    private readonly closeConnections: () => void;

    /**
     * @param options The Ethereum chain, the Solana cluster, the bridge websocket, and optional endpoints and timings.
     */
    constructor(readonly options: ConnectionsOptions) {
        const { network, connections, close } = createProofRequestConnections(options);
        this.network = network;
        this.connections = connections;
        this.closeConnections = close;
        this.bridge = startBridgeConnection(options.bridge.wssUrl);
        this.account$ = (connections.ethereum.wallet?.walletProvider$ ?? EMPTY).pipe(
            switchMap((walletProvider) =>
                merge(
                    from(walletProvider.request({ method: 'eth_accounts' })),
                    accountsChanged$(walletProvider),
                ),
            ),
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
        this.wallet?.walletProvider$.pipe(take(1)).subscribe((walletProvider) => {
            walletProvider.request({ method: 'eth_requestAccounts' }).catch(() => undefined);
        });
    }

    /** The running wallet machine, when reads go through the user's wallet. */
    get wallet(): EthereumWalletMachine | undefined {
        return this.connections.ethereum.wallet;
    }

    /** Whether reads can run on both chains: Ethereum's and Solana's connections are `ready`. */
    get ready$(): Observable<boolean> {
        return combineLatest([
            this.connections.ethereum.ethereumProviderConnectivity.state$,
            this.connections.solana.solanaRpcConnectivity.state$,
        ]).pipe(
            map(([ethereum, solana]) => ethereum.node === 'ready' && solana.node === 'ready'),
            distinctUntilChanged(),
        );
    }

    /** The public cluster Solana reads go to, or `custom` for the app's own endpoints. */
    get solanaCluster(): string {
        return 'cluster' in this.options.solana ? this.options.solana.cluster : 'custom';
    }

    /**
     * Closes the bridge websocket, and the network, Ethereum and Solana connections.
     * @returns {void}
     */
    onDestroy(): void {
        this.bridge.close();
        this.closeConnections();
    }
}
