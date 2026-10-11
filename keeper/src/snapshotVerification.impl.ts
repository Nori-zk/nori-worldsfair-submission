import {
    filter,
    map,
    type Observable,
    of,
    ReplaySubject,
    Subject,
    switchMap,
    take,
    takeWhile,
} from 'rxjs';
import { followedStates$, heldAcrossMoves } from './followedStates.js';
import { type Address } from '@solana/kit';
import { type ProofRequestConnections } from '@nori-zk/nori-bridge-solana-sdk';
import {
    dataOnEntry$,
    stateOf$,
    type StartedMachine,
} from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type createProvenRequestMachine } from './provenRequest.impl.js';
import { type ProvenRequestState } from './provenRequest.js';
import { createSnapshotEventMachine } from './snapshotEvent.impl.js';
import { type SnapshotEventState } from './snapshotEvent.js';
import { createSnapshotResultSimulationMachine } from './snapshotResultSimulation.impl.js';
import { type SnapshotResultSimulationState } from './snapshotResultSimulation.js';
import {
    SnapshotVerificationGraph,
    type SnapshotVerificationState,
} from './snapshotVerification.js';
import {
    snapshotResultWitness,
    type SnapshotEvent,
} from './snapshotWitness.js';

/** Where the result is verified. */
export interface SnapshotVerificationAddresses {
    /** The `NoriSnapshot` address. */
    noriSnapshot: string;
    /** An existing system account holding SOL: the simulation's fee payer, which pays nothing. */
    feePayer: Address;
}

/** The result it verifies. */
export interface SnapshotVerificationRequest {
    /** The transaction that called `NoriSnapshot.snapshot`. */
    snapshotTxHash: string;
    /** The query whose result is verified. */
    queryId: string;
}

/** The proven request machine once it holds the batch and the witness. */
type Proven = Extract<ProvenRequestState, { node: 'proven' }>;

/** The snapshot event machine once it holds the event. */
type EventRead = Extract<SnapshotEventState, { node: 'current' }> & {
    data: { event: SnapshotEvent };
};

/** The simulation machine once it holds what the program verified. */
type Simulated = Extract<SnapshotResultSimulationState, { node: 'current' }> & {
    data: {
        read: NonNullable<
            Extract<
                SnapshotResultSimulationState,
                { node: 'current' }
            >['data']['read']
        >;
        unitsConsumed: bigint;
    };
};

/** Where reading the event and simulating stands. */
type ReadOutcome =
    | { outcome: 'reading' }
    | { outcome: 'failed'; error: string }
    | { outcome: 'verified'; data: Simulated['data'] };

/** The read machines' nodes that have failed. */
const FAILED = new Set(['failedWhileLoading', 'failedWhileRefreshing']);

/**
 * Where a read machine stands, short of its value.
 *
 * @param state The read machine's state.
 * @returns `failed` with its error while it has failed, else `reading`.
 */
const standingOf = ({
    node,
    data,
}: {
    node: string;
    data: object;
}): ReadOutcome =>
    FAILED.has(node)
        ? { outcome: 'failed', error: (data as { error: string }).error }
        : { outcome: 'reading' };

/**
 * Starts verifying one snapshot result on Solana, from the snapshot
 * transaction on. It gates on the proven request machine, which its
 * creator owns. On entry into `simulating` it makes the snapshot event
 * machine, builds the result's witness from the event and the request's
 * witness, and makes the simulation machine with it. Both carry on while it
 * moves between `simulating` and `readFailed`, and close when it leaves
 * them.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param addresses The `NoriSnapshot` address and the simulation's fee payer.
 * @param request The snapshot transaction and the query.
 * @param provenRequest The running proven request machine for the snapshot's proof request, from `createProvenRequestMachine`.
 * @returns The running machine; `verified` carries what the program verified. Its controls:
 *   - `retry()`: reads the event or simulates again now, without waiting, while `readFailed`.
 *   - `close()`: moves the machine to `closed`.
 */
export function createSnapshotVerificationMachine(
    connections: ProofRequestConnections,
    addresses: SnapshotVerificationAddresses,
    request: SnapshotVerificationRequest,
    provenRequest: ReturnType<typeof createProvenRequestMachine>
) {
    const close$ = new Subject<void>();
    const retry$ = new Subject<void>();
    const started$ = new ReplaySubject<
        StartedMachine<SnapshotVerificationState>
    >(1);
    const state$ = stateOf$(started$);

    /** The proven request machine reaching `node`, once. */
    const atNode$ = (node: ProvenRequestState['node']): Observable<void> =>
        provenRequest.state$.pipe(
            filter((state) => state.node === node),
            take(1),
            map((): void => undefined)
        );
    const proven$ = provenRequest.state$.pipe(
        filter((state): state is Proven => state.node === 'proven'),
        take(1),
        map(({ data }) => data)
    );

    // One read per entry into `simulating`, shared by the outcome edges of
    // `simulating` and `readFailed`, and held while the machine moves between them.
    const read$: Observable<ReadOutcome> = dataOnEntry$(
        state$,
        'simulating'
    ).pipe(
        switchMap(({ snapshotTxHash, queryId, proofQueueBatchAddress }) =>
            proven$.pipe(
                switchMap(({ witness }) =>
                    followedStates$(
                        () =>
                            createSnapshotEventMachine(
                                connections,
                                addresses.noriSnapshot,
                                snapshotTxHash
                            ),
                        retry$
                    ).pipe(
                        takeWhile(
                            (state): boolean =>
                                !(
                                    state.node === 'current' &&
                                    state.data.event !== undefined
                                ),
                            true
                        ),
                        switchMap((state) =>
                            state.node === 'current' &&
                            state.data.event !== undefined
                                ? followedStates$(
                                      () =>
                                          createSnapshotResultSimulationMachine(
                                              connections,
                                              addresses.noriSnapshot,
                                              addresses.feePayer,
                                              {
                                                  proofQueueBatchAddress,
                                                  queryId,
                                                  witness:
                                                      snapshotResultWitness(
                                                          addresses.noriSnapshot,
                                                          (state as EventRead)
                                                              .data.event,
                                                          queryId,
                                                          witness
                                                      ),
                                              }
                                          ),
                                      retry$
                                  ).pipe(
                                      map((simulation): ReadOutcome =>
                                          simulation.node === 'current' &&
                                          simulation.data.read !== undefined &&
                                          simulation.data.unitsConsumed !==
                                              undefined
                                              ? {
                                                    outcome: 'verified',
                                                    data: (
                                                        simulation as Simulated
                                                    ).data,
                                                }
                                              : standingOf(simulation)
                                      )
                                  )
                                : of(standingOf(state))
                        )
                    )
                )
            )
        ),
        heldAcrossMoves()
    );

    /** What the result was made for, carried from node to node. */
    const madeOf = ({
        snapshotTxHash,
        queryId,
    }: SnapshotVerificationRequest) => ({
        snapshotTxHash,
        queryId,
    });

    const machine = SnapshotVerificationGraph.implement({
        requestFound: {
            $: () => atNode$('waitingForProof'),
            next: (_found, _dest, source) => madeOf(source),
        },
        transactionReplaced: {
            $: () => atNode$('transactionReplaced'),
            next: (_replaced, _dest, source) => madeOf(source),
        },
        transactionDropped: {
            $: () => atNode$('transactionDropped'),
            next: (_dropped, _dest, source) => madeOf(source),
        },
        proven: {
            $: () => proven$,
            next: ({ proofAvailable }, _dest, source) => ({
                ...madeOf(source),
                proofQueueBatchIndex: proofAvailable.proofQueueBatchIndex,
                proofQueueBatchAddress: proofAvailable.proofQueueBatchAddress,
            }),
        },
        simulated: {
            $: () =>
                read$.pipe(
                    filter(
                        (
                            read
                        ): read is Extract<
                            ReadOutcome,
                            { outcome: 'verified' }
                        > => read.outcome === 'verified'
                    ),
                    take(1)
                ),
            next: ({ data }, _dest, source) => ({
                ...source,
                read: data.read,
                unitsConsumed: data.unitsConsumed,
            }),
        },
        readFailed: {
            $: () =>
                read$.pipe(
                    filter(
                        (
                            read
                        ): read is Extract<
                            ReadOutcome,
                            { outcome: 'failed' }
                        > => read.outcome === 'failed'
                    ),
                    take(1)
                ),
            next: ({ error }, _dest, source) => ({ ...source, error }),
        },
        readingAgain: {
            $: () =>
                read$.pipe(
                    filter(({ outcome }) => outcome === 'reading'),
                    take(1)
                ),
            next: (_reading, _dest, { error: _error, ...source }) => source,
        },
        close: {
            $: () => close$,
            next: () => ({}),
        },
    });

    const running = machine
        .close()
        .start('findingRequest', undefined, {
            findingRequest: madeOf(request),
        });
    started$.next(running);
    return Object.assign(running, {
        retry: () => retry$.next(),
        close: () => close$.next(),
    });
}
