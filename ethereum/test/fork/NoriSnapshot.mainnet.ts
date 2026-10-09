/// <reference types="@nomicfoundation/hardhat-ethers" />
/// <reference types="@nomicfoundation/hardhat-ethers-chai-matchers" />
import { expect } from 'chai';
import hre from 'hardhat';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import { NoriSnapshot__factory } from '../../types/ethers-contracts/index.js';
import {
    MAINNET,
    MAINNET_SNAPSHOT_QUERIES,
    encodeQueryData,
    queryIdOf,
} from '../../queries.js';
import {
    resultWitnessOf,
    slotKeyOf,
    verifyResult,
} from '../../snapshotProof.js';

// Forks Ethereum mainnet at a recent block (ETH_MAINNET_FORK_RPC_URL, or a
// public RPC) and snapshots the real getters the guards read. The queue fee
// is zero, as planned for the hackathon deployment.
const { ethers } = await hre.network.getOrCreate('mainnetFork');

const SIX_TOKENS = [
    'usds-lockbox',
    'aave-ntt-hub',
    'uni-ntt-hub',
    'wormhole-weth-custody',
    'wormhole-wbtc-custody',
    'wormhole-weth-outstanding',
];

/** Unwraps a value the test expects to exist (a mined receipt, a block). */
function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined)
        throw new Error('Expected a value');
    return value;
}

function encodedQueries(names?: readonly string[]) {
    return MAINNET_SNAPSHOT_QUERIES.filter(
        (query) => !names || names.includes(query.name)
    ).map((query) => ({ ...query, data: encodeQueryData(query) }));
}

describe('NoriSnapshot on a mainnet fork', () => {
    async function deployOnForkFixture() {
        const [operator, keeper] = await ethers.getSigners();
        const queue = await new NoriProofRequestQueue__factory(operator).deploy(
            operator.address,
            operator.address,
            0n
        );
        const snapshot = await new NoriSnapshot__factory(operator).deploy(
            await queue.getAddress()
        );
        // Warm the queue's head and the snapshot count, as on a live deployment
        await snapshot.snapshot([
            {
                target: MAINNET.WETH,
                data: encodeQueryData({ signature: 'totalSupply()', args: [] }),
            },
        ]);
        return { queue, snapshot, keeper };
    }

    it('Should commit every mainnet query in one snapshot, each verifiable against the proven word', async function () {
        const { queue, snapshot, keeper } = await deployOnForkFixture();
        const queries = encodedQueries();

        const receipt = required(
            await (
                await snapshot
                    .connect(keeper)
                    .snapshot(
                        queries.map(({ target, data }) => ({ target, data }))
                    )
            ).wait()
        );
        console.log(
            `      fork block ${receipt.blockNumber}: ${queries.length} queries, gas ${receipt.gasUsed}`
        );

        // One queue entry for the whole snapshot, pointing at its commitment.
        // Indices start at 1 and the warm-up took 1, so this is snapshot 2.
        expect(await snapshot.snapshotCount()).to.equal(2n);
        expect(await queue.head()).to.equal(2n);
        const request = await queue.requests(1n);
        expect(request.slotKey).to.equal(slotKeyOf(2n));
        const provenWord = await ethers.provider.getStorage(
            await snapshot.getAddress(),
            request.slotKey
        );

        const event = required(
            receipt.logs
                .map((log) => snapshot.interface.parseLog(log))
                .find((parsed) => parsed?.name === 'Snapshot')
        );
        const queryIds: string[] = [...event.args.queryIds];
        const results: string[] = [...event.args.results];
        for (const [k, query] of queries.entries()) {
            const direct = await ethers.provider.call({
                to: query.target,
                data: query.data,
            });

            expect(queryIds[k], query.name).to.equal(
                queryIdOf(query.target, query.data)
            );
            expect(results[k], query.name).to.equal(direct);
            expect(
                verifyResult(
                    provenWord,
                    queryIds[k],
                    results[k],
                    k,
                    resultWitnessOf(queryIds, results, k).path
                ),
                query.name
            ).to.equal(true);
            console.log(`      [${k}] ${query.name}: ${BigInt(results[k])}`);
        }
    });

    it('Should snapshot the six Solana-backing tokens for about 250k gas', async function () {
        const { snapshot, keeper } = await deployOnForkFixture();
        const queries = encodedQueries(SIX_TOKENS);
        expect(queries).to.have.length(6);

        const receipt = required(
            await (
                await snapshot
                    .connect(keeper)
                    .snapshot(
                        queries.map(({ target, data }) => ({ target, data }))
                    )
            ).wait()
        );

        console.log(`      6 tokens: gas ${receipt.gasUsed}`);
        expect(receipt.gasUsed).to.be.lessThan(300_000n);
    });

    it('Should read the Solana-only lockboxes as non-empty and unpaused', async function () {
        const { snapshot } = await deployOnForkFixture();
        const queries = encodedQueries([
            'usds-lockbox',
            'aave-ntt-hub',
            'uni-ntt-hub',
            'usds-lockbox-paused',
            'aave-ntt-hub-paused',
            'uni-ntt-hub-paused',
        ]);

        // Every one of them is a valid query
        await snapshot.snapshot.staticCall(
            queries.map(({ target, data }) => ({ target, data }))
        );
        for (const query of queries) {
            const result = BigInt(
                await ethers.provider.call({
                    to: query.target,
                    data: query.data,
                })
            );
            if (query.name.endsWith('-paused'))
                expect(result, query.name).to.equal(0n);
            else expect(result, query.name).to.be.greaterThan(0n);
        }
    });

    it('Should see Wormhole Portal WETH custody cover outstandingBridged', async function () {
        const [outstanding, custody] = await Promise.all(
            encodedQueries([
                'wormhole-weth-outstanding',
                'wormhole-weth-custody',
            ]).map(async (query) =>
                BigInt(
                    await ethers.provider.call({
                        to: query.target,
                        data: query.data,
                    })
                )
            )
        );

        // outstandingBridged is normalized to 8 decimals; WETH has 18
        expect(custody).to.be.greaterThanOrEqual(outstanding * 10n ** 10n);
    });
});
