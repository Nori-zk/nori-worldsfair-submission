#!/usr/bin/env node
// LOCAL DRY RUN ONLY. Stands in for the Nori prover on surfpool: writes the
// Nori program's state and a proof queue batch covering every new queue
// request, laid out as `initialize` and `update` write them, with surfpool's
// surfnet_setAccount cheatcode. It proves nothing.
import { JsonRpcProvider, getBytes, zeroPadValue } from 'ethers';
import {
    createSolanaRpc,
    type Address,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import { findProofQueueBatchPda } from '@nori-zk/nori-bridge-solana-sdk';
import {
    findStatePda,
    getNoriSolTokenBridgeDecoder,
    getNoriSolTokenBridgeEncoder,
    getProofRequestRootEntryEncoder,
    type NoriSolTokenBridgeArgs,
} from '@nori-zk/nori-bridge-solana-sdk/program';
import {
    request_batch_root,
    type RequestLeaf,
} from '@nori-zk/ethereum-solana-proof-queue-utils-glam';
import { loadConfig, loadEnv } from '../keeper/config.js';

loadEnv();
const config = loadConfig(process.argv[2] ?? 'keeper.demo.json');
const { hostname } = new URL(config.solana.rpcUrl);
if (!['127.0.0.1', 'localhost'].includes(hostname)) {
    console.error(
        `fake-prover only runs against a local surfpool, not ${hostname}`
    );
    process.exit(1);
}
const provider = new JsonRpcProvider(config.ethereum.rpcUrl);
const rpc = createSolanaRpc(config.solana.rpcUrl);
const noriProgram = config.solana.noriProgram;

async function setAccount(account: Address, data: ReadonlyUint8Array) {
    const lamports = await rpc
        .getMinimumBalanceForRentExemption(BigInt(data.length))
        .send();
    const response = await fetch(config.solana.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'surfnet_setAccount',
            params: [
                account,
                {
                    lamports: Number(lamports),
                    data: Buffer.from(data).toString('hex'),
                    owner: noriProgram,
                    executable: false,
                },
            ],
        }),
    });
    const body = (await response.json()) as { error?: { message: string } };
    if (body.error)
        throw new Error(
            `surfnet_setAccount: ${body.error.message} (is this surfpool?)`
        );
}

// The Nori state, as initialize wrote it (or zeroed, on a fresh surfpool)
const [stateAddress] = await findStatePda({ programAddress: noriProgram });
const { value: stateAccount } = await rpc
    .getAccountInfo(stateAddress, { encoding: 'base64' })
    .send();
const stateDecoder = getNoriSolTokenBridgeDecoder();
const state: NoriSolTokenBridgeArgs = stateDecoder.decode(
    stateAccount
        ? Buffer.from(stateAccount.data[0], 'base64')
        : new Uint8Array(stateDecoder.fixedSize)
);
let cursor = BigInt(state.queueCursor);
let batchCount = BigInt(state.proofQueueBatchCount);

const queue = NoriProofRequestQueue__factory.connect(
    config.ethereum.proofQueue,
    provider
);
const block = await provider.getBlockNumber();
const head = await queue.head({ blockTag: block });

if (head > cursor) {
    const leaves: RequestLeaf[] = [];
    for (let id = cursor; id < head; id++) {
        const request = await queue.requests(id, { blockTag: block });
        const count = Number(request.collectionKeysCount);
        leaves.push({
            target: request.target,
            collectionKeysCount: count,
            collectionKeys: [...request.collectionKeys].slice(0, count),
            value: zeroPadValue(
                await provider.getStorage(
                    request.target,
                    request.slotKey,
                    block
                ),
                32
            ),
        });
    }
    const [batchAddress] = await findProofQueueBatchPda(
        batchCount,
        noriProgram
    );
    await setAccount(
        batchAddress,
        getProofRequestRootEntryEncoder().encode({
            root: getBytes(request_batch_root({ leaves })),
            outputBlockNumber: block,
            inputQueueCursor: cursor,
            outputQueueCursor: head,
        })
    );
    console.log(
        `batch ${batchCount}: requests [${cursor}, ${head}) at Ethereum block ${block}`
    );
    cursor = head;
    batchCount += 1n;
} else {
    console.log(`no new requests (cursor ${cursor})`);
}

await setAccount(
    stateAddress,
    getNoriSolTokenBridgeEncoder().encode({
        ...state,
        ethProofQueueAddress: getBytes(config.ethereum.proofQueue),
        queueCursor: cursor,
        proofQueueBatchCount: batchCount,
    })
);
console.log(
    `Nori state ${stateAddress}: cursor ${cursor}, ${batchCount} batches`
);
