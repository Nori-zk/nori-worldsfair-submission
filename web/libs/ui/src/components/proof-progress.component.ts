import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { distinctUntilChanged, filter, map, type Observable, switchMap, take } from 'rxjs';
import type {
    ProofRequestStateNodeUnion,
    UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type FollowedProof, ProofProgressService } from '../services/proof-progress.service.js';
import styles from './proof-progress.component.css';

/**
 * The status line for each node of the proof request machine.
 *
 * @param request The proof request machine's state.
 * @returns The status.
 */
const requestStatus = (request: ProofRequestStateNodeUnion): string => {
    switch (request.node) {
        case 'undetermined':
            return 'Finding the proof request on Ethereum';
        case 'unprocessed':
            return `Request #${request.data.requestId.toString()} is waiting for the bridge`;
        case 'proofAvailable':
            return `Proven on Solana in batch #${request.data.proofQueueBatchIndex.toString()}`;
        case 'waitingForConnectionWhileUndetermined':
        case 'waitingForConnectionWhileUnprocessed':
            return `Waiting for ${request.data.waitingOn.join(' and ')}`;
        case 'failedWhileUndetermined':
        case 'failedWhileUnprocessed':
            return `Reading failed: ${request.data.error}`;
        case 'closed':
            return 'Stopped';
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
 * The fill of the progress bar: the whole wait, from when this page first
 * saw the request to its commit on Solana, as the machine estimates it. A
 * reload starts it again, scaled to the time left then.
 *
 * @param progress The unprocessed machine's state.
 * @returns The fill, from 0 to 1.
 */
const progressFill = (progress: UnprocessedProofRequestStateNodeUnion): number => {
    if (progress.node === 'FinishedWaiting') return 1;
    const { waiting_elapsed_sec, commit_time_remaining_sec } = progress.data;
    const total = waiting_elapsed_sec + Math.max(0, commit_time_remaining_sec);
    return Number.isFinite(total) && total > 0 ? Math.min(1, waiting_elapsed_sec / total) : 0;
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
 * progress on it from the websocket.
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
                    request.node === 'failedWhileUndetermined' ||
                    request.node === 'failedWhileUnprocessed',
            ),
        );
    }

    get processing$(): Observable<boolean> {
        return this.progress$.pipe(map((progress) => progress !== undefined));
    }

    get fill$(): Observable<string> {
        return this.progress$.pipe(
            map((progress) =>
                progress === undefined
                    ? ''
                    : `width: ${(progressFill(progress) * 100).toFixed(1)}%`,
            ),
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
