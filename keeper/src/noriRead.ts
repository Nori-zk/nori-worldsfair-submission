import {
    AccountRole,
    address,
    type Address,
    type Instruction,
} from '@solana/kit';
import { concat, decodeBase64, getBytes, hexlify } from 'ethers';
import { map, type Observable } from 'rxjs';
import { type SolanaRpc } from '@nori-zk/nori-bridge-solana-sdk';
import {
    discriminator,
    encodeSnapshotResultWitness,
    eventDiscriminator,
} from './anchor.js';
import { simulation$ } from './simulation.js';
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

/**
 * Verifies one result of a snapshot on Solana, against the proof queue
 * batch Nori proved it in: simulates nori-read-example's
 * `read_snapshot_result` with the result's witness. No signature and no
 * fee, but `feePayer` must be an existing account holding SOL.
 *
 * @param rpc The Solana RPC.
 * @param request The batch, the snapshot, the query, its witness and the fee payer.
 * @returns What the program verified and what it cost, once; errors when the result does not verify.
 */
export const snapshotResultSimulation$ = (
    rpc: SolanaRpc,
    request: {
        proofQueueBatch: Address;
        noriSnapshot: string;
        queryId: string;
        witness: SnapshotResultWitnessArgs;
        feePayer: Address;
    }
): Observable<{ read: SnapshotResultRead; unitsConsumed: bigint }> =>
    simulation$(
        rpc,
        [readSnapshotResultInstruction(request)],
        request.feePayer,
        'Failed to simulate read_snapshot_result.'
    ).pipe(
        map(({ err, logs, unitsConsumed }) => {
            const read = err ? undefined : snapshotResultReadFromLogs(logs);
            if (!read)
                throw new Error(
                    `The result did not verify: ${logs.filter((line) => line.startsWith('Program log: ')).join(' ') || 'simulation failed'}`
                );
            return { read, unitsConsumed };
        })
    );
