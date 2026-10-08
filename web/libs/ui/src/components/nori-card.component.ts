import { Component, RxElement, state } from '@yaw-rx/core';
import styles from './nori-card.component.css';

/**
 * The card every page's content sits in, as in the bridge zkapp: a dark
 * glass panel with a green glow from its top left, green strokes from its
 * top corners, a deep shadow and a centred heading over its children.
 */
@Component({
    selector: 'nori-card',
    template: `
        <h2 class="heading">{{ heading }}</h2>
        <slot></slot>
    `,
    styles,
})
export class NoriCard extends RxElement {
    @state heading = '';
}
