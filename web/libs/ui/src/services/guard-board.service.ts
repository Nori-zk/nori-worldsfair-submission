import { Injectable } from '@yaw-rx/core';
import {
    catchError,
    defer,
    filter,
    type Observable,
    of,
    shareReplay,
    switchMap,
    take,
    timer,
} from 'rxjs';
import { decodeBase64 } from 'ethers';
import { type Address } from '@solana/kit';
import { ConnectionsService } from './connections.service.js';
import { type SolanaRpc } from '@nori-zk/nori-bridge-solana-sdk';
import {
    BACKSTOP_PROGRAM,
    decodeGuard,
    guardStatus,
    mintDecimals,
    mintSupply,
    type GuardState,
} from '@nori-zk/backstop-client/guard';

/** How often the board reads the guards again. */
const REFRESH_MS = 30_000;

/** One guard and its mint's live supply. */
export interface GuardRead {
    address: Address;
    guard: GuardState;
    supply: bigint;
    decimals: number;
    status: ReturnType<typeof guardStatus>;
}

/**
 * Every Backstop guard on the cluster with its mint's live supply.
 *
 * @param rpc The Solana RPC.
 * @returns The guards whose mint exists.
 */
async function readGuards(rpc: SolanaRpc): Promise<GuardRead[]> {
    // Backstop owns only guard accounts
    const accounts = await rpc.getProgramAccounts(BACKSTOP_PROGRAM, { encoding: 'base64' }).send();
    const guards = accounts.map(({ pubkey, account }) => ({
        address: pubkey,
        guard: decodeGuard(decodeBase64(account.data[0])),
    }));
    const { value: mints } = await rpc
        .getMultipleAccounts(
            guards.map(({ guard }) => guard.mint),
            { encoding: 'base64' },
        )
        .send();
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
}

/**
 * The board's guards, read every `REFRESH_MS` once Solana's http connection
 * is first ready: the guards, or why reading them failed.
 */
@Injectable([ConnectionsService])
export class GuardBoardService {
    readonly guards$: Observable<GuardRead[] | string>;

    /**
     * @param connections The connections; the guards are read over Solana's.
     */
    constructor(connections: ConnectionsService) {
        const { solana } = connections.connections;
        this.guards$ = solana.http.connection.state$.pipe(
            filter(({ node }) => node === 'ready'),
            take(1),
            switchMap(() => timer(0, REFRESH_MS)),
            switchMap(() =>
                defer(async () => readGuards(await solana.http.ready())).pipe(
                    catchError((error: unknown) =>
                        of(error instanceof Error ? error.message : String(error)),
                    ),
                ),
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }
}
