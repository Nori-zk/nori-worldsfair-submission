import { Injectable } from '@yaw-rx/core';
import {
    BehaviorSubject,
    combineLatest,
    distinctUntilChanged,
    filter,
    interval,
    map,
    Observable,
    of,
    shareReplay,
    startWith,
    switchMap,
} from 'rxjs';
import { getAddress } from 'ethers';
import {
    type EnqueuedProofRequest,
    getEnqueuedProofRequests,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService, NoriBridgeInfraService } from '@nori-zk/solana-web-ui';
import { type ShownBatch, type BridgeBatchesState } from '../ystate/bridge-batches.js';
import {
    type BatchesAddresses,
    createBridgeBatchesMachine,
} from '../ystate/bridge-batches.impl.js';
import { type Arrived, waitingRows, type WaitingRow } from '../utils/waiting-rows.js';
import { SYNTHETIC, syntheticRequests } from '../utils/synthetic-requests.js';

/**
 * Each value with when it arrived.
 *
 * @param source$ The values.
 * @returns Each value and its arrival time, in ms since the epoch.
 */
const arrived = <T>(source$: Observable<T>): Observable<Arrived<T>> =>
    source$.pipe(map((value) => ({ value, atMs: Date.now() })));

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
 * URL filters on (started again when the filter changes), the rows of
 * requests no batch covers yet by where they wait, and each batch's
 * requests, read once when opened.
 */
@Injectable([ConnectionsService, NoriBridgeInfraService])
export class BridgeDashboardService {
    /** The filter: a contract, `''` for every contract, or `undefined` when `?target=` is not an address. */
    readonly target$ = new BehaviorSubject<Target>(targetFromUrl());
    /** The batches machine's states, or `undefined` while the filter is not an address. */
    readonly batches$: Observable<BridgeBatchesState | undefined>;
    /**
     * The requests no batch covers yet, as rows by where they wait: for
     * Ethereum finality, scheduled for processing, and in the job Nori is
     * processing. Built again each second, and on every new view or Nori state.
     */
    readonly waitingRows$: Observable<WaitingRow[]>;
    private readonly addresses: BatchesAddresses;
    private retryBatches: () => void = () => undefined;
    /** Each opened batch's requests, by batch index and filter. */
    private readonly batchRequests = new Map<string, Promise<EnqueuedProofRequest[]>>();
    private readonly onPopState = (): void => this.target$.next(targetFromUrl());

    /**
     * @param connections The connections, and the queue and program addresses.
     * @param noriBridgeInfra Nori's bridge state.
     */
    constructor(
        private readonly connections: ConnectionsService,
        noriBridgeInfra: NoriBridgeInfraService,
    ) {
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
        // Stamped once as they arrive, so a replay keeps the time they were sent.
        const bridge$ = arrived(noriBridgeInfra.state$).pipe(
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        const finality$ = arrived(noriBridgeInfra.finality$).pipe(
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        /** A Nori stream while its websocket is open, `undefined` otherwise. */
        const whileOpen = <T>(source$: Observable<T>): Observable<T | undefined> =>
            noriBridgeInfra.open$.pipe(
                switchMap((open) => (open ? source$.pipe(startWith(undefined)) : of(undefined))),
            );
        this.waitingRows$ = combineLatest([
            arrived(
                this.batches$.pipe(
                    filter((state): state is BridgeBatchesState => state !== undefined),
                    map((state) => state.data.view),
                    distinctUntilChanged(),
                ),
            ),
            whileOpen(bridge$),
            whileOpen(noriBridgeInfra.timings$),
            whileOpen(finality$),
            interval(1000).pipe(startWith(0)),
        ]).pipe(
            map(([view, bridge, timings, finality]) =>
                waitingRows({
                    // TEMPORARY: `?synthetic` adds synthetic requests to preview populated rows.
                    view: SYNTHETIC
                        ? {
                              ...view,
                              value: {
                                  ...view.value,
                                  waiting: [
                                      ...view.value.waiting,
                                      ...syntheticRequests(
                                          view.value.finalizedBlock,
                                          bridge?.value,
                                      ),
                                  ],
                              },
                          }
                        : view,
                    bridge,
                    timings,
                    finality,
                    nowMs: Date.now(),
                }),
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
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
    async requestsOf(batch: ShownBatch, target: string): Promise<EnqueuedProofRequest[]> {
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
