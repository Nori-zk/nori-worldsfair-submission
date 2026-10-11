import { address, type Address } from '@solana/kit';
import { map, NEVER } from 'rxjs';
import {
    dueOn,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { AssertHealthyGraph } from './assertHealthy.js';
import { assertHealthyInstruction } from './guard.js';
import { simulation$ } from './simulation.js';

/**
 * Starts simulating one guard's `assert_healthy` through the Solana
 * connection, once.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param feePayer An existing system account holding SOL: the simulation's fee payer, which pays nothing.
 * @param guard The guard account.
 * @param mint The guard's mint.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the transaction's error and what it cost. Its controls:
 *   - `retry()`: simulates again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createAssertHealthyMachine = (
    connections: ProofRequestConnections,
    feePayer: Address,
    guard: Address,
    mint: Address,
    backoff: ReadRetryBackoff = {}
) =>
    startReadThroughConnectionsMachine(AssertHealthyGraph, {
        connections,
        read: (clients, { guard: heldGuard, mint: heldMint }) =>
            clients
                .solana((rpc) =>
                    simulation$(
                        rpc,
                        [
                            assertHealthyInstruction({
                                guard: address(heldGuard),
                                mint: address(heldMint),
                            }),
                        ],
                        feePayer,
                        'Failed to simulate assert_healthy.'
                    )
                )
                .pipe(
                    map(({ err, unitsConsumed }) => ({
                        guard: heldGuard,
                        mint: heldMint,
                        simulated: { err, unitsConsumed },
                    }))
                ),
        refreshOn: () => dueOn(NEVER),
        needs: ['solana'],
        backoff,
        // The guard it is made for is its starting data.
        start: {
            node: 'loading',
            data: { guard, mint, simulated: undefined, failedReads: 0 },
        },
    });
