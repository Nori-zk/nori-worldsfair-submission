import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable, startWith } from 'rxjs';
import { GuardBoardService } from '@nori-zk/solana-web-ui';
import { cardOf, type GuardCardView } from '../utils/card.js';
import { ordered } from '../utils/guards.js';
import './guard-list/guard-card.component.js';
import styles from './guard-list.component.css';

/**
 * Every Backstop guard on the cluster, one card each: the ones a lender can
 * use first, then the tripped and paused ones, then the stale ones. Read
 * from Solana every 30 seconds by `GuardBoardService`; a failed read is
 * shown and tried again on the next one.
 */
@Component({
    selector: 'guard-list',
    directives: [RxFor],
    template: `
        <div class="cards" rx-for="cards by key">
            <guard-card></guard-card>
        </div>
        <p class="status">{{ status }}</p>
    `,
    styles,
})
export class GuardList extends RxElement {
    @Inject(GuardBoardService) private readonly board!: GuardBoardService;

    get cards$(): Observable<GuardCardView[]> {
        return this.board.guards$.pipe(
            map((guards) => {
                if (typeof guards === 'string') return [];
                const now = Math.floor(Date.now() / 1000);
                return ordered(guards).map((read) => cardOf(read, now));
            }),
        );
    }

    /** Why there are no cards, or nothing. */
    get status$(): Observable<string> {
        return this.board.guards$.pipe(
            map((guards) =>
                typeof guards === 'string'
                    ? `Reading failed: ${guards}. Trying again in 30 s.`
                    : guards.length === 0
                      ? 'No guards on this cluster.'
                      : '',
            ),
            startWith('Reading the guards…'),
        );
    }
}
