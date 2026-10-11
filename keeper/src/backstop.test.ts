import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { address, type TransactionError } from '@solana/kit';
import { getBytes } from 'ethers';
import {
    assertHealthyInstruction,
    BACKSTOP_ERROR_MESSAGE,
    BackstopError,
    backstopErrorName,
    checkpointInstruction,
    customErrorOf,
    decodeGuard,
    encodeCreateGuard,
    guardStatus,
    transactionErrorText,
    unlatchInstruction,
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

test('encodes checkpoint, unlatch and assert_healthy exactly as the Rust program does', () => {
    const anyAddress = address('5xS32i7XNRk7JCjYR7RgfHVxdLepVSnnJ1gdHkmfD8W1');
    const accounts = { guard: anyAddress, mint: anyAddress, admin: anyAddress };
    assert.equal(
        hex(new Uint8Array(checkpointInstruction(accounts).data ?? [])),
        fixture('checkpoint')
    );
    assert.equal(
        hex(new Uint8Array(unlatchInstruction(accounts).data ?? [])),
        fixture('unlatch')
    );
    assert.equal(
        hex(new Uint8Array(assertHealthyInstruction(accounts).data ?? [])),
        fixture('assert-healthy')
    );
});

test('names Backstop error codes', () => {
    assert.equal(backstopErrorName(6010), 'Tripped');
    assert.equal(backstopErrorName(BackstopError.Stale), 'Stale');
    assert.equal(backstopErrorName(3012), undefined);
    assert.equal(
        BACKSTOP_ERROR_MESSAGE[BackstopError.Tripped],
        'Tripped: supply exceeded proven backing'
    );
});

test('reads the custom error of a failed transaction, bigints included', () => {
    // @solana/kit types them as numbers but returns them as bigints.
    const asError = (value: unknown) => value as TransactionError;
    const err = asError({ InstructionError: [0n, { Custom: 6010n }] });
    assert.equal(customErrorOf(err), 6010);
    assert.equal(
        transactionErrorText(err),
        '{"InstructionError":[0,{"Custom":6010}]}'
    );
    assert.equal(customErrorOf('AccountNotFound'), undefined);
    assert.equal(
        customErrorOf(
            asError({ InstructionError: [0n, 'InvalidAccountData'] })
        ),
        undefined
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
    assert.deepEqual(guard.checkpoints, [
        { time: 1_893_455_700n, supply: 116_700_000_000_000n },
    ]);
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

test('reads the checkpoint ring oldest first once it has wrapped', () => {
    // The fixture with 70 checkpoints written: the ring holds the last 64,
    // and the oldest of them (the 7th written) sits at slot 70 % 64 = 6.
    const data = getBytes('0x' + fixture('guard-account-sample')).slice();
    const view = new DataView(data.buffer);
    const t0 = 1_893_000_000n;
    for (let n = 0; n < 70; n++) {
        const at = 283 + 16 * (n % 64);
        view.setBigInt64(at, t0 + 120n * BigInt(n), true);
        view.setBigUint64(at + 8, 1_000n + BigInt(n), true);
    }
    view.setBigUint64(1307, 70n, true);

    const { checkpoints, checkpointCount } = decodeGuard(data);
    assert.equal(checkpointCount, 70n);
    assert.equal(checkpoints.length, 64);
    assert.deepEqual(checkpoints[0], {
        time: view.getBigInt64(283 + 16 * 6, true),
        supply: 1_006n,
    });
    assert.deepEqual(checkpoints[63], {
        time: t0 + 120n * 69n,
        supply: 1_069n,
    });
    checkpoints.slice(1).forEach((c, k) => {
        assert.ok(c.time > (checkpoints[k]?.time ?? 0n));
    });
});
