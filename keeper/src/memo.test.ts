import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMO_PROGRAM,
    memoInstruction,
    parseSnapshotReadMemo,
    snapshotReadMemo,
    snapshotReadSignatures,
    snapshotReadTransactionsOf,
} from './memo.js';

const snapshotTxHash = '0x' + 'ab'.repeat(32);
const queryId = '0x' + '12'.repeat(32);
const memo = `nori snapshot ${snapshotTxHash} query ${queryId} backing`;

test('the memo names the snapshot, the query and the read, and parses back', () => {
    assert.equal(
        snapshotReadMemo({ snapshotTxHash, queryId, kind: 'backing' }),
        memo
    );
    for (const kind of ['backing', 'pause', 'example'] as const)
        assert.deepEqual(
            parseSnapshotReadMemo(
                snapshotReadMemo({
                    snapshotTxHash: '0x' + 'AB'.repeat(32),
                    queryId,
                    kind,
                })
            ),
            { snapshotTxHash, queryId, kind }
        );
});

test("parses the RPC's memo, which leads with its length in brackets", () => {
    assert.deepEqual(parseSnapshotReadMemo(`[${memo.length}] ${memo}`), {
        snapshotTxHash,
        queryId,
        kind: 'backing',
    });
});

test('anything else is no snapshot read', () => {
    for (const other of [
        null,
        undefined,
        '',
        'hello',
        `[5] hello`,
        memo.replace('backing', 'other'),
        memo.replace(snapshotTxHash, '0x1234'),
        `${memo}; [5] hello`,
    ])
        assert.equal(parseSnapshotReadMemo(other), undefined, String(other));
});

test('the memo instruction is SPL Memo v2 with the text and no signers', () => {
    const instruction = memoInstruction(memo);
    assert.equal(MEMO_PROGRAM, 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    assert.equal(instruction.programAddress, MEMO_PROGRAM);
    assert.equal(instruction.accounts, undefined);
    assert.equal(new TextDecoder().decode(instruction.data), memo);
});

test("a snapshot's transactions: successful, its own, newest first, each once, at most 8", () => {
    const older = '0x' + 'cd'.repeat(32);
    const read = (
        signature: string,
        slot: bigint,
        hash = snapshotTxHash,
        err: unknown = null
    ) => {
        const text = snapshotReadMemo({
            snapshotTxHash: hash,
            queryId,
            kind: 'pause',
        });
        return { signature, slot, err, memo: `[${text.length}] ${text}` };
    };
    // Two guards' signatures, each newest first; both name one transaction
    const transactions = [
        ...snapshotReadTransactionsOf([
            { signature: 'checkpoint', slot: 30n, err: null, memo: null },
            read('reverted', 28n, snapshotTxHash, {
                InstructionError: [0, { Custom: 6005 }],
            }),
            read('both-guards', 20n),
            read('older-snapshot', 10n, older),
        ]),
        ...snapshotReadTransactionsOf([
            read('guard-2', 25n),
            read('both-guards', 20n),
        ]),
    ];
    assert.deepEqual(
        snapshotReadSignatures(transactions, '0x' + 'AB'.repeat(32)),
        ['guard-2', 'both-guards']
    );
    assert.deepEqual(snapshotReadSignatures(transactions, older), [
        'older-snapshot',
    ]);
    assert.deepEqual(
        snapshotReadSignatures(transactions, '0x' + '00'.repeat(32)),
        []
    );
    const ten = snapshotReadTransactionsOf(
        Array.from({ length: 10 }, (_, i) => read(`read-${i}`, BigInt(i)))
    );
    assert.deepEqual(
        snapshotReadSignatures(ten, snapshotTxHash),
        [9, 8, 7, 6, 5, 4, 3, 2].map((i) => `read-${i}`)
    );
});
