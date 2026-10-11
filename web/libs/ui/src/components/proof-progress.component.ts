import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import {
    combineLatest,
    distinctUntilChanged,
    filter,
    map,
    type Observable,
    switchMap,
    take,
    timer,
} from 'rxjs';
import {
    ProofRequestState,
    type ProofRequestStateNodeUnion,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type FollowedProof, ProofProgressService } from '../services/proof-progress.service.js';
import { anchoredFill, waitedSec } from '../utils/proof-progress.js';
import styles from './proof-progress.component.css';

/**
 * The status line for each node of the proof request machine: where the
 * request is, from the snapshot each live node holds.
 *
 * @param request The proof request machine's state.
 * @returns The status.
 */
const requestStatus = (request: ProofRequestStateNodeUnion): string => {
    switch (request.node) {
        case 'proofAvailable':
            return `Proven on Solana in batch #${request.data.snapshot.proofQueueBatchIndex.toString()}`;
        case 'transactionReplaced':
            return 'The transaction was replaced in your wallet before it enqueued a proof request';
        case 'transactionDropped':
            return 'The transaction was dropped before it enqueued a proof request';
        case 'waitingForConnectionWhileLoading':
        case 'waitingForConnectionWhileRefreshing':
            return `Waiting for ${request.data.waitingOn.join(' and ')}`;
        case 'failedWhileLoading':
        case 'failedWhileRefreshing':
            return `Reading failed: ${request.data.error}`;
        case 'closed':
            return 'Stopped';
        case 'loading':
        case 'current':
        case 'refreshing': {
            const { snapshot } = request.data;
            return snapshot.state === ProofRequestState.Unprocessed && 'requestId' in snapshot
                ? `Request #${snapshot.requestId.toString()} is waiting for the bridge`
                : 'Finding the proof request on Ethereum';
        }
    }
};

/**
 * About how long, in words.
 *
 * @param seconds The seconds.
 * @returns `about 12 min` from two minutes up, else `about 40s`.
 */
const about = (seconds: number): string =>
    seconds >= 120
        ? `about ${Math.round(seconds / 60).toString()} min`
        : `about ${Math.max(0, Math.round(seconds)).toString()}s`;

/**
 * The fill of the progress bar: the whole wait, from the block that enqueued
 * the request to its commit on Solana, against one total per request. It
 * measures from that block's time, so a reload keeps it; until that time is
 * read, or if the read fails, from when this page first saw the request.
 * The total is the time waited plus the bridge's time left at the first
 * estimate (`ProofProgressService`'s `totalSec$`), extended only when a later
 * estimate runs past it. The bridge's estimate counts down between its
 * finality messages and re-bases on each, so the minutes under the bar move
 * in steps while the bar fills steadily; when the total is extended, the bar
 * steps back a little.
 *
 * @param progress The unprocessed machine's state.
 * @param enqueuedAtMs The enqueue block's time, unix milliseconds, or `undefined` while unknown.
 * @param totalSec The bar's total in seconds, or `undefined` while unknown.
 * @param nowMs The time now, unix milliseconds.
 * @returns The fill, from 0 to 1.
 */
const progressFill = (
    progress: UnprocessedProofRequestStateNodeUnion,
    enqueuedAtMs: number | undefined,
    totalSec: number | undefined,
    nowMs: number,
): number => {
    if (progress.node === 'FinishedWaiting') return 1;
    return anchoredFill(
        waitedSec(nowMs, enqueuedAtMs, progress.data.waiting_elapsed_sec),
        totalSec,
    );
};

/**
 * The detail under the bar for a node of the unprocessed machine: the
 * bridge's stage while the job that includes the request runs, and the time
 * left until it is committed on Solana.
 *
 * @param progress The unprocessed machine's state.
 * @returns The detail.
 */
const progressDetail = (progress: UnprocessedProofRequestStateNodeUnion): string => {
    if (progress.node === 'FinishedWaiting') return 'Confirming on Solana';
    const { stage_name, commit_time_remaining_sec } = progress.data;
    const left = !Number.isFinite(commit_time_remaining_sec)
        ? ''
        : commit_time_remaining_sec > 0
          ? `${about(commit_time_remaining_sec)} to Solana`
          : 'taking longer than expected';
    return progress.node === 'WaitingForCurrentJobCompletion' && left !== ''
        ? `${stage_name} · ${left}`
        : left;
};

/**
 * Follows one proof request from the transaction that enqueued it until a
 * committed batch on Solana covers it. The status follows the proof request
 * machine; while the request is `unprocessed`, a bar follows the bridge's
 * progress on it from the websocket, measured from the block that enqueued it
 * against one total per request.
 */
@Component({
    selector: 'proof-progress',
    directives: [RxIf],
    template: `
        <p class="status">{{ status }}</p>
        <div rx-if="failed">
            <button class="retry" onclick="retry">Read again</button>
        </div>
        <div rx-if="processing">
            <div class="bar"><div class="fill" [style]="fill"></div></div>
            <ol class="stages">
                <li [class.current]="atFinality">Ethereum finality</li>
                <li [class.current]="atPrevious">Previous batch</li>
                <li [class.current]="atCurrent">Proving</li>
                <li [class.current]="atFinished">Solana</li>
            </ol>
            <p class="detail">{{ detail }}</p>
        </div>
    `,
    styles,
})
export class ProofProgress extends RxElement {
    @Inject(ProofProgressService) private readonly proofProgress!: ProofProgressService;
    /** The transaction that enqueued the proof request. */
    @state txHash = '';

    /** The followed proof request, once the transaction hash is set. */
    private get followed$(): Observable<FollowedProof> {
        return this.txHash$.pipe(
            filter((txHash) => txHash !== ''),
            distinctUntilChanged(),
            map((txHash) => this.proofProgress.follow(txHash)),
        );
    }

    private get request$(): Observable<ProofRequestStateNodeUnion> {
        return this.followed$.pipe(switchMap(({ request$ }) => request$));
    }

    /** The unprocessed machine's state while the request is `unprocessed`, else `undefined`. */
    private get progress$(): Observable<UnprocessedProofRequestStateNodeUnion | undefined> {
        return this.followed$.pipe(switchMap(({ progress$ }) => progress$));
    }

    get status$(): Observable<string> {
        return this.request$.pipe(map(requestStatus));
    }

    get failed$(): Observable<boolean> {
        return this.request$.pipe(
            map(
                (request) =>
                    request.node === 'failedWhileLoading' ||
                    request.node === 'failedWhileRefreshing',
            ),
        );
    }

    get processing$(): Observable<boolean> {
        return this.progress$.pipe(map((progress) => progress !== undefined));
    }

    /** When the request was enqueued, from its block, once read. */
    private get enqueuedAtMs$(): Observable<number | undefined> {
        return this.followed$.pipe(switchMap(({ enqueuedAtMs$ }) => enqueuedAtMs$));
    }

    /** The bar's total for the request, in seconds, once estimated. */
    private get totalSec$(): Observable<number | undefined> {
        return this.followed$.pipe(switchMap(({ totalSec$ }) => totalSec$));
    }

    get fill$(): Observable<string> {
        // Ticks each second, so the bar moves with the clock between the machine's states.
        return combineLatest([
            this.progress$,
            this.enqueuedAtMs$,
            this.totalSec$,
            timer(0, 1000),
        ]).pipe(
            map(([progress, enqueuedAtMs, totalSec]) =>
                progress === undefined
                    ? ''
                    : `width: ${(progressFill(progress, enqueuedAtMs, totalSec, Date.now()) * 100).toFixed(1)}%`,
            ),
            distinctUntilChanged(),
        );
    }

    get detail$(): Observable<string> {
        return this.progress$.pipe(
            map((progress) => (progress === undefined ? '' : progressDetail(progress))),
        );
    }

    get atFinality$(): Observable<boolean> {
        return this.progress$.pipe(map((progress) => progress?.node === 'WaitingForEthFinality'));
    }

    get atPrevious$(): Observable<boolean> {
        return this.progress$.pipe(
            map((progress) => progress?.node === 'WaitingForPreviousJobCompletion'),
        );
    }

    get atCurrent$(): Observable<boolean> {
        return this.progress$.pipe(
            map((progress) => progress?.node === 'WaitingForCurrentJobCompletion'),
        );
    }

    get atFinished$(): Observable<boolean> {
        return this.progress$.pipe(map((progress) => progress?.node === 'FinishedWaiting'));
    }

    retry(): void {
        this.followed$.pipe(take(1)).subscribe(({ retry }) => retry());
    }
}
