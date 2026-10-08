import { Component, Inject, RxElement } from '@yaw-rx/core';
import { combineLatest, map, of, type Observable } from 'rxjs';
import type {
    EthereumProviderConnection,
    EthereumWalletState,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from '../services/connections.service.js';
import styles from './connection-pins.component.css';

/**
 * A pin's class for a connectivity machine's node: green when up, pulsing
 * blue while connecting, red otherwise.
 *
 * @param up The node that means up.
 * @param connecting The nodes that mean connecting.
 * @returns The pin's class for a state.
 */
const pin =
    (up: string, connecting: string[]) =>
    (state: { node: string }): string =>
        state.node === up ? 'pin green' : connecting.includes(state.node) ? 'pin blue' : 'pin red';

/** The wallet nodes that are on their way to the expected chain without the user. */
const walletConnecting = pin('', ['lookingForWallets', 'checkingChain', 'askingToSwitchChain']);

/**
 * The Ethereum pin: the provider's connectivity, and while it waits for the
 * wallet, the wallet's own state, which says whether the user has something
 * to do.
 *
 * @param provider The provider connectivity machine's state.
 * @param wallet The wallet machine's state, when reads go through the wallet.
 * @returns The pin's class.
 */
const ethereumPin = (
    provider: EthereumProviderConnection,
    wallet: EthereumWalletState | undefined,
): string =>
    provider.node === 'waitingForWallet' && wallet !== undefined
        ? walletConnecting(wallet)
        : pin('ready', ['checking'])(provider);

/**
 * Every connection along the bottom of the page, each with a pin: the
 * network, Ethereum, Solana, and Nori's bridge websocket, linked to its page.
 */
@Component({
    selector: 'connection-pins',
    template: `
        <div class="bar">
            <span class="item"><span [className]="network"></span>Network</span>
            <span class="item"><span [className]="ethereum"></span>Ethereum</span>
            <span class="item"><span [className]="solana"></span>Solana</span>
            <a class="item" [href]="noriUrl" target="_blank" rel="noopener">
                <span [className]="nori"></span>Nori
            </a>
        </div>
    `,
    styles,
})
export class ConnectionPins extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;

    get network$(): Observable<string> {
        return this.connections.network.state$.pipe(map(pin('online', ['checking'])));
    }

    get ethereum$(): Observable<string> {
        return combineLatest([
            this.connections.connections.ethereum.ethereumProviderConnectivity.state$,
            this.connections.wallet?.ethereumWallet.state$ ?? of(undefined),
        ]).pipe(map(([provider, wallet]) => ethereumPin(provider, wallet)));
    }

    get solana$(): Observable<string> {
        return this.connections.connections.solana.solanaRpcConnectivity.state$.pipe(
            map(pin('ready', ['checking'])),
        );
    }

    get nori$(): Observable<string> {
        return this.connections.bridge.connectivity.state$.pipe(
            map(pin('open', ['connecting', 'reconnecting'])),
        );
    }

    /** The bridge websocket's page: its `wss://` URL over `https://`. */
    get noriUrl(): string {
        return this.connections.options.bridge.wssUrl.replace(/^ws/, 'http');
    }
}
