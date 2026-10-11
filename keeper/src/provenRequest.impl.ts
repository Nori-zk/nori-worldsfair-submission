import {
    filter,
    map,
    type Observable,
    ReplaySubject,
    Subject,
    switchMap,
    take,
} from 'rxjs';
import {
    createProofRequestWitnessMachine,
    type ProofRequestConnections,
    type ProofRequestStateNodeUnion,
    type ProofRequestWitnessState,
    type RequestWitness,
    type VerifiedRequestWitness,
} from '@nori-zk/nori-bridge-solana-sdk';
import {
    dataOnEntry$,
    stateOf$,
    type StartedMachine,
} from '@nori-zk/nori-bridge-solana-sdk/utils';
import { followedStates$ } from './followedStates.js';
import {
    ProvenRequestGraph,
    type ProvenRequestState,
} from './provenRequest.js';

/** The proof request machine once a committed batch covers the request. */
type ProofAvailable = Extract<
    ProofRequestStateNodeUnion,
    { node: 'proofAvailable' }
>;

/** The witness machine once it holds the witness. */
type WitnessRead = Extract<ProofRequestWitnessState, { node: 'current' }> & {
    data: { witness: RequestWitness; verifiedWitness: VerifiedRequestWitness };
};

/**
 * Whether the witness machine holds the witness.
 *
 * @param state The witness machine's state.
 * @returns `true` once it is current with the witness.
 */
const witnessRead = (state: ProofRequestWitnessState): state is WitnessRead =>
    state.node === 'current' &&
    state.data.witness !== undefined &&
    state.data.verifiedWitness !== undefined;

/**
 * Starts following one proof request until Nori has proven its batch, then
 * reads the request's witness in it. It gates on the proof request
 * machine, which its creator owns. The witness machine is made from the
 * batch `readingWitness` holds, on entry, and closed when the flow leaves
 * `readingWitness`.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param proofQueueAddress The `NoriProofRequestQueue` address.
 * @param proofRequest The running proof request machine following the request, from `createProofRequestStateMachine`: its states.
 * @returns The running machine; `proven` carries the batch and the witness. Its control:
 *   - `close()`: moves the machine to `closed`.
 */
export function createProvenRequestMachine(
    connections: ProofRequestConnections,
    proofQueueAddress: string,
    proofRequest: StartedMachine<ProofRequestStateNodeUnion>
) {
    const close$ = new Subject<void>();
    const started$ = new ReplaySubject<StartedMachine<ProvenRequestState>>(1);
    const state$ = stateOf$(started$);

    /** The proof request machine reaching `node`, once. */
    const atNode$ = (
        node: ProofRequestStateNodeUnion['node']
    ): Observable<void> =>
        proofRequest.state$.pipe(
            filter((state) => state.node === node),
            take(1),
            map((): void => undefined)
        );

    const machine = ProvenRequestGraph.implement({
        requestFound: {
            $: () => atNode$('current'),
            next: () => ({}),
        },
        transactionReplaced: {
            $: () => atNode$('transactionReplaced'),
            next: () => ({}),
        },
        transactionDropped: {
            $: () => atNode$('transactionDropped'),
            next: () => ({}),
        },
        proofAvailable: {
            $: () =>
                proofRequest.state$.pipe(
                    filter(
                        (state): state is ProofAvailable =>
                            state.node === 'proofAvailable'
                    ),
                    take(1),
                    map(({ data }) => data.snapshot)
                ),
            next: (snapshot) => ({ proofAvailable: snapshot }),
        },
        witnessRead: {
            $: () =>
                dataOnEntry$(state$, 'readingWitness').pipe(
                    switchMap(({ proofAvailable }) =>
                        followedStates$(() =>
                            createProofRequestWitnessMachine(
                                connections,
                                proofQueueAddress,
                                proofAvailable
                            )
                        )
                    ),
                    filter(witnessRead),
                    take(1)
                ),
            next: ({ data }, _dest, source) => ({
                proofAvailable: source.proofAvailable,
                witness: data.witness,
                verifiedWitness: data.verifiedWitness,
            }),
        },
        close: {
            $: () => close$,
            next: () => ({}),
        },
    });

    const running = machine.close().start('findingRequest');
    started$.next(running);
    return Object.assign(running, { close: () => close$.next() });
}
