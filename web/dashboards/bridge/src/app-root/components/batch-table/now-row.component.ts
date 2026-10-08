import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { combineLatest, filter, map, type Observable, startWith } from 'rxjs';
import {
    type EnqueuedProofRequest,
    type NoriBridgeInfraTransitionState,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { NORI_BRIDGE_INFRA_STAGE_TEXT, noriBridgeInfraStagesAround } from '@nori-zk/solana-web-ui';
import { BridgeDashboardService } from '../../services/bridge-dashboard.service.js';
import { type BatchesView, EMPTY_VIEW } from '../../ystate/bridge-batches.js';
import { asciiBar, stageFraction, timeLeft, UNKNOWN_BAR } from '../../utils/ascii.js';
import {
    addressUrl,
    blockText,
    contractName,
    idRange,
    shortHex,
    transactionUrl,
} from '../../utils/format.js';
import './request-line.component.js';
import styles from './now-row.component.css';

/** Where a waiting request is: before Ethereum finality, in the run after this one, or in this run. */
type Step = 'finality' | 'next' | 'this';

/** What each step is shown as, beside the request and over the run. */
const STEP_TEXT: Record<Step, string> = {
    finality: 'waiting for Ethereum finality',
    next: 'next run',
    this: 'in this run',
};

/** Each node of the oldest waiting request's unprocessed machine, beside the bar. */
const PROGRESS_LABEL: Record<UnprocessedProofRequestStateNodeUnion['node'], string> = {
    WaitingForEthFinality: 'Waiting for Ethereum finality',
    WaitingForPreviousJobCompletion: 'Processing previous requests',
    WaitingForCurrentJobCompletion: 'Processing your request',
    FinishedWaiting: 'Confirming on Solana',
};

/** The bridge's current job, from Nori's websocket: the Ethereum blocks it proves. */
interface Job {
    input_block_number: number;
    output_block_number: number;
}

/**
 * Where a waiting request is: above Ethereum's finalized block it waits for
 * finality; inside the blocks the bridge is proving now it is in this run;
 * otherwise it waits for the next run.
 *
 * @param request The request.
 * @param finalizedBlock Ethereum's finalized block.
 * @param job The bridge's current job, while Nori's websocket reports it.
 * @returns Its step.
 */
const stepOf = (request: EnqueuedProofRequest, finalizedBlock: number, job: Job | undefined): Step => {
    if (request.blockNumber > finalizedBlock) return 'finality';
    if (
        job !== undefined &&
        request.blockNumber > job.input_block_number &&
        request.blockNumber <= job.output_block_number
    )
        return 'this';
    return 'next';
};

/** The run's step: the furthest any waiting request has got, or `undefined` with none waiting. */
const runStep = (steps: Step[]): Step | undefined =>
    steps.includes('this') ? 'this' : steps.includes('next') ? 'next' : steps[0];

/**
 * The run Nori is on now, at the top of the table: the requests no batch
 * covers yet, the Ethereum block the bridge is proving to, and a bar for
 * the stage it is in, from its websocket. Under it, the three steps a
 * request goes through and, while the run is proving and the websocket is
 * open, the stage before, now and after. Opening it lists the waiting
 * requests with where each one is.
 */
@Component({
    selector: 'now-row',
    directives: [RxIf, RxFor],
    template: `
        <button type="button" class="row" onclick="toggle">
            <span class="batch">{{ marker }} now</span>
            <span class="requests">{{ requests }}</span>
            <span class="block">{{ block }}</span>
            <span class="bar">{{ bar }}</span>
            <span class="status">{{ status }}</span>
        </button>
        <div rx-if="showStages">
            <ol class="stages">
                <li class="previous">{{ previousStage }}</li>
                <li class="current">{{ currentStage }}</li>
                <li class="next">{{ nextStage }}</li>
            </ol>
        </div>
        <div rx-if="open">
            <div class="nested" rx-for="lines by key">
                <request-line></request-line>
            </div>
        </div>
    `,
    styles,
})
export class NowRow extends RxElement {
    @Inject(BridgeDashboardService) private readonly dashboard!: BridgeDashboardService;
    @state open = false;

    /** The view the batches machine last read. */
    private get view$(): Observable<BatchesView> {
        return this.dashboard.batches$.pipe(
            map((state) => state?.data.view ?? EMPTY_VIEW),
        );
    }

    /** The bridge's state with timings, or `undefined` before Nori reports it. */
    private get bridge$() {
        return this.dashboard.bridgeState$.pipe(startWith(undefined));
    }

    /** Each waiting request with its step. */
    private get waiting$(): Observable<{ request: EnqueuedProofRequest; step: Step }[]> {
        return combineLatest([this.view$, this.bridge$]).pipe(
            map(([view, bridge]) =>
                view.waiting.map((request) => ({
                    request,
                    step: stepOf(request, view.finalizedBlock, bridge),
                })),
            ),
        );
    }

    private get step$(): Observable<Step | undefined> {
        return this.waiting$.pipe(map((waiting) => runStep(waiting.map(({ step }) => step))));
    }

    get marker$(): Observable<string> {
        return this.open$.pipe(map((open) => (open ? '▾' : '▸')));
    }

    get requests$(): Observable<string> {
        return this.view$.pipe(map((view) => idRange(view.waiting.map(({ requestId }) => requestId))));
    }

    get block$(): Observable<string> {
        return this.bridge$.pipe(
            map((bridge) => (bridge === undefined ? '' : blockText(bridge.output_block_number))),
        );
    }

    /** The oldest waiting request's unprocessed machine state, or `undefined` with none waiting. */
    private get progress$(): Observable<UnprocessedProofRequestStateNodeUnion | undefined> {
        return this.dashboard.runProgress$.pipe(startWith(undefined));
    }

    /** The bar: the oldest waiting request's time in its step over the sdk's estimate of it. */
    get bar$(): Observable<string> {
        return combineLatest([this.dashboard.noriOpen$, this.progress$]).pipe(
            map(([open, progress]) => {
                if (!open || progress === undefined) return UNKNOWN_BAR;
                if (progress.node === 'FinishedWaiting') return asciiBar(1);
                return asciiBar(stageFraction(progress.data.elapsed_sec, progress.data.time_remaining_sec));
            }),
        );
    }

    /**
     * Beside the bar: the oldest waiting request's step and the sdk's
     * estimate of the time left, or with none waiting, Nori's stage.
     */
    get status$(): Observable<string> {
        return combineLatest([
            this.dashboard.noriOpen$,
            this.progress$,
            this.dashboard.infraStage$.pipe(startWith<NoriBridgeInfraTransitionState | undefined>(undefined)),
        ]).pipe(
            map(([open, progress, stage]) => {
                if (!open) return 'Nori disconnected, live stages unavailable';
                if (progress === undefined)
                    return stage === undefined ? 'Waiting for Nori' : NORI_BRIDGE_INFRA_STAGE_TEXT[stage.node];
                const left =
                    progress.node === 'FinishedWaiting' ? '' : timeLeft(progress.data.time_remaining_sec);
                return [PROGRESS_LABEL[progress.node], left].filter((part) => part !== '').join(' · ');
            }),
        );
    }

    /** Whether the oldest waiting request is being proven and Nori's websocket is open. */
    get showStages$(): Observable<boolean> {
        return combineLatest([this.progress$, this.dashboard.noriOpen$]).pipe(
            map(([progress, open]) => open && progress?.node === 'WaitingForCurrentJobCompletion'),
        );
    }

    /** The stage before, now and after, along Nori's loop. */
    private get stages$(): Observable<[string, string, string]> {
        return this.dashboard.infraStage$.pipe(
            filter((stage) => stage.node in NORI_BRIDGE_INFRA_STAGE_TEXT),
            map((stage) => noriBridgeInfraStagesAround(stage.node)),
        );
    }

    get previousStage$(): Observable<string> {
        return this.stages$.pipe(map(([previous]) => previous));
    }

    get currentStage$(): Observable<string> {
        return this.stages$.pipe(map(([, current]) => current));
    }

    get nextStage$(): Observable<string> {
        return this.stages$.pipe(map(([, , next]) => next));
    }

    get lines$() {
        return this.waiting$.pipe(
            map((waiting) =>
                // The same line as inside a batch: they all clear together with the run.
                waiting.map(({ request }) => ({
                    key: request.requestId.toString(),
                    request: `#${request.requestId.toString()}`,
                    contract: contractName(request.target),
                    detail: shortHex(request.target),
                    detailUrl: addressUrl(request.target),
                    transaction: shortHex(request.transactionHash),
                    transactionUrl: transactionUrl(request.transactionHash),
                })),
            ),
        );
    }

    toggle(): void {
        this.open = !this.open;
    }
}
