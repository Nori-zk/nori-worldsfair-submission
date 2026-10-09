import { Component, RxElement, state } from '@yaw-rx/core';
import { type GuardRead } from '../../services/guard-board.service.js';
import styles from './guard-pane.component.css';

/**
 * What an opened guard row shows. Empty for now: the lender sandbox fills
 * it next.
 */
@Component({
    selector: 'guard-pane',
    template: `<div class="pane"></div>`,
    styles,
})
export class GuardPane extends RxElement {
    /** The guard, set by the row's `rx-for` on every refresh. */
    @state read: GuardRead | undefined = undefined;
    /** The row's status colour, for what the pane shows in it. */
    @state statusColour = '';
}
