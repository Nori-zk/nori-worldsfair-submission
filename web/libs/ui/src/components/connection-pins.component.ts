import { Component, Inject, RxElement } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import { ConnectionsService } from '../services/connections.service.js';
import styles from './connection-pins.component.css';

/**
 * A pin's class for a connection machine's node: green when up, pulsing
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

/**
 * Every connection along the bottom of the page, each with a pin: the
 * network, Ethereum through the wallet, Solana, and Nori's websocket, linked
 * to its page.
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
        return this.connections.connections.network.connection.state$.pipe(
            map(pin('online', ['checking'])),
        );
    }

    /** The wallet: blue while it is on its way to the expected chain without the user. */
    get ethereum$(): Observable<string> {
        return this.connections.walletState$.pipe(
            map(pin('ready', ['lookingForWallets', 'checking', 'askingToSwitchChain'])),
        );
    }

    get solana$(): Observable<string> {
        return this.connections.connections.solana.http.connection.state$.pipe(
            map(pin('ready', ['checking'])),
        );
    }

    get nori$(): Observable<string> {
        return this.connections.connections.nori.websocket.connection.state$.pipe(
            map(pin('open', ['connecting', 'reconnecting'])),
        );
    }

    /** Nori's websocket page: its `wss://` URL over `https://`. */
    get noriUrl(): string {
        return this.connections.noriUrl.replace(/^ws/, 'http');
    }
}
