import {
    concat,
    debounceTime,
    distinctUntilChanged,
    filter,
    map,
    NEVER,
    type Observable,
    pairwise,
    share,
    Subject,
    switchMap,
    take,
    withLatestFrom,
} from 'rxjs';
import { isAddress } from 'ethers';
import type { Address } from '@solana/kit';
import {
    changesOf$,
    createChainChangesMachine,
    createWalletTransactionMachine,
    type ProofRequestConnections,
    type ProofRequestStateNodeUnion,
    startReadThroughConnectionsMachine,
    type TransactionCall,
    type WalletAccount,
    type WalletAccountState,
    type WalletTransactionState,
} from '@nori-zk/nori-bridge-solana-sdk';
import { dataOnEntry$ } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { NoriSnapshot__factory, queryIdOf } from '@nori-zk/ethereum-snapshot';
import {
    createProvenRequestMachine,
    createSnapshotVerificationMachine,
    followedStates$,
    heldAcrossMoves,
    type SnapshotVerificationState,
} from '@nori-zk/backstop-keeper/read';
import { balanceQuery, type BalanceRequest, preview$ } from './preview.impl.js';
import { type Preview, ProveBalanceGraph, type ProveBalanceState } from './prove-balance.js';
import { createResumeMachine } from './resume.impl.js';
import { type ResumeState } from './resume.js';

export type { BalanceRequest } from './preview.impl.js';

/** How long the form waits after the last edit before reading. */
const EDIT_SETTLE_MS = 400;

/** Where the machine reads, proves and verifies. */
export interface ProveBalanceAddresses {
    /** The `NoriSnapshot` address. */
    snapshotAddress: string;
    /** The proof request queue `NoriSnapshot` enqueues on. */
    proofQueueAddress: string;
    /** An existing system account holding SOL: the simulation's fee payer, which pays nothing. */
    feePayer: Address;
}

/** The proof request a snapshot transaction enqueued, as the sdk's proof request machine follows it. */
export type FollowProof = (txHash: string) => Observable<ProofRequestStateNodeUnion>;

/** The data of the flow's nodes. */
type DataAt<TNode extends ProveBalanceState['node']> = Extract<
    ProveBalanceState,
    { node: TNode }
>['data'];

/** The resume machine once it has read the transaction. */
type Resumed = Extract<ResumeState, { node: 'current' }>;

/** The verification machine once the program verified the result. */
type Verified = Extract<SnapshotVerificationState, { node: 'verified' }>;

/**
 * Whether a request can be read: the asset is `eth` or an address, and the
 * holder is an address.
 *
 * @param request The asset and holder.
 * @returns Whether both are valid.
 */
const isComplete = ({ asset, holder }: BalanceRequest): boolean =>
    (asset === 'eth' || isAddress(asset)) && isAddress(holder);

/**
 * The request a state of the flow holds.
 *
 * @param state The flow's state.
 * @returns The asset and holder, or `undefined` while resuming or once `closed`.
 */
export const requestOf = (state: ProveBalanceState): BalanceRequest | undefined =>
    'asset' in state.data ? { asset: state.data.asset, holder: state.data.holder } : undefined;

/**
 * The balance and fee a state of the flow holds.
 *
 * @param state The flow's state.
 * @returns The preview, or `undefined` where the node holds none yet.
 */
export const previewOf = (state: ProveBalanceState): Preview | undefined =>
    'preview' in state.data ? state.data.preview : undefined;

/**
 * The account a state of the account machine holds.
 *
 * @param state The account machine's state.
 * @returns The account, or `undefined` while none is shared.
 */
const accountOf = (state: WalletAccountState): string | undefined =>
    'account' in state.data ? state.data.account : undefined;

/** `NoriSnapshot`'s ABI: what the snapshot call is encoded with, and what names a refusal. */
const noriSnapshotInterface = NoriSnapshot__factory.createInterface();

/**
 * The one `NoriSnapshot.snapshot` call that proves a request's balance,
 * paying the fee previewed.
 *
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param data The request and its preview.
 * @returns The call: the contract, its data and the fee.
 */
const snapshotCall = (
    snapshotAddress: string,
    { asset, holder, preview }: DataAt<'awaitingSignature'>,
): TransactionCall => ({
    to: snapshotAddress,
    data: noriSnapshotInterface.encodeFunctionData('snapshot', [[balanceQuery({ asset, holder })]]),
    value: preview.fee,
});

/**
 * The query id of a request's balance query, as the snapshot records it.
 *
 * @param request The asset and holder.
 * @returns The query id.
 */
const queryIdOfRequest = (request: BalanceRequest): string => {
    const query = balanceQuery(request);
    return queryIdOf(query.target, query.data);
};

/**
 * Starts the prove balance flow: at `resuming` for the transaction `?tx=`
 * names, else at `noAccount`.
 *
 * The balance and fee are the flow's own read (`ProveBalanceGraph` spreads
 * `readThroughConnectionsOf`), read through Ethereum and again on each new
 * Ethereum block. The flow's own steps gate on other machines' states, as
 * the ystate README's heater gates on `temperature$`: the wallet's account
 * machine, and the proof request machine `followProof` gives. The resume
 * machine, the snapshot's wallet transaction machine and the verification
 * machines are made for one thing each, on entry into the node that needs
 * them, and closed when the flow leaves it.
 *
 * @param connections The Ethereum and Solana chains; the snapshot is signed in the wallet.
 * @param account The wallet's account machine.
 * @param addresses The snapshot and queue addresses, and the simulation's fee payer.
 * @param followProof The proof request a snapshot transaction enqueued, followed by the sdk.
 * @param resumeTxHash The snapshot transaction `?tx=` names, to follow again.
 * @returns The running flow. Its controls:
 *   - `edit(request)`: replaces the asset and holder; a complete request is read once edits settle.
 *   - `prove()`: signs the snapshot, or signs it again after a decline or a failure.
 *   - `another()`: reads the same request again for another proof.
 *   - `retry()`: reads or verifies again now, after a failure.
 *   - `close()`: closes the flow.
 */
export function createProveBalanceMachine(
    connections: ProofRequestConnections,
    account: WalletAccount,
    addresses: ProveBalanceAddresses,
    followProof: FollowProof,
    resumeTxHash?: string,
): ProveBalanceMachine {
    const edit$ = new Subject<BalanceRequest>();
    const prove$ = new Subject<void>();
    const another$ = new Subject<void>();
    const verifyRetry$ = new Subject<void>();
    const sharedAccount$ = account.state$.pipe(
        map(accountOf),
        filter((shared): shared is string => shared !== undefined),
    );
    // A change of account after the node was entered: the one before and the one now.
    const accountChange$ = sharedAccount$.pipe(distinctUntilChanged(), pairwise());
    // Every edit re-enters `editing`, which resubscribes its edges: the settle
    // wait stays subscribed across those re-entries, or no edit would settle.
    const settled$ = edit$.pipe(
        debounceTime(EDIT_SETTLE_MS),
        filter(isComplete),
        share({ resetOnRefCountZero: false }),
    );
    const newBlocks = createChainChangesMachine(connections.ethereum);

    const flow = startReadThroughConnectionsMachine(ProveBalanceGraph, {
        connections,
        read: (clients, previous) =>
            clients
                .ethereum((provider) => preview$(provider, addresses.snapshotAddress, previous))
                .pipe(
                    map((preview) => ({ asset: previous.asset, holder: previous.holder, preview })),
                ),
        refreshOn: () => changesOf$(newBlocks),
        needs: ['ethereum'],
        owns: [newBlocks],
        start:
            resumeTxHash === undefined
                ? { node: 'noAccount', data: { asset: 'eth', holder: '' } }
                : { node: 'resuming', data: { txHash: resumeTxHash } },
        ownTransitions: (_read$, state$) => {
            /** The holder follows the account while it is the account before the change. */
            const followed$ = accountChange$.pipe(
                withLatestFrom(state$.pipe(map(requestOf))),
                filter(
                    (change): change is [[string, string], BalanceRequest] =>
                        change[1] !== undefined && change[1].holder === change[0][0],
                ),
                map(([[, now], { asset }]) => ({ asset, holder: now })),
            );
            // The resume machine, made for the transaction `resuming` holds, until it has read it.
            const resumed$ = dataOnEntry$(state$, 'resuming').pipe(
                switchMap(({ txHash }) =>
                    followedStates$(() =>
                        createResumeMachine(connections, addresses.snapshotAddress, txHash),
                    ),
                ),
                filter((state): state is Resumed => state.node === 'current'),
                take(1),
                share(),
            );
            // The snapshot's transaction, made and sent on entry into `awaitingSignature`
            // and followed through `proving`; leaving both closes it.
            const transaction$: Observable<WalletTransactionState> = dataOnEntry$(
                state$,
                'awaitingSignature',
            ).pipe(
                switchMap((data) =>
                    concat(
                        followedStates$(() => {
                            const transaction = createWalletTransactionMachine(
                                connections,
                                snapshotCall(addresses.snapshotAddress, data),
                                { errors: noriSnapshotInterface },
                            );
                            transaction.send();
                            return transaction;
                        }),
                        // Its states end at `confirmed`; the edges still following it wait instead.
                        NEVER,
                    ),
                ),
                heldAcrossMoves(),
            );
            /** The proof request machine reaching `node` while `proving`, once. */
            const proofRequestAt$ = <TNode extends ProofRequestStateNodeUnion['node']>(
                node: TNode,
            ) =>
                dataOnEntry$(state$, 'proving').pipe(
                    switchMap(({ txHash }) => followProof(txHash)),
                    filter(
                        (state): state is Extract<ProofRequestStateNodeUnion, { node: TNode }> =>
                            state.node === node,
                    ),
                    take(1),
                );
            // The proven request and verification machines, made for the snapshot
            // `verifying` holds and followed through `verifyFailed`; leaving both closes them.
            const verification$: Observable<SnapshotVerificationState> = dataOnEntry$(
                state$,
                'verifying',
            ).pipe(
                switchMap(({ asset, holder, txHash }) =>
                    followedStates$(() => {
                        const proven = createProvenRequestMachine(
                            connections,
                            addresses.proofQueueAddress,
                            { state$: followProof(txHash) },
                        );
                        const verification = createSnapshotVerificationMachine(
                            connections,
                            {
                                noriSnapshot: addresses.snapshotAddress,
                                feePayer: addresses.feePayer,
                            },
                            {
                                snapshotTxHash: txHash,
                                queryId: queryIdOfRequest({ asset, holder }),
                            },
                            proven,
                        );
                        return {
                            state$: verification.state$,
                            retry: () => verification.retry(),
                            close: () => {
                                verification.close();
                                proven.close();
                            },
                        };
                    }, verifyRetry$),
                ),
                heldAcrossMoves(),
            );
            /** The verification machine reaching `node`, once. */
            const verificationAt$ = <TNode extends SnapshotVerificationState['node']>(
                node: TNode,
            ) =>
                verification$.pipe(
                    filter(
                        (state): state is Extract<SnapshotVerificationState, { node: TNode }> =>
                            state.node === node,
                    ),
                    take(1),
                );
            /** The request, its preview and why it failed: what `sendFailed` holds. */
            const failedWith =
                (error: string) =>
                (
                    _ended: unknown,
                    _dest: unknown,
                    { asset, holder, preview }: DataAt<'proving'>,
                ) => ({
                    asset,
                    holder,
                    preview,
                    error,
                });

            return {
                resumed: {
                    $: () =>
                        resumed$.pipe(
                            map(({ data }) => data.request),
                            filter((request) => request !== undefined),
                        ),
                    next: (
                        request: NonNullable<Resumed['data']['request']>,
                        _dest: unknown,
                        { txHash }: DataAt<'resuming'>,
                    ): DataAt<'proving'> => ({ ...request, txHash }),
                },
                notResumable: {
                    $: () => resumed$.pipe(filter(({ data }) => data.request === undefined)),
                    next: (): DataAt<'noAccount'> => ({ asset: 'eth', holder: '' }),
                },
                accountShared: {
                    $: () => sharedAccount$.pipe(take(1)),
                    next: (holder: string): DataAt<'loading'> => ({
                        asset: 'eth',
                        holder,
                        preview: undefined,
                        failedReads: 0,
                    }),
                },
                accountChanged: {
                    $: () => followed$,
                    next: (request: BalanceRequest): DataAt<'loading'> => ({
                        ...request,
                        preview: undefined,
                        failedReads: 0,
                    }),
                },
                accountChangedWhileEditing: {
                    $: () => followed$,
                    next: (request: BalanceRequest): DataAt<'editing'> => request,
                },
                edit: {
                    $: () => edit$,
                    next: (request: BalanceRequest): DataAt<'editing'> => request,
                },
                editSettled: {
                    $: () => settled$,
                    next: (request: BalanceRequest): DataAt<'loading'> => ({
                        ...request,
                        preview: undefined,
                        failedReads: 0,
                    }),
                },
                prove: {
                    $: () =>
                        prove$.pipe(
                            withLatestFrom(state$),
                            map(([, state]) => previewOf(state)),
                            filter((preview): preview is Preview => preview !== undefined),
                        ),
                    next: (
                        preview: Preview,
                        _dest: unknown,
                        { asset, holder }: BalanceRequest,
                    ): DataAt<'awaitingSignature'> => ({ asset, holder, preview }),
                },
                signed: {
                    $: () =>
                        transaction$.pipe(
                            map((state) =>
                                'transactionHash' in state.data ? state.data.transactionHash : '',
                            ),
                            filter((hash) => hash !== ''),
                            take(1),
                        ),
                    next: (
                        txHash: string,
                        _dest: unknown,
                        source: DataAt<'awaitingSignature'>,
                    ): DataAt<'proving'> => ({ ...source, txHash }),
                },
                userDeclined: {
                    $: () =>
                        transaction$.pipe(
                            filter(({ node }) => node === 'declined'),
                            take(1),
                        ),
                    next: (
                        _declined: unknown,
                        _dest: unknown,
                        source: DataAt<'awaitingSignature'>,
                    ): DataAt<'declined'> => source,
                },
                sendRejected: {
                    $: () =>
                        transaction$.pipe(
                            map((state) => {
                                if (state.node === 'refused') return state.data.errorName;
                                // The wallet's own error is not for the page: say what happened in plain words.
                                if (state.node === 'sendFailed')
                                    return "Your wallet couldn't send the transaction. Prove again once it has no transaction pending.";
                                if (state.node === 'notReadyToSend')
                                    return `Waiting on ${state.data.waitingOn.join(', ')}`;
                                return undefined;
                            }),
                            filter((error): error is string => error !== undefined),
                            take(1),
                        ),
                    next: (
                        error: string,
                        _dest: unknown,
                        source: DataAt<'awaitingSignature'>,
                    ): DataAt<'sendFailed'> => ({ ...source, error }),
                },
                another: {
                    $: () => another$,
                    next: (
                        _another: unknown,
                        _dest: unknown,
                        { asset, holder }: BalanceRequest,
                    ): DataAt<'loading'> => ({ asset, holder, preview: undefined, failedReads: 0 }),
                },
                transactionReverted: {
                    $: () =>
                        transaction$.pipe(
                            filter(({ node }) => node === 'reverted'),
                            take(1),
                        ),
                    next: (_reverted: unknown, dest: unknown, source: DataAt<'proving'>) =>
                        failedWith(`The transaction ${source.txHash} failed on Ethereum`)(
                            undefined,
                            dest,
                            source,
                        ),
                },
                transactionReplaced: {
                    $: () => proofRequestAt$('transactionReplaced'),
                    next: (_replaced: unknown, dest: unknown, source: DataAt<'proving'>) =>
                        failedWith(`The transaction ${source.txHash} was replaced on Ethereum`)(
                            undefined,
                            dest,
                            source,
                        ),
                },
                transactionDropped: {
                    $: () => proofRequestAt$('transactionDropped'),
                    next: (_dropped: unknown, dest: unknown, source: DataAt<'proving'>) =>
                        failedWith(`The transaction ${source.txHash} was dropped on Ethereum`)(
                            undefined,
                            dest,
                            source,
                        ),
                },
                proofAvailable: {
                    $: () => proofRequestAt$('proofAvailable'),
                    next: (
                        { data }: Extract<ProofRequestStateNodeUnion, { node: 'proofAvailable' }>,
                        _dest: unknown,
                        source: DataAt<'proving'>,
                    ): DataAt<'verifying'> => ({
                        ...source,
                        proofQueueBatchIndex: data.snapshot.proofQueueBatchIndex,
                        proofQueueBatchAddress: data.snapshot.proofQueueBatchAddress,
                    }),
                },
                verified: {
                    $: () => verificationAt$('verified'),
                    next: (
                        { data }: Verified,
                        _dest: unknown,
                        source: DataAt<'verifying'>,
                    ): DataAt<'verified'> => ({
                        ...source,
                        provenBalance: BigInt(data.read.result),
                        ethBlockNumber: data.read.ethBlockNumber,
                        ethTimestamp: data.read.ethTimestamp,
                        provenBlockNumber: data.read.provenBlockNumber,
                        unitsConsumed: data.unitsConsumed,
                    }),
                },
                verifyError: {
                    $: () => verificationAt$('readFailed'),
                    next: (
                        _failed: unknown,
                        _dest: unknown,
                        source: DataAt<'verifying'>,
                    ): DataAt<'verifyFailed'> => source,
                },
                verifyRetry: {
                    $: () => verificationAt$('simulating'),
                    next: (
                        _again: unknown,
                        _dest: unknown,
                        source: DataAt<'verifyFailed'>,
                    ): DataAt<'verifying'> => source,
                },
            };
        },
    });

    const retryRead = flow.retry;
    return Object.assign(flow, {
        edit: (request: BalanceRequest) => edit$.next(request),
        prove: () => prove$.next(),
        another: () => another$.next(),
        retry: () => {
            retryRead();
            verifyRetry$.next();
        },
    });
}

/** The running prove balance flow, with its controls. */
export type ProveBalanceMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof ProveBalanceGraph.nodes,
        typeof ProveBalanceGraph.edges,
        BalanceRequest & { preview: Preview }
    >
> & {
    edit: (request: BalanceRequest) => void;
    prove: () => void;
    another: () => void;
};
