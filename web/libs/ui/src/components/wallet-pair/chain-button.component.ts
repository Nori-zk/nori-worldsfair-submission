import { Component, Inject, RxElement } from '@yaw-rx/core';
import { ConnectionsService } from '../../services/connections.service.js';
import styles from './chain-button.component.css';

/**
 * The base of each chain's button in the wallet pair, as the bridge zkapp's
 * wallet buttons: a chain logo and its connection's state, white while the
 * user has something to do and green once the chain is ready. Each chain's
 * button extends it and inherits its styles.
 */
@Component({
    selector: 'chain-button',
    styles,
})
export class ChainButton extends RxElement {
    @Inject(ConnectionsService) protected readonly connections!: ConnectionsService;
}
