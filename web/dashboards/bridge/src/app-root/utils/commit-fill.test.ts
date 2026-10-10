import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type CommitTimes } from '@nori-zk/nori-bridge-solana-sdk';
import {
    blockAgeSec,
    commitFill,
    commitText,
    finalityEstimate,
    processingEstimate,
    scheduledEstimate,
} from './commit-fill.js';

/**
 * One job of 135 s (the sdk's fallback timings), Nori idle and its next job
 * created now, on this finality transition: committed in ~2 m.
 */
const IDLE: CommitTimes = { currentJobSec: undefined, nextJobSec: 135, jobSec: 135 };

void test('the fill is the time since the block against that time plus the time to the commit', () => {
    assert.equal(commitFill(300, 100), 0.75);
    assert.equal(commitFill(0, 600), 0);
    assert.equal(commitFill(600, 0), 1);
    assert.equal(commitFill(600, -30), 1);
    assert.equal(commitFill(0, 0), 0);
    assert.equal(commitFill(-5, 100), 0);
    assert.equal(commitFill(100, Number.POSITIVE_INFINITY), 0);
});

void test('a block is 12 s old for each block since, plus the time since the read', () => {
    assert.equal(blockAgeSec(1_000, 990, 3), 123);
    assert.equal(blockAgeSec(1_000, 1_005, 0), 0);
});

void test('a scheduled request sits ahead of one still waiting for finality', () => {
    // #132: finalized and scheduled, its block 15 m old; #133: its block 8 m old, 6 m to finality.
    const scheduled = scheduledEstimate(15 * 60, IDLE);
    const finality = finalityEstimate(8 * 60, 6 * 60, IDLE.jobSec, IDLE);
    assert.equal(scheduled.remainingSec, 135);
    // The sdk's getCommitTimeRemaining for WaitingForEthFinality: finality left plus one job.
    assert.equal(finality.remainingSec, 360 + 135);
    assert.ok(scheduled.fill > finality.fill);
    assert.ok(Math.abs(scheduled.fill - 900 / 1035) < 1e-9);
    assert.ok(Math.abs(finality.fill - 480 / 975) < 1e-9);
    // Before, each row filled against its own step and both read ~70%.
    assert.equal(scheduled.commit, 1);
    assert.equal(finality.commit, 2);
});

void test('a request finalized in time for the next job lands in it', () => {
    // Finality in 30 s, on the transition that creates the next job: it is that job's.
    const finality = finalityEstimate(500, 30, IDLE.jobSec, {
        ...IDLE,
        nextJobSec: 135 + 30,
    });
    assert.equal(finality.commit, 1);
});

void test('one more epoch to finality is one more commit', () => {
    const finality = finalityEstimate(60, 6 * 60 + 384, IDLE.jobSec, IDLE);
    assert.equal(finality.commit, 3);
});

void test("without Nori's stage the finality row still fills, but names no commit", () => {
    const finality = finalityEstimate(300, 300, 135, undefined);
    assert.equal(finality.commit, undefined);
    assert.equal(finality.fill, 300 / 735);
});

void test('the running job lands first: fuller than the scheduled requests of the same age', () => {
    const running: CommitTimes = { currentJobSec: 40, nextJobSec: 384 + 135 - 95, jobSec: 135 };
    const processing = processingEstimate(600, 40);
    const scheduled = scheduledEstimate(600, running);
    assert.ok(processing.fill > scheduled.fill);
    assert.equal(processing.commit, 0);
});

void test('the commits in words', () => {
    assert.equal(commitText(0), 'the current commit');
    assert.equal(commitText(1), 'the next commit');
    assert.equal(commitText(2), 'the commit after next');
    assert.equal(commitText(3), 'the 3rd commit from now');
    assert.equal(commitText(4), 'the 4th commit from now');
});
