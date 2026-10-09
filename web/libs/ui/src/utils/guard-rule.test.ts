import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { type Checkpoint, type GuardState } from '@nori-zk/backstop-client/guard';
import { checkpointLines, windowOf } from './guard-rule.js';

// The demo guard's numbers: a 9-decimal mint, backing 223.52, supply
// 116,700, tolerance 1, a 10 min window and 1 min skew.
const DECIMALS = 9;
const UNIT = 1_000_000_000n;
const T = 1_791_572_388n; // 18:59:48 UTC
const SUPPLY = 116_700n * UNIT;

/**
 * A guard proven at `T` with the given checkpoints, oldest first.
 *
 * @param checkpoints The checkpoints it keeps.
 * @param overrides Any other fields.
 * @returns The guard.
 */
const guardWith = (checkpoints: Checkpoint[], overrides: Partial<GuardState> = {}): GuardState => ({
    admin: address('EuRkxPWMLFrNqzNFZYsC7JQZhNewxLfLz3aQFVzts27Y'),
    mint: address('Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi'),
    config: {
        noriProgram: address('EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg'),
        noriSnapshot: '0xc377ebbf516a9db2fe5aeb65fa19d4dca1717340',
        backingQuery: `0x${'22'.repeat(32)}`,
        pauseQuery: `0x${'33'.repeat(32)}`,
        backingDecimals: 18,
        tolerance: UNIT,
        windowSecs: 600,
        skewSecs: 60,
        checkpointIntervalSecs: 120,
        maxStalenessSecs: 7_200,
    },
    backing: 22_352n * (UNIT / 100n),
    backingEthBlock: 11_879_302n,
    backingEthTime: T,
    paused: false,
    pauseEthBlock: 11_879_302n,
    tripped: false,
    tripEthBlock: 0n,
    tripDeficit: 0n,
    checkpointCount: BigInt(checkpoints.length),
    checkpoints,
    ...overrides,
});

/** A checkpoint `offset` seconds from `T`. */
const at = (offset: number, supply = SUPPLY): Checkpoint => ({
    time: T + BigInt(offset),
    supply,
});

/** Checkpoints every 2 min from `first` to `last` seconds around `T`. */
const every2Min = (first: number, last: number, supply = SUPPLY): Checkpoint[] =>
    Array.from({ length: Math.floor((last - first) / 120) + 1 }, (_, i) =>
        at(first + 120 * i, supply),
    );

void test('the window keeps only the checkpoints within T ± window', () => {
    const rule = windowOf(guardWith([at(-601), at(-600), at(-60), at(600), at(601)]), DECIMALS);
    assert.equal(rule.from, T - 600n);
    assert.equal(rule.to, T + 600n);
    assert.deepEqual(rule.inWindow, [at(-600), at(-60), at(600)]);
    assert.equal(rule.rotatedOut, false);
});

void test('a supply above backing + tolerance gives the deficit the program trips on', () => {
    const rule = windowOf(guardWith(every2Min(-540, 540)), DECIMALS);
    assert.equal(rule.inWindow.length, 10);
    assert.deepEqual(rule.lowest, at(-540));
    // 116,700 − (223.52 + 1) = 116,475.48, the demo guard's trip deficit.
    assert.equal(rule.deficit, 116_475_480_000_000n);
    assert.equal(
        rule.verdict,
        'window 18:49:48–19:09:48 · 10 checkpoints · lowest 116,700 vs backing + tolerance 224.52 · deficit 116,475.48',
    );
});

void test('the lowest supply in the window is the one compared', () => {
    const rule = windowOf(
        guardWith([at(-300, 300n * UNIT), at(-200, 224n * UNIT), at(-100, 224n * UNIT)]),
        DECIMALS,
    );
    assert.deepEqual(rule.lowest, at(-200, 224n * UNIT));
    assert.equal(rule.deficit, undefined);
    assert.match(rule.verdict, /lowest 224 vs backing \+ tolerance 224.52 · no deficit$/);
});

void test('a supply exactly at backing + tolerance is no deficit', () => {
    const limit = 22_452n * (UNIT / 100n);
    const rule = windowOf(guardWith([at(-120, limit)]), DECIMALS);
    assert.equal(rule.deficit, undefined);
    assert.match(rule.verdict, /· no deficit$/);
});

void test('no checkpoint in the window gives no verdict', () => {
    const rule = windowOf(guardWith([at(-1_200), at(1_200)]), DECIMALS);
    assert.deepEqual(rule.inWindow, []);
    assert.equal(rule.lowest, undefined);
    assert.equal(rule.verdict, 'No checkpoint in the window');
});

void test('without a checkpoint at or before T − skew there is no verdict yet', () => {
    const rule = windowOf(guardWith([at(-59), at(0), at(300)]), DECIMALS);
    assert.equal(rule.inWindow.length, 3);
    assert.equal(rule.lowest, undefined);
    assert.equal(rule.verdict, 'No checkpoint before T − skew yet: no verdict');
    const onSkew = windowOf(guardWith([at(-60)]), DECIMALS);
    assert.match(onSkew.verdict, /^window /);
});

void test('a window the 64-entry ring has rotated past says so', () => {
    // 70 written, the 64 kept start 2 h after T.
    const kept = every2Min(7_200, 7_200 + 63 * 120);
    const rule = windowOf(guardWith(kept, { checkpointCount: 70n }), DECIMALS);
    assert.equal(rule.rotatedOut, true);
    assert.deepEqual(rule.inWindow, []);
    assert.equal(rule.verdict, 'The window has rotated out of the 64 kept checkpoints');
    // Fewer than 64 written: nothing was dropped, so the window is just empty.
    const young = windowOf(guardWith(every2Min(7_200, 7_440)), DECIMALS);
    assert.equal(young.rotatedOut, false);
    assert.equal(young.verdict, 'No checkpoint in the window');
});

void test('a window whose start has rotated out still runs on what is kept, and says so', () => {
    const kept = every2Min(-300, -300 + 63 * 120);
    const rule = windowOf(guardWith(kept, { checkpointCount: 400n }), DECIMALS);
    assert.equal(rule.rotatedOut, true);
    assert.equal(rule.inWindow.length, 8);
    assert.match(rule.verdict, /· deficit 116,475.48 · the window's start has rotated out$/);
});

void test('no backing proven gives no window', () => {
    const rule = windowOf(guardWith([at(0)], { backingEthTime: 0n }), DECIMALS);
    assert.equal(rule.verdict, 'No backing proven yet');
});

void test('the checkpoint lines run newest first, barred against the highest, the lowest marked', () => {
    const rule = windowOf(
        guardWith([at(-300, 100n * UNIT), at(-180, 50n * UNIT), at(-60, 50n * UNIT)]),
        DECIMALS,
    );
    assert.deepEqual(checkpointLines(rule, DECIMALS), [
        '18:58:48   50  ▓▓▓▓▓░░░░░',
        '18:56:48   50  ▓▓▓▓▓░░░░░  ◂ lowest',
        '18:54:48  100  ▓▓▓▓▓▓▓▓▓▓',
    ]);
});

void test('the checkpoint lines stop at 12 and count the rest', () => {
    const rule = windowOf(guardWith(every2Min(-600, 600)), DECIMALS);
    const lines = checkpointLines(rule, DECIMALS);
    assert.equal(rule.inWindow.length, 11);
    assert.equal(lines.length, 11);
    const many = windowOf(guardWith(every2Min(-600, 600).flatMap((c) => [c, c])), DECIMALS);
    const capped = checkpointLines(many, DECIMALS);
    assert.equal(capped.length, 13);
    assert.equal(capped[12], '… 10 older');
});
