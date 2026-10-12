import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import type { SnapshotReadTransaction } from '@nori-zk/backstop-keeper/read';
import {
    factLinesOf,
    lockboxName,
    mintOf,
    verifyTargetOf,
    type LabelledLine,
} from './sentences.js';

const DEMO = 'Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi';
const SHADOW = 'Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX';
const OTHER = 'AbCdm3W34LuGNNuTWxHu8wVbre7wUE445hxir3XwWxYz';

const backing = (mint: string, value: string): LabelledLine => ({
    queryId: `0x${'ab'.repeat(32)}`,
    word: `0x${'00'.repeat(32)}`,
    label: { text: 'backing', kind: 'backing', decimals: 2 },
    value,
    mint,
});
const paused = (mint: string, value: 'true' | 'false'): LabelledLine => ({
    queryId: `0x${'cd'.repeat(32)}`,
    word: `0x${'00'.repeat(32)}`,
    label: { text: 'paused', kind: 'pause' },
    value,
    mint,
});
const unknown = (short: string, value: string): LabelledLine => ({
    queryId: `0x${'ef'.repeat(32)}`,
    word: `0x${'00'.repeat(32)}`,
    label: { text: short, kind: 'unknown' },
    value,
});

void test('a mint is named by its lockbox, as guard status names it, or by its short address', () => {
    assert.equal(lockboxName(DEMO), 'Demo lockbox');
    assert.equal(lockboxName(SHADOW), 'Shadow lockbox');
    assert.equal(lockboxName('B6cveUAMmg5x1vfnjUCmW2dws18owYNSE9RQ2LN48JQC'), 'Demo lockbox');
    assert.equal(lockboxName(OTHER), 'Mint AbCd…WxYz');
});

void test('a query names the mint of the guard that reads it, in any case', () => {
    const guards = [
        {
            mint: address(DEMO),
            config: { backingQuery: '0xAB', pauseQuery: '0xCD', backingDecimals: 2 },
        },
    ];
    assert.equal(mintOf('0xab', guards), DEMO);
    assert.equal(mintOf('0xcd', guards), DEMO);
    assert.equal(mintOf('0xef', guards), undefined);
});

const texts = (lines: LabelledLine[]): string[] => factLinesOf(lines, []).map(({ text }) => text);

void test("a mint's backing and pause read as one line", () => {
    assert.deepEqual(texts([backing(DEMO, '116,723.52'), paused(DEMO, 'false')]), [
        'Demo lockbox · held 116,723.52 · not paused',
    ]);
    assert.deepEqual(texts([paused(SHADOW, 'true'), backing(SHADOW, '5,000')]), [
        'Shadow lockbox · held 5,000 · paused',
    ]);
});

void test('a backing alone, or a pause alone, reads as its own line', () => {
    assert.deepEqual(texts([backing(OTHER, '12.5')]), ['Mint AbCd…WxYz · held 12.5']);
    assert.deepEqual(texts([paused(DEMO, 'true')]), ['Demo lockbox · paused']);
});

void test('two mints and an unknown query read in the order they first appear', () => {
    assert.deepEqual(
        texts([
            backing(DEMO, '116,723.52'),
            unknown('0x1234…abcd', '42'),
            backing(SHADOW, '1,000'),
            paused(DEMO, 'false'),
            paused(SHADOW, 'false'),
        ]),
        [
            'Demo lockbox · held 116,723.52 · not paused',
            'Query 0x1234…abcd returned 42',
            'Shadow lockbox · held 1,000 · not paused',
        ],
    );
});

void test('past eight lines, the rest are counted', () => {
    const lines = Array.from({ length: 11 }, (_, i) => unknown(`0x${i.toString()}`, i.toString()));
    const shown = texts(lines);
    assert.equal(shown.length, 9);
    assert.equal(shown[7], 'Query 0x7 returned 7');
    assert.equal(shown[8], '… and 3 more');
});

void test('a snapshot with no results says so', () => {
    assert.deepEqual(texts([]), ['It recorded no results.']);
});

void test("each mint's line carries the keeper's newest backing and pause read of its own queries", () => {
    const read = (
        signature: string,
        queryId: string,
        kind: SnapshotReadTransaction['kind'],
    ): SnapshotReadTransaction => ({
        signature,
        slot: 0n,
        snapshotTxHash: `0x${'11'.repeat(32)}`,
        queryId,
        kind,
    });
    const shadowBacking = { ...backing(SHADOW, '1'), queryId: `0x${'AA'.repeat(32)}` };
    // Newest first, as snapshotReadsOf gives them.
    const reads = [
        read('pause-new', `0x${'cd'.repeat(32)}`, 'pause'),
        read('backing-new', `0x${'ab'.repeat(32)}`, 'backing'),
        read('backing-old', `0x${'ab'.repeat(32)}`, 'backing'),
        read('example', `0x${'ab'.repeat(32)}`, 'example'),
        read('shadow', `0x${'aa'.repeat(32)}`, 'backing'),
    ];
    const lines = factLinesOf(
        [backing(DEMO, '9'), paused(DEMO, 'false'), shadowBacking, unknown('0x1', '1')],
        reads,
    );
    assert.deepEqual(
        lines.map((line) => line.reads.map(({ signature, kind }) => `${kind} ${signature}`)),
        [['backing backing-new', 'pause pause-new'], ['backing shadow'], []],
    );
    assert.deepEqual(factLinesOf([backing(DEMO, '9')], [])[0]?.reads, []);
});

void test('verify checks the backing when there is one, else the first result', () => {
    const first = unknown('0x1', '1');
    const back = backing(DEMO, '9');
    assert.equal(verifyTargetOf([first, paused(DEMO, 'false'), back]), back);
    assert.equal(verifyTargetOf([first, paused(DEMO, 'false')]), first);
    assert.equal(verifyTargetOf([]), undefined);
});
