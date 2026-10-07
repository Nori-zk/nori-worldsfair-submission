#!/usr/bin/env node
// LOCAL DRY RUN ONLY. Stands in for the Nori prover on surfpool: writes the
// Nori program's state and a proof queue batch covering every new queue
// request, laid out as `initialize` and `update` write them, with surfpool's
// surfnet_setAccount cheatcode. It proves nothing.
import {
    JsonRpcProvider,
    concat,
    getBytes,
    sha256,
    toBeHex,
    toUtf8Bytes,
    zeroPadValue,
} from 'ethers';
import {
    createSolanaRpc,
    getProgramDerivedAddress,
    type Address,
} from '@solana/kit';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import {
    request_batch_root,
    type RequestLeaf,
} from '@nori-zk/ethereum-solana-proof-queue-utils-glam';
import { findNoriStateAddress } from '../backstop.js';
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

const discriminator = (account: string) =>
    getBytes(sha256(toUtf8Bytes(`account:${account}`))).slice(0, 8);
const u64 = (value: bigint) => getBytes(toBeHex(value, 8)).reverse();

async function setAccount(address: Address, data: Uint8Array) {
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
                address,
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

// The Nori state: zero-copy NoriSolTokenBridge, queue cursor at 184, batch count at 192
const stateAddress = await findNoriStateAddress(noriProgram);
const { value: stateAccount } = await rpc
    .getAccountInfo(stateAddress, { encoding: 'base64' })
    .send();
const state = stateAccount
    ? Buffer.from(stateAccount.data[0], 'base64')
    : Buffer.concat([
          Buffer.from(discriminator('NoriSolTokenBridge')),
          Buffer.alloc(192),
      ]);
let cursor = state.readBigUInt64LE(184);
let batchCount = state.readBigUInt64LE(192);

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
    const [batchAddress] = await getProgramDerivedAddress({
        programAddress: noriProgram,
        seeds: [toUtf8Bytes('PROOF_QUEUE_BATCH'), u64(batchCount)],
    });
    await setAccount(
        batchAddress,
        getBytes(
            concat([
                discriminator('ProofRequestRootEntry'),
                request_batch_root({ leaves }),
                u64(BigInt(block)),
                u64(cursor),
                u64(head),
            ])
        )
    );
    console.log(
        `batch ${batchCount}: requests [${cursor}, ${head}) at Ethereum block ${block}`
    );
    cursor = head;
    batchCount += 1n;
} else {
    console.log(`no new requests (cursor ${cursor})`);
}

state.set(getBytes(config.ethereum.proofQueue), 8 + 136);
state.writeBigUInt64LE(cursor, 184);
state.writeBigUInt64LE(batchCount, 192);
await setAccount(stateAddress, state);
console.log(
    `Nori state ${stateAddress}: cursor ${cursor}, ${batchCount} batches`
);
