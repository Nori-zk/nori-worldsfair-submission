import {
    AccountRole,
    address,
    appendTransactionMessageInstruction,
    blockhash,
    compileTransaction,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type Address,
    type Instruction,
} from '@solana/kit';
import { concat, decodeBase64, getBytes, hexlify } from 'ethers';
import {
    discriminator,
    encodeSnapshotResultWitness,
    eventDiscriminator,
} from './anchor.js';
import {
    fetchProvenSnapshot,
    type ProvenSnapshotRequest,
} from './fetchProvenSnapshot.js';
import type { SnapshotResultWitnessArgs } from './snapshotWitness.js';

/** `programs/nori-read-example`: verifies one snapshot result with nori-read and emits it. */
export const NORI_READ_EXAMPLE_PROGRAM = address(
    '5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7'
);

/** `read_snapshot_result(nori_snapshot, query_id, witness)` instruction data. */
export function encodeReadSnapshotResult(
    noriSnapshot: string,
    queryId: string,
    witness: SnapshotResultWitnessArgs
): Uint8Array {
    return getBytes(
        concat([
            discriminator('read_snapshot_result'),
            noriSnapshot,
            queryId,
            encodeSnapshotResultWitness(witness),
        ])
    );
}

/** `read_snapshot_result`: verifies `queryId`'s result against `proofQueueBatch`. */
export function readSnapshotResultInstruction(accounts: {
    proofQueueBatch: Address;
    noriSnapshot: string;
    queryId: string;
    witness: SnapshotResultWitnessArgs;
}): Instruction {
    return {
        programAddress: NORI_READ_EXAMPLE_PROGRAM,
        accounts: [
            { address: accounts.proofQueueBatch, role: AccountRole.READONLY },
        ],
        data: encodeReadSnapshotResult(
            accounts.noriSnapshot,
            accounts.queryId,
            accounts.witness
        ),
    };
}

/** The `SnapshotResultRead` event: a result nori-read verified (its `ProvenResult`). */
export interface SnapshotResultRead {
    queryId: string;
    /** The 32-byte result, 0x-hex. */
    result: string;
    snapshotIndex: bigint;
    requestId: bigint;
    /** The Ethereum block the view call ran in, and its time (seconds). */
    ethBlockNumber: bigint;
    ethTimestamp: bigint;
    /** The finalized block whose state the batch proved. */
    provenBlockNumber: bigint;
}

const SNAPSHOT_RESULT_READ = eventDiscriminator('SnapshotResultRead');

/** Decodes a `SnapshotResultRead` event; `undefined` for any other data. */
export function decodeSnapshotResultRead(
    data: Uint8Array
): SnapshotResultRead | undefined {
    if (
        data.length !== 8 + 32 + 32 + 5 * 8 ||
        SNAPSHOT_RESULT_READ.some((byte, i) => data[i] !== byte)
    )
        return undefined;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u64 = (at: number) => view.getBigUint64(at, true);
    return {
        queryId: hexlify(data.subarray(8, 40)),
        result: hexlify(data.subarray(40, 72)),
        snapshotIndex: u64(72),
        requestId: u64(80),
        ethBlockNumber: u64(88),
        ethTimestamp: u64(96),
        provenBlockNumber: u64(104),
    };
}

/** The first `SnapshotResultRead` event in a transaction's logs (Anchor's `Program data:` lines). */
export function snapshotResultReadFromLogs(
    logs: readonly string[]
): SnapshotResultRead | undefined {
    for (const line of logs) {
        if (!line.startsWith('Program data: ')) continue;
        const read = decodeSnapshotResultRead(
            decodeBase64(line.slice('Program data: '.length))
        );
        if (read) return read;
    }
    return undefined;
}

/** Any blockhash: the simulation replaces it with a recent one. */
const ANY_LIFETIME = {
    blockhash: blockhash('11111111111111111111111111111111'),
    lastValidBlockHeight: 0n,
};

/**
 * Verifies one result of a snapshot transaction on Solana, once Nori has
 * proven its batch: builds the witness and simulates nori-read-example's
 * `read_snapshot_result` with it. No signature and no fee, but `feePayer`
 * must be an existing account holding SOL.
 *
 * @throws When Nori has not proven the batch yet, or the result does not verify.
 */
export async function verifySnapshotResult(
    request: ProvenSnapshotRequest & { queryId: string; feePayer: Address }
): Promise<{
    read: SnapshotResultRead;
    unitsConsumed: bigint;
    proofQueueBatch: Address;
}> {
    const proven = await fetchProvenSnapshot(request);
    if (!proven.proven)
        throw new Error(
            `Nori has not proven the batch of ${request.snapshotTxHash} yet`
        );
    const instruction = readSnapshotResultInstruction({
        proofQueueBatch: proven.proofQueueBatch,
        noriSnapshot: request.noriSnapshot,
        queryId: request.queryId,
        witness: proven.witnessFor(request.queryId),
    });
    const transaction = compileTransaction(
        pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayer(request.feePayer, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(ANY_LIFETIME, m),
            (m) => appendTransactionMessageInstruction(instruction, m)
        )
    );
    const rpc = await request.connections.solana.http.ready();
    const { value } = await rpc
        .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
            encoding: 'base64',
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: 'confirmed',
        })
        .send();
    const logs = value.logs ?? [];
    const read = value.err ? undefined : snapshotResultReadFromLogs(logs);
    if (!read)
        throw new Error(
            `The result did not verify: ${logs.filter((line) => line.startsWith('Program log: ')).join(' ') || 'simulation failed'}`
        );
    return {
        read,
        unitsConsumed: value.unitsConsumed ?? 0n,
        proofQueueBatch: proven.proofQueueBatch,
    };
}
