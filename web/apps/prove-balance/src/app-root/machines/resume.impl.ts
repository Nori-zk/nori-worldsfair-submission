import { map, NEVER, type Observable, of, switchMap } from 'rxjs';
import { dataLength, dataSlice, getAddress, type TransactionResponse } from 'ethers';
import {
    dueOn,
    type EthereumProvider,
    ethRpcRead$,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { balanceQuery, type BalanceRequest, MULTICALL3_ADDRESS, preview$ } from './preview.impl.js';
import { ResumeGraph, type ResumeState } from './resume.js';

/** The request `current` holds. */
type ResumedRequest = Extract<ResumeState, { node: 'current' }>['data']['request'];

/**
 * The balance request a snapshot transaction sent: only a snapshot of one
 * balance query, with the exact query this app builds for it.
 *
 * @param tx The transaction.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @returns The request, or `undefined` when the transaction is not one this app sends.
 */
const balanceRequestOf = (
    tx: TransactionResponse | null,
    snapshotAddress: string,
): BalanceRequest | undefined => {
    if (tx?.to?.toLowerCase() !== snapshotAddress.toLowerCase()) return undefined;
    const call = NoriSnapshot__factory.createInterface().parseTransaction(tx);
    const queries = (call?.name === 'snapshot' ? call.args[0] : []) as {
        target: string;
        data: string;
    }[];
    const [query] = queries;
    if (queries.length !== 1 || query === undefined || dataLength(query.data) !== 36)
        return undefined;
    const { target, data } = query;
    // The call's one argument, an address: the last 20 bytes of its word
    const holder = getAddress(dataSlice(data, 16));
    const request = {
        asset: getAddress(target) === MULTICALL3_ADDRESS ? 'eth' : getAddress(target),
        holder,
    };
    // The selector too: only the exact query this app builds for the request
    return balanceQuery(request).data.toLowerCase() === data.toLowerCase() ? request : undefined;
};

/**
 * The request a snapshot transaction sent, with its symbol and decimals
 * read again, the balance at the latest block, and the fee it paid.
 *
 * @param provider The provider the read goes through.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param txHash The snapshot transaction.
 * @returns The request, or `undefined` when the transaction is not one this app sends, once.
 */
const resumedRequest$ = (
    provider: EthereumProvider,
    snapshotAddress: string,
    txHash: string,
): Observable<ResumedRequest> =>
    ethRpcRead$(async () => provider.getTransaction(txHash), `Failed to read ${txHash}.`).pipe(
        switchMap((tx) => {
            const request = balanceRequestOf(tx, snapshotAddress);
            return request === undefined || tx === null
                ? of(undefined)
                : preview$(provider, snapshotAddress, request).pipe(
                      map((preview) => ({ ...request, preview: { ...preview, fee: tx.value } })),
                  );
        }),
    );

/** The running resume machine, with its controls. */
export type ResumeMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<typeof ResumeGraph.nodes, typeof ResumeGraph.edges>
>;

/**
 * Starts reading the request a snapshot transaction sent, through the
 * Ethereum connection, so a page opened at `?tx=` follows that proof again.
 * A sent transaction never changes, so it is never read again.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param txHash The snapshot transaction `?tx=` names.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the request, or `undefined` for a transaction this app did not send. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createResumeMachine = (
    connections: ProofRequestConnections,
    snapshotAddress: string,
    txHash: string,
    backoff: ReadRetryBackoff = {},
): ResumeMachine =>
    startReadThroughConnectionsMachine(ResumeGraph, {
        connections,
        read: (clients, { txHash: held }) =>
            clients
                .ethereum((provider) => resumedRequest$(provider, snapshotAddress, held))
                .pipe(map((request) => ({ txHash: held, request }))),
        refreshOn: () => dueOn(NEVER),
        needs: ['ethereum'],
        backoff,
        // The transaction it is made for is its starting data.
        start: { node: 'loading', data: { txHash, request: undefined, failedReads: 0 } },
    });
