import {
    concatMap,
    defaultIfEmpty,
    from,
    last,
    map,
    type Observable,
    scan,
    switchMap,
    takeWhile,
} from 'rxjs';
import { Interface, type Log } from 'ethers';
import {
    blockRanges,
    changesOf$,
    createChainChangesMachine,
    type EthereumProvider,
    ethRpcRead$,
    MAX_BLOCK_RANGE_PER_QUERY,
    type ProofRequestConnections,
    type ReadRetryBackoff,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type SnapshotFact, SnapshotFactsGraph } from './snapshotFacts.js';

/** How many snapshots it holds, newest first. */
const SNAPSHOTS = 25;

/** NoriSnapshot's `Snapshot` event, as `ethereum/contracts/NoriSnapshot.sol` declares it. */
const snapshotEvent = new Interface([
    'event Snapshot(uint256 indexed snapshotIndex, uint256 indexed requestId, uint256 blockNumber, uint256 timestamp, bytes32 resultsRoot, bytes32[] queryIds, bytes32[] results)',
]);

/** The `Snapshot` event's topic. */
const SNAPSHOT_TOPIC = snapshotEvent.getEvent('Snapshot')?.topicHash ?? '';

/** The `Snapshot` event's fields, as ethers decodes them. */
interface SnapshotArgs {
    snapshotIndex: bigint;
    requestId: bigint;
    blockNumber: bigint;
    timestamp: bigint;
    queryIds: string[];
    results: string[];
}

/** Where the snapshots are read. */
export interface SnapshotFactsAddresses {
    /** The `NoriSnapshot` address. */
    snapshotAddress: string;
    /** The proof queue's deploy block: no snapshot is older. */
    deployBlock: number;
}

/**
 * A `Snapshot` log as the tab shows it.
 *
 * @param log The log.
 * @returns The snapshot, or `undefined` when the log is not a `Snapshot` event.
 */
function snapshotOf(log: Log): SnapshotFact | undefined {
    const parsed = snapshotEvent.parseLog(log);
    if (parsed === null) return undefined;
    const args = parsed.args as unknown as SnapshotArgs;
    return {
        index: args.snapshotIndex,
        requestId: args.requestId,
        blockNumber: args.blockNumber,
        timestamp: args.timestamp,
        queryIds: [...args.queryIds],
        results: [...args.results],
        txHash: log.transactionHash,
    };
}

/**
 * The newest snapshots: `Snapshot` logs read newest first in windows of
 * `MAX_BLOCK_RANGE_PER_QUERY` blocks, from the latest block down to the
 * queue's deploy block, until `SNAPSHOTS` are found.
 *
 * shortcut: it scans back to the deploy block when there are fewer than
 * `SNAPSHOTS`; once history grows past a few days of blocks without that
 * many, scan a bounded window instead.
 *
 * @param provider Where to read.
 * @param addresses The `NoriSnapshot` address and the deploy block.
 * @returns The snapshots, newest first, once.
 */
const newestSnapshots$ = (
    provider: EthereumProvider,
    { snapshotAddress, deployBlock }: SnapshotFactsAddresses,
): Observable<SnapshotFact[]> =>
    ethRpcRead$(async () => provider.getBlockNumber(), 'Failed to read the latest block.').pipe(
        switchMap((latest) =>
            from(blockRanges(latest, deployBlock, MAX_BLOCK_RANGE_PER_QUERY, 'desc')).pipe(
                concatMap(([fromBlock, toBlock]) =>
                    ethRpcRead$(
                        async () =>
                            provider.getLogs({
                                address: snapshotAddress,
                                topics: [SNAPSHOT_TOPIC],
                                fromBlock,
                                toBlock,
                            }),
                        `Snapshot log query over blocks ${fromBlock}-${toBlock} failed.`,
                    ),
                ),
                scan(
                    (found: SnapshotFact[], logs) => [
                        ...found,
                        ...logs.flatMap((log) => snapshotOf(log) ?? []),
                    ],
                    [],
                ),
                takeWhile((found) => found.length < SNAPSHOTS, true),
                defaultIfEmpty([] as SnapshotFact[]),
                last(),
            ),
        ),
        map((found) =>
            found
                .sort((a, b) => (a.index < b.index ? 1 : a.index > b.index ? -1 : 0))
                .slice(0, SNAPSHOTS),
        ),
    );

/** The running snapshot facts machine, with its controls. */
export type SnapshotFactsMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof SnapshotFactsGraph.nodes,
        typeof SnapshotFactsGraph.edges
    >
>;

/**
 * Starts reading the newest NoriSnapshot snapshots through the Ethereum
 * connection, and reading them again on each `Snapshot` event.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param addresses The `NoriSnapshot` address and the deploy block.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the snapshots. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createSnapshotFactsMachine = (
    connections: ProofRequestConnections,
    addresses: SnapshotFactsAddresses,
    backoff: ReadRetryBackoff = {},
): SnapshotFactsMachine => {
    const snapshotted = createChainChangesMachine(connections.ethereum, {
        address: addresses.snapshotAddress,
        topics: [SNAPSHOT_TOPIC],
    });
    return startReadThroughConnectionsMachine(SnapshotFactsGraph, {
        connections,
        read: (clients) =>
            clients
                .ethereum((provider) => newestSnapshots$(provider, addresses))
                .pipe(map((snapshots) => ({ snapshots }))),
        refreshOn: () => changesOf$(snapshotted),
        kind: 'logs',
        needs: ['ethereum'],
        backoff,
        owns: [snapshotted],
    });
};
