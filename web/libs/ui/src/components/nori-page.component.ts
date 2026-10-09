import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { noriLogo } from '../brand/brand.js';
import { ConnectionsService } from '../services/connections.service.js';
import styles from './nori-page.component.css';

/** The beam's settings: the bridge zkapp's, with the flare on the card's edge. */
const BEAM = `
    color="#64e18e"
    horizontalBeamOffset="0"
    verticalBeamOffset="-0.5"
    horizontalSizing="1"
    verticalSizing="4"
    fogIntensity="0.6"
    wispIntensity="6"
`;

/**
 * Every page's frame, as in the bridge zkapp: the background, Nori's logo,
 * the card with its heading and lede over its children, a beam on each side
 * of it once both chains are ready, and the connection pins along the bottom.
 */
@Component({
    selector: 'nori-page',
    directives: [RxIf],
    template: `
        <nori-background></nori-background>
        <header>
            <img class="logo" src="${noriLogo}" alt="Nori" />
        </header>
        <main>
            <div class="stage">
                <div class="beam left">
                    <div rx-if="connections.ready"><laser-flow ${BEAM}></laser-flow></div>
                </div>
                <nori-card [heading]="heading">
                    <p class="lede">{{ lede }}</p>
                    <slot></slot>
                </nori-card>
                <div class="beam right">
                    <div rx-if="connections.ready"><laser-flow ${BEAM}></laser-flow></div>
                </div>
            </div>
        </main>
        <connection-pins></connection-pins>
    `,
    styles,
})
export class NoriPage extends RxElement {
    @Inject(ConnectionsService) readonly connections!: ConnectionsService;
    @state heading = '';
    @state lede = '';
}
