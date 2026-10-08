import { Injectable } from '@yaw-rx/core';
import {
    filter,
    type Observable,
    pairwise,
    ReplaySubject,
    shareReplay,
    startWith,
    Subscription,
    switchMap,
    take,
    withLatestFrom,
} from 'rxjs';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { type BalanceRequest, createProveBalanceMachine } from '../ystate/prove-balance.impl.js';
import type { ProveBalanceState } from '../ystate/prove-balance.js';

/** The prove balance machine and its controls, started. */
export type ProveBalanceMachine = ReturnType<typeof createProveBalanceMachine>;

/** The nodes where the address follows the wallet's account while the user has not typed another. */
const FOLLOWS_ACCOUNT: ProveBalanceState['node'][] = [
    'editing',
    'reading',
    'waitingForConnection',
    'readFailed',
    'balanceRead',
];

/**
 * Owns the prove balance machine for the app's lifetime. It starts with the
 * first account the wallet shares, as the address, reading ETH at once; the
 * address then follows the wallet's account until the user types another.
 */
@Injectable([ConnectionsService])
export class ProveBalanceService {
    /** The running machine, once the wallet has shared an account. */
    readonly machine$ = new ReplaySubject<ProveBalanceMachine>(1);
    /** The machine's states. */
    readonly state$: Observable<ProveBalanceState> = this.machine$.pipe(
        switchMap(({ proveBalance }) => proveBalance.state$),
        shareReplay({ bufferSize: 1, refCount: false }),
    );
    private readonly subscriptions = new Subscription();
    private machine: ProveBalanceMachine | undefined;

    /**
     * @param connections The connections, the wallet and its account.
     */
    constructor(connections: ConnectionsService) {
        const wallet = connections.wallet;
        if (wallet === undefined) return;
        this.subscriptions.add(
            connections.account$
                .pipe(
                    filter((account) => account !== ''),
                    take(1),
                )
                .subscribe((account) => {
                    const initial: BalanceRequest = { asset: 'eth', holder: account };
                    const machine = createProveBalanceMachine(
                        connections.connections,
                        wallet,
                        NORI_WEB_ENV.ethereum.snapshotAddress,
                        initial,
                    );
                    this.machine = machine;
                    this.machine$.next(machine);
                    machine.edit(initial);
                }),
        );
        this.subscriptions.add(
            connections.account$
                .pipe(
                    pairwise(),
                    withLatestFrom(this.state$.pipe(startWith(undefined))),
                    filter(
                        ([[previous, current], state]) =>
                            current !== '' &&
                            state !== undefined &&
                            state.data.holder === previous &&
                            FOLLOWS_ACCOUNT.includes(state.node),
                    ),
                )
                .subscribe(([[, current], state]) =>
                    this.machine?.edit({ asset: state?.data.asset ?? 'eth', holder: current }),
                ),
        );
    }

    /**
     * Edits the request the machine holds.
     *
     * @param change The new request, from the current one.
     * @returns {void}
     */
    edit(change: (request: BalanceRequest) => BalanceRequest): void {
        this.state$.pipe(take(1)).subscribe(({ data }) =>
            this.machine?.edit(change({ asset: data.asset, holder: data.holder })),
        );
    }

    /**
     * Stops the machine with the app.
     * @returns {void}
     */
    onDestroy(): void {
        this.subscriptions.unsubscribe();
        this.machine?.proveBalance.stop();
    }
}
