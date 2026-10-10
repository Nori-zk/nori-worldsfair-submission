import { test } from 'node:test';
import assert from 'node:assert/strict';
// The shared library's plain helpers, by path: its index also loads components.
import { verifiedText, verifyFailedText } from '../../../../../libs/ui/src/utils/facts.js';
import { verdictSentence } from './verdict.js';

void test('a verify that matched reads as a sentence, in its green', () => {
    const word = `0x${'00'.repeat(31)}2a`;
    const verdict = verdictSentence(verifiedText(word, word, 2751n));
    assert.equal(verdict.text, 'Verified by nori-read-example on Solana (2,751 CU).');
    assert.equal(verdict.style, 'color: var(--nori-light-green)');
});

void test('a verify that did not match, or threw, could not verify', () => {
    const a = `0x${'00'.repeat(31)}2a`;
    const b = `0x${'00'.repeat(31)}2b`;
    assert.match(
        verdictSentence(verifiedText(a, b, 1n)).text,
        /^Could not verify: Solana verified /,
    );
    assert.deepEqual(verdictSentence(verifyFailedText(new Error('missing trie node abc'))), {
        text: "Could not verify: missing trie node abc (the Ethereum RPC may have pruned that block's state)",
        style: 'color: var(--nori-muted)',
    });
});
