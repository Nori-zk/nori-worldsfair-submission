/// <reference types="@nomicfoundation/hardhat-ethers" />
/// <reference types="@nomicfoundation/hardhat-ethers-chai-matchers" />
import { expect } from 'chai';
import hre from 'hardhat';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import {
    merkle_root_from_path,
    request_witness,
} from '@nori-zk/ethereum-solana-proof-queue-utils-glam';
import {
    NoriSnapshot__factory,
    SnapshotTargetMock__factory,
} from '../types/ethers-contracts/index.js';
import { encodeQueryData, queryIdOf } from '../queries.js';
import {
    MAX_QUERIES,
    SENTINEL,
    commitmentWordOf,
    parseTimeKey,
    resultLeafOf,
    resultWitnessOf,
    resultsRootOf,
    slotKeyOf,
    timeKeyOf,
    verifyResult,
} from '../snapshotProof.js';
const { ethers } = await hre.network.getOrCreate();

const PROOF_REQUEST_QUEUE_FEE = 200n * 10n ** 12n; // 0.0002 ETH

// Proof-critical storage layout: every enqueued slotKey must point at the
// word the snapshot wrote.
const COMMITMENTS_SLOT_INDEX = 0n;
const SNAPSHOT_COUNT_SLOT_INDEX = 1n;

const abi = ethers.AbiCoder.defaultAbiCoder();

/** Unwraps a value the test expects to exist (a mined receipt, a block). */
function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined)
        throw new Error('Expected a value');
    return value;
}

/** Location of `commitments[snapshotIndex]`, per Solidity's mapping rule. */
function commitmentSlot(snapshotIndex: bigint): string {
    return ethers.keccak256(
        abi.encode(
            ['uint256', 'uint256'],
            [snapshotIndex, COMMITMENTS_SLOT_INDEX]
        )
    );
}

async function readStorage(
    address: string,
    slot: string | bigint
): Promise<bigint> {
    return BigInt(await ethers.provider.getStorage(address, slot));
}

function word(value: bigint): string {
    return ethers.toBeHex(value, 32);
}

const VALUE_DATA = encodeQueryData({ signature: 'value()', args: [] });
const IS_PAUSED_DATA = encodeQueryData({ signature: 'isPaused()', args: [] });
const TWO_WORDS_DATA = encodeQueryData({ signature: 'twoWords()', args: [] });
const NOTHING_DATA = encodeQueryData({ signature: 'nothing()', args: [] });
const REVERTS_DATA = encodeQueryData({ signature: 'reverts()', args: [] });
const BUMP_DATA = encodeQueryData({ signature: 'bump()', args: [] });

/** `count` distinct queries reading the same word: value() ignores trailing calldata. */
function distinctValueQueries(target: string, count: number) {
    return Array.from({ length: count }, (_unused, k) => ({
        target,
        data: VALUE_DATA + k.toString(16).padStart(4, '0'),
    }));
}

describe('NoriSnapshot', () => {
    async function deploySnapshotFixture(fee = PROOF_REQUEST_QUEUE_FEE) {
        const [operator, keeper, other, treasury] = await ethers.getSigners();

        const queue = await new NoriProofRequestQueue__factory(operator).deploy(
            operator.address,
            treasury.address,
            fee
        );
        const snapshot = await new NoriSnapshot__factory(operator).deploy(
            await queue.getAddress()
        );
        const target = await new SnapshotTargetMock__factory(operator).deploy();
        await target.setValue(42n);
        const targetAddress = await target.getAddress();

        return {
            queue,
            snapshot,
            snapshotAddress: await snapshot.getAddress(),
            target,
            targetAddress,
            // value() = 42 and isPaused() = true
            twoQueries: [
                { target: targetAddress, data: VALUE_DATA },
                { target: targetAddress, data: IS_PAUSED_DATA },
            ],
            operator,
            keeper,
            other,
            treasury,
        };
    }

    // -----------------------------------------------------------
    // Deployment
    // -----------------------------------------------------------
    describe('Deployment', function () {
        it('Should pin the proof request queue', async function () {
            const { queue, snapshot } = await deploySnapshotFixture();

            expect(await snapshot.proofQueue()).to.equal(
                await queue.getAddress()
            );
        });

        it('Should revert if the queue is the zero address', async function () {
            const [deployer] = await ethers.getSigners();
            const factory = new NoriSnapshot__factory(deployer);

            await expect(
                factory.deploy(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(factory, 'ZeroAddress');
        });

        it('Should expose the proof-critical constants', async function () {
            const { snapshot } = await deploySnapshotFixture();

            expect(await snapshot.SENTINEL()).to.equal(SENTINEL);
            expect(await snapshot.COMMITMENTS_SLOT_INDEX()).to.equal(
                COMMITMENTS_SLOT_INDEX
            );
            expect(await snapshot.MAX_QUERIES()).to.equal(BigInt(MAX_QUERIES));
            expect(await snapshot.snapshotCount()).to.equal(0n);
        });
    });

    // -----------------------------------------------------------
    // Storage layout & key derivation
    // -----------------------------------------------------------
    describe('Storage layout', function () {
        it('Should store root | SENTINEL at commitments[index] in slot 0 and the count in slot 1', async function () {
            const { snapshot, snapshotAddress, twoQueries, keeper } =
                await deploySnapshotFixture();

            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });
            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });

            const root = resultsRootOf(
                twoQueries.map((q) => queryIdOf(q.target, q.data)),
                [word(42n), word(1n)]
            );
            // Indices start at 1, so commitments[0] is never written
            expect(await snapshot.commitments(0n)).to.equal(0n);
            for (const index of [1n, 2n]) {
                expect(
                    await readStorage(snapshotAddress, commitmentSlot(index))
                ).to.equal(commitmentWordOf(root));
                expect(await snapshot.commitments(index)).to.equal(
                    commitmentWordOf(root)
                );
            }
            expect(
                await readStorage(snapshotAddress, SNAPSHOT_COUNT_SLOT_INDEX)
            ).to.equal(2n);
        });

        it('Should derive slotKey and timeKey exactly as snapshotProof.ts does', async function () {
            const { snapshot } = await deploySnapshotFixture();

            for (const index of [0n, 1n, 255n, 2n ** 40n]) {
                expect(await snapshot.slotKeyOf(index)).to.equal(
                    slotKeyOf(index)
                );
                expect(slotKeyOf(index)).to.equal(commitmentSlot(index));
            }
            expect(
                await snapshot.timeKeyOf(23_456_789n, 1_791_000_000n)
            ).to.equal(timeKeyOf(23_456_789n, 1_791_000_000n));
            expect(
                parseTimeKey(timeKeyOf(23_456_789n, 1_791_000_000n))
            ).to.deep.equal({
                blockNumber: 23_456_789n,
                timestamp: 1_791_000_000n,
            });
            expect(() => parseTimeKey(0n)).to.throw('Not a snapshot time key');
            expect(() => parseTimeKey(1n << 128n)).to.throw(
                'Not a snapshot time key'
            );
        });

        it('Should derive queryIds and result leaves exactly as queries.ts and snapshotProof.ts do', async function () {
            const { snapshot, targetAddress, other } =
                await deploySnapshotFixture();
            const queryId = queryIdOf(targetAddress, VALUE_DATA);

            expect(
                await snapshot.queryIdOf(targetAddress, VALUE_DATA)
            ).to.equal(queryId);
            expect(queryId).to.not.equal(
                queryIdOf(targetAddress, IS_PAUSED_DATA)
            );
            expect(queryId).to.not.equal(queryIdOf(other.address, VALUE_DATA));
            expect(await snapshot.resultLeafOf(queryId, word(42n))).to.equal(
                resultLeafOf(queryId, word(42n))
            );
        });

        it('Should build the same results root as snapshotProof.ts for every tree shape', async function () {
            const { snapshot } = await deploySnapshotFixture();

            for (const count of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17]) {
                const queryIds = Array.from({ length: count }, (_unused, k) =>
                    ethers.keccak256(ethers.toBeHex(k + 1, 32))
                );
                const results = Array.from({ length: count }, (_unused, k) =>
                    word(BigInt(k) * 1_000_003n)
                );
                expect(
                    await snapshot.resultsRootOf(queryIds, results),
                    `${count}`
                ).to.equal(resultsRootOf(queryIds, results));
            }
        });

        it('Should build result paths that nori-hash verifies, so Solana can reuse its Merkle check', async function () {
            for (const count of [1, 2, 3, 5, 8, 13]) {
                const queryIds = Array.from({ length: count }, (_unused, k) =>
                    ethers.keccak256(ethers.toBeHex(k + 100, 32))
                );
                const results = Array.from({ length: count }, (_unused, k) =>
                    word(BigInt(k))
                );
                for (let index = 0; index < count; index++) {
                    const witness = resultWitnessOf(queryIds, results, index);
                    expect(
                        merkle_root_from_path({
                            leaf: witness.leaf,
                            index,
                            path: witness.path,
                        }),
                        `${count}/${index}`
                    ).to.equal(witness.root);
                }
            }
        });
    });

    // -----------------------------------------------------------
    // snapshot
    // -----------------------------------------------------------
    describe('snapshot', function () {
        it('Should enqueue one request for its own slot with [index, timeKey]', async function () {
            const { queue, snapshot, snapshotAddress, twoQueries, keeper } =
                await deploySnapshotFixture();

            const receipt = required(
                await (
                    await snapshot.connect(keeper).snapshot(twoQueries, {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
                ).wait()
            );
            const block = required(
                await ethers.provider.getBlock(receipt.blockNumber)
            );

            expect(await queue.head()).to.equal(1n);
            const request = await queue.requests(0n);
            expect(request.target).to.equal(snapshotAddress);
            expect(request.slotKey).to.equal(slotKeyOf(1n));
            expect(request.collectionKeysCount).to.equal(2n);
            expect(request.collectionKeys[0]).to.equal(word(1n));
            expect(request.collectionKeys[1]).to.equal(
                timeKeyOf(BigInt(block.number), BigInt(block.timestamp))
            );
        });

        it('Should return the snapshot index, request id and results root', async function () {
            const { queue, operator, snapshot, twoQueries, keeper } =
                await deploySnapshotFixture();
            await queue.connect(operator).requestProof(ethers.ZeroHash, [], {
                value: PROOF_REQUEST_QUEUE_FEE,
            });

            const [snapshotIndex, requestId, root] = await snapshot
                .connect(keeper)
                .snapshot.staticCall(twoQueries, {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(snapshotIndex).to.equal(1n);
            expect(requestId).to.equal(1n);
            expect(root).to.equal(
                resultsRootOf(
                    twoQueries.map((q) => queryIdOf(q.target, q.data)),
                    [word(42n), word(1n)]
                )
            );
        });

        it('Should emit Snapshot with every query id and result, and the queue its ProofRequested', async function () {
            const { queue, snapshot, snapshotAddress, twoQueries, keeper } =
                await deploySnapshotFixture();
            const queryIds = twoQueries.map((q) => queryIdOf(q.target, q.data));
            const results = [word(42n), word(1n)];
            const blockNumber = BigInt(
                (await ethers.provider.getBlockNumber()) + 1
            );

            const tx = snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });

            await expect(tx)
                .to.emit(snapshot, 'Snapshot')
                .withArgs(
                    1n,
                    0n,
                    blockNumber,
                    (timestamp: bigint) => timestamp > 0n,
                    resultsRootOf(queryIds, results),
                    queryIds,
                    results
                )
                .and.to.emit(queue, 'ProofRequested')
                .withArgs(
                    0n,
                    snapshotAddress,
                    slotKeyOf(1n),
                    (keys: string[]) =>
                        keys.length === 2 && keys[0] === word(1n)
                );
        });

        it('Should forward exactly the fee to the queue and keep no ETH', async function () {
            const { queue, snapshot, snapshotAddress, twoQueries, keeper } =
                await deploySnapshotFixture();

            expect(await snapshot.snapshotFee()).to.equal(
                PROOF_REQUEST_QUEUE_FEE
            );
            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });

            expect(await queue.accumulatedFees()).to.equal(
                PROOF_REQUEST_QUEUE_FEE
            );
            expect(await ethers.provider.getBalance(snapshotAddress)).to.equal(
                0n
            );
        });

        it('Should work with a zero queue fee', async function () {
            const { queue, snapshot, twoQueries, keeper } =
                await deploySnapshotFixture(0n);

            await snapshot.connect(keeper).snapshot(twoQueries);

            expect(await queue.head()).to.equal(1n);
        });

        it('Should commit any 32-byte result, including zero and the top bit set', async function () {
            const { snapshot, target, targetAddress, keeper } =
                await deploySnapshotFixture();
            const query = { target: targetAddress, data: VALUE_DATA };
            const queryId = queryIdOf(targetAddress, VALUE_DATA);

            for (const value of [0n, SENTINEL | 5n, 2n ** 256n - 1n]) {
                await target.setValue(value);
                const index = (await snapshot.snapshotCount()) + 1n;
                await snapshot
                    .connect(keeper)
                    .snapshot([query], { value: PROOF_REQUEST_QUEUE_FEE });

                expect(await snapshot.commitments(index)).to.equal(
                    commitmentWordOf(resultsRootOf([queryId], [word(value)]))
                );
            }
        });

        it('Should give each snapshot its own index, even twice in one block', async function () {
            const { queue, snapshot, twoQueries, keeper, other } =
                await deploySnapshotFixture();

            await ethers.provider.send('evm_setAutomine', [false]);
            try {
                const first = await snapshot
                    .connect(keeper)
                    .snapshot(twoQueries, {
                        value: PROOF_REQUEST_QUEUE_FEE,
                        gasLimit: 1_000_000n,
                    });
                const second = await snapshot
                    .connect(other)
                    .snapshot(twoQueries, {
                        value: PROOF_REQUEST_QUEUE_FEE,
                        gasLimit: 1_000_000n,
                    });
                await ethers.provider.send('evm_mine', []);

                const firstReceipt = required(
                    await ethers.provider.getTransactionReceipt(first.hash)
                );
                const secondReceipt = required(
                    await ethers.provider.getTransactionReceipt(second.hash)
                );
                expect(firstReceipt.status).to.equal(1);
                expect(secondReceipt.status).to.equal(1);
                expect(secondReceipt.blockNumber).to.equal(
                    firstReceipt.blockNumber
                );
            } finally {
                await ethers.provider.send('evm_setAutomine', [true]);
            }
            expect(await snapshot.snapshotCount()).to.equal(2n);
            expect(await queue.head()).to.equal(2n);
            expect((await queue.requests(1n)).slotKey).to.equal(slotKeyOf(2n));
        });

        it('Should allow the same query twice in one snapshot', async function () {
            const { snapshot, targetAddress, keeper } =
                await deploySnapshotFixture();
            const query = { target: targetAddress, data: VALUE_DATA };

            await expect(
                snapshot.connect(keeper).snapshot([query, query], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                })
            ).to.emit(snapshot, 'Snapshot');
        });

        it('Should keep earlier commitments after the target changes', async function () {
            const { snapshot, target, twoQueries, keeper } =
                await deploySnapshotFixture();

            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });
            const before = await snapshot.commitments(1n);
            await target.setValue(0n);
            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });

            expect(await snapshot.commitments(1n)).to.equal(before);
            expect(await snapshot.commitments(2n)).to.not.equal(before);
        });

        it('Should revert NoQueries and TooManyQueries', async function () {
            const { snapshot, targetAddress, keeper } =
                await deploySnapshotFixture();

            await expect(
                snapshot
                    .connect(keeper)
                    .snapshot([], { value: PROOF_REQUEST_QUEUE_FEE })
            ).to.be.revertedWithCustomError(snapshot, 'NoQueries');
            await expect(
                snapshot
                    .connect(keeper)
                    .snapshot(
                        distinctValueQueries(targetAddress, MAX_QUERIES + 1),
                        {
                            value: PROOF_REQUEST_QUEUE_FEE,
                        }
                    )
            )
                .to.be.revertedWithCustomError(snapshot, 'TooManyQueries')
                .withArgs(BigInt(MAX_QUERIES + 1), BigInt(MAX_QUERIES));
        });

        it('Should revert IncorrectFee below and above the queue fee', async function () {
            const { snapshot, twoQueries, keeper } =
                await deploySnapshotFixture();

            for (const value of [
                0n,
                PROOF_REQUEST_QUEUE_FEE - 1n,
                PROOF_REQUEST_QUEUE_FEE * 2n,
            ]) {
                await expect(
                    snapshot.connect(keeper).snapshot(twoQueries, { value })
                )
                    .to.be.revertedWithCustomError(snapshot, 'IncorrectFee')
                    .withArgs(PROOF_REQUEST_QUEUE_FEE, value);
            }
        });

        it('Should revert QueryFailed with the failing index when a call reverts', async function () {
            const { snapshot, targetAddress, twoQueries, keeper } =
                await deploySnapshotFixture();

            await expect(
                snapshot
                    .connect(keeper)
                    .snapshot(
                        [
                            ...twoQueries,
                            { target: targetAddress, data: REVERTS_DATA },
                        ],
                        {
                            value: PROOF_REQUEST_QUEUE_FEE,
                        }
                    )
            )
                .to.be.revertedWithCustomError(snapshot, 'QueryFailed')
                .withArgs(
                    2n,
                    queryIdOf(targetAddress, REVERTS_DATA),
                    (reason: string) => reason.length > 2
                );
        });

        it('Should revert QueryFailed when a call writes state', async function () {
            const { snapshot, target, targetAddress, keeper } =
                await deploySnapshotFixture();

            await expect(
                snapshot
                    .connect(keeper)
                    .snapshot([{ target: targetAddress, data: BUMP_DATA }], {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
            ).to.be.revertedWithCustomError(snapshot, 'QueryFailed');
            expect(await target.value()).to.equal(42n);
        });

        it('Should revert InvalidResultLength for results other than one word', async function () {
            const { snapshot, targetAddress, keeper, other } =
                await deploySnapshotFixture();

            for (const [query, length] of [
                [{ target: targetAddress, data: TWO_WORDS_DATA }, 64n],
                [{ target: targetAddress, data: NOTHING_DATA }, 0n],
                // An account without code answers every call with empty success
                [{ target: other.address, data: VALUE_DATA }, 0n],
            ] as const) {
                await expect(
                    snapshot
                        .connect(keeper)
                        .snapshot([query], { value: PROOF_REQUEST_QUEUE_FEE })
                )
                    .to.be.revertedWithCustomError(
                        snapshot,
                        'InvalidResultLength'
                    )
                    .withArgs(0n, queryIdOf(query.target, query.data), length);
            }
        });

        it('Should revert as a whole if any query fails', async function () {
            const { queue, snapshot, targetAddress, twoQueries, keeper } =
                await deploySnapshotFixture();

            await expect(
                snapshot
                    .connect(keeper)
                    .snapshot(
                        [
                            ...twoQueries,
                            { target: targetAddress, data: TWO_WORDS_DATA },
                        ],
                        {
                            value: PROOF_REQUEST_QUEUE_FEE,
                        }
                    )
            ).to.be.revertedWithCustomError(snapshot, 'InvalidResultLength');
            expect(await queue.head()).to.equal(0n);
            expect(await snapshot.snapshotCount()).to.equal(0n);
        });

        it('Should reject plain ETH transfers', async function () {
            const { snapshotAddress, keeper } = await deploySnapshotFixture();

            await expect(
                keeper.sendTransaction({ to: snapshotAddress, value: 1n })
            ).to.revert(ethers);
        });
    });

    // -----------------------------------------------------------
    // What a Solana consumer verifies
    // -----------------------------------------------------------
    describe('Proof request leaf and results', function () {
        it('Should rebuild every leaf from the queue and storage alone, and verify each result against it', async function () {
            const {
                queue,
                snapshot,
                target,
                targetAddress,
                twoQueries,
                keeper,
            } = await deploySnapshotFixture();
            const fiveQueries = [
                ...twoQueries,
                ...distinctValueQueries(targetAddress, 3),
            ];

            await snapshot
                .connect(keeper)
                .snapshot(twoQueries, { value: PROOF_REQUEST_QUEUE_FEE });
            await target.setValue(7n);
            const lastReceipt = required(
                await (
                    await snapshot.connect(keeper).snapshot(fiveQueries, {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
                ).wait()
            );
            const lastBlock = required(
                await ethers.provider.getBlock(lastReceipt.blockNumber)
            );

            // 1. What a witness builder sees for the proof queue batch
            //    [0, head): each queue record and the word at its slotKey
            const head = await queue.head();
            const leaves = [];
            for (let id = 0n; id < head; id++) {
                const request = await queue.requests(id);
                const count = Number(request.collectionKeysCount);
                leaves.push({
                    target: request.target,
                    collectionKeysCount: count,
                    collectionKeys: request.collectionKeys.slice(0, count),
                    value: word(
                        await readStorage(request.target, request.slotKey)
                    ),
                });
            }
            const requestWitness = request_witness({ leaves, index: 1 });
            expect(
                merkle_root_from_path({
                    leaf: requestWitness.leaf,
                    index: 1,
                    path: requestWitness.path,
                })
            ).to.equal(requestWitness.root);

            // 2. The proof request leaf a Solana consumer checks
            const leaf = leaves[1];
            expect(leaf.target).to.equal(await snapshot.getAddress());
            expect(leaf.collectionKeysCount).to.equal(2);
            expect(BigInt(leaf.collectionKeys[0])).to.equal(2n);
            expect(parseTimeKey(leaf.collectionKeys[1])).to.deep.equal({
                blockNumber: BigInt(lastBlock.number),
                timestamp: BigInt(lastBlock.timestamp),
            });

            // 3. Each result against the proven word, from the Snapshot event
            const event = required(
                lastReceipt.logs
                    .map((log) => snapshot.interface.parseLog(log))
                    .find((parsed) => parsed?.name === 'Snapshot')
            );
            const queryIds: string[] = [...event.args.queryIds];
            const results: string[] = [...event.args.results];
            expect(results.map((result) => BigInt(result))).to.deep.equal([
                7n,
                1n,
                7n,
                7n,
                7n,
            ]);
            for (let index = 0; index < queryIds.length; index++) {
                const witness = resultWitnessOf(queryIds, results, index);
                expect(
                    verifyResult(
                        leaf.value,
                        queryIds[index],
                        results[index],
                        index,
                        witness.path
                    ),
                    `result ${index}`
                ).to.equal(true);
            }

            // 4. A forged result, a wrong index or a word without the sentinel fails
            const witness = resultWitnessOf(queryIds, results, 0);
            expect(
                verifyResult(leaf.value, queryIds[0], word(8n), 0, witness.path)
            ).to.equal(false);
            expect(
                verifyResult(
                    leaf.value,
                    queryIds[0],
                    results[0],
                    1,
                    witness.path
                )
            ).to.equal(false);
            expect(
                verifyResult(
                    BigInt(leaf.value) ^ SENTINEL,
                    queryIds[0],
                    results[0],
                    0,
                    witness.path
                )
            ).to.equal(false);
            expect(
                verifyResult(0n, queryIds[0], results[0], 0, witness.path)
            ).to.equal(false);
        });
    });

    // -----------------------------------------------------------
    // Forgery through a snapshot of the attacker's own choosing
    // -----------------------------------------------------------
    describe('Leaf and node separation', function () {
        it('Should not let a result chosen by the attacker pass for a node one level up', async function () {
            const { snapshot, targetAddress, keeper } =
                await deploySnapshotFixture(0n);
            // The consumer pins value(); the attacker wants it to read 2^200
            const pinned = queryIdOf(targetAddress, VALUE_DATA);
            const forged = word(1n << 200n);
            // Without the leaf prefix, a node over (pinned, forged) would be
            // sha256(pinned ++ forged); the identity precompile (0x04) returns
            // whatever it is given, so the attacker commits that as a result
            const unprefixed = ethers.sha256(ethers.concat([pinned, forged]));
            const identity = {
                target: '0x' + '04'.padStart(40, '0'),
                data: unprefixed,
            };
            const receipt = required(
                await (
                    await snapshot.connect(keeper).snapshot([identity])
                ).wait()
            );
            const provenWord = await snapshot.commitments(
                await snapshot.snapshotCount()
            );
            const identityId = queryIdOf(identity.target, identity.data);
            expect(receipt.status).to.equal(1);

            // The forged witness: (pinned, forged) at index 1 under sibling identityId
            expect(
                verifyResult(provenWord, pinned, forged, 1, [identityId])
            ).to.equal(false);
            // ...which the unprefixed tree would have accepted
            expect(
                commitmentWordOf(
                    ethers.sha256(ethers.concat([identityId, unprefixed]))
                ) === provenWord
            ).to.equal(false);
            // The genuine result still verifies
            expect(
                verifyResult(provenWord, identityId, unprefixed, 0, [])
            ).to.equal(true);
        });

        it('Should prefix result leaves so they are 65 bytes against 64 for nodes', async function () {
            const { snapshot } = await deploySnapshotFixture();
            const queryId = ethers.keccak256('0x01');
            const result = word(5n);

            expect(await snapshot.RESULT_LEAF_PREFIX()).to.equal('0x00');
            expect(await snapshot.resultLeafOf(queryId, result)).to.equal(
                ethers.sha256(ethers.concat(['0x00', queryId, result]))
            );
        });
    });

    // -----------------------------------------------------------
    // Gas
    // -----------------------------------------------------------
    describe('Gas', function () {
        it('Should cost one queue entry per snapshot, plus little per query', async function () {
            const { snapshot, targetAddress, twoQueries, keeper } =
                await deploySnapshotFixture(0n);
            // Warm the queue's head and the snapshot count, as on a live deployment
            await snapshot.connect(keeper).snapshot(twoQueries);

            const gasFor = async (count: number) =>
                required(
                    await (
                        await snapshot
                            .connect(keeper)
                            .snapshot(
                                distinctValueQueries(targetAddress, count)
                            )
                    ).wait()
                ).gasUsed;
            const one = await gasFor(1);
            const six = await gasFor(6);
            const thirtyTwo = await gasFor(32);

            console.log(
                `      gas: 1 query ${one}, 6 queries ${six}, 32 queries ${thirtyTwo}`
            );
            expect(one).to.be.lessThan(200_000n);
            expect(six).to.be.lessThan(250_000n);
            expect((thirtyTwo - one) / 31n).to.be.lessThan(10_000n);
        });
    });
});
