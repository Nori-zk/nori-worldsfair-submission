import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable, take } from 'rxjs';
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
 * every guard is stale. Read from Solana by `GuardBoardService`'s machine,
 * again on each Backstop transaction and every 30 seconds; the cards keep
 * the last read while the machine reads again.
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
        return combineLatest([this.board.state$, this.showStale$]).pipe(
            map(([board, choice]) => {
                const now = Math.floor(Date.now() / 1000);
                const guards = 'guards' in board.data ? board.data.guards : [];
                const cards = ordered(guards).map((read) => cardOf(read, now));
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
        return this.board.state$.pipe(
            map((board) => {
                // Until the first read lands; the machine reads again by itself, and the pins show the connections.
                switch (board.node) {
                    case 'loading':
                    case 'waitingForConnectionWhileLoading':
                    case 'failedWhileLoading':
                        return 'Reading the guards…';
                    case 'closed':
                        return '';
                    case 'current':
                    case 'refreshing':
                    case 'waitingForConnectionWhileRefreshing':
                    case 'failedWhileRefreshing':
                        return board.data.guards.length === 0 ? 'No guards on this cluster.' : '';
                }
            }),
        );
    }
}
