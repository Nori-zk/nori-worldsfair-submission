import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable, startWith } from 'rxjs';
import { formatUnits } from 'ethers';
import { GuardBoardService, type GuardRead } from '../services/guard-board.service.js';
import { blockText, blockUrl, solanaAccountUrl } from '../utils/format.js';
import type { GuardRowView } from './guard-table/guard-row.component.js';
import './guard-table/guard-row.component.js';
import styles from './guard-table.component.css';

/** Each status's colour. */
const STATUS_COLOUR: Record<GuardRead['status'], string> = {
    HEALTHY: 'var(--nori-light-green)',
    WARN: 'var(--nori-neon-blue)',
    PAUSED_AT_SOURCE: 'var(--nori-neon-blue)',
    STALE: 'var(--nori-muted)',
    TRIPPED: 'var(--nori-neon-red)',
};

/**
 * An amount in a mint's units, for reading.
 *
 * @param value The amount in the mint's smallest unit.
 * @param decimals The mint's decimals.
 * @returns `116,723.52`.
 */
const amount = (value: bigint, decimals: number): string =>
    Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * How long ago something happened, roughly.
 *
 * @param secs Seconds since.
 * @returns `12 min ago`, `3 h ago` or `2 d ago`.
 */
const ago = (secs: number): string =>
    secs < 3600
        ? `${Math.floor(secs / 60).toString()} min ago`
        : secs < 172_800
          ? `${Math.floor(secs / 3600).toString()} h ago`
          : `${Math.floor(secs / 86_400).toString()} d ago`;

/**
 * A guard as its row shows it.
 *
 * @param read The guard and its mint's supply.
 * @returns The row's text and links.
 */
const rowOf = ({ address, guard, supply, decimals, status }: GuardRead): GuardRowView => ({
    key: address,
    mint: `${guard.mint.slice(0, 4)}…${guard.mint.slice(-4)}`,
    mintUrl: solanaAccountUrl(guard.mint),
    status: status === 'PAUSED_AT_SOURCE' ? 'PAUSED' : status,
    statusStyle: `color: ${STATUS_COLOUR[status]}`,
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
 * lender's `assert_healthy`.
 */
@Component({
    selector: 'guard-table',
    directives: [RxFor],
    template: `
        <p class="title">BACKSTOP GUARDS: proven Ethereum backing vs Solana supply</p>
        <div class="head">
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
