import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';
import type { SnapshotResultWitnessArgs } from './snapshotWitness.js';

/** Anchor's discriminator: sha256("<namespace>:<name>")[..8]. */
function sighash(namespace: string, name: string): Uint8Array {
    return getBytes(sha256(toUtf8Bytes(`${namespace}:${name}`))).slice(0, 8);
}

/** An Anchor instruction's discriminator: `global:<snake_case name>`. */
export const discriminator = (name: string) => sighash('global', name);

/** An Anchor event's discriminator: `event:<StructName>`. */
export const eventDiscriminator = (name: string) => sighash('event', name);

/** `value` as `bytes` little-endian bytes (Borsh integers). */
export function le(value: bigint, bytes: number): Uint8Array {
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
    return out;
}

/** A Borsh `Vec<[u8; 32]>`. */
function words(list: Array<readonly [Uint8Array]>): Uint8Array {
    return getBytes(
        concat([le(BigInt(list.length), 4), ...list.map(([w]) => w)])
    );
}

/** nori-read's `SnapshotResultWitness`, Borsh as Anchor encodes it. */
export function encodeSnapshotResultWitness(
    witness: SnapshotResultWitnessArgs
): Uint8Array {
    const { request } = witness;
    return getBytes(
        concat([
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
