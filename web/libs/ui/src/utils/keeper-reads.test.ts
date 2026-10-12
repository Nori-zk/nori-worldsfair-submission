import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type ProofQueueBatchSummary } from '@nori-zk/nori-bridge-solana-sdk';
import {
    batchAddressesOf,
    keeperReadsOf,
    lowestBatchOf,
    type ReadSignature,
} from './keeper-reads.js';

const DEMO = ['0xab', '0xcd'];
const SHADOW = ['0xaa', '0xcc'];
const ok = (signature: string): ReadSignature => ({ signature, err: null });
const failed = (signature: string): ReadSignature => ({
    signature,
    err: { InstructionError: [0, { Custom: 6005 }] },
});

void test('a read is a successful transaction on both a guard and a batch, newest first', () => {
    const guards = [
        // Checkpoints touch the guard only.
        { queryIds: DEMO, signatures: [ok('checkpoint'), ok('demo-pause'), ok('demo-backing')] },
        { queryIds: SHADOW, signatures: [ok('shadow-backing'), failed('shadow-reverted')] },
    ];
    const batches = [
        {
            batch: 'batch-2',
            signatures: [
                ok('shadow-backing'),
                failed('shadow-reverted'),
                // nori-read-example's verify touches the batch only.
                ok('verify'),
                ok('demo-pause'),
                ok('demo-backing'),
                ok('creating-update'),
            ],
        },
        { batch: 'batch-1', signatures: [ok('creating-update-1')] },
    ];
    assert.deepEqual(keeperReadsOf(guards, batches), [
        { batch: 'batch-2', queryIds: SHADOW, signature: 'shadow-backing' },
        { batch: 'batch-2', queryIds: DEMO, signature: 'demo-pause' },
        { batch: 'batch-2', queryIds: DEMO, signature: 'demo-backing' },
    ]);
    assert.deepEqual(keeperReadsOf([], batches), []);
    assert.deepEqual(keeperReadsOf(guards, []), []);
});

const batch = (index: bigint, input: bigint, output: bigint): ProofQueueBatchSummary => ({
    proofQueueBatchIndex: index,
    proofQueueBatchAddress: `batch-${index.toString()}`,
    root: '0x00',
    inputQueueCursor: input,
    outputQueueCursor: output,
    outputBlockNumber: 0n,
    previousOutputBlockNumber: -1n,
});

void test("the snapshots' batches, each once, without the requests no batch known holds", () => {
    const batches = [batch(229n, 250n, 251n), batch(228n, 248n, 250n), batch(227n, 245n, 248n)];
    // 251 is not proven yet, 248 and 249 share batch 228, 200 is older than the batches known.
    assert.deepEqual(batchAddressesOf([251n, 250n, 249n, 248n, 246n, 200n], batches), [
        'batch-229',
        'batch-228',
        'batch-227',
    ]);
    assert.deepEqual(batchAddressesOf([], batches), []);
});

void test('the lowest batch that can hold a request, as on devnet: 230 batches, cursor 251', () => {
    // Batch 229 holds 250, batch 227 holds 245..248: at most one batch per request after it.
    assert.equal(lowestBatchOf(250n, 251n, 230n), 229n);
    assert.equal(lowestBatchOf(245n, 251n, 230n), 224n);
    assert.equal(lowestBatchOf(3n, 251n, 230n), 0n);
    // Not proven yet: no committed batch holds it, so it reads from the next one.
    assert.equal(lowestBatchOf(260n, 251n, 230n), 230n);
});
