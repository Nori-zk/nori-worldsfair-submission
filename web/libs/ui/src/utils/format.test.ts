import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, amount, clock, dateTime, duration, minutes, solanaTransactionUrl } from './format.js';

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

void test('dateTime is the UTC date and time, as Prove balance shows it', () => {
    assert.equal(dateTime(1_791_572_388), 'Oct 9, 2026, 6:59:48 PM UTC');
});

void test('a duration reads in its largest whole unit', () => {
    assert.equal(duration(7_200), '2 h');
    assert.equal(duration(600), '10 min');
    assert.equal(duration(60), '1 min');
    assert.equal(duration(5_400), '90 min');
    assert.equal(duration(90), '90 s');
    assert.equal(duration(0), '0 s');
});

void test('minutes have one decimal', () => {
    assert.equal(minutes(1092), '18.2');
    assert.equal(minutes(0), '0.0');
});

void test('a Solana transaction links to the explorer on the build cluster', () => {
    assert.equal(
        solanaTransactionUrl('2Hz6'),
        `https://explorer.solana.com/tx/2Hz6?cluster=${NORI_WEB_ENV.solana.cluster}`,
    );
});
