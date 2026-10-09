import { test } from 'node:test';
import assert from 'node:assert/strict';
// The shared library's plain helper, by path: its index also loads components.
import { summaryOf } from '../../../../../libs/ui/src/utils/latency.js';
import { headlineOf } from './headline.js';

void test('no landed read, no headline', () => {
    assert.equal(headlineOf([]), undefined);
});

void test('the headline tells the median, the spread under it', () => {
    assert.deepEqual(headlineOf([20.7, 14.6, 16.9, 27.5, 16.2, 18.4]), {
        line: 'Reads land on Solana a median 18.4 min after their Ethereum block',
        spread: 'last 6 reads · p90 27.5 · fastest 14.6 · slowest 27.5',
    });
    assert.deepEqual(headlineOf([15]), {
        line: 'Reads land on Solana a median 15.0 min after their Ethereum block',
        spread: 'last 1 read · p90 15.0 · fastest 15.0 · slowest 15.0',
    });
});

void test('the headline picks the same numbers as the dashboard summary', () => {
    const latencies = Array.from({ length: 36 }, (_, i) => 14 + ((i * 7.3) % 13.5));
    const summary = summaryOf(latencies);
    const headline = headlineOf(latencies);
    const [, median, p90, min, max] =
        /median (\S+) min · p90 (\S+) · min (\S+) · max (\S+)/.exec(summary) ?? [];
    assert.equal(
        headline?.line,
        `Reads land on Solana a median ${median ?? ''} min after their Ethereum block`,
    );
    assert.equal(
        headline?.spread,
        `last 36 reads · p90 ${p90 ?? ''} · fastest ${min ?? ''} · slowest ${max ?? ''}`,
    );
});
