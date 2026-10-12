import { address, type Address, type TransactionSigner } from '@solana/kit';
import {
    combineLatest,
    EMPTY,
    filter,
    map,
    type Observable,
    of,
    ReplaySubject,
    Subject,
    switchMap,
    take,
} from 'rxjs';
import {
    createProofRequestStateMachine,
    type ProofRequestConnections,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    dataOnEntry$,
    stateOf$,
    type StartedMachine,
} from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type ReadKind, submitReadInstruction } from '../backstop.js';
import { followedStates$, heldAcrossMoves } from '../followedStates.js';
import { type ProvenRequestState } from '../provenRequest.js';
import { createProvenRequestMachine } from '../provenRequest.impl.js';
import { type SnapshotEventState } from '../snapshotEvent.js';
import { createSnapshotEventMachine } from '../snapshotEvent.impl.js';
import {
    type SnapshotEvent,
    snapshotResultWitness,
} from '../snapshotWitness.js';
import {
    BACKSTOP_ERROR_NAMES,
    sendOutcomeOf,
    sendOver,
    signerSend$,
} from './sends.js';
import {
    SnapshotSubmissionGraph,
    type SnapshotSubmissionState,
    type SubmittedReadOutcome,
} from './snapshotSubmission.js';

/** One guard read a snapshot submits: which guard, which kind, and the query whose result it is. */
export interface GuardRead {
    /** `<guard name> backing` or `<guard name> pause`. */
    read: string;
    /** The guard account. */
    guard: Address;
    /** The guarded mint. */
    mint: Address;
    kind: ReadKind;
    queryId: string;
}

/** Where the snapshot is proven, and the reads to submit. */
export interface SnapshotSubmissionRequest {
    /** The `NoriSnapshot` address. */
    noriSnapshot: string;
    /** The `NoriProofRequestQueue` address. */
    proofQueue: string;
    /** The Nori program that commits proof queue batches. */
    noriProgram: Address;
    reads: GuardRead[];
}

/** The proven request machine once proven. */
type Proven = Extract<ProvenRequestState, { node: 'proven' }>;

/** The event machine once it holds the event. */
type EventRead = Extract<SnapshotEventState, { node: 'current' }> & {
    data: { event: SnapshotEvent };
};

/**
 * Starts following one snapshot transaction the keeper sent: until Nori has
 * proven its batch, then its event, then each guard read sent with the
 * keeper's signer until it is over. Each machine it gates on is made on
 * entry into the node that needs it and closed when the flow leaves it: the
 * proof request and proven request machines in `findingRequest` (held into
 * `waitingForProof`), the event machine in `readingEvent`, and one signer
 * transaction per read in `submitting`.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param snapshotTxHash The snapshot transaction.
 * @param request The addresses and the reads.
 * @param signer The keeper's Solana signer.
 * @param resendAfterMs How long a read whose send failed or expired waits before it is sent again.
 * @param recheckTrigger$ An extra signal to read the proof request again.
 * @returns The running machine; `submitted` carries how each read ended. Its control:
 *   - `close()`: moves the machine to `closed`.
 */
export function createSnapshotSubmissionMachine(
    connections: ProofRequestConnections,
    snapshotTxHash: string,
    request: SnapshotSubmissionRequest,
    signer: TransactionSigner,
    resendAfterMs: number,
    recheckTrigger$: Observable<unknown> = EMPTY
) {
    const close$ = new Subject<void>();
    const started$ = new ReplaySubject<StartedMachine<SnapshotSubmissionState>>(
        1
    );
    const state$ = stateOf$(started$);

    // The proven request, made for the snapshot `findingRequest` holds and followed through `waitingForProof`.
    const provenRequest$: Observable<ProvenRequestState> = dataOnEntry$(
        state$,
        'findingRequest'
    ).pipe(
        switchMap(({ snapshotTxHash: held }) =>
            followedStates$(() => {
                const proofRequest = createProofRequestStateMachine(
                    connections,
                    {
                        proofQueueAddress: request.proofQueue,
                        proofRequestTxHash: held,
                        programAddress: request.noriProgram,
                    },
                    undefined,
                    undefined,
                    recheckTrigger$
                );
                const proven = createProvenRequestMachine(
                    connections,
                    request.proofQueue,
                    proofRequest
                );
                return {
                    state$: proven.state$,
                    close: () => {
                        proven.close();
                        proofRequest.close();
                    },
                };
            })
        ),
        heldAcrossMoves()
    );

    /** The proven request machine reaching `node`, once. */
    const provenRequestAt$ = (
        node: ProvenRequestState['node']
    ): Observable<void> =>
        provenRequest$.pipe(
            filter((state) => state.node === node),
            take(1),
            map((): void => undefined)
        );

    const machine = SnapshotSubmissionGraph.implement({
        requestFound: {
            $: () => provenRequestAt$('waitingForProof'),
            next: (_found, _dest, { snapshotTxHash: held }) => ({
                snapshotTxHash: held,
            }),
        },
        transactionReplaced: {
            $: () => provenRequestAt$('transactionReplaced'),
            next: (_replaced, _dest, { snapshotTxHash: held }) => ({
                snapshotTxHash: held,
            }),
        },
        transactionDropped: {
            $: () => provenRequestAt$('transactionDropped'),
            next: (_dropped, _dest, { snapshotTxHash: held }) => ({
                snapshotTxHash: held,
            }),
        },
        proven: {
            $: () =>
                provenRequest$.pipe(
                    filter((state): state is Proven => state.node === 'proven'),
                    take(1),
                    map(({ data }) => data)
                ),
            next: (
                { proofAvailable, witness },
                _dest,
                { snapshotTxHash: held }
            ) => ({
                snapshotTxHash: held,
                proofQueueBatchAddress: proofAvailable.proofQueueBatchAddress,
                witness,
            }),
        },
        eventRead: {
            $: () =>
                dataOnEntry$(state$, 'readingEvent').pipe(
                    switchMap(({ snapshotTxHash: held }) =>
                        followedStates$(() =>
                            createSnapshotEventMachine(
                                connections,
                                request.noriSnapshot,
                                held
                            )
                        )
                    ),
                    filter(
                        (state): state is EventRead =>
                            state.node === 'current' &&
                            state.data.event !== undefined
                    ),
                    take(1),
                    map(({ data }) => data.event)
                ),
            next: (event, _dest, source) => ({ ...source, event }),
        },
        readsSubmitted: {
            $: () =>
                dataOnEntry$(state$, 'submitting').pipe(
                    switchMap(({ proofQueueBatchAddress, witness, event }) =>
                        request.reads.length === 0
                            ? of([])
                            : combineLatest(
                                  request.reads.map((guardRead) =>
                                      signerSend$(
                                          connections,
                                          signer,
                                          [
                                              submitReadInstruction({
                                                  guard: guardRead.guard,
                                                  mint: guardRead.mint,
                                                  proofQueueBatch: address(
                                                      proofQueueBatchAddress
                                                  ),
                                                  kind: guardRead.kind,
                                                  witness:
                                                      snapshotResultWitness(
                                                          request.noriSnapshot,
                                                          event,
                                                          guardRead.queryId,
                                                          witness
                                                      ),
                                              }),
                                          ],
                                          {
                                              errorNames: BACKSTOP_ERROR_NAMES,
                                              commitment: 'confirmed',
                                          },
                                          resendAfterMs
                                      )
                                  )
                              )
                    ),
                    filter((states) => states.every(sendOver)),
                    take(1),
                    map((states) =>
                        states.map((state, i): SubmittedReadOutcome => ({
                            read: request.reads[i]?.read ?? '',
                            outcome: sendOver(state)
                                ? sendOutcomeOf(state)
                                : '',
                        }))
                    )
                ),
            next: (
                outcomes,
                _dest,
                { snapshotTxHash: held, proofQueueBatchAddress }
            ) => ({
                snapshotTxHash: held,
                proofQueueBatchAddress,
                outcomes,
            }),
        },
        close: {
            $: () => close$,
            next: () => ({}),
        },
    });

    const running = machine.close().start('findingRequest', undefined, {
        findingRequest: { snapshotTxHash },
    });
    started$.next(running);
    return Object.assign(running, { close: () => close$.next() });
}
