import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    REVEAL_STEP,
    allShown,
    moreShown,
    olderLinkText,
    showOlderText,
    visibleOf,
} from './reveal.js';

const snapshots = Array.from({ length: 25 }, (_, i) => 25 - i);

void test('the list shows the newest 8, then 8 more per click, up to every snapshot', () => {
    assert.equal(REVEAL_STEP, 8);
    const counts: number[] = [];
    for (let shown = REVEAL_STEP; ; shown = moreShown(shown)) {
        counts.push(visibleOf(snapshots, shown).length);
        if (showOlderText(snapshots.length, shown) === '') break;
    }
    assert.deepEqual(counts, [8, 16, 24, 25]);
    assert.deepEqual(visibleOf(snapshots, 8), [25, 24, 23, 22, 21, 20, 19, 18]);
    assert.equal(visibleOf(snapshots, 25).length, 25);
    assert.equal(visibleOf(snapshots, 40).length, 25);
    assert.deepEqual(visibleOf(snapshots, 0), []);
});

void test('revealing more only appends to what shows', () => {
    const before = visibleOf(snapshots, 8);
    const after = visibleOf(snapshots, moreShown(8));
    assert.deepEqual(after.slice(0, before.length), before);
});

void test('a read with fewer snapshots than shown shows them all', () => {
    assert.equal(visibleOf([1, 2, 3, 4, 5], 8).length, 5);
    assert.equal(visibleOf(snapshots, moreShown(24)).length, 25);
});

void test('the button shows while some are hidden, the explorer line once all show', () => {
    assert.equal(showOlderText(25, 8), '[ Show older ]');
    assert.equal(showOlderText(25, 24), '[ Show older ]');
    assert.equal(showOlderText(25, 25), '');
    assert.equal(showOlderText(5, 8), '');
    assert.equal(showOlderText(0, 8), '');
    assert.equal(allShown(25, 24), false);
    assert.equal(allShown(25, 25), true);
    assert.equal(allShown(5, 8), true);
    assert.equal(allShown(0, 8), false);
});

void test('the explorer line names the chain', () => {
    assert.equal(olderLinkText(11155111), 'NoriSnapshot on Sepolia ↗');
    assert.equal(olderLinkText(1), 'NoriSnapshot on Ethereum ↗');
    assert.equal(olderLinkText(5), 'NoriSnapshot on chain 5 ↗');
});
