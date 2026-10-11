import {
    type Arrived,
    ETHEREUM_EPOCH_SEC,
    getCommitTimes,
    getFinalityTimeRemainingSec,
    jobTimingsOf,
    NORI_JOB_STAGES,
    sortWaitingProofRequests,
    type EnqueuedProofRequest,
    type EthereumFinality,
    type ProofQueueBatchesView,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    NORI_BRIDGE_INFRA_STAGE_TEXT,
    type NoriBridgeInfraFinality,
    type NoriBridgeInfraStage,
    type NoriBridgeInfraState,
    timeLeft,
    blockText,
    idRange,
} from '@nori-zk/solana-web-ui';
import {
    blockAgeSec,
    finalityEstimate,
    processingEstimate,
    scheduledEstimate,
} from './commit-fill.js';
import { type Line, lineOf } from './request-line.js';

/** One row above the batches: a set of the requests no batch covers yet, and where they wait. */
export interface WaitingRow {
    key: 'finality' | 'scheduled' | 'processing';
    /** Its requests' ids and count. */
    requests: string;
    /** The Ethereum block the row is about. */
    block: string;
    /** How far its oldest request is from its Ethereum block to its commit on Solana, from 0 to 1; `undefined` while not known. */
    fill: number | undefined;
    /** What the row waits for, the time left, and the commit it lands in. */
    status: string;
    /** Its requests, oldest first. */
    lines: Line[];
    /** Whether the row has requests to show. */
    shown: boolean;
}

/** What the rows are built from. */
export interface WaitingRowsInput {
    /** The view the batches machine last read, and when. */
    view: Arrived<ProofQueueBatchesView>;
    /** Nori's `state.bridge`, while its websocket is open. */
    bridge?: Arrived<NoriBridgeInfraState>;
    /** Nori's timings, while its websocket is open. */
    timings?: Partial<Record<string, number>>;
    /** Nori's `state.eth`, while its websocket is open. */
    finality?: Arrived<NoriBridgeInfraFinality>;
    /** Now, in ms since the epoch. */
    nowMs: number;
}

/**
 * The time left, or that the step is taking longer than expected once it is past.
 *
 * @param seconds The seconds left.
 * @returns `~2m left`, `~40s left`, or `taking longer than expected`.
 */
const leftText = (seconds: number): string =>
    seconds > 0 ? timeLeft(seconds) : 'taking longer than expected';

/**
 * Whether a stage name has text: a node of Nori's transition graph.
 *
 * @param name A stage name.
 * @returns `true` for a node.
 */
const isShownStage = (name: string): name is NoriBridgeInfraStage =>
    name in NORI_BRIDGE_INFRA_STAGE_TEXT;

/**
 * The rows above the batches, top to bottom: the requests waiting for
 * Ethereum finality, those finalized and scheduled for a later job, and,
 * while Nori's websocket says which job it is running, the requests in that
 * job. Every row's bar shares one scale, from its oldest request's Ethereum
 * block to that request's commit on Solana, so a fuller bar is further along
 * the whole way; its time left counts towards its next step (finality, or
 * the commit), and its status names the commit it lands in.
 *
 * @param input The view, Nori's state, timings and finality, and now.
 * @returns The rows.
 */
export function waitingRows({
    view,
    bridge,
    timings,
    finality,
    nowMs,
}: WaitingRowsInput): WaitingRow[] {
    const since = (atMs: number) => Math.max(0, (nowMs - atMs) / 1000);
    const stage = bridge && {
        ...bridge.value,
        elapsed_sec: bridge.value.elapsed_sec + since(bridge.atMs),
    };
    // Nori's finality is the freshest; the view's polled block counts slots as blocks.
    const finalityNow: Arrived<EthereumFinality> =
        finality && finality.value.latest_finality_block_number >= view.value.finalizedBlock
            ? finality
            : {
                  value: {
                      latest_finality_block_number: view.value.finalizedBlock,
                      latest_finality_slot: view.value.finalizedBlock,
                  },
                  atMs: view.atMs,
              };
    const sorted = sortWaitingProofRequests(
        view.value.waiting,
        finalityNow.value.latest_finality_block_number,
        stage,
    );
    const commits = stage && getCommitTimes(stage, timings);

    // One job's time, from Nori's timings where it reports them, as `getCommitTimes` counts it.
    const known = jobTimingsOf(timings);
    const jobSec = NORI_JOB_STAGES.reduce((total, name) => total + known[name], 0);
    /** The seconds since a row's oldest request's block. */
    const ageOf = (first: EnqueuedProofRequest | undefined) =>
        first ? blockAgeSec(view.value.latestBlock, first.blockNumber, since(view.atMs)) : 0;

    const oldest = sorted.waitingForFinality[0];
    const finalityLeft =
        oldest &&
        getFinalityTimeRemainingSec(oldest.blockNumber, finalityNow.value) -
            since(finalityNow.atMs);
    const finalityRow =
        finalityLeft === undefined
            ? undefined
            : finalityEstimate(ageOf(oldest), finalityLeft, jobSec, commits);
    const rows: Omit<WaitingRow, 'shown'>[] = [
        {
            key: 'finality',
            requests: idRange(sorted.waitingForFinality.map(({ requestId }) => requestId)),
            block: oldest ? blockText(oldest.blockNumber) : '',
            fill: finalityRow?.fill,
            status:
                finalityLeft === undefined
                    ? 'Waiting for Ethereum finality'
                    : `Waiting for Ethereum finality · ${leftText(finalityLeft)}`,
            lines: sorted.waitingForFinality.map(lineOf),
        },
    ];

    const scheduledRow = commits && scheduledEstimate(ageOf(sorted.scheduled[0]), commits);
    rows.push({
        key: 'scheduled',
        requests: idRange(sorted.scheduled.map(({ requestId }) => requestId)),
        block: '',
        fill: scheduledRow?.fill,
        status: scheduledRow
            ? `Scheduled for processing · ${leftText(scheduledRow.remainingSec)}`
            : `Scheduled for processing · within ~${Math.round((ETHEREUM_EPOCH_SEC + jobSec) / 60).toString()}m`,
        lines: sorted.scheduled.map(lineOf),
    });

    const running =
        stage &&
        commits?.currentJobSec !== undefined &&
        (NORI_JOB_STAGES as readonly string[]).includes(stage.stage_name);
    const stageText =
        running && isShownStage(stage.stage_name)
            ? NORI_BRIDGE_INFRA_STAGE_TEXT[stage.stage_name]
            : '';
    const currentJobSec = commits?.currentJobSec ?? 0;
    rows.push({
        key: 'processing',
        requests: idRange(sorted.processing.map(({ requestId }) => requestId)),
        block: running ? blockText(stage.output_block_number) : '',
        fill: running
            ? processingEstimate(ageOf(sorted.processing[0]), currentJobSec).fill
            : undefined,
        status: running
            ? ['Processing', stageText, leftText(currentJobSec)]
                  .filter((part) => part !== '')
                  .join(' · ')
            : 'Processing',
        lines: sorted.processing.map(lineOf),
    });
    // Always all three, in this order, so the table never reorders them; an empty one hides itself.
    return rows.map((row) => ({ ...row, shown: row.lines.length > 0 }));
}
