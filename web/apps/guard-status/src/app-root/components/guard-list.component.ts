import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable, startWith, take } from 'rxjs';
import { GuardBoardService } from '@nori-zk/solana-web-ui';
import { cardOf, type GuardCardView } from '../utils/card.js';
import { type CardSplit, ordered, splitCards } from '../utils/guards.js';
import './guard-list/guard-card.component.js';
import styles from './guard-list.component.css';

/**
 * Every Backstop guard on the cluster, one card each: the ones a lender can
 * use first, then the tripped and paused ones. The stale ones fold into one
 * line under them, `▸ 3 guards with no recent backing`, which shows their
 * cards on a click; they start shown when the page's link names one, or when
 * every guard is stale. Read from Solana every 30 seconds by
 * `GuardBoardService`; a failed read is shown and tried again on the next one.
 */
@Component({
    selector: 'guard-list',
    directives: [RxFor],
    template: `
        <div class="cards" rx-for="cards by key">
            <guard-card></guard-card>
        </div>
        <button type="button" class="stale-toggle" [class.hidden]="noStale" onclick="toggleStale">
            {{ staleLine }}
        </button>
        <div class="cards" rx-for="staleCards by key">
            <guard-card></guard-card>
        </div>
        <p class="status">{{ status }}</p>
    `,
    styles,
})
export class GuardList extends RxElement {
    /** The reader's last click on the stale line: shown, folded, or not clicked yet. */
    @state showStale: boolean | undefined = undefined;

    @Inject(GuardBoardService) private readonly board!: GuardBoardService;

    /** The cards split around the stale line. */
    get split$(): Observable<CardSplit<GuardCardView>> {
        const linked = new URLSearchParams(window.location.search).get('guard');
        return combineLatest([this.board.guards$, this.showStale$]).pipe(
            map(([guards, choice]) => {
                const now = Math.floor(Date.now() / 1000);
                const cards =
                    typeof guards === 'string'
                        ? []
                        : ordered(guards).map((read) => cardOf(read, now));
                return splitCards(cards, choice, linked);
            }),
        );
    }

    /** Every card but the stale ones. */
    get cards$(): Observable<GuardCardView[]> {
        return this.split$.pipe(map(({ live }) => live));
    }

    /** The stale cards while they are shown. */
    get staleCards$(): Observable<GuardCardView[]> {
        return this.split$.pipe(map(({ stale }) => stale));
    }

    get staleLine$(): Observable<string> {
        return this.split$.pipe(map(({ line }) => line));
    }

    get noStale$(): Observable<boolean> {
        return this.split$.pipe(map(({ line }) => line === ''));
    }

    /** Shows the stale cards, or folds them. */
    toggleStale(): void {
        this.split$.pipe(take(1)).subscribe(({ expanded }) => (this.showStale = !expanded));
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
