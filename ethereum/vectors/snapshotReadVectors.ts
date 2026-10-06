import path from 'path';
import { fileURLToPath } from 'url';
import type { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';
import type { ContractTransactionResponse } from 'ethers';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import { request_witness, type RequestLeaf } from '@nori-zk/nori-hash-utils';
import {
    NoriSnapshot__factory,
    ReplayToken__factory,
    SnapshotTargetMock__factory,
    type NoriSnapshot,
} from '../types/ethers-contracts/index.js';
import {
    MAINNET_SNAPSHOT_QUERIES,
    encodeQueryData,
    queryIdOf,
} from '../queries.js';
import { resultWitnessOf } from '../snapshotProof.js';

const VECTORS_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'test-vectors',
    'nori-snapshot'
);
/** Reproducible vectors, checked by test/SnapshotReadVectors.ts. */
export const LOCAL_VECTORS_FILE = path.join(
    VECTORS_DIR,
    'snapshot-read-vectors.json'
);
/** Kelp replay vectors, checked by test/SnapshotReadVectors.ts. */
export const KELP_REPLAY_VECTORS_FILE = path.join(
    VECTORS_DIR,
    'kelp-replay-vectors.json'
);
/** Vectors from a mainnet fork, regenerated on demand. */
export const MAINNET_VECTORS_FILE = path.join(
    VECTORS_DIR,
    'snapshot-read-mainnet-vectors.json'
);

/**
 * Test vectors for verifying NoriSnapshot results on Solana (nori-read):
 * one proof queue batch rebuilt from contract state exactly as a witness
 * builder does, with every request's witness and every snapshot result's
 * witness. Hashing comes from nori-hash-utils, the SP1 guest's own code.
 */
export interface SnapshotReadVectors {
    description: string;
    chainId: number;
    noriSnapshot: string;
    proofQueue: string;
    /** The batch as `update` commits it in a `ProofRequestRootEntry`. */
    batch: {
        root: string;
        inputQueueCursor: number;
        outputQueueCursor: number;
        outputBlockNumber: number;
    };
    /** Every request in the batch, in queue order, with its witness. */
    requests: Array<{
        requestId: number;
        /** Index in the batch: `requestId - inputQueueCursor`. */
        index: number;
        target: string;
        collectionKeysCount: number;
        /** Both keys, unused ones zero. */
        collectionKeys: [string, string];
        /** The 32-byte storage word at `outputBlockNumber`, big-endian. */
        value: string;
        leaf: string;
        path: string[];
    }>;
    /** Every snapshot in the batch, with a witness for each result. */
    snapshots: Array<{
        snapshotIndex: number;
        requestId: number;
        blockNumber: number;
        timestamp: number;
        resultsRoot: string;
        results: Array<{
            name: string;
            target: string;
            data: string;
            queryId: string;
            result: string;
            index: number;
            path: string[];
        }>;
    }>;
}

interface NamedQuery {
    name: string;
    target: string;
    data: string;
}

/** Sends a transaction in the next block at a fixed time, so vectors are reproducible. */
type Step = (
    send: () => Promise<ContractTransactionResponse>
) => Promise<ContractTransactionResponse>;

async function mined(tx: ContractTransactionResponse) {
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`No receipt for ${tx.hash}`);
    return receipt;
}

/**
 * Reads the batch `[inputQueueCursor, head)` the way a witness builder does:
 * each queue record and the word at its slot key at the latest block (the
 * block the batch proves), then builds every request's witness.
 */
async function collectVectors(
    ethers: HardhatEthers,
    description: string,
    snapshot: NoriSnapshot,
    queueAddress: string,
    inputQueueCursor: bigint,
    snapshotTxs: Array<{
        tx: ContractTransactionResponse;
        queries: NamedQuery[];
    }>
): Promise<SnapshotReadVectors> {
    const queue = NoriProofRequestQueue__factory.connect(
        queueAddress,
        ethers.provider
    );
    const outputBlockNumber = await ethers.provider.getBlockNumber();
    const outputQueueCursor = await queue.head({ blockTag: outputBlockNumber });

    const records = [];
    for (let id = inputQueueCursor; id < outputQueueCursor; id++) {
        const request = await queue.requests(id, {
            blockTag: outputBlockNumber,
        });
        const count = Number(request.collectionKeysCount);
        const value = await ethers.provider.getStorage(
            request.target,
            request.slotKey,
            outputBlockNumber
        );
        records.push({
            requestId: Number(id),
            target: request.target,
            collectionKeysCount: count,
            collectionKeys: [
                request.collectionKeys[0],
                request.collectionKeys[1],
            ] as [string, string],
            value: ethers.zeroPadValue(value, 32),
        });
    }
    const leaves: RequestLeaf[] = records.map((record) => ({
        target: record.target,
        collectionKeysCount: record.collectionKeysCount,
        collectionKeys: record.collectionKeys.slice(
            0,
            record.collectionKeysCount
        ),
        value: record.value,
    }));
    const requests = records.map((record, index) => {
        const witness = request_witness({ leaves, index });
        return {
            ...record,
            index,
            leaf: witness.leaf,
            path: witness.path,
            root: witness.root,
        };
    });

    const snapshots = [];
    for (const { tx, queries } of snapshotTxs) {
        const receipt = await mined(tx);
        const event = receipt.logs
            .map((log) => snapshot.interface.parseLog(log))
            .find((parsed) => parsed?.name === 'Snapshot');
        if (!event) throw new Error(`No Snapshot event in ${tx.hash}`);
        const queryIds: string[] = [...event.args.queryIds];
        const results: string[] = [...event.args.results];
        snapshots.push({
            snapshotIndex: Number(event.args.snapshotIndex),
            requestId: Number(event.args.requestId),
            blockNumber: Number(event.args.blockNumber),
            timestamp: Number(event.args.timestamp),
            resultsRoot: event.args.resultsRoot as string,
            results: queries.map((query, index) => ({
                ...query,
                queryId: queryIds[index],
                result: results[index],
                index,
                path: resultWitnessOf(queryIds, results, index).path,
            })),
        });
    }

    return {
        description,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        noriSnapshot: await snapshot.getAddress(),
        proofQueue: queueAddress,
        batch: {
            root: requests[0].root,
            inputQueueCursor: Number(inputQueueCursor),
            outputQueueCursor: Number(outputQueueCursor),
            outputBlockNumber,
        },
        requests: requests.map(({ root: _root, ...request }) => request),
        snapshots: snapshots.filter(
            (s) =>
                s.requestId >= inputQueueCursor &&
                s.requestId < outputQueueCursor
        ),
    };
}

/**
 * Reproducible vectors on the `vectors` network (fixed start date and block
 * times). The batch `[1, 5)` holds a request from an account that is not
 * NoriSnapshot, a snapshot of two queries, a snapshot of five, and an
 * attacker's snapshot of the identity precompile (0x04) whose result is
 * `sha256(queryId(value()) ++ 2^200)`: the unprefixed node over a forged
 * value() result, which a reader must not accept one level up. Request 0, a
 * snapshot, falls in an earlier batch.
 */
export async function buildLocalSnapshotReadVectors(
    ethers: HardhatEthers
): Promise<SnapshotReadVectors> {
    let time = Date.parse('2026-10-06T12:00:00Z') / 1000;
    const step: Step = async (send) => {
        await ethers.provider.send('evm_setNextBlockTimestamp', [time]);
        time += 12;
        const tx = await send();
        await mined(tx);
        return tx;
    };

    const [operator, keeper, other] = await ethers.getSigners();
    let queueAddress = '';
    await step(async () => {
        const queue = await new NoriProofRequestQueue__factory(operator).deploy(
            operator.address,
            operator.address,
            0n
        );
        queueAddress = await queue.getAddress();
        return queue.deploymentTransaction() as ContractTransactionResponse;
    });
    let snapshot: NoriSnapshot | undefined;
    await step(async () => {
        snapshot = await new NoriSnapshot__factory(operator).deploy(
            queueAddress
        );
        return snapshot.deploymentTransaction() as ContractTransactionResponse;
    });
    let targetAddress = '';
    let target:
        Awaited<ReturnType<SnapshotTargetMock__factory['deploy']>> | undefined;
    await step(async () => {
        target = await new SnapshotTargetMock__factory(operator).deploy();
        targetAddress = await target.getAddress();
        return target.deploymentTransaction() as ContractTransactionResponse;
    });
    if (!snapshot || !target) throw new Error('Deployment failed');
    const noriSnapshot = snapshot;
    const mock = target;
    const queue = NoriProofRequestQueue__factory.connect(
        queueAddress,
        operator
    );

    const query = (
        name: string,
        signature: string,
        suffix = ''
    ): NamedQuery => ({
        name,
        target: targetAddress,
        data: encodeQueryData({ signature, args: [] }) + suffix,
    });
    const value = query('value', 'value()');
    const isPaused = query('isPaused', 'isPaused()');
    const twoQueries = [value, isPaused];
    const fiveQueries = [
        value,
        isPaused,
        query('value-00', 'value()', '00'),
        query('value-01', 'value()', '01'),
        query('value-02', 'value()', '02'),
    ];
    const snapshotOf = (queries: NamedQuery[]) =>
        noriSnapshot.connect(keeper).snapshot(
            queries.map(({ target: queryTarget, data }) => ({
                target: queryTarget,
                data,
            }))
        );

    await step(() => mock.setValue(42n));
    // Request 0: a snapshot in an earlier batch
    await step(() => snapshotOf([value]));
    // Request 1: an account proving its own (empty) storage, not a snapshot
    await step(() => queue.connect(other).requestProof(ethers.ZeroHash, []));
    // Request 2: value() = 42, isPaused() = true
    const twoTx = await step(() => snapshotOf(twoQueries));
    await step(() => mock.setValue(7n));
    // Request 3: value() = 7, isPaused() = true
    const fiveTx = await step(() => snapshotOf(fiveQueries));
    // Request 4: the identity precompile echoes the attacker's chosen word
    const forgery: NamedQuery = {
        name: 'identity-forgery',
        target: '0x0000000000000000000000000000000000000004',
        data: ethers.sha256(
            ethers.concat([
                queryIdOf(value.target, value.data),
                ethers.toBeHex(1n << 200n, 32),
            ])
        ),
    };
    const forgeryTx = await step(() => snapshotOf([forgery]));

    return collectVectors(
        ethers,
        'NoriSnapshot read vectors: batch [1, 5) on a local network with fixed block times',
        noriSnapshot,
        queueAddress,
        1n,
        [
            { tx: twoTx, queries: twoQueries },
            { tx: fiveTx, queries: fiveQueries },
            { tx: forgeryTx, queries: [forgery] },
        ]
    );
}

/**
 * Vectors from a mainnet fork: one snapshot of every mainnet query
 * (queries.ts), alone in its batch. Not reproducible; regenerate on demand.
 */
export async function buildMainnetSnapshotReadVectors(
    ethers: HardhatEthers
): Promise<SnapshotReadVectors> {
    const [operator, keeper] = await ethers.getSigners();
    const queue = await new NoriProofRequestQueue__factory(operator).deploy(
        operator.address,
        operator.address,
        0n
    );
    await queue.waitForDeployment();
    const snapshot = await new NoriSnapshot__factory(operator).deploy(
        await queue.getAddress()
    );
    await snapshot.waitForDeployment();

    const queries = MAINNET_SNAPSHOT_QUERIES.map((query) => ({
        name: query.name,
        target: query.target,
        data: encodeQueryData(query),
    }));
    const tx = await snapshot
        .connect(keeper)
        .snapshot(queries.map(({ target, data }) => ({ target, data })));
    await mined(tx);

    const block = await ethers.provider.getBlock('latest');
    return collectVectors(
        ethers,
        `NoriSnapshot read vectors: every mainnet query, on a mainnet fork at block ${block?.number}`,
        snapshot,
        await queue.getAddress(),
        0n,
        [{ tx, queries }]
    );
}

const REPLAY_START = Date.parse('2030-01-01T00:00:00Z') / 1000;

/**
 * The KelpDAO drain (18 Apr 2026) replayed with its real lockbox numbers, at
 * fixed times from 2030-01-01T00:00:00Z (after any test run, so a validator
 * can time-travel to them). One batch `[0, 4)` of four snapshots, each of
 * `[lockbox balance, lockbox paused]`:
 *
 *   +60s    116,723.52 rsETH
 *   +600s   223.52 (drained)
 *   +1800s  40,300 (attacker refill)
 *   +3000s  40,300, lockbox paused
 */
export async function buildKelpReplayVectors(
    ethers: HardhatEthers
): Promise<SnapshotReadVectors> {
    const at = async (
        offset: number,
        send: () => Promise<ContractTransactionResponse>
    ) => {
        await ethers.provider.send('evm_setNextBlockTimestamp', [
            REPLAY_START + offset,
        ]);
        const tx = await send();
        await mined(tx);
        return tx;
    };
    const deployed = async <T extends { deploymentTransaction(): unknown }>(
        offset: number,
        deploy: () => Promise<T>
    ) => {
        let contract: T | undefined;
        await at(offset, async () => {
            contract = await deploy();
            return contract.deploymentTransaction() as ContractTransactionResponse;
        });
        if (!contract) throw new Error('Deployment failed');
        return contract;
    };

    const [operator, keeper] = await ethers.getSigners();
    const queue = await deployed(-50, () =>
        new NoriProofRequestQueue__factory(operator).deploy(
            operator.address,
            operator.address,
            0n
        )
    );
    const queueAddress = await queue.getAddress();
    const snapshot = await deployed(-40, () =>
        new NoriSnapshot__factory(operator).deploy(queueAddress)
    );
    const token = await deployed(-30, () =>
        new ReplayToken__factory(operator).deploy()
    );
    const lockbox = await deployed(-20, () =>
        new SnapshotTargetMock__factory(operator).deploy()
    );
    const lockboxAddress = await lockbox.getAddress();

    const queries: NamedQuery[] = [
        {
            name: 'lockbox-balance',
            target: await token.getAddress(),
            data: encodeQueryData({
                signature: 'balanceOf(address)',
                args: [lockboxAddress],
            }),
        },
        {
            name: 'lockbox-paused',
            target: lockboxAddress,
            data: encodeQueryData({ signature: 'isPaused()', args: [] }),
        },
    ];
    const snapshotAt = (offset: number) =>
        at(offset, () =>
            snapshot
                .connect(keeper)
                .snapshot(queries.map(({ target, data }) => ({ target, data })))
        );
    const rsEth = (amount: string) => ethers.parseEther(amount);

    await at(-10, () => token.setBalance(lockboxAddress, rsEth('116723.52')));
    const healthy = await snapshotAt(60);
    await at(590, () => token.setBalance(lockboxAddress, rsEth('223.52')));
    const drained = await snapshotAt(600);
    await at(1790, () => token.setBalance(lockboxAddress, rsEth('40300')));
    const refilled = await snapshotAt(1800);
    await at(2990, () => lockbox.setValue(1n));
    const paused = await snapshotAt(3000);

    return collectVectors(
        ethers,
        'Kelp replay: lockbox 116,723.52 -> 223.52 -> 40,300 rsETH, then paused; times from 2030-01-01',
        snapshot,
        queueAddress,
        0n,
        [healthy, drained, refilled, paused].map((tx) => ({ tx, queries }))
    );
}
