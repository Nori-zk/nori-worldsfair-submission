import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable, startWith } from 'rxjs';
import {
    GuardBoardService,
    type GuardRead,
    ago,
    amount,
    blockText,
    blockUrl,
    solanaAccountUrl,
    STATUS_COLOUR,
} from '@nori-zk/solana-web-ui';
import type { GuardRowView } from './guard-table/guard-row.component.js';
import './guard-table/guard-row.component.js';
import styles from './guard-table.component.css';

/**
 * A guard as its row shows it.
 *
 * @param read The guard and its mint's supply.
 * @returns The row's text and links.
 */
const rowOf = (read: GuardRead): GuardRowView => ({
    key: read.address,
    read,
    mint: `${read.guard.mint.slice(0, 4)}…${read.guard.mint.slice(-4)}`,
    mintUrl: solanaAccountUrl(read.guard.mint),
    status: read.status === 'PAUSED_AT_SOURCE' ? 'PAUSED' : read.status,
    statusStyle: `color: ${STATUS_COLOUR[read.status]}`,
    statusColour: STATUS_COLOUR[read.status],
    ...amountsOf(read),
});

/**
 * A guard's amounts and proven block, as its row shows them.
 *
 * @param read The guard and its mint's supply.
 * @returns The backing, supply, ratio, block and age.
 */
const amountsOf = ({
    guard,
    supply,
    decimals,
}: GuardRead): Pick<
    GuardRowView,
    'backing' | 'supply' | 'ratio' | 'block' | 'blockUrl' | 'age'
> => ({
    backing: amount(guard.backing, decimals),
    supply: amount(supply, decimals),
    ratio: supply === 0n ? '—' : `${(Number(guard.backing) / Number(supply)).toFixed(4)}x`,
    block: guard.backingEthBlock === 0n ? '—' : blockText(guard.backingEthBlock),
    blockUrl: blockUrl(guard.backingEthBlock),
    age:
        guard.backingEthTime === 0n
            ? 'never'
            : ago(Math.floor(Date.now() / 1000) - Number(guard.backingEthTime)),
});

/**
 * Backstop's guards: each bridged asset's proven Ethereum backing against
 * its live Solana supply, and the status the program would return to a
 * lender's `assert_healthy`. A row opens (▸) onto its pane.
 */
@Component({
    selector: 'guard-table',
    directives: [RxFor],
    template: `
        <p class="title">BACKSTOP GUARDS: proven Ethereum backing vs Solana supply</p>
        <div class="head">
            <span></span>
            <span>MINT</span>
            <span>STATUS</span>
            <span>BACKING</span>
            <span>SUPPLY</span>
            <span>RATIO</span>
            <span>ETH BLOCK</span>
            <span>PROVEN</span>
        </div>
        <div rx-for="rows by key">
            <guard-row></guard-row>
        </div>
        <p class="status">{{ status }}</p>
    `,
    styles,
})
export class GuardTable extends RxElement {
    @Inject(GuardBoardService) private readonly board!: GuardBoardService;

    get rows$(): Observable<GuardRowView[]> {
        return this.board.guards$.pipe(
            map((guards) => (typeof guards === 'string' ? [] : guards.map(rowOf))),
        );
    }

    /** Why there are no rows, or nothing. */
    get status$(): Observable<string> {
        return this.board.guards$.pipe(
            map((guards) =>
                typeof guards === 'string'
                    ? `Reading the guards failed: ${guards}`
                    : guards.length === 0
                      ? 'No guards yet'
                      : '',
            ),
            startWith('Reading the guards'),
        );
    }
}
