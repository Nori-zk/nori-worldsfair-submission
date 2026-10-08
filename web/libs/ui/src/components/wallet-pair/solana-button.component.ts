import { Component } from '@yaw-rx/core';
import { map, type Observable } from 'rxjs';
import type { SolanaRpcConnection } from '@nori-zk/nori-bridge-solana-sdk';
import { solanaLogo } from '../../brand/brand.js';
import { ChainButton } from './chain-button.component.js';

/**
 * A slot shortened for display: its last four digits.
 *
 * @param slot The slot.
 * @returns The shortened slot.
 */
const shortSlot = (slot: bigint): string => `…${slot.toString().slice(-4)}`;

/**
 * The button's text for each node of the Solana RPC machine.
 *
 * @param cluster The cluster the apps read.
 * @param state The Solana RPC machine's state.
 * @returns The text for the button.
 */
const solanaText = (cluster: string, state: SolanaRpcConnection): string => {
    switch (state.node) {
        case 'checking':
            return 'Connecting to Solana';
        case 'ready':
            return `Solana ${cluster}: ${shortSlot(state.data.slot)}`;
        case 'wrongNetwork':
        case 'unreachable':
            return 'Reconnecting to Solana';
        case 'offline':
            return 'Offline';
        case 'closed':
            return 'Closed';
    }
};

/**
 * The Solana side of the wallet pair: the cluster its connection reads and
 * the latest finalized slot. Solana reads need no wallet, so it shows the
 * connection only.
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
        return this.connections.connections.solana.solanaRpcConnectivity.state$.pipe(
            map((state) => solanaText(this.connections.solanaCluster, state)),
        );
    }

    get ready$(): Observable<boolean> {
        return this.connections.connections.solana.solanaRpcConnectivity.state$.pipe(
            map((state) => state.node === 'ready'),
        );
    }
}
