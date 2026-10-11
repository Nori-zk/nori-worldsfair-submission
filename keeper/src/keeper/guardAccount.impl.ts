import { address, type Address } from '@solana/kit';
import { map, switchMap } from 'rxjs';
import {
    changesOf$,
    createSolanaChangesMachine,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    solanaRpcRead$,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { guardAddress$ } from '../backstop.js';
import { BACKSTOP_PROGRAM, decodeGuard, mintSupply } from '../guard.js';
import { changesOrEvery$ } from '../refresh.js';
import { GuardAccountGraph } from './guardAccount.js';

/**
 * Starts reading one guard the keeper administers through the Solana
 * connection: its account and its mint's supply, again on each transaction
 * calling Backstop and every `pollIntervalMs`.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param mint The guarded mint.
 * @param admin The guard's admin, the keeper's Solana address.
 * @param pollIntervalMs How often to read again besides each Backstop transaction, as the status moves with time.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the guard's address, the guard and the supply. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createGuardAccountMachine = (
    connections: ProofRequestConnections,
    mint: Address,
    admin: Address,
    pollIntervalMs: number,
    backoff: ReadRetryBackoff = {}
) => {
    const backstopCalled = createSolanaChangesMachine(connections.solana, {
        mentions: BACKSTOP_PROGRAM,
    });
    return startReadThroughConnectionsMachine(GuardAccountGraph, {
        connections,
        read: (clients, { mint: heldMint, admin: heldAdmin }) =>
            guardAddress$(address(heldMint), address(heldAdmin)).pipe(
                switchMap((guardAddress) =>
                    clients
                        .solana((rpc) =>
                            solanaRpcRead$(
                                (abortSignal) =>
                                    rpc
                                        .getMultipleAccounts(
                                            [guardAddress, address(heldMint)],
                                            {
                                                encoding: 'base64',
                                            }
                                        )
                                        .send({ abortSignal }),
                                `Failed to read guard ${guardAddress}.`
                            )
                        )
                        .pipe(
                            map(({ value: [guardAccount, mintAccount] }) => ({
                                mint: heldMint,
                                admin: heldAdmin,
                                address: guardAddress,
                                guard:
                                    guardAccount && mintAccount
                                        ? decodeGuard(
                                              Buffer.from(
                                                  guardAccount.data[0],
                                                  'base64'
                                              )
                                          )
                                        : undefined,
                                supply: mintAccount
                                    ? mintSupply(
                                          Buffer.from(
                                              mintAccount.data[0],
                                              'base64'
                                          )
                                      )
                                    : 0n,
                            }))
                        )
                )
            ),
        refreshOn: () =>
            changesOrEvery$(changesOf$(backstopCalled), pollIntervalMs),
        needs: ['solana'],
        backoff,
        owns: [backstopCalled],
        // The guard it is made for is its starting data.
        start: {
            node: 'loading',
            data: {
                mint,
                admin,
                address: '',
                guard: undefined,
                supply: 0n,
                failedReads: 0,
            },
        },
    });
};
