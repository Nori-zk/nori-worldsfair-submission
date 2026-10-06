import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { address } from '@solana/kit';
import { getBytes } from 'ethers';
import {
    decodeGuard,
    encodeCreateGuard,
    guardStatus,
    type GuardConfig,
} from './backstop.js';

const fixture = (name: string) =>
    readFileSync(
        new URL(`../../test-vectors/backstop/${name}.hex`, import.meta.url),
        'utf8'
    ).trim();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// Mirrors the sample config in programs/backstop/tests/instruction_fixture.rs
const sampleConfig: GuardConfig = {
    noriProgram: address('5xS32i7XNRk7JCjYR7RgfHVxdLepVSnnJ1gdHkmfD8W1'),
    noriSnapshot: '0x' + '11'.repeat(20),
    backingQuery: '0x' + '22'.repeat(32),
    pauseQuery: '0x' + '33'.repeat(32),
    backingDecimals: 18,
    tolerance: 1_000_000_000n,
    windowSecs: 600,
    skewSecs: 60,
    checkpointIntervalSecs: 60,
    maxStalenessSecs: 7_200,
};

test('encodes create_guard exactly as the Rust program does', () => {
    assert.equal(
        hex(encodeCreateGuard(sampleConfig)),
        fixture('create-guard-sample')
    );
});

test('decodes a Guard account written by the Rust program', () => {
    const guard = decodeGuard(getBytes('0x' + fixture('guard-account-sample')));

    assert.deepEqual(guard.config, sampleConfig);
    assert.equal(guard.backing, 223_520_000_000n);
    assert.equal(guard.backingEthBlock, 12_345n);
    assert.equal(guard.backingEthTime, 1_893_456_600n);
    assert.equal(guard.paused, true);
    assert.equal(guard.tripped, true);
    assert.equal(guard.tripDeficit, 116_475_480_000_000n);
    assert.equal(guard.checkpointCount, 1n);
    assert.equal(guardStatus(guard, 0n, 1_893_456_700n), 'TRIPPED');
    assert.equal(
        guardStatus({ ...guard, tripped: false }, 0n, 1_893_456_700n),
        'PAUSED_AT_SOURCE'
    );
    assert.equal(
        guardStatus(
            { ...guard, tripped: false, paused: false },
            300_000_000_000n,
            1_893_456_700n
        ),
        'WARN'
    );
});
