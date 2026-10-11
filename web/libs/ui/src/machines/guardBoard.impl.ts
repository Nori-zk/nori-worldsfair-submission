import { map, type Observable, switchMap } from 'rxjs';
import { decodeBase64 } from 'ethers';
import {
    changesOf$,
    createSolanaChangesMachine,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    type SolanaRpc,
    solanaRpcRead$,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    BACKSTOP_PROGRAM,
    decodeGuard,
    guardStatus,
    mintDecimals,
    mintSupply,
} from '@nori-zk/backstop-keeper/guard';
import { changesOrEvery$ } from '@nori-zk/backstop-keeper/read';
import { GuardBoardGraph, type GuardRead } from './guardBoard.js';

/** How often the board reads the guards again, as a guard's status moves with the clock. */
const REFRESH_MS = 30_000;

/**
 * Every Backstop guard on the cluster with its mint's live supply.
 *
 * @param rpc The Solana RPC.
 * @returns The guards whose mint exists, once.
 */
const guards$ = (rpc: SolanaRpc): Observable<GuardRead[]> =>
    solanaRpcRead$(
        async (abortSignal) =>
            // Backstop owns only guard accounts
            rpc.getProgramAccounts(BACKSTOP_PROGRAM, { encoding: 'base64' }).send({ abortSignal }),
        'Failed to read the Backstop guards.',
    ).pipe(
        map((accounts) =>
            accounts.map(({ pubkey, account }) => ({
                address: pubkey,
                guard: decodeGuard(decodeBase64(account.data[0])),
            })),
        ),
        switchMap((guards) =>
            solanaRpcRead$(
                async (abortSignal) =>
                    rpc
                        .getMultipleAccounts(
                            guards.map(({ guard }) => guard.mint),
                            { encoding: 'base64' },
                        )
                        .send({ abortSignal }),
                "Failed to read the guards' mints.",
            ).pipe(
                map(({ value: mints }) => {
                    const now = BigInt(Math.floor(Date.now() / 1000));
                    return guards.flatMap(({ address, guard }, i) => {
                        const mint = mints[i];
                        if (!mint) return [];
                        const data = decodeBase64(mint.data[0]);
                        const supply = mintSupply(data);
                        return [
                            {
                                address,
                                guard,
                                supply,
                                decimals: mintDecimals(data),
                                status: guardStatus(guard, supply, now),
                            },
                        ];
                    });
                }),
            ),
        ),
    );

/** The running guard board machine, with its controls. */
export type GuardBoardMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof GuardBoardGraph.nodes,
        typeof GuardBoardGraph.edges
    >
>;

/**
 * Starts reading every Backstop guard through the Solana connection, and
 * reading them again on each transaction that calls Backstop and every
 * `REFRESH_MS`.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the guards. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createGuardBoardMachine = (
    connections: ProofRequestConnections,
    backoff: ReadRetryBackoff = {},
): GuardBoardMachine => {
    const backstopCalled = createSolanaChangesMachine(connections.solana, {
        mentions: BACKSTOP_PROGRAM,
    });
    return startReadThroughConnectionsMachine(GuardBoardGraph, {
        connections,
        read: (clients) => clients.solana(guards$).pipe(map((guards) => ({ guards }))),
        refreshOn: () => changesOrEvery$(changesOf$(backstopCalled), REFRESH_MS),
        needs: ['solana'],
        backoff,
        owns: [backstopCalled],
    });
};
