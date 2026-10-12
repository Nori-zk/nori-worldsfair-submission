import { Component } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import type { HttpConnectionState, SolanaHealth } from '@nori-zk/nori-bridge-solana-sdk';
import { solanaLogo } from '../../brand/brand.js';
import { ChainButton } from './chain-button.component.js';

/**
 * The button's text for each node of Solana's http connection machine.
 *
 * @param cluster The cluster the apps read.
 * @param state Solana's http connection machine's state.
 * @returns The text for the button.
 */
const solanaText = (cluster: string, state: HttpConnectionState<SolanaHealth>): string => {
    switch (state.node) {
        case 'connecting':
            return 'Connecting to Solana';
        case 'ready':
        case 'overwhelmed':
            return `Solana ${cluster}`;
        case 'wrongNetwork':
        case 'waitingToRetry':
            return 'Reconnecting to Solana';
        case 'offline':
            return 'Offline';
        case 'closed':
            return 'Closed';
    }
};

/**
 * The Solana side of the wallet pair: the cluster its connection reads.
 * Solana reads need no wallet, so it shows the connection only; the pin's
 * colour is its health.
 */
@Component({
    selector: 'solana-button',
    template: `
        <button [class.ready]="ready" disabled>
            <img class="logo" src="${solanaLogo}" alt="Solana" />
            <span class="text">{{ text }}</span>
        </button>
    `,
})
export class SolanaButton extends ChainButton {
    get text$(): Observable<string> {
        return this.connections.solanaHttpState$.pipe(
            map((state) => solanaText(this.connections.solanaCluster, state)),
        );
    }

    get ready$(): Observable<boolean> {
        return this.connections.solanaHttpState$.pipe(
            map((state) => state.node === 'ready' || state.node === 'overwhelmed'),
        );
    }
}
