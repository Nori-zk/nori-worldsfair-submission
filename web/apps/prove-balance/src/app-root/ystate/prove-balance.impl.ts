import {
    catchError,
    concat,
    debounceTime,
    defer,
    filter,
    from,
    map,
    NEVER,
    type Observable,
    of,
    ReplaySubject,
    share,
    Subject,
    switchMap,
    take,
    throwError,
    timeout,
    timer,
} from 'rxjs';
import { Contract, dataLength, isAddress, isError, type TransactionReceipt } from 'ethers';
import type { Address } from '@solana/kit';
import {
    bothReady$,
    ConnectionNotReadyError,
    type ConnectionName,
    type Connections,
    type EthereumProvider,
    forCalls,
    type ProofRequestConnections,
    type ProofRequestStateNodeUnion,
    waitingOnChanged$,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    atNode,
    dataOnEntry$,
    type StartedMachine,
    stateOf$,
} from '@nori-zk/nori-bridge-solana-sdk/utils';
import { encodeQueryData, NoriSnapshot__factory, queryIdOf } from '@nori-zk/ethereum-snapshot';
import { verifySnapshotResult } from '@nori-zk/backstop-client/read';
import { ProveBalanceGraph, type ProveBalanceState } from './prove-balance.js';

/** Multicall3, at the same address on every chain: its `getEthBalance` makes an ETH balance a view call. */
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** How long the form waits after the last edit before reading. */
const EDIT_SETTLE_MS = 400;

/** The wait before reading again after the first failed read; it doubles with each one after it. */
const RETRY_INITIAL_MS = 1000;
/** The longest wait between reads after failures. */
const RETRY_MAX_MS = 30_000;
/** The longest verifying a result may take before it counts as failed. */
const READ_TIMEOUT_MS = 60_000;

/** Where the machine reads, proves and verifies. */
export interface ProveBalanceAddresses {
    /** The `NoriSnapshot` address. */
    snapshotAddress: string;
    /** The proof request queue `NoriSnapshot` enqueues on. */
    proofQueueAddress: string;
    /** The Nori program that commits proof queue batches. */
    noriProgram: Address;
    /** An existing system account holding SOL: the simulation's fee payer, which pays nothing. */
    feePayer: Address;
}

/** The proof request a snapshot transaction enqueued, as the sdk's proof request machine follows it. */
export type FollowProof = (txHash: string) => Observable<ProofRequestStateNodeUnion>;

/** The asset and holder the form holds. */
export interface BalanceRequest {
    /** `eth`, or an ERC-20 token's address. */
    asset: string;
    /** The Ethereum address whose balance is proven. */
    holder: string;
}

/** What reading a request found. */
interface Preview {
    symbol: string;
    decimals: number;
    balance: bigint;
    fee: bigint;
}

/** The ERC-20 calls that name a token and scale its balance. */
const TOKEN_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
];

/** How reading a request ended. */
type ReadOutcome =
    | { outcome: 'succeeded'; value: Preview }
    | { outcome: 'connectionLost'; waitingOn: ConnectionName[] }
    | { outcome: 'failed'; error: string };

/** How verifying a result ended. */
type Outcome<T> = { outcome: 'succeeded'; value: T } | { outcome: 'failed'; error: string };

/** What `read_snapshot_result` verified on Solana, and what it cost. */
interface VerifiedBalance {
    provenBalance: bigint;
    ethBlockNumber: bigint;
    ethTimestamp: bigint;
    provenBlockNumber: bigint;
    unitsConsumed: bigint;
}

/** How sending the snapshot ended. */
type SendOutcome =
    | { outcome: 'signed'; txHash: string }
    | { outcome: 'declined' }
    | { outcome: 'failed'; error: string };

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
 * The view call `NoriSnapshot` makes for a balance: `balanceOf(holder)` on
 * the token, or Multicall3's `getEthBalance(holder)` for ETH.
 *
 * @param request The asset and holder.
 * @returns The call's target and calldata.
 */
const balanceQuery = ({ asset, holder }: BalanceRequest): { target: string; data: string } =>
    asset === 'eth'
        ? {
              target: MULTICALL3_ADDRESS,
              data: encodeQueryData({ signature: 'getEthBalance(address)', args: [holder] }),
          }
        : {
              target: asset,
              data: encodeQueryData({ signature: 'balanceOf(address)', args: [holder] }),
          };

/**
 * Reads the balance with the call the snapshot will make, and the snapshot fee.
 *
 * @param provider The Ethereum provider reads go through.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param request The asset and holder.
 * @returns The balance and the fee.
 * @throws When the call does not return exactly one 32-byte word.
 */
async function readPreview(
    provider: EthereumProvider,
    snapshotAddress: string,
    request: BalanceRequest,
): Promise<Preview> {
    const query = balanceQuery(request);
    const word = await provider.call({ to: query.target, data: query.data });
    if (dataLength(word) !== 32)
        throw new Error(`The balance call returned ${dataLength(word).toString()} bytes, not 32.`);
    const fee = await NoriSnapshot__factory.connect(snapshotAddress, provider).snapshotFee();
    if (request.asset === 'eth') return { symbol: 'ETH', decimals: 18, balance: BigInt(word), fee };
    const token = new Contract(request.asset, TOKEN_ABI, provider);
    const [symbol, decimals] = await Promise.all([
        token.getFunction('symbol')() as Promise<string>,
        token.getFunction('decimals')() as Promise<bigint>,
    ]);
    return { symbol, decimals: Number(decimals), balance: BigInt(word), fee };
}

/**
 * Reads the balance and fee through Ethereum's calls order. Nothing in it
 * able to serve the read is a lost connection, naming the chains; any other
 * failure is the read's own.
 *
 * @param ethereum The Ethereum chain.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param request The asset and holder.
 * @returns How the read ended, once.
 */
function readPreview$(
    ethereum: Connections['ethereum'],
    snapshotAddress: string,
    request: BalanceRequest,
): Observable<ReadOutcome> {
    return defer(async () => forCalls(ethereum, readPreview, snapshotAddress, request)).pipe(
        map((value): ReadOutcome => ({ outcome: 'succeeded', value })),
        catchError((error: unknown) =>
            of<ReadOutcome>(
                error instanceof ConnectionNotReadyError
                    ? {
                          outcome: 'connectionLost',
                          waitingOn: [
                              ...new Set(
                                  error.notReady.map(
                                      ({ transport }) => transport.split('.')[0] as ConnectionName,
                                  ),
                              ),
                          ],
                      }
                    : {
                          outcome: 'failed',
                          error: error instanceof Error ? error.message : String(error),
                      },
            ),
        ),
    );
}

/**
 * Sends `NoriSnapshot.snapshot` with the balance query and the fee, signed
 * in the user's wallet.
 *
 * @param wallet The user's wallet, which signs while it is `ready`.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param request The asset, holder and fee.
 * @returns How the send ended.
 */
function sendSnapshot$(
    wallet: Connections['ethereum']['wallet'],
    snapshotAddress: string,
    request: BalanceRequest & { fee: bigint },
): Observable<SendOutcome> {
    return from(
        (async (): Promise<SendOutcome> => {
            const signer = await (await wallet.ready()).getSigner();
            const snapshot = NoriSnapshot__factory.connect(snapshotAddress, signer);
            const transaction = await snapshot.snapshot([balanceQuery(request)], {
                value: request.fee,
            });
            return { outcome: 'signed', txHash: transaction.hash };
        })(),
    ).pipe(
        catchError((error: unknown) =>
            of<SendOutcome>(
                isError(error, 'ACTION_REJECTED')
                    ? { outcome: 'declined' }
                    : {
                          outcome: 'failed',
                          error: error instanceof Error ? error.message : String(error),
                      },
            ),
        ),
    );
}

/**
 * The transaction's receipt once it is mined, through the user's wallet.
 *
 * @param wallet The user's wallet.
 * @param txHash The transaction's hash.
 * @returns The receipt, once; nothing when it cannot be read.
 */
function receiptOf$(
    wallet: Connections['ethereum']['wallet'],
    txHash: string,
): Observable<TransactionReceipt> {
    return from((async () => (await wallet.ready()).waitForTransaction(txHash))()).pipe(
        filter((receipt): receipt is TransactionReceipt => receipt !== null),
        catchError(() => NEVER),
    );
}

/**
 * How long a failed read waits before reading again: doubling from
 * `RETRY_INITIAL_MS` with each failure in a row, up to `RETRY_MAX_MS`.
 *
 * @param failedReads The failed reads in a row, from 1.
 * @returns The wait in ms.
 */
const retryDelayMs = (failedReads: number): number =>
    Math.min(RETRY_INITIAL_MS * 2 ** (failedReads - 1), RETRY_MAX_MS);

/**
 * Verifies the balance a proven snapshot recorded, on Solana: builds the
 * result's witness and simulates `read_snapshot_result` with it.
 *
 * @param connections The Ethereum and Solana chains.
 * @param addresses The snapshot, queue and programs, and the simulation's fee payer.
 * @param request The asset, holder and snapshot transaction.
 * @returns What the program verified, and its compute units.
 */
async function verifyBalance(
    connections: ProofRequestConnections,
    addresses: ProveBalanceAddresses,
    request: BalanceRequest & { txHash: string },
): Promise<VerifiedBalance> {
    const query = balanceQuery(request);
    const { read, unitsConsumed } = await verifySnapshotResult({
        connections,
        noriSnapshot: addresses.snapshotAddress,
        proofQueue: addresses.proofQueueAddress,
        snapshotTxHash: request.txHash,
        noriProgram: addresses.noriProgram,
        queryId: queryIdOf(query.target, query.data),
        feePayer: addresses.feePayer,
    });
    return {
        provenBalance: BigInt(read.result),
        ethBlockNumber: read.ethBlockNumber,
        ethTimestamp: read.ethTimestamp,
        provenBlockNumber: read.provenBlockNumber,
        unitsConsumed,
    };
}

/**
 * Runs `read` once both chains can serve it, and gives up after
 * `READ_TIMEOUT_MS`.
 *
 * @param connections The Ethereum and Solana chains.
 * @param read The read.
 * @returns How it ended, once.
 */
function attempt$<T>(
    connections: ProofRequestConnections,
    read: () => Promise<T>,
): Observable<Outcome<T>> {
    return bothReady$(connections).pipe(
        switchMap(() =>
            defer(read).pipe(
                timeout({
                    first: READ_TIMEOUT_MS,
                    with: () =>
                        throwError(
                            () =>
                                new Error(`No answer in ${(READ_TIMEOUT_MS / 1000).toString()} s`),
                        ),
                }),
            ),
        ),
        map((value): Outcome<T> => ({ outcome: 'succeeded', value })),
        catchError((error: unknown) =>
            of<Outcome<T>>({
                outcome: 'failed',
                error: error instanceof Error ? error.message : String(error),
            }),
        ),
    );
}

/**
 * Keeps only the attempts with one outcome, narrowed to it.
 *
 * @param outcome$ Attempts.
 * @param outcome The outcome to keep.
 * @returns The attempts with that outcome.
 */
function endedWith<T, TOutcome extends Outcome<T>['outcome']>(
    outcome$: Observable<Outcome<T>>,
    outcome: TOutcome,
): Observable<Extract<Outcome<T>, { outcome: TOutcome }>> {
    return outcome$.pipe(
        filter(
            (attempt): attempt is Extract<Outcome<T>, { outcome: TOutcome }> =>
                attempt.outcome === outcome,
        ),
    );
}

/**
 * Keeps only the reads with one of `outcomes`, narrowed to them.
 *
 * @param read$ Reads.
 * @param outcomes The outcomes to keep.
 * @returns The reads with those outcomes.
 */
function withOutcome<TOutcome extends ReadOutcome['outcome']>(
    read$: Observable<ReadOutcome>,
    ...outcomes: TOutcome[]
): Observable<Extract<ReadOutcome, { outcome: TOutcome }>> {
    return read$.pipe(
        filter((read): read is Extract<ReadOutcome, { outcome: TOutcome }> =>
            outcomes.some((outcome) => outcome === read.outcome),
        ),
    );
}

/**
 * Keeps only the sends with one outcome, narrowed to it.
 *
 * @param send$ Sends.
 * @param outcome The outcome to keep.
 * @returns The sends with that outcome.
 */
function sentWith<TOutcome extends SendOutcome['outcome']>(
    send$: Observable<SendOutcome>,
    outcome: TOutcome,
): Observable<Extract<SendOutcome, { outcome: TOutcome }>> {
    return send$.pipe(
        filter(
            (sent): sent is Extract<SendOutcome, { outcome: TOutcome }> => sent.outcome === outcome,
        ),
    );
}

/**
 * Starts the prove balance machine at `editing`.
 *
 * @param connections The Ethereum and Solana chains; reads go through Ethereum's, the wallet signs.
 * @param addresses The snapshot, queue and programs, and the simulation's fee payer.
 * @param followProof The proof request a snapshot transaction enqueued, followed by the sdk.
 * @param initial The asset and holder the form starts with.
 * @returns
 *   - `proveBalance`: the running machine.
 *   - `edit(request)`: replaces the asset and holder; a complete request is read once edits settle.
 *   - `retry()`: reads or verifies again after a failure.
 *   - `prove()`: sends the snapshot.
 *   - `another()`: starts another proof.
 */
export function createProveBalanceMachine(
    connections: ProofRequestConnections,
    addresses: ProveBalanceAddresses,
    followProof: FollowProof,
    initial: BalanceRequest,
): {
    proveBalance: StartedMachine<ProveBalanceState> & { stop: () => void };
    edit: (request: BalanceRequest) => void;
    retry: () => void;
    prove: () => void;
    another: () => void;
} {
    const edit$ = new Subject<BalanceRequest>();
    const retry$ = new Subject<void>();
    const prove$ = new Subject<void>();
    const another$ = new Subject<void>();
    const started$ = new ReplaySubject<StartedMachine<ProveBalanceState>>(1);
    const state$ = stateOf$(started$);

    // The outcome edges of `reading` share one read of the request it
    // carries; entering `reading` again, from itself on an edit, switches to
    // the new request.
    const read$ = state$.pipe(
        filter(
            (state): state is Extract<ProveBalanceState, { node: 'reading' }> =>
                state.node === 'reading',
        ),
        switchMap(({ data }) =>
            readPreview$(connections.ethereum, addresses.snapshotAddress, data),
        ),
        share(),
    );
    // The outcome edges of `awaitingSignature` share one send per entry into it.
    const send$ = dataOnEntry$(state$, 'awaitingSignature').pipe(
        switchMap((request) =>
            sendSnapshot$(connections.ethereum.wallet, addresses.snapshotAddress, request),
        ),
        share(),
    );
    // The outcome edges of `verifying` share one verification per entry into it.
    const verify$ = dataOnEntry$(state$, 'verifying').pipe(
        switchMap((request) =>
            attempt$(connections, async () => verifyBalance(connections, addresses, request)),
        ),
        share(),
    );

    // Every edit re-enters `editing`, which resubscribes its edges: the settle
    // wait stays subscribed across those re-entries, or no edit would settle.
    const settled$ = edit$.pipe(
        debounceTime(EDIT_SETTLE_MS),
        filter(isComplete),
        share({ resetOnRefCountZero: false }),
    );

    const machine = ProveBalanceGraph.implement({
        edit: {
            $: () => edit$,
            next: (request) => request,
        },
        editSettled: {
            $: () => settled$,
            next: (request) => ({ ...request, failedReads: 0 }),
        },
        balanceArrived: {
            $: () => withOutcome(read$, 'succeeded'),
            next: ({ value }, _dest, { asset, holder }) => ({ asset, holder, ...value }),
        },
        readError: {
            $: () => withOutcome(read$, 'failed'),
            next: ({ error }, _dest, { asset, holder, failedReads }) => ({
                asset,
                holder,
                error,
                failedReads: failedReads + 1,
            }),
        },
        retryDue: {
            $: () =>
                dataOnEntry$(state$, 'readFailed').pipe(
                    switchMap(({ failedReads }) => timer(retryDelayMs(failedReads))),
                ),
            next: (_due, _dest, { asset, holder, failedReads }) => ({ asset, holder, failedReads }),
        },
        connectionLost: {
            $: () => withOutcome(read$, 'connectionLost'),
            next: ({ waitingOn }, _dest, { asset, holder }) => ({ asset, holder, waitingOn }),
        },
        connectionsChanged: {
            $: () => waitingOnChanged$(connections),
            next: (waitingOn, _dest, { asset, holder }) => ({ asset, holder, waitingOn }),
        },
        connectionRestored: {
            $: () => bothReady$(connections),
            next: (_restored, _dest, { asset, holder }) => ({ asset, holder, failedReads: 0 }),
        },
        retry: {
            $: () => retry$,
            next: (_retry, _dest, { asset, holder, failedReads }) => ({
                asset,
                holder,
                failedReads,
            }),
        },
        prove: {
            $: () => prove$,
            next: (_prove, _dest, { asset, holder, symbol, decimals, balance, fee }) => ({
                asset,
                holder,
                symbol,
                decimals,
                balance,
                fee,
            }),
        },
        signed: {
            $: () => sentWith(send$, 'signed'),
            next: ({ txHash }, _dest, source) => ({ ...source, txHash }),
        },
        userDeclined: {
            $: () => sentWith(send$, 'declined'),
            next: (_declined, _dest, source) => source,
        },
        sendRejected: {
            $: () => sentWith(send$, 'failed'),
            next: ({ error }, _dest, source) => ({ ...source, error }),
        },
        another: {
            $: () => another$,
            next: (_another, _dest, { asset, holder }) => ({ asset, holder, failedReads: 0 }),
        },
        transactionReverted: {
            $: () =>
                dataOnEntry$(state$, 'proving').pipe(
                    switchMap(({ txHash }) => receiptOf$(connections.ethereum.wallet, txHash)),
                    // Silent unless it reverted: completing without a value would error the machine.
                    switchMap((receipt) => (receipt.status === 0 ? of(receipt) : NEVER)),
                ),
            next: (receipt, _dest, { asset, holder, symbol, decimals, balance, fee }) => ({
                asset,
                holder,
                symbol,
                decimals,
                balance,
                fee,
                error: `The transaction ${receipt.hash} failed on Ethereum`,
            }),
        },
        proofAvailable: {
            $: () =>
                dataOnEntry$(state$, 'proving').pipe(
                    // Silent if the proof request machine closes first.
                    switchMap(({ txHash }) => concat(followProof(txHash), NEVER)),
                    filter(atNode('proofAvailable')),
                    take(1),
                ),
            next: ({ data }, _dest, source) => ({
                ...source,
                proofQueueBatchIndex: data.proofQueueBatchIndex,
                proofQueueBatchAddress: data.proofQueueBatchAddress,
                failedReads: 0,
            }),
        },
        verified: {
            $: () => endedWith(verify$, 'succeeded'),
            next: ({ value }, _dest, { failedReads: _failedReads, ...source }) => ({
                ...source,
                ...value,
            }),
        },
        verifyError: {
            $: () => endedWith(verify$, 'failed'),
            next: ({ error }, _dest, source) => ({
                ...source,
                error,
                failedReads: source.failedReads + 1,
            }),
        },
        verifyRetry: {
            $: () => retry$,
            next: (_retry, _dest, { error: _error, ...source }) => source,
        },
        verifyRetryDue: {
            $: () =>
                dataOnEntry$(state$, 'verifyFailed').pipe(
                    switchMap(({ failedReads }) => timer(retryDelayMs(failedReads))),
                ),
            next: (_due, _dest, { error: _error, ...source }) => source,
        },
    });

    const proveBalance = machine.close().start('editing', undefined, { editing: initial });
    started$.next(proveBalance);

    return {
        proveBalance,
        edit: (request: BalanceRequest) => edit$.next(request),
        retry: () => retry$.next(),
        prove: () => prove$.next(),
        another: () => another$.next(),
    };
}
