import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { filter, map, type Observable } from 'rxjs';
import {
    type CheckpointRow,
    type GuardRead,
    addressUrl,
    amount,
    checkpointRows,
    duration,
    shortHex,
    solanaAccountUrl,
    windowOf,
} from '@nori-zk/solana-web-ui';
import { CHECKPOINTS } from '@nori-zk/backstop-client/guard';
import { lockboxOf } from '../../../utils/guards.js';
import { settingsSentence, type Sentence } from '../../../utils/status-text.js';
import styles from './guard-how.component.css';

/** A query id of zeros: the guard reads no pause flag. */
const NO_QUERY = /^0x0*$/;

/**
 * How a guard is checked, from the card's read (nothing more is read for
 * it): its settings in sentences, the trip rule re-run on the supply
 * checkpoints it keeps, and the accounts behind it.
 */
@Component({
    selector: 'guard-how',
    directives: [RxFor],
    template: `
        <p class="settings">
            {{ settingsText }}
            <a [class.hidden]="noLockbox" [href]="lockboxUrl" target="_blank" rel="noopener"
                >{{ lockbox }} ↗</a
            >{{ settingsEnd }}
        </p>
        <p class="rule"><span class="label">RULE</span> {{ rule }}</p>
        <div class="checkpoints" rx-for="row of checkpoints.rows by key">
            <div class="checkpoint">
                <span>{{ row.time }}</span>
                <span class="supply">{{ row.supply }}</span>
                <progress-bar [fill]="row.fill" cells="10"></progress-bar>
                <span>{{ row.marker }}</span>
            </div>
        </div>
        <p class="older">{{ checkpoints.older }}</p>
        <p class="links">
            <a [href]="guardUrl" target="_blank" rel="noopener">Guard account ↗</a>
            <a [href]="adminUrl" target="_blank" rel="noopener">Admin ↗</a>
            <a [href]="snapshotUrl" target="_blank" rel="noopener">NoriSnapshot ↗</a>
            <a [href]="programUrl" target="_blank" rel="noopener">Nori program ↗</a>
        </p>
    `,
    styles,
})
export class GuardHow extends RxElement {
    /** The guard, set by the card's `rx-for` on every read. */
    @state read: GuardRead | undefined = undefined;

    get settingsText$(): Observable<string> {
        return this.settings$.pipe(map((sentence) => sentence.text));
    }

    get lockbox$(): Observable<string> {
        return this.settings$.pipe(map((sentence) => sentence.link));
    }

    get noLockbox$(): Observable<boolean> {
        return this.settings$.pipe(map((sentence) => sentence.link === ''));
    }

    get settingsEnd$(): Observable<string> {
        return this.settings$.pipe(map((sentence) => sentence.end));
    }

    get lockboxUrl$(): Observable<string> {
        return this.fact$(({ guard }) => addressUrl(lockboxOf(guard.mint)?.address ?? ''));
    }

    /** The trip rule's verdict on the latest backing. */
    get rule$(): Observable<string> {
        return this.fact$(({ guard, decimals }) => windowOf(guard, decimals).verdict);
    }

    /** The window's checkpoints, newest first, at most 12, and how many older ones are not listed. */
    get checkpoints$(): Observable<{ rows: CheckpointRow[]; older: string }> {
        return this.fact$(({ guard, decimals }) =>
            checkpointRows(windowOf(guard, decimals), decimals),
        );
    }

    get guardUrl$(): Observable<string> {
        return this.fact$(({ address }) => solanaAccountUrl(address));
    }

    get adminUrl$(): Observable<string> {
        return this.fact$(({ guard }) => solanaAccountUrl(guard.admin));
    }

    get snapshotUrl$(): Observable<string> {
        return this.fact$(({ guard }) => addressUrl(guard.config.noriSnapshot));
    }

    get programUrl$(): Observable<string> {
        return this.fact$(({ guard }) => solanaAccountUrl(guard.config.noriProgram));
    }

    /** The guard's settings, as a sentence with its lockbox linked. */
    private get settings$(): Observable<Sentence> {
        return this.fact$(({ guard, decimals }) =>
            settingsSentence({
                query: shortHex(guard.config.backingQuery),
                lockbox: lockboxOf(guard.mint)?.name ?? '',
                pauseQuery: NO_QUERY.test(guard.config.pauseQuery)
                    ? ''
                    : shortHex(guard.config.pauseQuery),
                window: duration(guard.config.windowSecs),
                tolerance: amount(guard.config.tolerance, decimals),
                staleness: duration(guard.config.maxStalenessSecs),
                interval: duration(guard.config.checkpointIntervalSecs),
                kept: CHECKPOINTS,
            }),
        );
    }

    /**
     * One fact of the guard, once the card has set its read.
     *
     * @param of The fact, from the read.
     * @returns It, again on every read.
     */
    private fact$<T>(of: (read: GuardRead) => T): Observable<T> {
        return this.read$.pipe(
            filter((read): read is GuardRead => read !== undefined),
            map(of),
        );
    }
}
