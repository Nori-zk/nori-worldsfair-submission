import {
    ETHEREUM_EPOCH_SEC,
    getCommitTimes,
    getFinalityTimeRemainingSec,
    jobTimingsOf,
    NORI_JOB_STAGES,
    sortWaitingProofRequests,
    type EthereumFinality,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    NORI_BRIDGE_INFRA_STAGE_TEXT,
    type NoriBridgeInfraFinality,
    type NoriBridgeInfraStage,
    type NoriBridgeInfraState,
} from '@nori-zk/solana-web-ui';
import { type BatchesView } from '../ystate/bridge-batches.js';
import { asciiBar, timeLeft, UNKNOWN_BAR } from './ascii.js';
import { blockText, idRange } from './format.js';
import { type Line, lineOf } from './request-line.js';

/** One row above the batches: a set of the requests no batch covers yet, and where they wait. */
export interface WaitingRow {
    key: 'finality' | 'scheduled' | 'processing';
    /** Its requests' ids and count. */
    requests: string;
    /** The Ethereum block the row is about. */
    block: string;
    /** How far along the row's wait is. */
    bar: string;
    /** What the row waits for, and the time left. */
    status: string;
    /** Its requests, oldest first. */
    lines: Line[];
    /** Whether the row has requests to show. */
    shown: boolean;
}

/** A value and when it arrived, in ms since the epoch. */
export interface Arrived<T> {
    value: T;
    atMs: number;
}

/** What the rows are built from. */
export interface WaitingRowsInput {
    /** The view the batches machine last read, and when. */
    view: Arrived<BatchesView>;
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
 * job. Each row's bar and time left count towards its next step: finality,
 * or the commit on Solana of the job its requests are in.
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

    const oldest = sorted.waitingForFinality[0];
    const finalityLeft =
        oldest &&
        getFinalityTimeRemainingSec(oldest.blockNumber, finalityNow.value) -
            since(finalityNow.atMs);
    const age = oldest ? (view.value.latestBlock - oldest.blockNumber) * 12 + since(view.atMs) : 0;
    const rows: Omit<WaitingRow, 'shown'>[] = [
        {
            key: 'finality',
            requests: idRange(sorted.waitingForFinality.map(({ requestId }) => requestId)),
            block: oldest ? blockText(oldest.blockNumber) : '',
            bar:
                finalityLeft === undefined
                    ? UNKNOWN_BAR
                    : asciiBar(age / (age + Math.max(0, finalityLeft))),
            status:
                finalityLeft === undefined
                    ? 'Waiting for Ethereum finality'
                    : `Waiting for Ethereum finality · ${leftText(finalityLeft)}`,
            lines: sorted.waitingForFinality.map(lineOf),
        },
    ];

    const fallbackJobSec = Object.values(jobTimingsOf(undefined)).reduce(
        (total, s) => total + s,
        0,
    );
    rows.push({
        key: 'scheduled',
        requests: idRange(sorted.scheduled.map(({ requestId }) => requestId)),
        block: '',
        bar: commits
            ? asciiBar(1 - commits.nextJobSec / (ETHEREUM_EPOCH_SEC + commits.jobSec))
            : UNKNOWN_BAR,
        status: commits
            ? `Scheduled for processing · ${leftText(commits.nextJobSec)}`
            : `Scheduled for processing · within ~${Math.round((ETHEREUM_EPOCH_SEC + fallbackJobSec) / 60).toString()}m`,
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
    rows.push({
        key: 'processing',
        requests: idRange(sorted.processing.map(({ requestId }) => requestId)),
        block: running ? blockText(stage.output_block_number) : '',
        bar: running ? asciiBar(1 - (commits.currentJobSec ?? 0) / commits.jobSec) : UNKNOWN_BAR,
        status: running
            ? ['Processing', stageText, leftText(commits.currentJobSec ?? 0)]
                  .filter((part) => part !== '')
                  .join(' · ')
            : 'Processing',
        lines: sorted.processing.map(lineOf),
    });
    // Always all three, in this order, so the table never reorders them; an empty one hides itself.
    return rows.map((row) => ({ ...row, shown: row.lines.length > 0 }));
}
