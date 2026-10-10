import { ETHEREUM_EPOCH_SEC, type CommitTimes } from '@nori-zk/nori-bridge-solana-sdk';

/** Seconds per Ethereum block, as the rows count a request's age. */
const BLOCK_SEC = 12;

/** Where a waiting row is on its way from its Ethereum block to its commit on Solana. */
export interface CommitEstimate {
    /** The seconds until the commit; negative once it is overdue. */
    remainingSec: number;
    /** How far along the whole way, from 0 to 1. */
    fill: number;
    /**
     * The commit it lands in: 0 for the job Nori is running, 1 for the next
     * job's, 2 for the one after, …; `undefined` while Nori's stage is unknown.
     */
    commit: number | undefined;
}

/**
 * How far a request is on its way from its Ethereum block to its commit on
 * Solana: the time since the block against that time plus the time left.
 * Every waiting row uses it, so the rows share one scale.
 *
 * @param ageSec The seconds since the request's Ethereum block.
 * @param remainingSec The seconds until its commit on Solana; negative counts as none left.
 * @returns From 0 to 1; 0 when the total is unknown.
 */
export function commitFill(ageSec: number, remainingSec: number): number {
    const age = Math.max(0, ageSec);
    const total = age + Math.max(0, remainingSec);
    return Number.isFinite(total) && total > 0 ? Math.min(1, age / total) : 0;
}

/**
 * The seconds since a block: 12 a block from the latest block the view
 * read, plus the time since that read.
 *
 * @param latestBlock Ethereum's latest block when the view was read.
 * @param blockNumber The block.
 * @param sinceReadSec The seconds since the view was read.
 * @returns The seconds, never negative.
 */
export function blockAgeSec(
    latestBlock: number,
    blockNumber: number,
    sinceReadSec: number,
): number {
    return Math.max(0, (latestBlock - blockNumber) * BLOCK_SEC + sinceReadSec);
}

/**
 * The requests waiting for Ethereum finality. Their time to the commit is
 * the sdk's `getCommitTimeRemaining` for `WaitingForEthFinality`: the
 * finality time left plus one job, which Nori creates on the finality
 * transition that finalizes the block. Nori creates one job an epoch, so
 * they land one commit after the next job's for each epoch past it.
 *
 * @param ageSec The seconds since the oldest request's block.
 * @param finalityLeftSec The seconds until that block is finalized.
 * @param jobSec How long one job takes, from its creation to its commit.
 * @param commits When the next commits are due, while Nori's stage is known.
 * @returns The estimate.
 */
export function finalityEstimate(
    ageSec: number,
    finalityLeftSec: number,
    jobSec: number,
    commits: CommitTimes | undefined,
): CommitEstimate {
    const remainingSec = Math.max(0, finalityLeftSec) + jobSec;
    const later =
        commits === undefined
            ? undefined
            : (remainingSec - commits.nextJobSec) / ETHEREUM_EPOCH_SEC;
    return {
        remainingSec,
        fill: commitFill(ageSec, remainingSec),
        commit: later === undefined ? undefined : 1 + Math.max(0, Math.round(later)),
    };
}

/**
 * The finalized requests scheduled for the job after Nori's current one,
 * or its next one while it is idle: committed when that job is.
 *
 * @param ageSec The seconds since the oldest request's block.
 * @param commits When the next commits are due.
 * @returns The estimate.
 */
export function scheduledEstimate(ageSec: number, commits: CommitTimes): CommitEstimate {
    return {
        remainingSec: commits.nextJobSec,
        fill: commitFill(ageSec, commits.nextJobSec),
        commit: 1,
    };
}

/**
 * The requests in the job Nori is running: committed when it is.
 *
 * @param ageSec The seconds since the oldest request's block.
 * @param currentJobSec The seconds until the running job is committed.
 * @returns The estimate.
 */
export function processingEstimate(ageSec: number, currentJobSec: number): CommitEstimate {
    return { remainingSec: currentJobSec, fill: commitFill(ageSec, currentJobSec), commit: 0 };
}

/**
 * A commit, in words.
 *
 * @param commit 0 for the running job's commit, 1 for the next job's, 2 for the one after, ….
 * @returns `the current commit`, `the next commit`, `the commit after next`, `the 3rd commit from now`, ….
 */
export function commitText(commit: number): string {
    if (commit <= 0) return 'the current commit';
    if (commit === 1) return 'the next commit';
    if (commit === 2) return 'the commit after next';
    return `the ${commit.toString()}${commit === 3 ? 'rd' : 'th'} commit from now`;
}
