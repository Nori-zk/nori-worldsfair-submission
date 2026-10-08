import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { EMPTY, map, type Observable } from 'rxjs';
import type { WalletInfo } from '@nori-zk/nori-bridge-solana-sdk';
import { swapIcon } from '../brand/brand.js';
import { ConnectionsService } from '../services/connections.service.js';
import './wallet-pair/ethereum-button.component.js';
import './wallet-pair/solana-button.component.js';
import { WALLET_CHOSEN } from './wallet-pair/wallet-option.component.js';
import styles from './wallet-pair.component.css';

/**
 * Ethereum and Solana side by side, as the bridge zkapp's wallet pair: each
 * chain's button shows its connection, and while several wallets are
 * installed the user chooses one under the pair.
 */
@Component({
    selector: 'wallet-pair',
    directives: [RxIf, RxFor],
    template: `
        <div class="pair">
            <ethereum-button></ethereum-button>
            <img class="swap" src="${swapIcon}" alt="" />
            <solana-button></solana-button>
        </div>
        <div rx-if="choosing">
            <div class="wallets" rx-for="wallets by uuid">
                <wallet-option></wallet-option>
            </div>
        </div>
    `,
    styles,
})
export class WalletPair extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;

    get choosing$(): Observable<boolean> {
        return (this.connections.wallet?.ethereumWallet.state$ ?? EMPTY).pipe(
            map((state) => state.node === 'choosingWallet'),
        );
    }

    get wallets$(): Observable<WalletInfo[]> {
        return (this.connections.wallet?.ethereumWallet.state$ ?? EMPTY).pipe(
            map((state) => (state.node === 'choosingWallet' ? state.data.wallets : [])),
        );
    }

    /** A wallet picked from the installed ones. */
    private readonly onWalletChosen = (event: Event): void => {
        this.connections.wallet?.chooseWallet((event as CustomEvent<string>).detail);
    };

    override onInit(): void {
        this.addEventListener(WALLET_CHOSEN, this.onWalletChosen);
    }

    override onDestroy(): void {
        this.removeEventListener(WALLET_CHOSEN, this.onWalletChosen);
    }
}
