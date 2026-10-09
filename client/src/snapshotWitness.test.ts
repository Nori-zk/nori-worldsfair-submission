import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBytes } from 'ethers';
import {
    snapshotResultWitness,
    type SnapshotEvent,
} from './snapshotWitness.js';

interface VectorSnapshot {
    snapshotIndex: number;
    requestId: number;
    blockNumber: number;
    timestamp: number;
    resultsRoot: string;
    results: Array<{
        name: string;
        queryId: string;
        result: string;
        index: number;
        path: string[];
    }>;
}
interface Vectors {
    noriSnapshot: string;
    batch: { root: string };
    requests: Array<{
        requestId: number;
        index: number;
        value: string;
        leaf: string;
        path: string[];
    }>;
    snapshots: VectorSnapshot[];
}

const vectors: Vectors = JSON.parse(
    readFileSync(
        new URL(
            '../../test-vectors/nori-snapshot/kelp-replay-vectors.json',
            import.meta.url
        ),
        'utf8'
    )
);

function eventOf(snapshot: VectorSnapshot): SnapshotEvent {
    return {
        snapshotIndex: BigInt(snapshot.snapshotIndex),
        requestId: BigInt(snapshot.requestId),
        blockNumber: BigInt(snapshot.blockNumber),
        timestamp: BigInt(snapshot.timestamp),
        resultsRoot: snapshot.resultsRoot,
        queryIds: snapshot.results.map((r) => r.queryId),
        results: snapshot.results.map((r) => r.result),
    };
}

function requestWitnessOf(requestId: number) {
    const request = vectors.requests.find((r) => r.requestId === requestId);
    assert.ok(request);
    return {
        root: vectors.batch.root,
        index: request.index,
        leaf: request.leaf,
        path: request.path,
    };
}

const bytes = (words: Array<readonly [Uint8Array]>) =>
    words.map(([w]) => Buffer.from(w).toString('hex'));
const hexes = (words: string[]) =>
    words.map((w) => Buffer.from(getBytes(w)).toString('hex'));

test('rebuilds the drained snapshot witness from its event and batch path', () => {
    const drained = vectors.snapshots[1];
    assert.ok(drained);
    const balance = drained.results.find((r) => r.name === 'lockbox-balance');
    assert.ok(balance);
    const request = vectors.requests.find(
        (r) => r.requestId === drained.requestId
    );
    assert.ok(request);

    const witness = snapshotResultWitness(
        vectors.noriSnapshot,
        eventOf(drained),
        balance.queryId,
        requestWitnessOf(drained.requestId)
    );

    assert.deepEqual(bytes(witness.request.path), hexes(request.path));
    assert.equal(witness.request.index, BigInt(request.index));
    assert.equal(witness.request.value.collectionKeysCount, 2);
    assert.equal(
        Buffer.from(witness.request.value.value[0]).toString('hex'),
        Buffer.from(getBytes(request.value).reverse()).toString('hex')
    );
    assert.equal(witness.resultIndex, balance.index);
    assert.deepEqual(bytes(witness.resultPath), hexes(balance.path));
    assert.equal(
        Buffer.from(witness.result[0]).toString('hex'),
        Buffer.from(getBytes(balance.result)).toString('hex')
    );
});

test('refuses a batch path that belongs to another snapshot', () => {
    const [healthy, drained] = vectors.snapshots;
    assert.ok(healthy && drained);
    const queryId = drained.results[0]?.queryId ?? '';

    assert.throws(
        () =>
            snapshotResultWitness(
                vectors.noriSnapshot,
                eventOf(drained),
                queryId,
                requestWitnessOf(healthy.requestId)
            ),
        /not for this snapshot/
    );
    assert.throws(
        () =>
            snapshotResultWitness(
                vectors.noriSnapshot,
                eventOf(drained),
                '0x' + '00'.repeat(32),
                requestWitnessOf(drained.requestId)
            ),
        /not in this snapshot/
    );
});

test('encodes submit_read exactly as the Rust program does', async () => {
    const { encodeSubmitRead, ReadKind } = await import('./backstop.js');
    const drained = vectors.snapshots[1];
    assert.ok(drained);
    const balance = drained.results.find((r) => r.name === 'lockbox-balance');
    assert.ok(balance);
    const witness = snapshotResultWitness(
        vectors.noriSnapshot,
        eventOf(drained),
        balance.queryId,
        requestWitnessOf(drained.requestId)
    );
    const fixture = readFileSync(
        new URL(
            '../../test-vectors/backstop/submit-read-kelp-drained.hex',
            import.meta.url
        ),
        'utf8'
    ).trim();

    assert.equal(
        Buffer.from(encodeSubmitRead(ReadKind.Backing, witness)).toString(
            'hex'
        ),
        fixture
    );
});
