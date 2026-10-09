import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { labelOf, valueOf, verifiedText, verifyFailedText, type GuardQueries } from './facts.js';

const BACKING = `0x${'ab'.repeat(32)}`;
const PAUSE = `0x${'cd'.repeat(32)}`;
const OTHER = `0x9f2c${'00'.repeat(28)}11ab`;
const guards: GuardQueries[] = [
    {
        mint: address('Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi'),
        config: { backingQuery: BACKING, pauseQuery: PAUSE, backingDecimals: 2 },
    },
];
const word = (value: bigint): string => `0x${value.toString(16).padStart(64, '0')}`;

void test('a guard query is named by its mint, in any case', () => {
    assert.deepEqual(labelOf(BACKING.toUpperCase().replace('0X', '0x'), guards), {
        text: 'Fhw5…cbhi backing',
        kind: 'backing',
        decimals: 2,
    });
    assert.deepEqual(labelOf(PAUSE, guards), { text: 'Fhw5…cbhi paused', kind: 'pause' });
});

void test('any other query is its short id', () => {
    assert.deepEqual(labelOf(OTHER, guards), { text: '0x9f2c…11ab', kind: 'unknown' });
    assert.deepEqual(labelOf(BACKING, []), { text: '0xabab…abab', kind: 'unknown' });
});

void test('a backing reads in its decimals, a pause as true or false, the rest as an integer', () => {
    assert.equal(valueOf(word(11_672_352n), labelOf(BACKING, guards)), '116,723.52');
    assert.equal(valueOf(word(0n), labelOf(PAUSE, guards)), 'false');
    assert.equal(valueOf(word(1n), labelOf(PAUSE, guards)), 'true');
    assert.equal(
        valueOf(word(919_116_467_980_193_089n), labelOf(OTHER, guards)),
        '919,116,467,980,193,089',
    );
});

void test('a verified result that matches the event is green with its compute units', () => {
    assert.deepEqual(verifiedText(word(5n).toUpperCase().replace('0X', '0x'), word(5n), 2503n), {
        text: 'verified by nori-read-example · 2,503 CU',
        style: 'color: var(--nori-light-green)',
    });
    assert.deepEqual(verifiedText(word(6n), word(5n), 2503n), {
        text: 'did not verify: Solana verified 0x0000…0006, the event recorded 0x0000…0005',
        style: 'color: var(--nori-muted)',
    });
});

void test('a failed verify is muted, and names pruned state', () => {
    assert.deepEqual(verifyFailedText(new Error('no response')), {
        text: 'did not verify: no response',
        style: 'color: var(--nori-muted)',
    });
    assert.equal(
        verifyFailedText(new Error('missing trie node 1a2b (path )')).text,
        "did not verify: missing trie node 1a2b (path ) (the Ethereum RPC may have pruned that block's state)",
    );
});
