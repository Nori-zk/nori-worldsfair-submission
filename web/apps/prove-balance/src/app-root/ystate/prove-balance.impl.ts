import {
    catchError,
    debounceTime,
    filter,
    from,
    type Observable,
    of,
    ReplaySubject,
    share,
    Subject,
    switchMap,
    take,
    timer,
} from 'rxjs';
import {
    BrowserProvider,
    Contract,
    dataLength,
    isAddress,
    isError,
    type Provider,
} from 'ethers';
import {
    bothReady$,
    type ConnectedRead,
    dataOnEntry$,
    type EthereumWalletMachine,
    type ProofRequestConnections,
    readThroughConnections$,
    type StartedMachine,
    stateOf$,
    waitingOnChanged$,
} from '@nori-zk/nori-bridge-solana-sdk';
import { encodeQueryData, NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { ProveBalanceGraph, type ProveBalanceState } from './prove-balance.js';

/** Multicall3, at the same address on every chain: its `getEthBalance` makes an ETH balance a view call. */
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** How long the form waits after the last edit before reading. */
const EDIT_SETTLE_MS = 400;

/** The wait before reading again after the first failed read; it doubles with each one after it. */
const RETRY_INITIAL_MS = 1000;
/** The longest wait between reads after failures. */
const RETRY_MAX_MS = 30_000;

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
    provider: Provider,
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
 * Sends `NoriSnapshot.snapshot` with the balance query and the fee, signed
 * in the user's wallet.
 *
 * @param wallet The wallet machine, whose chosen provider signs.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param request The asset, holder and fee.
 * @returns How the send ended.
 */
function sendSnapshot$(
    wallet: EthereumWalletMachine,
    snapshotAddress: string,
    request: BalanceRequest & { fee: bigint },
): Observable<SendOutcome> {
    return wallet.walletProvider$.pipe(
        take(1),
        switchMap((walletProvider) =>
            from(
                (async (): Promise<SendOutcome> => {
                    const signer = await new BrowserProvider(walletProvider).getSigner();
                    const snapshot = NoriSnapshot__factory.connect(snapshotAddress, signer);
                    const transaction = await snapshot.snapshot([balanceQuery(request)], {
                        value: request.fee,
                    });
                    return { outcome: 'signed', txHash: transaction.hash };
                })(),
            ),
        ),
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
 * Keeps only the reads with one of `outcomes`, narrowed to them.
 *
 * @param read$ Reads.
 * @param outcomes The outcomes to keep.
 * @returns The reads with those outcomes.
 */
function withOutcome<TRead extends ConnectedRead<unknown>, TOutcome extends TRead['outcome']>(
    read$: Observable<TRead>,
    ...outcomes: TOutcome[]
): Observable<Extract<TRead, { outcome: TOutcome }>> {
    return read$.pipe(
        filter((read): read is Extract<TRead, { outcome: TOutcome }> =>
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
        filter((sent): sent is Extract<SendOutcome, { outcome: TOutcome }> => sent.outcome === outcome),
    );
}

/**
 * Starts the prove balance machine at `editing` with `initial`.
 *
 * @param connections The Ethereum provider and Solana RPC, with their running connectivity machines.
 * @param wallet The wallet machine that signs.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param initial The asset and holder the form starts with.
 * @returns
 *   - `proveBalance`: the running machine.
 *   - `edit(request)`: replaces the asset and holder; a complete request is read once edits settle.
 *   - `retry()`: reads again after a failed read.
 *   - `prove()`: sends the snapshot.
 *   - `another()`: starts another proof.
 */
export function createProveBalanceMachine(
    connections: ProofRequestConnections,
    wallet: EthereumWalletMachine,
    snapshotAddress: string,
    initial: BalanceRequest,
) {
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
            readThroughConnections$(connections, ({ provider }) =>
                readPreview(provider, snapshotAddress, data),
            ),
        ),
        share(),
    );
    // The outcome edges of `awaitingSignature` share one send per entry into it.
    const send$ = dataOnEntry$(state$, 'awaitingSignature').pipe(
        switchMap((request) => sendSnapshot$(wallet, snapshotAddress, request)),
        share(),
    );

    const machine = ProveBalanceGraph.implement({
        editIncomplete: {
            $: () => edit$.pipe(filter((request) => !isComplete(request))),
            next: (request) => request,
        },
        editComplete: {
            $: () => edit$.pipe(debounceTime(EDIT_SETTLE_MS), filter(isComplete)),
            next: (request) => ({ ...request, failedReads: 0 }),
        },
        balanceArrived: {
            $: () => withOutcome(read$, 'succeeded'),
            next: ({ value }, _dest, { asset, holder }) => ({ asset, holder, ...value }),
        },
        readError: {
            $: () => withOutcome(read$, 'failed', 'failedOnHealthyConnection'),
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
                    switchMap(({ failedReads }) =>
                        timer(Math.min(RETRY_INITIAL_MS * 2 ** (failedReads - 1), RETRY_MAX_MS)),
                    ),
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
            next: (_retry, _dest, { asset, holder, failedReads }) => ({ asset, holder, failedReads }),
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
            next: (_another, _dest, { asset, holder }) => ({ asset, holder }),
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
