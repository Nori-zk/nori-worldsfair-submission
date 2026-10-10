import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredFill, anchoredTotal, storedTotal, waitedSec } from './proof-progress.js';

void test('the fill is the time waited against the total', () => {
    assert.equal(anchoredFill(180, 720), 0.25);
    assert.equal(anchoredFill(0, 600), 0);
    assert.equal(anchoredFill(600, 600), 1);
    assert.equal(anchoredFill(900, 600), 1);
});

void test('nothing known fills none of the bar', () => {
    assert.equal(anchoredFill(120, undefined), 0);
    assert.equal(anchoredFill(120, 0), 0);
    assert.equal(anchoredFill(120, Number.POSITIVE_INFINITY), 0);
    assert.equal(anchoredFill(Number.NaN, 300), 0);
    assert.equal(anchoredFill(-10, 300), 0);
});

void test('the first estimate anchors the total', () => {
    assert.equal(anchoredTotal(undefined, 480, 1200), 1680);
    assert.equal(anchoredTotal(undefined, 900, -30), 900);
    assert.equal(anchoredTotal(undefined, -5, 300), 300);
});

void test('an unknown estimate keeps the total', () => {
    assert.equal(anchoredTotal(undefined, 120, Number.POSITIVE_INFINITY), undefined);
    assert.equal(anchoredTotal(1680, 120, Number.NaN), 1680);
    assert.equal(anchoredTotal(1680, Number.NaN, 300), 1680);
});

void test('an estimate that steps down keeps the total, so the fill rises steadily', () => {
    let total = anchoredTotal(undefined, 480, 1200);
    let fill = anchoredFill(480, total);
    // Between finality messages the estimate counts down with the clock; then it re-bases lower.
    for (const [elapsed, remaining] of [
        [540, 1140],
        [600, 1080],
        [660, 700],
        [720, 640],
        [1000, 300],
    ] as const) {
        total = anchoredTotal(total, elapsed, remaining);
        assert.equal(total, 1680);
        const next = anchoredFill(elapsed, total);
        assert.ok(next > fill);
        fill = next;
    }
    // The estimate's own fill would have jumped from 0.49 to 0.77 at the re-base; this one did not.
    assert.ok(anchoredFill(660, total) < 0.4);
});

void test('an estimate that re-bases up extends the total, and the fill steps back', () => {
    const total = anchoredTotal(undefined, 480, 600);
    assert.equal(total, 1080);
    const before = anchoredFill(700, total);
    const extended = anchoredTotal(total, 700, 900);
    assert.equal(extended, 1600);
    const after = anchoredFill(700, extended);
    assert.ok(after < before);
    // It never shrinks back.
    assert.equal(anchoredTotal(extended, 800, 100), 1600);
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

void test('a reload keeps the fill: the same block time and the kept total give the same fill', () => {
    const enqueuedAt = 1_791_572_000_000;
    const total = anchoredTotal(undefined, waitedSec(enqueuedAt + 180_000, enqueuedAt, 180), 540);
    const before = anchoredFill(waitedSec(enqueuedAt + 180_000, enqueuedAt, 180), total);
    // The page reloaded: the machine's count is back at 0, the estimate a step lower.
    const kept = storedTotal(String(total));
    const reloaded = anchoredTotal(kept, waitedSec(enqueuedAt + 195_000, undefined, 0), 300);
    assert.equal(reloaded, total);
    const after = anchoredFill(waitedSec(enqueuedAt + 195_000, enqueuedAt, 0), reloaded);
    assert.ok(after > before && after - before < 0.03);
});

void test('a stored total is a positive number, else none', () => {
    assert.equal(storedTotal('1680'), 1680);
    assert.equal(storedTotal('1680.5'), 1680.5);
    assert.equal(storedTotal(null), undefined);
    assert.equal(storedTotal(''), undefined);
    assert.equal(storedTotal('0'), undefined);
    assert.equal(storedTotal('-3'), undefined);
    assert.equal(storedTotal('Infinity'), undefined);
    assert.equal(storedTotal('abc'), undefined);
});
