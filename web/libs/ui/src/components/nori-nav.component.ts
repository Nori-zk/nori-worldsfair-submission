import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import { navLinks, type NavLink } from '../utils/nav.js';
import styles from './nori-nav.component.css';

/**
 * The links along the top of every page to each app and dashboard, at the
 * addresses in `web/.env`, with the page's own marked current. Each is its
 * own site, so a link loads its page.
 */
@Component({
    selector: 'nori-nav',
    directives: [RxFor],
    template: `
        <nav rx-for="link of links by label">
            <a [href]="link.url" [ariaCurrent]="link.current">{{ link.label }}</a>
        </nav>
    `,
    styles,
})
export class NoriNav extends RxElement {
    /** The page's heading, which names its app. */
    @state heading = '';

    get links$(): Observable<NavLink[]> {
        return this.heading$.pipe(map((heading) => navLinks(NORI_WEB_ENV.urls, heading)));
    }
}
