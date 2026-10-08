import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './token-option.component.css';

/** The event an option sends up when picked: its address, `eth`, or `other`. */
export const TOKEN_CHOSEN = 'token-chosen';

/**
 * One row of the token dropdown: the token's icon, symbol and name. Picking
 * it sends `token-chosen` up with the token's address.
 */
@Component({
    selector: 'token-option',
    template: `
        <button type="button" onclick="pick">
            <img [src]="logoURI" alt="" />
            <span class="symbol">{{ symbol }}</span>
            <span class="name">{{ name }}</span>
        </button>
    `,
    styles,
})
export class TokenOption extends RxElement {
    @state address = '';
    @state symbol = '';
    @state name = '';
    @state logoURI = '';

    pick(): void {
        this.dispatchEvent(
            new CustomEvent<string>(TOKEN_CHOSEN, { bubbles: true, detail: this.address }),
        );
    }
}
