import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { map, type Observable } from 'rxjs';
import { type ConnectionPin, ConnectionsService } from '../services/connections.service.js';
import styles from './connection-pins.component.css';

/** A pin as the bar draws it: its class, and whether it links to its connection's page. */
interface DrawnPin extends ConnectionPin {
    className: string;
    linked: boolean;
    plain: boolean;
}

/**
 * The connections along the bottom of the page, each with its pin, as
 * `ConnectionsService.pins$` gives them for the app's connections. A pin
 * with a page (Nori's websocket) links to it.
 */
@Component({
    selector: 'connection-pins',
    directives: [RxFor, RxIf],
    template: `
        <div class="bar" rx-for="pin of pins by label">
            <span>
                <span rx-if="pin.plain">
                    <span class="item"
                        ><span [className]="pin.className"></span>{{ pin.label }}</span
                    >
                </span>
                <span rx-if="pin.linked">
                    <a class="item" [href]="pin.href" target="_blank" rel="noopener">
                        <span [className]="pin.className"></span
                        ><span class="link">{{ pin.label }}</span>
                        <svg class="clip" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
                            />
                        </svg>
                    </a>
                </span>
            </span>
        </div>
    `,
    styles,
})
export class ConnectionPins extends RxElement {
    @Inject(ConnectionsService) private readonly connections!: ConnectionsService;

    get pins$(): Observable<DrawnPin[]> {
        return this.connections.pins$.pipe(
            map((pins) =>
                pins.map((pin) => ({
                    ...pin,
                    className: `pin ${pin.colour}`,
                    linked: pin.href !== '',
                    plain: pin.href === '',
                })),
            ),
        );
    }
}
