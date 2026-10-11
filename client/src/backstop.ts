import {
    AccountRole,
    address,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Address,
    type Instruction,
} from '@solana/kit';
import { concat, getBytes, toUtf8Bytes } from 'ethers';
import { defer, forkJoin, map, type Observable } from 'rxjs';
import { stateAddress$ } from '@nori-zk/nori-bridge-solana-sdk';
import { discriminator, encodeSnapshotResultWitness, le } from './anchor.js';
import type { SnapshotResultWitnessArgs } from './snapshotWitness.js';
import { BACKSTOP_PROGRAM, type GuardConfig } from './guard.js';

export * from './guard.js';

export const ReadKind = { Backing: 0, Pause: 1 } as const;
export type ReadKind = (typeof ReadKind)[keyof typeof ReadKind];

/** `submit_read(kind, witness)` instruction data, Borsh as Anchor encodes it. */
export function encodeSubmitRead(
    kind: ReadKind,
    witness: SnapshotResultWitnessArgs
): Uint8Array {
    return getBytes(
        concat([
            discriminator('submit_read'),
            new Uint8Array([kind]),
            encodeSnapshotResultWitness(witness),
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

/** `unlatch()`: clears a trip. Only the guard's admin may sign it; for testing and demos only. */
export function unlatchInstruction(accounts: {
    admin: Address;
    guard: Address;
}): Instruction {
    return {
        programAddress: BACKSTOP_PROGRAM,
        accounts: [
            { address: accounts.admin, role: AccountRole.READONLY_SIGNER },
            { address: accounts.guard, role: AccountRole.WRITABLE },
        ],
        data: discriminator('unlatch'),
    };
}

const addressBytes = (value: Address) =>
    new Uint8Array(getAddressEncoder().encode(value));

/** `create_guard(config)` instruction data. */
export function encodeCreateGuard(config: GuardConfig): Uint8Array {
    return getBytes(
        concat([
            discriminator('create_guard'),
            addressBytes(config.noriProgram),
            getBytes(config.noriSnapshot),
            getBytes(config.backingQuery),
            getBytes(config.pauseQuery),
            new Uint8Array([config.backingDecimals]),
            le(config.tolerance, 8),
            le(BigInt(config.windowSecs), 4),
            le(BigInt(config.skewSecs), 4),
            le(BigInt(config.checkpointIntervalSecs), 4),
            le(BigInt(config.maxStalenessSecs), 4),
        ])
    );
}

/**
 * The guard PDA: `[b"guard", mint, admin]`.
 *
 * @param mint The guarded mint.
 * @param admin The guard's admin.
 * @returns The guard's address, once.
 */
export const guardAddress$ = (
    mint: Address,
    admin: Address
): Observable<Address> =>
    defer(() =>
        getProgramDerivedAddress({
            programAddress: BACKSTOP_PROGRAM,
            seeds: [
                toUtf8Bytes('guard'),
                addressBytes(mint),
                addressBytes(admin),
            ],
        })
    ).pipe(map(([pda]) => pda));

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/**
 * `create_guard`: `admin` pays and becomes the guard's admin.
 *
 * @param accounts The admin, the mint and the guard's settings.
 * @returns The instruction, once.
 */
export const createGuardInstruction$ = (accounts: {
    admin: Address;
    mint: Address;
    config: GuardConfig;
}): Observable<Instruction> =>
    forkJoin({
        noriState: stateAddress$(accounts.config.noriProgram),
        guard: guardAddress$(accounts.mint, accounts.admin),
    }).pipe(
        map(({ noriState, guard }) => ({
            programAddress: BACKSTOP_PROGRAM,
            accounts: [
                { address: accounts.admin, role: AccountRole.WRITABLE_SIGNER },
                { address: accounts.mint, role: AccountRole.READONLY },
                { address: noriState, role: AccountRole.READONLY },
                { address: guard, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
            ],
            data: encodeCreateGuard(accounts.config),
        }))
    );
