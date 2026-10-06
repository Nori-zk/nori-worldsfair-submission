import {
    AccountRole,
    address,
    type Address,
    type Instruction,
} from '@solana/kit';
import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';
import type { SnapshotResultWitnessArgs } from './snapshotWitness.js';

export const BACKSTOP_PROGRAM = address(
    'JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9'
);

export const ReadKind = { Backing: 0, Pause: 1 } as const;
export type ReadKind = (typeof ReadKind)[keyof typeof ReadKind];

/** Anchor's instruction discriminator: sha256("global:<name>")[..8]. */
function discriminator(name: string): Uint8Array {
    return getBytes(sha256(toUtf8Bytes(`global:${name}`))).slice(0, 8);
}

function le(value: bigint, bytes: number): Uint8Array {
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
    return out;
}

function words(list: Array<readonly [Uint8Array]>): Uint8Array {
    return getBytes(
        concat([le(BigInt(list.length), 4), ...list.map(([w]) => w)])
    );
}

/** `submit_read(kind, witness)` instruction data, Borsh as Anchor encodes it. */
export function encodeSubmitRead(
    kind: ReadKind,
    witness: SnapshotResultWitnessArgs
): Uint8Array {
    const { request } = witness;
    return getBytes(
        concat([
            discriminator('submit_read'),
            new Uint8Array([kind]),
            words(request.path),
            le(request.index, 8),
            request.value.target[0],
            new Uint8Array([request.value.collectionKeysCount]),
            request.value.collectionKeys[0][0],
            request.value.collectionKeys[1][0],
            request.value.value[0],
            witness.result[0],
            le(BigInt(witness.resultIndex), 2),
            words(witness.resultPath),
        ])
    );
}

export function submitReadInstruction(accounts: {
    guard: Address;
    mint: Address;
    proofQueueBatch: Address;
    kind: ReadKind;
    witness: SnapshotResultWitnessArgs;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.WRITABLE },
            { address: accounts.mint, role: AccountRole.READONLY },
            { address: accounts.proofQueueBatch, role: AccountRole.READONLY },
        ],
        data: encodeSubmitRead(accounts.kind, accounts.witness),
    };
}

/** `checkpoint()`: records the mint's supply; crank about once a minute. */
export function checkpointInstruction(accounts: {
    guard: Address;
    mint: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.guard, role: AccountRole.WRITABLE },
            { address: accounts.mint, role: AccountRole.READONLY },
        ],
        data: discriminator('checkpoint'),
    };
}
