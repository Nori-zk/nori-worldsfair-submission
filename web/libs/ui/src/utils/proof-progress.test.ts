import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillOf, waitedSec } from './proof-progress.js';

void test('the fill is the time waited against the whole wait', () => {
    assert.equal(fillOf(180, 540), 0.25);
    assert.equal(fillOf(0, 600), 0);
    assert.equal(fillOf(600, 0), 1);
});

void test('an overdue estimate fills the bar, and nothing known fills none of it', () => {
    assert.equal(fillOf(900, -30), 1);
    assert.equal(fillOf(0, 0), 0);
    assert.equal(fillOf(0, -5), 0);
    assert.equal(fillOf(120, Number.POSITIVE_INFINITY), 0);
    assert.equal(fillOf(Number.NaN, 300), 0);
});

void test('a negative wait counts as none', () => {
    assert.equal(fillOf(-10, 300), 0);
});

void test('the wait counts from the enqueue block once its time is known', () => {
    const now = 1_791_572_388_000;
    assert.equal(waitedSec(now, now - 240_000, 3), 240);
    assert.equal(waitedSec(now, now - 1_500, 0), 1.5);
});

void test("before the block's time is read, the wait is the machine's own count", () => {
    assert.equal(waitedSec(1_791_572_388_000, undefined, 42), 42);
});

void test('a block time ahead of the clock waits nothing', () => {
    const now = 1_791_572_388_000;
    assert.equal(waitedSec(now, now + 5_000, 7), 0);
    assert.equal(waitedSec(now, undefined, -1), 0);
});

void test('a reload keeps the fill: the same block time gives the same fill', () => {
    const enqueuedAt = 1_791_572_000_000;
    const before = fillOf(waitedSec(enqueuedAt + 180_000, enqueuedAt, 180), 540);
    // The page reloaded: the machine's count is back at 0, the estimate a step higher.
    const after = fillOf(waitedSec(enqueuedAt + 195_000, enqueuedAt, 0), 540);
    assert.ok(Math.abs(after - before) < 0.03);
    assert.equal(fillOf(waitedSec(enqueuedAt + 195_000, undefined, 0), 540), 0);
});
