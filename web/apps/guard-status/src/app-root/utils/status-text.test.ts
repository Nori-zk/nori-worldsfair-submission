import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type TransactionError } from '@solana/kit';
import {
    checkFailed,
    coverageText,
    depositSentence,
    lenderSentence,
    settingsSentence,
    statusSentence,
    statusWord,
    type StatusFacts,
} from './status-text.js';
import { mintName, ordered, shortAddress, splitCards, staleLineOf } from './guards.js';

const facts = (status: StatusFacts['status'], more: Partial<StatusFacts> = {}): StatusFacts => ({
    status,
    above: '',
    tolerance: '1',
    staleFor: '',
    tripDeficit: '',
    tripBlock: '',
    ...more,
});

void test('a status reads as one word, PAUSED for PAUSED_AT_SOURCE', () => {
    assert.equal(statusWord('PAUSED_AT_SOURCE'), 'PAUSED');
    assert.equal(statusWord('HEALTHY'), 'HEALTHY');
});

void test('each status is one plain sentence', () => {
    assert.deepEqual(statusSentence(facts('HEALTHY')), {
        text: 'Supply is within the proven backing.',
        link: '',
        end: '',
    });
    assert.equal(
        statusSentence(facts('WARN', { above: '1,234' })).text,
        'Supply is 1,234 above the proven backing (tolerance 1); the next proven read decides.',
    );
    assert.equal(
        statusSentence(facts('STALE', { staleFor: '23 h' })).text,
        'No proven backing for 23 h; the keeper is not running, so deposits are blocked.',
    );
    assert.equal(
        statusSentence(facts('STALE')).text,
        'No backing has been proven yet, so deposits are blocked.',
    );
    assert.equal(
        statusSentence(facts('PAUSED_AT_SOURCE')).text,
        'The Ethereum lockbox is paused; deposits are blocked.',
    );
});

void test('a trip names its deficit and links its block', () => {
    assert.deepEqual(
        statusSentence(facts('TRIPPED', { tripDeficit: '116,475.48', tripBlock: '11,880,162' })),
        {
            text: 'Supply exceeded the proven backing by 116,475.48 at block',
            link: '11,880,162',
            end: '; latched until the admin unlatches.',
        },
    );
    assert.equal(
        statusSentence(facts('TRIPPED', { tripDeficit: '5' })).text,
        'Supply exceeded the proven backing by 5; latched until the admin unlatches.',
    );
});

void test("a lender's deposit is allowed only when HEALTHY", () => {
    assert.equal(lenderSentence('HEALTHY'), "A lender's deposit would be allowed right now.");
    for (const status of ['WARN', 'STALE', 'PAUSED_AT_SOURCE', 'TRIPPED'] as const)
        assert.equal(lenderSentence(status), "A lender's deposit would be blocked right now.");
});

void test('coverage is the backing over the supply, rounded down, or the shortfall', () => {
    assert.equal(
        coverageText(116_723_520_000_000n, 116_700_000_000_000n, ''),
        'The backing covers 100.02% of the supply.',
    );
    assert.equal(coverageText(5n, 5n, ''), 'The backing covers 100.00% of the supply.');
    assert.equal(coverageText(4n, 5n, '1'), 'The backing is 1 short of the supply.');
    assert.equal(coverageText(1n, 0n, ''), 'Nothing is minted yet.');
});

void test('mints are named from the devnet deployment, else Mint', () => {
    assert.equal(mintName('Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi'), 'Demo mint');
    assert.equal(mintName('Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX'), 'Shadow mint');
    assert.equal(mintName('3Q9xNZr7iSkUZBEbLHkvap8Ece6aBSVskPCUPLWhtkTo'), 'Test mint B');
    assert.equal(mintName('JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9'), 'Mint');
    assert.equal(shortAddress('Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi'), 'Fhw5…cbhi');
});

void test('guards sort HEALTHY and WARN, then TRIPPED and PAUSED, then STALE, then by address', () => {
    const guards = [
        { address: 'd', status: 'STALE' },
        { address: 'c', status: 'TRIPPED' },
        { address: 'b', status: 'HEALTHY' },
        { address: 'e', status: 'PAUSED_AT_SOURCE' },
        { address: 'a', status: 'WARN' },
    ] as const;
    assert.deepEqual(
        ordered(guards).map((g) => g.address),
        ['a', 'b', 'c', 'e', 'd'],
    );
});

void test('stale guards fold into one line, singular for one', () => {
    assert.equal(staleLineOf(3, false), '▸ 3 guards with no recent backing');
    assert.equal(staleLineOf(1, false), '▸ 1 guard with no recent backing');
    assert.equal(staleLineOf(3, true), '▾ 3 guards with no recent backing');
    assert.equal(staleLineOf(0, false), '');
});

void test('stale cards are folded unless clicked open, linked, or all there is', () => {
    const cards = [
        { key: 'a', status: 'HEALTHY' },
        { key: 'b', status: 'TRIPPED' },
        { key: 'c', status: 'STALE' },
        { key: 'd', status: 'STALE' },
    ] as const;
    const keys = (list: readonly { key: string }[]): string[] => list.map((card) => card.key);
    const folded = splitCards(cards, undefined, null);
    assert.deepEqual(keys(folded.live), ['a', 'b']);
    assert.deepEqual(keys(folded.stale), []);
    assert.equal(folded.line, '▸ 2 guards with no recent backing');
    assert.equal(folded.expanded, false);
    const open = splitCards(cards, true, null);
    assert.deepEqual(keys(open.stale), ['c', 'd']);
    assert.equal(open.line, '▾ 2 guards with no recent backing');
    assert.equal(splitCards(cards, undefined, 'd').expanded, true);
    assert.equal(splitCards(cards, undefined, 'a').expanded, false);
    assert.equal(splitCards(cards, false, 'd').expanded, false);
    const allStale = splitCards(cards.slice(2), undefined, null);
    assert.deepEqual(keys(allStale.stale), ['c', 'd']);
    assert.equal(allStale.line, '▾ 2 guards with no recent backing');
    const none = splitCards(cards.slice(0, 2), undefined, null);
    assert.equal(none.line, '');
    assert.deepEqual(keys(none.live), ['a', 'b']);
});

/** @solana/kit types the numbers in `err` as numbers but returns bigints. */
const asError = (value: unknown): TransactionError => value as TransactionError;

void test('a deposit check reads allowed with its compute units, or blocked with the error', () => {
    assert.equal(
        depositSentence({ err: null, unitsConsumed: 3956n }),
        'Your deposit would be allowed (3,956 CU).',
    );
    assert.equal(
        depositSentence({
            err: asError({ InstructionError: [0n, { Custom: 6008n }] }),
            unitsConsumed: 3500n,
        }),
        'Your deposit would be blocked: Stale (6008), No recent proven backing.',
    );
    assert.equal(
        depositSentence({ err: asError({ InstructionError: [0, { Custom: 6010 }] }) }),
        'Your deposit would be blocked: Tripped (6010), Tripped: supply exceeded proven backing.',
    );
    assert.equal(
        depositSentence({ err: asError('AccountNotFound') }),
        'The check failed: "AccountNotFound".',
    );
    assert.equal(checkFailed(new Error('fetch failed')), 'The check failed: fetch failed.');
});

void test("a guard's settings read as sentences, the lockbox linked when known", () => {
    const settings = {
        query: '0xd5ce…e29d',
        lockbox: 'Demo lockbox',
        pauseQuery: '0x975b…e1c5',
        window: '10 min',
        tolerance: '1',
        staleness: '2 h',
        interval: '2 min',
        kept: 64,
    };
    const end =
        " in every snapshot. The guard trips when the lowest supply checkpointed within 10 min of the backing's Ethereum time exceeds backing + 1 tolerance; a backing older than 2 h is stale; supply is checkpointed every 2 min, the last 64 kept.";
    assert.deepEqual(settingsSentence(settings), {
        text: 'Backing is read from NoriSnapshot query 0xd5ce…e29d on the',
        link: 'Demo lockbox',
        end: `${end} The pause flag is query 0x975b…e1c5.`,
    });
    assert.deepEqual(settingsSentence({ ...settings, lockbox: '', pauseQuery: '' }), {
        text: `Backing is read from NoriSnapshot query 0xd5ce…e29d${end} It reads no pause flag.`,
        link: '',
        end: '',
    });
});
