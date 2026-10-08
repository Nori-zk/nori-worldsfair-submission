import { Injectable } from '@yaw-rx/core';
import {
    BehaviorSubject,
    distinctUntilChanged,
    map,
    Observable,
    of,
    shareReplay,
    switchMap,
} from 'rxjs';
import { getAddress } from 'ethers';
import {
    createUnprocessedProofRequestStateMachine,
    type EnqueuedProofRequest,
    getEnqueuedProofRequests,
    getNoriBridgeInfraState$,
    getNoriBridgeInfraStateWithTimings$,
    startNoriBridgeInfraTransitions,
    type NoriBridgeInfraTransitionState,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { type ShownBatch, type BridgeBatchesState } from '../ystate/bridge-batches.js';
import { type BatchesAddresses, createBridgeBatchesMachine } from '../ystate/bridge-batches.impl.js';

/** The filter the page's URL holds: a contract address, `''` for every contract, or `undefined` when it is not an address. */
type Target = string | undefined;

/**
 * The contract `?target=` names, checksummed.
 *
 * @returns The address, `''` without a filter, or `undefined` when it is not an address.
 */
const targetFromUrl = (): Target => {
    const target = new URLSearchParams(window.location.search).get('target')?.trim() ?? '';
    if (target === '') return '';
    try {
        return getAddress(target);
    } catch {
        return undefined;
    }
};

/**
 * Everything the dashboard shows: the batches machine for the contract the
 * URL filters on (started again when the filter changes), Nori's pipeline
 * from its websocket, and each batch's requests, read once when opened.
 */
@Injectable([ConnectionsService])
export class BridgeDashboardService {
    /** The filter: a contract, `''` for every contract, or `undefined` when `?target=` is not an address. */
    readonly target$ = new BehaviorSubject<Target>(targetFromUrl());
    /** The batches machine's states, or `undefined` while the filter is not an address. */
    readonly batches$: Observable<BridgeBatchesState | undefined>;
    /**
     * The oldest waiting request's unprocessed machine states: where it waits
     * and the sdk's estimate of the time left, ticking each second; `undefined`
     * while none is waiting.
     */
    readonly runProgress$: Observable<UnprocessedProofRequestStateNodeUnion | undefined>;
    /** Nori's pipeline, one notice at a time. */
    readonly infraStage$: Observable<NoriBridgeInfraTransitionState>;
    /** The bridge's current stage, blocks and time left, counting down each second. */
    readonly bridgeState$: ReturnType<typeof getNoriBridgeInfraStateWithTimings$>;
    /** Whether Nori's websocket is open. */
    readonly noriOpen$: Observable<boolean>;
    private readonly addresses: BatchesAddresses;
    private retryBatches: () => void = () => undefined;
    /** Each opened batch's requests, by batch index and filter. */
    private readonly batchRequests = new Map<string, Promise<EnqueuedProofRequest[]>>();
    private readonly onPopState = (): void => this.target$.next(targetFromUrl());

    /**
     * @param connections The connections, and the queue and program addresses.
     */
    constructor(private readonly connections: ConnectionsService) {
        const { connections: all, options } = connections;
        this.addresses = {
            ...options.proofRequests,
            proofQueueDeployBlock: NORI_WEB_ENV.ethereum.proofQueueDeployBlock,
        };
        this.batches$ = this.target$.pipe(
            switchMap((target) =>
                target === undefined
                    ? of(undefined)
                    : new Observable<BridgeBatchesState>((subscriber) => {
                          const { bridgeBatches, retry } = createBridgeBatchesMachine(
                              all,
                              this.addresses,
                              target,
                          );
                          this.retryBatches = retry;
                          const subscription = bridgeBatches.state$.subscribe(subscriber);
                          return () => {
                              subscription.unsubscribe();
                              bridgeBatches.stop();
                          };
                      }),
            ),
            shareReplay({ bufferSize: 1, refCount: false }),
        );
        // A request simulated at the block the bridge's job proves to: always
        // finalized, so the machine starts straight into the job's stage.
        this.runProgress$ = getNoriBridgeInfraState$(all.nori).pipe(
            map((state) => state.output_block_number),
            distinctUntilChanged(),
            switchMap(
                (jobBlock) =>
                    new Observable<UnprocessedProofRequestStateNodeUnion>((subscriber) => {
                          const unprocessed = createUnprocessedProofRequestStateMachine(
                              jobBlock,
                              all.nori,
                          )
                              .close()
                              .start('WaitingForEthFinality');
                          const subscription = unprocessed.state$.subscribe(subscriber);
                          return () => {
                              subscription.unsubscribe();
                              unprocessed.stop();
                          };
                      }),
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        this.infraStage$ = startNoriBridgeInfraTransitions(all.nori).noriBridgeInfraTransitions.state$;
        this.bridgeState$ = getNoriBridgeInfraStateWithTimings$(all.nori);
        this.noriOpen$ = all.nori.websocket.connection.state$.pipe(
            map((state) => state.node === 'open'),
        );
        window.addEventListener('popstate', this.onPopState);
    }

    /**
     * Filters on a contract, or shows every contract for `''`, and writes it to `?target=`.
     *
     * @param target The contract's address, or `''`.
     */
    filter(target: string): void {
        const url = new URL(window.location.href);
        if (target.trim() === '') url.searchParams.delete('target');
        else url.searchParams.set('target', target.trim());
        window.history.pushState(null, '', url);
        this.target$.next(targetFromUrl());
    }

    /**
     * Reads the batches again now, while a read has failed.
     * @returns {void}
     */
    retry(): void {
        this.retryBatches();
    }

    /**
     * A batch's requests (only the filtered contract's when there is a
     * filter), read once over the batch's own block range and id range.
     *
     * @param batch The batch.
     * @param target The contract, or `''` for every contract.
     * @returns The requests, oldest first.
     */
    requestsOf(batch: ShownBatch, target: string): Promise<EnqueuedProofRequest[]> {
        const key = `${batch.proofQueueBatchIndex.toString()}:${target}`;
        let requests = this.batchRequests.get(key);
        if (requests === undefined) {
            requests = getEnqueuedProofRequests(
                this.connections.connections.ethereum,
                this.addresses.proofQueueAddress,
                {
                    fromBlock:
                        batch.previousOutputBlockNumber < 0n
                            ? this.addresses.proofQueueDeployBlock
                            : Number(batch.previousOutputBlockNumber) + 1,
                    toBlock: Number(batch.outputBlockNumber),
                    fromRequestId: batch.inputQueueCursor,
                    toRequestId: batch.outputQueueCursor,
                    ...(target === '' ? {} : { target }),
                },
            );
            this.batchRequests.set(key, requests);
            // A failed read is read again on the next open.
            requests.catch(() => this.batchRequests.delete(key));
        }
        return requests;
    }

    /**
     * Stops listening for back and forward.
     * @returns {void}
     */
    onDestroy(): void {
        window.removeEventListener('popstate', this.onPopState);
    }
}
