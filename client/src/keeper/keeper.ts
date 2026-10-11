import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FetchRequest, JsonRpcProvider, Wallet } from 'ethers';
import {
    address,
    createKeyPairSignerFromBytes,
    type Address,
    type KeyPairSigner,
} from '@solana/kit';
import {
    catchError,
    concatMap,
    defer,
    EMPTY,
    exhaustMap,
    filter,
    finalize,
    forkJoin,
    from,
    ignoreElements,
    map,
    merge,
    mergeMap,
    type Observable,
    of,
    scan,
    startWith,
    switchMap,
    take,
    tap,
    throwError,
    timeout,
    timer,
    toArray,
    withLatestFrom,
} from 'rxjs';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import {
    createBridgeStateMachine,
    createConnections,
    createProofQueueHeadMachine,
    createProofRequestStateMachine,
    type Connections,
    type SignerTransactionState,
    type SolanaSignerTransactionState,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    type GraphState,
    type StartedMachine,
} from '@nori-zk/nori-bridge-solana-sdk/utils';
import {
    BackstopError,
    backstopErrorName,
    checkpointInstruction,
    createGuardInstruction$,
    guardAddress$,
    guardStatus,
    ReadKind,
    unlatchInstruction,
} from '../backstop.js';
import { createAssertHealthyMachine } from '../assertHealthy.impl.js';
import { followedStates$, valueOnce$ } from '../followedStates.js';
import { customErrorOf, transactionErrorText } from '../guard.js';
import { readSnapshotResultInstruction } from '../noriRead.js';
import { type ProvenRequestState } from '../provenRequest.js';
import { createProvenRequestMachine } from '../provenRequest.impl.js';
import { type SnapshotEventState } from '../snapshotEvent.js';
import { createSnapshotEventMachine } from '../snapshotEvent.impl.js';
import {
    type SnapshotEvent,
    snapshotResultWitness,
} from '../snapshotWitness.js';
import {
    guardConfigOf,
    queryOf,
    type GuardEntry,
    type KeeperConfig,
} from './config.js';
import { createGuardAccountMachine } from './guardAccount.impl.js';
import {
    BACKSTOP_ERROR_NAMES,
    ethereumSignerSend$,
    sendLost,
    sendLostReason,
    sendOutcomeOf,
    sendOver,
    signerSend$,
} from './sends.js';
import {
    createSnapshotCallMachine,
    type SnapshotQuery,
} from './snapshotCall.impl.js';
import { type SnapshotSubmissionState } from './snapshotSubmission.js';
import {
    createSnapshotSubmissionMachine,
    type GuardRead,
} from './snapshotSubmission.impl.js';
import { RPC_TIMEOUT_MS } from './solana.js';

/** How long `snapshot` waits for its transaction to be mined. */
const SNAPSHOT_WAIT_MS = 3 * 60_000;
/** How long a one-off `submit` follows a snapshot before it leaves it pending. */
const PROVEN_SNAPSHOT_TIMEOUT_MS = 2 * 60_000;

/** `NoriSnapshot`'s ABI: what the snapshot call is encoded with, and what names a refusal. */
const noriSnapshotInterface = NoriSnapshot__factory.createInterface();

interface KeeperState {
    /** Snapshot transactions whose reads are not all submitted yet. */
    pending: string[];
    /** The last snapshot: when it was sent (unix seconds) and its results root. */
    lastSnapshot?: { sentAt: number; resultsRoot: string };
}

/** How a Solana send the keeper waits on ended: over, or failed without the program's verdict. */
type SendEnd = SolanaSignerTransactionState;

/** The proven request machine at a node a one-off command stops at. */
type ProvenOrWaiting = Extract<
    ProvenRequestState,
    {
        node:
            | 'proven'
            | 'waitingForProof'
            | 'transactionReplaced'
            | 'transactionDropped';
    }
>;

/** The event machine once it holds the event. */
type EventRead = Extract<SnapshotEventState, { node: 'current' }> & {
    data: { event: SnapshotEvent };
};

/** The submission machine at a node it stops at. */
type SubmissionEnd = Extract<
    SnapshotSubmissionState,
    {
        node:
            | 'submitted'
            | 'transactionReplaced'
            | 'transactionDropped'
            | 'waitingForProof';
    }
>;

/**
 * Each item of a list in the state file not seen before, re-reading the
 * file every interval: what another keeper process added is picked up too.
 *
 * @param items$ The list, each time the file is read.
 * @returns Each new item, once.
 */
function newItems$(items$: Observable<string[]>): Observable<string> {
    return items$.pipe(
        scan(
            ({ seen }, items) => {
                const fresh = items.filter((item) => !seen.has(item));
                return { seen: new Set([...seen, ...fresh]), fresh };
            },
            { seen: new Set<string>(), fresh: [] as string[] }
        ),
        concatMap(({ fresh }) => from(fresh))
    );
}

/**
 * The first state a read machine settles in, for a one-off command: its
 * first `current`, or its first failure (a missing account is one), then the
 * machine is closed.
 *
 * @param create Makes the read machine.
 * @returns That state, once.
 */
function settledOnce$<TState extends GraphState>(
    create: () => StartedMachine<TState> & { close(): void }
): Observable<TState> {
    return defer(() => {
        const machine = create();
        return machine.state$.pipe(
            filter(
                (state) =>
                    state.node === 'current' ||
                    state.node === 'failedWhileLoading'
            ),
            take(1),
            finalize(() => machine.close())
        );
    });
}

export class Keeper {
    private constructor(
        private readonly config: KeeperConfig,
        private readonly connections: Connections,
        private readonly solanaSigner: KeyPairSigner,
        private readonly ethereumProvider: JsonRpcProvider
    ) {}

    /** The keeper signs through its own signers and reads and sends through the sdk's connections. */
    static connect$(config: KeeperConfig): Observable<Keeper> {
        return defer(() =>
            createKeyPairSignerFromBytes(
                new Uint8Array(
                    JSON.parse(
                        readFileSync(config.solana.keypair, 'utf8')
                    ) as number[]
                )
            )
        ).pipe(
            map((signer) => {
                // ethers' default is 5 min per request; a hung one would stall a send
                const request = new FetchRequest(config.ethereum.rpcUrl);
                request.timeout = RPC_TIMEOUT_MS;
                const connections = createConnections({
                    ethereum: {
                        expectedChainId: BigInt(config.ethereum.chainId),
                        http: { rpcUrl: config.ethereum.rpcUrl },
                    },
                    solana: {
                        expectedGenesisHash: config.solana.genesisHash,
                        http: { rpcUrls: [config.solana.rpcUrl] },
                    },
                });
                return new Keeper(
                    config,
                    connections,
                    signer,
                    new JsonRpcProvider(request)
                );
            })
        );
    }

    /** Closes the keeper's connections. */
    close() {
        this.connections.close();
    }

    private log(message: string) {
        console.log(`${new Date().toISOString()} ${message}`);
    }

    /** How long a send that failed or expired waits before it is sent again: one poll. */
    private get resendAfterMs() {
        return this.config.intervals.pollSecs * 1000;
    }

    private guardAddress$(guard: GuardEntry): Observable<Address> {
        return guardAddress$(guard.mint, this.solanaSigner.address);
    }

    /** One guard's account and supply, read once. */
    private guardAccount$(guard: GuardEntry) {
        return valueOnce$(() =>
            createGuardAccountMachine(
                this.connections,
                guard.mint,
                this.solanaSigner.address,
                this.resendAfterMs
            )
        );
    }

    private loadState(): KeeperState {
        return existsSync(this.config.stateFile)
            ? (JSON.parse(
                  readFileSync(this.config.stateFile, 'utf8')
              ) as KeeperState)
            : { pending: [] };
    }

    /** Applies `change` to the state file as it is now, so what another keeper process added is kept. */
    private updateState(change: (state: KeeperState) => KeeperState) {
        writeFileSync(
            this.config.stateFile,
            JSON.stringify(change(this.loadState()), null, 2) + '\n'
        );
    }

    /**
     * One Solana transaction of the keeper's, sent until it is over or fails
     * without the program's verdict (a one-off command does not wait to send
     * it again).
     *
     * @param instructions The instructions.
     * @returns Its last state, once.
     */
    private sendEnd$(
        instructions: Parameters<typeof signerSend$>[2]
    ): Observable<SendEnd> {
        return signerSend$(
            this.connections,
            this.solanaSigner,
            instructions,
            { errorNames: BACKSTOP_ERROR_NAMES, commitment: 'confirmed' },
            this.resendAfterMs
        ).pipe(
            filter(
                (state) =>
                    sendOver(state) ||
                    (sendLost(state) && state.node !== 'notReadyToSend')
            ),
            take(1)
        );
    }

    /**
     * How a send ended, in words.
     *
     * @param end Its last state.
     * @returns `confirmed`, `reverted…`, the error the program refused it with, or why it failed.
     */
    private endText(end: SendEnd): string {
        if (sendOver(end)) return sendOutcomeOf(end);
        if (sendLost(end)) return sendLostReason(end);
        return end.node;
    }

    /**
     * Whether the Nori program has its state: its state machine's first read
     * lands `current`, or fails (no account to read).
     *
     * @returns Whether its state can be read, once.
     */
    private noriReadable$(): Observable<boolean> {
        return settledOnce$(() =>
            createBridgeStateMachine(
                this.connections,
                this.config.solana.noriProgram
            )
        ).pipe(map((state) => state.node === 'current'));
    }

    /** Creates each configured guard that does not exist yet; the keeper key is its admin. */
    createGuards$(): Observable<void> {
        const { noriProgram } = this.config.solana;
        return this.noriReadable$().pipe(
            switchMap((readable) =>
                readable
                    ? from(this.config.guards)
                    : throwError(
                          () =>
                              new Error(
                                  `Nori program ${noriProgram} has no state; initialize it before creating guards`
                              )
                      )
            ),
            concatMap((guard) =>
                this.guardAccount$(guard).pipe(
                    switchMap(({ address: guardAddress, guard: existing }) =>
                        existing
                            ? of(
                                  this.log(
                                      `${guard.name}: guard ${guardAddress} exists`
                                  )
                              )
                            : createGuardInstruction$({
                                  admin: this.solanaSigner.address,
                                  mint: guard.mint,
                                  config: guardConfigOf(this.config, guard),
                              }).pipe(
                                  switchMap((instruction) =>
                                      this.sendEnd$([instruction])
                                  ),
                                  map((end) =>
                                      this.log(
                                          end.node === 'confirmed'
                                              ? `${guard.name}: created guard ${guardAddress}`
                                              : `${guard.name}: create_guard failed: ${this.endText(end)}`
                                      )
                                  )
                              )
                    )
                )
            ),
            ignoreElements()
        );
    }

    /** The Ethereum signer of snapshots, from ETH_PRIVATE_KEY. */
    private ethereumSigner(): Wallet {
        const key = process.env.ETH_PRIVATE_KEY;
        if (!key) throw new Error('Missing env: ETH_PRIVATE_KEY');
        return new Wallet(key, this.ethereumProvider);
    }

    /** Every configured query once. */
    private snapshotQueries(): SnapshotQuery[] {
        const queries = new Map<string, SnapshotQuery>();
        for (const guard of this.config.guards) {
            for (const query of [guard.backing, guard.pause]) {
                if (!query) continue;
                const { target, data, queryId } = queryOf(query);
                queries.set(queryId, { target, data });
            }
        }
        return [...queries.values()];
    }

    /** What a snapshot would commit now, read once: the fee and the results root. */
    private snapshotCall$() {
        return defer(() =>
            valueOnce$(() =>
                createSnapshotCallMachine(
                    this.connections,
                    this.config.ethereum.noriSnapshot,
                    this.snapshotQueries(),
                    this.ethereumSigner().address
                )
            )
        );
    }

    /**
     * One NoriSnapshot transaction covering every configured query, pending
     * as soon as it is sent; `reason` goes in the log. A reverted one (e.g.
     * the queue fee changed) has no reads and is dropped, and `run` sends
     * another.
     */
    snapshot$(reason?: string): Observable<void> {
        const { noriSnapshot } = this.config.ethereum;
        return defer(() => {
            const signer = this.ethereumSigner();
            const queries = this.snapshotQueries();
            let sentHash = '';
            return this.snapshotCall$().pipe(
                switchMap(({ fee, resultsRoot }) =>
                    ethereumSignerSend$(
                        this.connections,
                        signer,
                        {
                            to: noriSnapshot,
                            data: noriSnapshotInterface.encodeFunctionData(
                                'snapshot',
                                [queries]
                            ),
                            value: fee,
                        },
                        { errors: noriSnapshotInterface }
                    ).pipe(
                        // Pending as soon as it is sent: a slow block can't lose it or stall the loop
                        tap((state) => {
                            const hash =
                                'transactionHash' in state.data
                                    ? state.data.transactionHash
                                    : '';
                            if (hash === '' || sentHash !== '') return;
                            sentHash = hash;
                            this.updateState((current) => ({
                                pending: [...current.pending, hash],
                                lastSnapshot: {
                                    sentAt: Date.now() / 1000,
                                    resultsRoot,
                                },
                            }));
                        }),
                        filter(
                            (state) =>
                                state.node === 'confirmed' ||
                                state.node === 'reverted' ||
                                state.node === 'refused' ||
                                state.node === 'sendFailed' ||
                                state.node === 'replaced' ||
                                state.node === 'dropped'
                        ),
                        take(1),
                        map((state) =>
                            this.snapshotEnded(
                                state,
                                sentHash,
                                queries.length,
                                reason
                            )
                        ),
                        timeout({
                            first: SNAPSHOT_WAIT_MS,
                            with: () =>
                                of(
                                    this.log(
                                        `snapshot ${sentHash}: not mined after ${SNAPSHOT_WAIT_MS / 60_000} min; its reads go in once it is`
                                    )
                                ),
                        })
                    )
                )
            );
        });
    }

    /**
     * Logs how a snapshot ended, and drops it from the pending ones when it
     * has no reads.
     *
     * @param state Its signer transaction machine's last state.
     * @param hash The transaction, `''` when it was never sent.
     * @param queryCount How many queries it makes.
     * @param reason Why it was sent, for the log.
     * @throws When it did not land: reverted, refused, failed to send, replaced or dropped.
     */
    private snapshotEnded(
        state: SignerTransactionState,
        hash: string,
        queryCount: number,
        reason: string | undefined
    ): void {
        if (state.node === 'confirmed') {
            this.log(
                `snapshot ${hash}: ${queryCount} queries, block ${state.data.receipt.blockNumber}` +
                    (reason ? ` (${reason})` : '')
            );
            return;
        }
        if (hash !== '')
            this.updateState((current) => ({
                pending: current.pending.filter((pending) => pending !== hash),
            }));
        switch (state.node) {
            case 'refused':
                throw new Error(`snapshot refused: ${state.data.errorName}`);
            case 'sendFailed':
                throw new Error(state.data.error);
            default:
                throw new Error(`snapshot ${hash} ${state.node}`);
        }
    }

    /** Records each guard's mint supply (skips guards checkpointed too recently). */
    checkpoint$(): Observable<void> {
        return from(this.config.guards).pipe(
            concatMap((guard) =>
                this.guardAddress$(guard).pipe(
                    switchMap((guardAddress) =>
                        this.sendEnd$([
                            checkpointInstruction({
                                guard: guardAddress,
                                mint: guard.mint,
                            }),
                        ])
                    ),
                    map((end) => {
                        if (end.node === 'confirmed')
                            this.log(`${guard.name}: checkpoint`);
                        else if (
                            end.node !== 'refused' ||
                            end.data.errorCode !==
                                BackstopError.CheckpointTooSoon
                        )
                            this.log(
                                `${guard.name}: checkpoint failed: ${this.endText(end)}`
                            );
                    })
                )
            ),
            ignoreElements()
        );
    }

    /** Each guard's backing and pause reads a snapshot submits, with the guard's address. */
    private guardReads$(): Observable<GuardRead[]> {
        const { guards } = this.config;
        if (guards.length === 0) return of([]);
        return forkJoin(guards.map((guard) => this.guardAddress$(guard))).pipe(
            map((addresses) =>
                guards.flatMap((guard, i) =>
                    (
                        [
                            [ReadKind.Backing, 'backing', guard.backing],
                            [ReadKind.Pause, 'pause', guard.pause],
                        ] as const
                    ).flatMap(([kind, label, query]) => {
                        const guardAddress = addresses[i];
                        return query && guardAddress
                            ? [
                                  {
                                      read: `${guard.name} ${label}`,
                                      guard: guardAddress,
                                      mint: guard.mint,
                                      kind,
                                      queryId: queryOf(query).queryId,
                                  },
                              ]
                            : [];
                    })
                )
            )
        );
    }

    /**
     * Follows a pending snapshot until its reads are submitted (or, for a
     * one-off `submit`, until its batch is found not proven yet), then logs
     * how it ended and drops it from the pending ones when it is done.
     *
     * @param snapshotTxHash The snapshot transaction.
     * @param untilWaiting Ends once it is looked up and its batch is not proven yet.
     * @returns Whether it is still pending, once.
     */
    private submission$(
        snapshotTxHash: string,
        untilWaiting: boolean
    ): Observable<boolean> {
        const { noriSnapshot, proofQueue } = this.config.ethereum;
        return this.guardReads$().pipe(
            switchMap((reads) =>
                followedStates$(() =>
                    createSnapshotSubmissionMachine(
                        this.connections,
                        snapshotTxHash,
                        {
                            noriSnapshot,
                            proofQueue,
                            noriProgram: this.config.solana.noriProgram,
                            reads,
                        },
                        this.solanaSigner,
                        this.resendAfterMs
                    )
                )
            ),
            filter(
                (state): state is SubmissionEnd =>
                    state.node === 'submitted' ||
                    state.node === 'transactionReplaced' ||
                    state.node === 'transactionDropped' ||
                    (untilWaiting && state.node === 'waitingForProof')
            ),
            take(1),
            map((state) => {
                if (state.node === 'waitingForProof') return true;
                if (state.node === 'submitted') {
                    for (const { read, outcome } of state.data.outcomes)
                        if (
                            outcome !== 'confirmed' &&
                            outcome !== 'ReadNotNewer'
                        )
                            this.log(
                                `${read}: read rejected: ${outcome}, dropped`
                            );
                    this.log(`snapshot ${snapshotTxHash}: reads submitted`);
                } else {
                    this.log(
                        `snapshot ${snapshotTxHash}: ${state.node}, dropped`
                    );
                }
                this.updateState((current) => ({
                    ...current,
                    pending: current.pending.filter(
                        (hash) => hash !== snapshotTxHash
                    ),
                }));
                return false;
            })
        );
    }

    /**
     * Submits every pending snapshot's reads whose batch is proven. A read the
     * program rejects is logged and dropped; one that fails in transit is
     * sent again. Neither blocks other guards or snapshots.
     */
    submit$(quiet = false): Observable<void> {
        return defer(() => from(this.loadState().pending)).pipe(
            concatMap((snapshotTxHash) =>
                this.submission$(snapshotTxHash, true).pipe(
                    timeout({
                        first: PROVEN_SNAPSHOT_TIMEOUT_MS,
                        with: () => {
                            this.log(
                                `snapshot ${snapshotTxHash}: failed: reading the proof request timed out after ${PROVEN_SNAPSHOT_TIMEOUT_MS / 1000} s`
                            );
                            return of(true);
                        },
                    })
                )
            ),
            ignoreElements(),
            finalize(() => {
                const stillPending = this.loadState().pending.length;
                if (stillPending && !quiet)
                    this.log(
                        `${stillPending} snapshot(s) pending: waiting for a proof or retrying`
                    );
            })
        );
    }

    /**
     * Clears each tripped guard's latch (the keeper key must be its admin).
     * Testing and demos only: one key reopens the guard, so a production
     * guard needs a timelock or governance instead. Unlatch after a proven
     * read shows the backing restored, or the next read trips it again.
     */
    unlatch$(): Observable<void> {
        return from(this.config.guards).pipe(
            concatMap((guard) =>
                this.guardAccount$(guard).pipe(
                    switchMap(({ address: guardAddress, guard: state }) => {
                        if (!state)
                            return of(
                                this.log(
                                    `${guard.name}: no guard at ${guardAddress}`
                                )
                            );
                        if (!state.tripped)
                            return of(this.log(`${guard.name}: not tripped`));
                        return this.sendEnd$([
                            unlatchInstruction({
                                admin: this.solanaSigner.address,
                                guard: address(guardAddress),
                            }),
                        ]).pipe(
                            map((end) =>
                                this.log(
                                    end.node === 'confirmed'
                                        ? `${guard.name}: unlatched (backing ${state.backing} at Ethereum block ${state.backingEthBlock})`
                                        : `${guard.name}: unlatch failed: ${this.endText(end)}`
                                )
                            )
                        );
                    })
                )
            ),
            ignoreElements()
        );
    }

    /**
     * Each guard's `assert_healthy`, the call a lender makes, simulated.
     * With `send`, each lands even when it fails (no preflight), which the
     * sdk's transaction machine cannot do yet.
     */
    assertHealthy$(send = false): Observable<void> {
        if (send)
            return throwError(
                () =>
                    new Error(
                        'assert --send is not available yet: the sdk cannot land a transaction without preflight'
                    )
            );
        return from(this.config.guards).pipe(
            concatMap((guard) =>
                this.guardAddress$(guard).pipe(
                    switchMap((guardAddress) =>
                        valueOnce$(() =>
                            createAssertHealthyMachine(
                                this.connections,
                                this.solanaSigner.address,
                                guardAddress,
                                guard.mint
                            )
                        )
                    ),
                    map(({ simulated }) =>
                        this.log(
                            `${guard.name}: ${verdictOf(simulated?.err ?? null)} | ${simulated?.unitsConsumed ?? 0n} CU`
                        )
                    )
                )
            ),
            ignoreElements()
        );
    }

    /**
     * Verifies each result of a proven snapshot on Solana with
     * nori-read-example, in real transactions: the on-chain record of what
     * Prove balance only simulates.
     */
    verify$(snapshotTxHash: string): Observable<void> {
        const { noriSnapshot, proofQueue } = this.config.ethereum;
        return followedStates$(() => {
            const proofRequest = createProofRequestStateMachine(
                this.connections,
                {
                    proofQueueAddress: proofQueue,
                    proofRequestTxHash: snapshotTxHash,
                    programAddress: this.config.solana.noriProgram,
                }
            );
            const proven = createProvenRequestMachine(
                this.connections,
                proofQueue,
                proofRequest
            );
            return {
                state$: proven.state$,
                close: () => {
                    proven.close();
                    proofRequest.close();
                },
            };
        }).pipe(
            filter(
                (state): state is ProvenOrWaiting =>
                    state.node === 'proven' ||
                    state.node === 'waitingForProof' ||
                    state.node === 'transactionReplaced' ||
                    state.node === 'transactionDropped'
            ),
            take(1),
            switchMap((state) => {
                if (state.node !== 'proven') {
                    this.log(`snapshot ${snapshotTxHash}: not proven yet`);
                    return EMPTY;
                }
                const { proofAvailable, witness } = state.data;
                const proofQueueBatch = address(
                    proofAvailable.proofQueueBatchAddress
                );
                return followedStates$(() =>
                    createSnapshotEventMachine(
                        this.connections,
                        noriSnapshot,
                        snapshotTxHash
                    )
                ).pipe(
                    filter(
                        (read): read is EventRead =>
                            read.node === 'current' &&
                            read.data.event !== undefined
                    ),
                    take(1),
                    switchMap(({ data: { event } }) => {
                        this.log(
                            `snapshot ${snapshotTxHash}: Ethereum block ${event.blockNumber}, batch ${proofQueueBatch}`
                        );
                        return from(event.queryIds.entries()).pipe(
                            concatMap(([i, queryId]) =>
                                this.sendEnd$([
                                    readSnapshotResultInstruction({
                                        proofQueueBatch,
                                        noriSnapshot,
                                        queryId,
                                        witness: snapshotResultWitness(
                                            noriSnapshot,
                                            event,
                                            queryId,
                                            witness
                                        ),
                                    }),
                                ]).pipe(
                                    map((end) =>
                                        this.log(
                                            end.node === 'confirmed'
                                                ? `query ${queryId}: ${BigInt(event.results[i] ?? 0)} verified | tx ${end.data.signature}${this.explorer(end.data.signature)}`
                                                : `query ${queryId}: ${this.endText(end)}`
                                        )
                                    )
                                )
                            )
                        );
                    })
                );
            }),
            ignoreElements()
        );
    }

    /** A Solana Explorer link when the RPC is devnet's; never prints the RPC URL. */
    private explorer(signature: string) {
        return this.config.solana.rpcUrl.includes('devnet')
            ? ` https://explorer.solana.com/tx/${signature}?cluster=devnet`
            : '';
    }

    /** Prints Nori's progress through the proof queue, then each guard's status. */
    status$(): Observable<void> {
        return this.statusLines$().pipe(
            map((lines) => {
                for (const line of lines) this.log(line);
            })
        );
    }

    /** Nori's progress through the proof queue, then each guard's status, read once. */
    private statusLines$(): Observable<string[]> {
        const { noriProgram } = this.config.solana;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nori$ = settledOnce$(() =>
            createBridgeStateMachine(this.connections, noriProgram)
        ).pipe(
            switchMap((state) =>
                state.node !== 'current' || state.data.bridgeState === undefined
                    ? of(`nori: no state for ${noriProgram}`)
                    : valueOnce$(() =>
                          createProofQueueHeadMachine(
                              this.connections,
                              this.config.ethereum.proofQueue
                          )
                      ).pipe(
                          map(({ head }) => {
                              const nori = state.data.bridgeState;
                              return (
                                  `nori: beacon slot ${nori?.latestHead} | ${nori?.queueCursor} of ${head} queue requests proven` +
                                  ` | ${nori?.proofQueueBatchCount} batches | ${this.loadState().pending.length} snapshot(s) waiting`
                              );
                          })
                      )
            )
        );
        return nori$.pipe(
            switchMap((noriLine) =>
                from(this.config.guards).pipe(
                    concatMap((guard) =>
                        this.guardAccount$(guard).pipe(
                            map(
                                ({
                                    address: guardAddress,
                                    guard: state,
                                    supply,
                                }) =>
                                    state
                                        ? `${guard.name}: ${guardStatus(state, supply, now)} | backing ${state.backing} | supply ${supply}` +
                                          ` | Ethereum block ${state.backingEthBlock} | paused ${state.paused}` +
                                          (state.tripped
                                              ? ` | tripped at block ${state.tripEthBlock}, deficit ${state.tripDeficit}`
                                              : '')
                                        : `${guard.name}: no guard at ${guardAddress}`
                            )
                        )
                    ),
                    toArray(),
                    map((guardLines) => [noriLine, ...guardLines])
                )
            )
        );
    }

    /**
     * A job of `run`, with its failure logged: the next interval runs it again.
     *
     * @param name The job's name, for the log.
     * @param job$ The job.
     * @returns The job, completing without a value when it failed.
     */
    private job$<T>(name: string, job$: Observable<T>): Observable<T> {
        return job$.pipe(
            catchError((error: unknown) => {
                this.log(`${name} failed: ${errorMessage(error)}`);
                return EMPTY;
            })
        );
    }

    /**
     * Checkpoints, snapshots and submits on the configured intervals, forever,
     * and prints each status line when it changes.
     */
    run$(): Observable<never> {
        const { snapshotSecs, checkpointSecs, pollSecs } =
            this.config.intervals;
        const poll$ = timer(0, pollSecs * 1000);
        // What a snapshot would commit now, kept current on each new block.
        const resultsRoot$ = defer(() =>
            followedStates$(() =>
                createSnapshotCallMachine(
                    this.connections,
                    this.config.ethereum.noriSnapshot,
                    this.snapshotQueries(),
                    this.ethereumSigner().address
                )
            )
        ).pipe(
            map((state) =>
                state.node === 'current' ? state.data.resultsRoot : undefined
            ),
            startWith(undefined)
        );
        const checkpoints$ = timer(0, checkpointSecs * 1000).pipe(
            exhaustMap(() => this.job$('checkpoint', this.checkpoint$()))
        );
        // The heartbeat, or as soon as a watched result changed. shortcut: a
        // vault that changes every poll is snapshotted every poll; add a
        // minimum gap before watching busy vaults
        const snapshots$ = poll$.pipe(
            withLatestFrom(resultsRoot$),
            exhaustMap(([, resultsRoot]) => {
                const last = this.loadState().lastSnapshot;
                const now = Date.now() / 1000;
                if (!last || now - last.sentAt >= snapshotSecs)
                    return this.job$('snapshot', this.snapshot$('heartbeat'));
                if (
                    resultsRoot !== undefined &&
                    resultsRoot !== last.resultsRoot
                )
                    return this.job$(
                        'snapshot',
                        this.snapshot$('results changed')
                    );
                return EMPTY;
            })
        );
        // Each pending snapshot, followed until its reads are submitted.
        const submissions$ = newItems$(
            poll$.pipe(map(() => this.loadState().pending))
        ).pipe(
            mergeMap((snapshotTxHash) =>
                this.job$(
                    `snapshot ${snapshotTxHash}`,
                    this.submission$(snapshotTxHash, false)
                )
            )
        );
        const status$ = poll$.pipe(
            exhaustMap(() => this.job$('status', this.statusLines$())),
            scan(
                ({ shown }, lines) => ({
                    shown: new Set(lines),
                    fresh: lines.filter((line) => !shown.has(line)),
                }),
                { shown: new Set<string>(), fresh: [] as string[] }
            ),
            map(({ fresh }) => {
                for (const line of fresh) this.log(line);
            })
        );
        return merge(checkpoints$, snapshots$, submissions$, status$).pipe(
            ignoreElements()
        );
    }
}

/** `allowed`, or `blocked: <BackstopError> (<code>)`. */
function verdictOf(err: unknown): string {
    if (!err) return 'allowed';
    const code = customErrorOf(err);
    return code === undefined
        ? `blocked: ${transactionErrorText(err)}`
        : `blocked: ${backstopErrorName(code) ?? 'program error'} (${code})`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
