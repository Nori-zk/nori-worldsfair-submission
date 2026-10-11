import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBytes } from 'ethers';
import {
    decodeSnapshotResultRead,
    snapshotResultReadFromLogs,
} from './noriRead.js';

// Written by programs/nori-read-example/tests/instruction_fixture.rs
const event = getBytes(
    '0x' +
        readFileSync(
            new URL(
                '../../test-vectors/nori-read-example/snapshot-result-read-event.hex',
                import.meta.url
            ),
            'utf8'
        ).trim()
);

const expected = {
    queryId: '0x' + '11'.repeat(32),
    result: '0x' + '22'.repeat(32),
    snapshotIndex: 7n,
    requestId: 1_234n,
    ethBlockNumber: 9_385_000n,
    ethTimestamp: 1_791_449_064n,
    provenBlockNumber: 9_385_064n,
};

test('decodes the SnapshotResultRead event the Rust program emits', () => {
    assert.deepEqual(decodeSnapshotResultRead(event), expected);
});

test('finds the event among a simulation log', () => {
    const logs = [
        'Program 5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7 invoke [1]',
        'Program log: Instruction: ReadSnapshotResult',
        `Program data: ${Buffer.from([1, 2, 3]).toString('base64')}`,
        `Program data: ${Buffer.from(event).toString('base64')}`,
        'Program 5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7 success',
    ];
    assert.deepEqual(snapshotResultReadFromLogs(logs), expected);
    assert.equal(snapshotResultReadFromLogs(logs.slice(0, 3)), undefined);
});

test('ignores other events', () => {
    const other = new Uint8Array(event);
    other[0] = (other[0] ?? 0) ^ 0xff;
    assert.equal(decodeSnapshotResultRead(other), undefined);
    assert.equal(decodeSnapshotResultRead(event.subarray(0, 100)), undefined);
});
