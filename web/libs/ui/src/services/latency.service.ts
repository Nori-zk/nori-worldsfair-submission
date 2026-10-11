import { Injectable } from '@yaw-rx/core';
import {
    combineLatest,
    distinctUntilChanged,
    map,
    type Observable,
    of,
    shareReplay,
    switchMap,
} from 'rxjs';
import {
    createBridgeStateMachine,
    createEthereumBlocksMachine,
    createProofQueueBatchesMachine,
    createProofQueueBatchRequestsMachine,
    type EnqueuedProofRequest,
    type ProofQueueBatchesState,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { followedStates$ } from '@nori-zk/backstop-keeper/read';
import { ConnectionsService } from './connections.service.js';
import { createBatchLandingsMachine } from '../machines/batchLandings.impl.js';
import { type BatchLanding } from '../utils/batch-landing.js';

/** How many batches the tab reads, newest first. */
const BATCH_COUNT = 30;

/** The latency tab's reads: the newest batches, their NoriSnapshot requests, and when each batch landed. */
export interface Latency {
    /** The newest batches, newest first. */
    batches: ProofQueueBatchSummary[];
    /** The NoriSnapshot requests in the batches, oldest first. */
    requests: EnqueuedProofRequest[];
    /** Each batch's landing by index; `undefined` while they are read. */
    landings: Map<bigint, BatchLanding> | undefined;
}

/**
 * The batches the batches machine's view holds: none before its first read.
 *
 * @param state The batches machine's state.
 * @returns The batches.
 */
const batchesOf = (state: ProofQueueBatchesState): ProofQueueBatchSummary[] =>
    'view' in state.data ? state.data.view.batches : [];

/**
 * Whether two runs of batches are the same batches, in the same order.
 *
 * @param before The run before.
 * @param now The run now.
 * @returns Whether their indices match.
 */
const sameBatches = (before: ProofQueueBatchSummary[], now: ProofQueueBatchSummary[]): boolean =>
    before.length === now.length &&
    before.every(
        ({ proofQueueBatchIndex }, i) => proofQueueBatchIndex === now[i]?.proofQueueBatchIndex,
    );

/**
 * The latency tab's reads, each a machine kept current: the newest
 * `BATCH_COUNT` batches (the sdk's batches machine, from the bridge's state
 * and Ethereum's blocks), each batch's NoriSnapshot requests (one sdk batch
 * requests machine per batch, made when the run of batches changes and
 * closed with it), and when each batch landed on Solana.
 */
@Injectable([ConnectionsService])
export class LatencyService {
    /** The batches machine's states. */
    readonly state$: Observable<ProofQueueBatchesState>;
    /** The reads, as the machines hold them: the batches and requests read so far, and the landings once read. */
    readonly latency$: Observable<Latency>;
    private readonly bridgeState: ReturnType<typeof createBridgeStateMachine>;
    private readonly ethereumBlocks: ReturnType<typeof createEthereumBlocksMachine>;
    private readonly batches: ReturnType<typeof createProofQueueBatchesMachine>;
    private readonly landings: ReturnType<typeof createBatchLandingsMachine>;

    /**
     * @param connections The connections: batches and landings from Solana, requests from Ethereum.
     */
    constructor(connections: ConnectionsService) {
        const programAddress = NORI_WEB_ENV.solana.programAddress;
        const { proofQueueAddress, snapshotAddress, proofQueueDeployBlock } = NORI_WEB_ENV.ethereum;
        this.bridgeState = createBridgeStateMachine(connections.connections, programAddress);
        this.ethereumBlocks = createEthereumBlocksMachine(connections.connections);
        this.batches = createProofQueueBatchesMachine(
            connections.connections,
            { proofQueueAddress, programAddress },
            { fromBlock: proofQueueDeployBlock, count: BATCH_COUNT },
            { bridgeState: this.bridgeState, ethereumBlocks: this.ethereumBlocks },
        );
        this.landings = createBatchLandingsMachine(
            connections.connections,
            programAddress,
            this.batches,
        );
        this.state$ = this.batches.state$;

        const batches$ = this.batches.state$.pipe(
            map(batchesOf),
            distinctUntilChanged(sameBatches),
        );
        // Each batch's NoriSnapshot requests, made for the run of batches in view: those read so far.
        const requests$: Observable<EnqueuedProofRequest[]> = batches$.pipe(
            switchMap((batches) =>
                batches.length === 0
                    ? of([])
                    : combineLatest(
                          batches.map((batch) =>
                              followedStates$(() =>
                                  createProofQueueBatchRequestsMachine(
                                      connections.connections,
                                      proofQueueAddress,
                                      batch,
                                      { target: snapshotAddress, fromBlock: proofQueueDeployBlock },
                                  ),
                              ),
                          ),
                      ).pipe(
                          map((states) =>
                              states
                                  .flatMap((state) =>
                                      'requests' in state.data ? state.data.requests : [],
                                  )
                                  .sort((a, b) =>
                                      a.requestId < b.requestId
                                          ? -1
                                          : a.requestId > b.requestId
                                            ? 1
                                            : 0,
                                  ),
                          ),
                      ),
            ),
        );
        this.latency$ = combineLatest([batches$, requests$, this.landings.state$]).pipe(
            map(([batches, requests, landings]) => {
                switch (landings.node) {
                    case 'loading':
                    case 'waitingForConnectionWhileLoading':
                    case 'failedWhileLoading':
                    case 'closed':
                        return { batches, requests, landings: undefined };
                    case 'current':
                    case 'refreshing':
                    case 'waitingForConnectionWhileRefreshing':
                    case 'failedWhileRefreshing':
                        return {
                            batches,
                            requests,
                            landings: new Map(
                                landings.data.landings.map(
                                    ({ proofQueueBatchIndex, atSecs, signature }) => [
                                        proofQueueBatchIndex,
                                        { atSecs, signature },
                                    ],
                                ),
                            ),
                        };
                }
            }),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    /**
     * Closes the reads with the app.
     * @returns {void}
     */
    onDestroy(): void {
        this.landings.close();
        this.batches.close();
        this.ethereumBlocks.close();
        this.bridgeState.close();
    }
}
