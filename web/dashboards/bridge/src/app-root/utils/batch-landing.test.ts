import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingOf, type SignatureEntry } from './batch-landing.js';

// Batch 85 on devnet, newest first: two Backstop reads, the creating update,
// an empty update before it, and the oldest, another empty update.
const batch85: SignatureEntry[] = [
    { signature: 'backstop-read-2', err: null, blockTime: 1_791_576_405n },
    { signature: 'backstop-read-1', err: null, blockTime: 1_791_576_402n },
    { signature: 'creating-update', err: null, blockTime: 1_791_576_357n },
    { signature: 'empty-update-2', err: null, blockTime: 1_791_576_042n },
    { signature: 'empty-update-1', err: null, blockTime: 1_791_575_593n },
];
const nori = new Set(['creating-update', 'empty-update-2', 'empty-update-1']);

void test('the newest successful Nori transaction is the landing, not the oldest', () => {
    assert.deepEqual(landingOf(batch85, nori), {
        atSecs: 1_791_576_357,
        signature: 'creating-update',
    });
});

void test('a failed Nori transaction is skipped', () => {
    const failed: SignatureEntry = {
        signature: 'failed-update',
        err: { InstructionError: [0n, { Custom: 1n }] },
        blockTime: 1_791_576_390n,
    };
    assert.equal(
        landingOf([failed, ...batch85], new Set([...nori, 'failed-update']))?.signature,
        'creating-update',
    );
});

void test('no landing when nothing matches or its time is unknown', () => {
    assert.equal(landingOf(batch85, new Set()), undefined);
    assert.equal(landingOf([], nori), undefined);
    assert.equal(
        landingOf([{ signature: 'creating-update', err: null, blockTime: null }], nori),
        undefined,
    );
});
