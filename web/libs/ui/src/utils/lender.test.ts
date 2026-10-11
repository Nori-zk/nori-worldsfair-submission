import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    address,
    getBase64Encoder,
    getCompiledTransactionMessageDecoder,
    getTransactionDecoder,
    type TransactionError,
} from '@solana/kit';
import { BACKSTOP_PROGRAM } from '@nori-zk/backstop-keeper/guard';
import { depositTransaction, simulationFailed, verdictText } from './lender.js';

const guard = address('E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD');
const mint = address('Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi');
const feePayer = address('EuRkxPWMLFrNqzNFZYsC7JQZhNewxLfLz3aQFVzts27Y');

// `sha256("global:assert_healthy")[..8]`, as test-vectors/backstop/assert-healthy.hex.
const ASSERT_HEALTHY = 'ed1c496e3a118b2f';

/** @solana/kit types the numbers in `err` as numbers but returns bigints. */
const asError = (value: unknown): TransactionError => value as TransactionError;

void test('the deposit transaction is one assert_healthy on the guard and mint, paid by the fee payer', () => {
    const wire = depositTransaction(guard, mint, feePayer);
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (message.version !== 0) throw new Error('A v0 transaction was expected');

    assert.equal(message.staticAccounts[0], feePayer);
    assert.equal(message.instructions.length, 1);
    const [instruction] = message.instructions;
    assert.equal(message.staticAccounts[instruction?.programAddressIndex ?? -1], BACKSTOP_PROGRAM);
    assert.deepEqual(
        instruction?.accountIndices?.map((i: number) => message.staticAccounts[i]),
        [guard, mint],
    );
    assert.equal(Buffer.from(instruction?.data ?? []).toString('hex'), ASSERT_HEALTHY);
});

void test('an allowed deposit is green with its compute units', () => {
    assert.deepEqual(verdictText({ err: null, unitsConsumed: 3912n }, 'red'), {
        text: 'deposit allowed · 3,912 CU',
        style: 'color: var(--nori-light-green)',
    });
});

void test('a blocked deposit names the Backstop error in the status colour', () => {
    const value = {
        err: asError({ InstructionError: [0n, { Custom: 6010n }] }),
        unitsConsumed: 3912n,
    };
    assert.deepEqual(verdictText(value, 'var(--nori-neon-red)'), {
        text: 'deposit blocked: Tripped (6010) · Tripped: supply exceeded proven backing · 3,912 CU',
        style: 'color: var(--nori-neon-red)',
    });
});

void test('a failure that is not a Backstop error is muted, with the error as text', () => {
    const value = { err: asError({ InstructionError: [0n, 'InvalidAccountData'] }) };
    assert.deepEqual(verdictText(value, 'red'), {
        text: 'simulation failed: {"InstructionError":[0,"InvalidAccountData"]}',
        style: 'color: var(--nori-muted)',
    });
    assert.deepEqual(simulationFailed(new Error('no response')), {
        text: 'simulation failed: no response',
        style: 'color: var(--nori-muted)',
    });
});
