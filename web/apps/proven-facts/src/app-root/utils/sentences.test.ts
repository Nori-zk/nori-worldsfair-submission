import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { mintName, mintOf, sentencesOf, verifyTargetOf, type LabelledLine } from './sentences.js';

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

void test('a mint is named demo, shadow, or by its short address', () => {
    assert.equal(mintName(DEMO), 'demo');
    assert.equal(mintName(SHADOW), 'shadow');
    assert.equal(mintName(OTHER), 'mint AbCd…WxYz');
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

void test('a backing and a pause of one mint read as one sentence', () => {
    assert.deepEqual(sentencesOf([backing(DEMO, '116,723.52'), paused(DEMO, 'false')]), [
        'The demo lockbox held 116,723.52 and was not paused.',
    ]);
    assert.deepEqual(sentencesOf([paused(SHADOW, 'true'), backing(SHADOW, '5,000')]), [
        'The shadow lockbox held 5,000 and was paused.',
    ]);
});

void test('a backing alone, or a pause alone, reads as its own sentence', () => {
    assert.deepEqual(sentencesOf([backing(OTHER, '12.5')]), [
        'The mint AbCd…WxYz backing was 12.5.',
    ]);
    assert.deepEqual(sentencesOf([paused(DEMO, 'true')]), ['The demo lockbox was paused.']);
});

void test('two mints and an unknown query read in the order they first appear', () => {
    assert.deepEqual(
        sentencesOf([
            backing(DEMO, '116,723.52'),
            unknown('0x1234…abcd', '42'),
            backing(SHADOW, '1,000'),
            paused(DEMO, 'false'),
            paused(SHADOW, 'false'),
        ]),
        [
            'The demo lockbox held 116,723.52 and was not paused.',
            'Query 0x1234…abcd returned 42.',
            'The shadow lockbox held 1,000 and was not paused.',
        ],
    );
});

void test('past four sentences, the rest are counted', () => {
    const lines = Array.from({ length: 7 }, (_, i) => unknown(`0x${i.toString()}`, i.toString()));
    assert.deepEqual(sentencesOf(lines), [
        'Query 0x0 returned 0.',
        'Query 0x1 returned 1.',
        'Query 0x2 returned 2.',
        'Query 0x3 returned 3.',
        '… and 3 more',
    ]);
});

void test('a snapshot with no results says so', () => {
    assert.deepEqual(sentencesOf([]), ['It recorded no results.']);
});

void test('verify checks the backing when there is one, else the first result', () => {
    const first = unknown('0x1', '1');
    const back = backing(DEMO, '9');
    assert.equal(verifyTargetOf([first, paused(DEMO, 'false'), back]), back);
    assert.equal(verifyTargetOf([first, paused(DEMO, 'false')]), first);
    assert.equal(verifyTargetOf([]), undefined);
});
