import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    type EnqueuedProofRequest,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ethTimeOf, latencyMinutes, rowsOf, summaryOf } from './latency.js';

const timeKey = (block: bigint, secs: bigint): string =>
    `0x${((block << 64n) | secs).toString(16).padStart(64, '0')}`;

const batch = (index: bigint, from: bigint, to: bigint): ProofQueueBatchSummary => ({
    proofQueueBatchIndex: index,
    proofQueueBatchAddress: `Batch${index.toString()}`,
    root: '0x00',
    inputQueueCursor: from,
    outputQueueCursor: to,
    outputBlockNumber: 0n,
    previousOutputBlockNumber: -1n,
});

const request = (requestId: bigint, keys: string[]): EnqueuedProofRequest => ({
    requestId,
    target: '0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340',
    slotKey: '0x00',
    blockNumber: 11_879_000,
    transactionHash: `0x${requestId.toString(16).padStart(64, '0')}`,
    collectionKeys: keys,
});

// 18:46:12 and 18:59:48 UTC on 9 Oct 2026.
const T95 = 1_791_571_572n;
const T96 = 1_791_572_388n;
const batches = [batch(86n, 96n, 97n), batch(85n, 94n, 96n)];
const requests = [
    request(95n, ['0x5f', timeKey(11_879_234n, T95)]),
    request(96n, ['0x60', timeKey(11_879_302n, T96)]),
    request(94n, ['0x5e']),
    request(97n, ['0x61', timeKey(11_879_400n, T96 + 600n)]),
];

void test('a time key splits into its block and timestamp; anything else is skipped', () => {
    assert.equal(ethTimeOf(timeKey(11_879_302n, T96)), Number(T96));
    assert.equal(ethTimeOf(undefined), undefined);
    assert.equal(ethTimeOf('0x0'), undefined);
    assert.equal(ethTimeOf('not hex'), undefined);
    assert.equal(ethTimeOf(`0x1${'0'.repeat(32)}`), undefined);
});

void test('before the landings are read, each read shows … with an unknown bar', () => {
    const rows = rowsOf(batches, requests, undefined);
    assert.deepEqual(
        rows.map(({ request: r, batch: b, ethTime, landed, minutes, bar }) => [
            r,
            b,
            ethTime,
            landed,
            minutes,
            bar,
        ]),
        [
            ['#96', '#86', '18:59:48', '…', '', '··········'],
            ['#95', '#85', '18:46:12', '…', '', '··········'],
        ],
    );
});

void test('each read runs from its Ethereum time to its batch landing, newest first', () => {
    const landings = new Map([
        [86n, { atSecs: Number(T96) + 1092, signature: 'sig86' }],
        [85n, { atSecs: Number(T95) + 1116, signature: 'sig85' }],
    ]);
    const [newest, older] = rowsOf(batches, requests, landings);
    assert.deepEqual(newest, {
        key: '96',
        request: '#96',
        requestUrl: `https://sepolia.etherscan.io/tx/0x${'0'.repeat(62)}60`,
        ethTime: '18:59:48',
        batch: '#86',
        batchUrl: `https://explorer.solana.com/address/Batch86?cluster=${NORI_WEB_ENV.solana.cluster}`,
        landed: '19:18:00 ↗',
        landedUrl: `https://explorer.solana.com/tx/sig86?cluster=${NORI_WEB_ENV.solana.cluster}`,
        minutes: '18.2',
        bar: '▓▓▓▓▓▓▓▓▓▓',
    });
    assert.equal(older?.minutes, '18.6');
    assert.equal(older?.bar, '▓▓▓▓▓▓▓▓▓▓');
});

void test('a batch without a landing shows —', () => {
    const [newest] = rowsOf(batches, requests, new Map());
    assert.equal(newest?.landed, '—');
    assert.equal(newest?.minutes, '');
    assert.equal(newest?.bar, '');
});

void test('the summary picks median and spread as the soak report does', () => {
    assert.equal(summaryOf([]), '');
    assert.equal(summaryOf([18.2]), '1 read · median 18.2 min · p90 18.2 · min 18.2 · max 18.2');
    // Ten reads, out of order: median is sorted[5], p90 sorted[9].
    assert.equal(
        summaryOf([22.4, 15.2, 18.1, 16, 17, 19, 20.7, 18.5, 17.5, 16.5]),
        '10 reads · median 18.1 min · p90 22.4 · min 15.2 · max 22.4',
    );
});

void test('only reads whose batch landed count toward the summary', () => {
    const landings = new Map([[86n, { atSecs: Number(T96) + 1092, signature: 'sig86' }]]);
    assert.deepEqual(latencyMinutes(batches, requests, landings), [18.2]);
});
