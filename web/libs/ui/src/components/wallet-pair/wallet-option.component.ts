import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './wallet-option.component.css';

/** The event an option sends up when picked: the wallet's uuid. */
export const WALLET_CHOSEN = 'wallet-chosen';

/**
 * One of the installed wallets to choose from: its icon and name. Picking
 * it sends `wallet-chosen` up with the wallet's uuid.
 */
@Component({
    selector: 'wallet-option',
    template: `
        <button type="button" onclick="pick"><img [src]="icon" alt="" />{{ name }}</button>
    `,
    styles,
})
export class WalletOption extends RxElement {
    @state uuid = '';
    @state name = '';
    @state icon = '';

    pick(): void {
        this.dispatchEvent(
            new CustomEvent<string>(WALLET_CHOSEN, { bubbles: true, detail: this.uuid }),
        );
    }
}
