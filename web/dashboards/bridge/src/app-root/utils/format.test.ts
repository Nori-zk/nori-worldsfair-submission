import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, amount, clock } from './format.js';

void test('an amount reads in the mint units, two decimals at most', () => {
    assert.equal(amount(11_672_352n, 2), '116,723.52');
    assert.equal(amount(22_352_000_000n, 8), '223.52');
    assert.equal(amount(0n, 6), '0');
});

void test('ago rounds down to minutes, hours or days', () => {
    assert.equal(ago(59), '0 min ago');
    assert.equal(ago(14 * 60), '14 min ago');
    assert.equal(ago(19 * 3600), '19 h ago');
    assert.equal(ago(3 * 86_400), '3 d ago');
});

void test('clock is the UTC time of day', () => {
    assert.equal(clock(0), '00:00:00');
    assert.equal(clock(1_791_572_388), '18:59:48');
});
