import { Injectable } from '@yaw-rx/core';
import { distinctUntilChanged, filter, map, type Observable, Subscription, take } from 'rxjs';
import { isHexString } from 'ethers';
import { NoWalletConfiguredError } from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService, ProofProgressService } from '@nori-zk/solana-web-ui';
import {
    type BalanceRequest,
    createProveBalanceMachine,
    type ProveBalanceAddresses,
    type ProveBalanceMachine,
    requestOf,
} from '../machines/prove-balance.impl.js';
import type { ProveBalanceState } from '../machines/prove-balance.js';

export type { ProveBalanceMachine } from '../machines/prove-balance.impl.js';

/** The snapshot and queue this build proves with, and the verifying simulation's fee payer. */
const ADDRESSES: ProveBalanceAddresses = {
    snapshotAddress: NORI_WEB_ENV.ethereum.snapshotAddress,
    proofQueueAddress: NORI_WEB_ENV.ethereum.proofQueueAddress,
    feePayer: NORI_WEB_ENV.solana.feePayer,
};

/**
 * The snapshot transaction `?tx=` names.
 *
 * @returns The transaction hash, or `undefined` when there is none or it is not a hash.
 */
const txFromUrl = (): string | undefined => {
    const tx = new URLSearchParams(window.location.search).get('tx') ?? '';
    return isHexString(tx, 32) ? tx : undefined;
};

/**
 * Runs the prove balance flow for the app's lifetime, from the start: it
 * waits in `noAccount` until the wallet shares an account, then reads ETH
 * for it; the address then follows the wallet's account until the user
 * types another. A page opened at `?tx=` follows that snapshot's proof
 * instead, and the snapshot being proven stays in the URL, so a reload
 * comes back to it.
 */
@Injectable([ConnectionsService, ProofProgressService])
export class ProveBalanceService {
    /** The running flow. */
    readonly machine: ProveBalanceMachine;
    private readonly subscriptions = new Subscription();

    /**
     * @param connections The connections, the wallet and its account.
     * @param proofProgress Follows each snapshot transaction's proof request.
     * @throws {NoWalletConfiguredError} When the app's connections have no wallet.
     */
    constructor(connections: ConnectionsService, proofProgress: ProofProgressService) {
        const { account } = connections.wallet;
        if (account === undefined) throw new NoWalletConfiguredError();
        this.machine = createProveBalanceMachine(
            connections.connections,
            account,
            ADDRESSES,
            (hash) => proofProgress.follow(hash).request$,
            txFromUrl(),
        );
        this.subscriptions.add(
            this.state$
                .pipe(
                    map(({ data }) => ('txHash' in data ? data.txHash : '')),
                    distinctUntilChanged(),
                )
                .subscribe((txHash) => {
                    const url = new URL(window.location.href);
                    if (txHash === '') url.searchParams.delete('tx');
                    else url.searchParams.set('tx', txHash);
                    window.history.replaceState(null, '', url);
                }),
        );
    }

    /** The flow's states. */
    get state$(): Observable<ProveBalanceState> {
        return this.machine.state$;
    }

    /**
     * Edits the request the flow holds.
     *
     * @param change The new request, from the current one.
     * @returns {void}
     */
    edit(change: (request: BalanceRequest) => BalanceRequest): void {
        this.state$
            .pipe(
                take(1),
                map(requestOf),
                filter((request): request is BalanceRequest => request !== undefined),
            )
            .subscribe((request) => this.machine.edit(change(request)));
    }

    /**
     * Closes the flow with the app.
     * @returns {void}
     */
    onDestroy(): void {
        this.subscriptions.unsubscribe();
        this.machine.close();
        this.machine.stop();
    }
}
