import { Injectable } from '@yaw-rx/core';
import {
    catchError,
    defer,
    firstValueFrom,
    type Observable,
    of,
    shareReplay,
    startWith,
    Subject,
    switchMap,
} from 'rxjs';
import { Interface, type Log } from 'ethers';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import {
    bothReady$,
    forCalls,
    forLogs,
    getBridgeState,
    type Ethereum,
    type EthereumProvider,
} from '@nori-zk/nori-bridge-solana-sdk';
import { type GuardState } from '@nori-zk/backstop-client/guard';
import { GuardBoardService } from './guard-board.service.js';

/** How many snapshots the tab shows, newest first. */
const SNAPSHOTS = 25;

/** The widest block range one log request asks for. */
const LOG_WINDOW = 2_000;

/** NoriSnapshot's `Snapshot` event, as `ethereum/contracts/NoriSnapshot.sol` declares it. */
const snapshotEvent = new Interface([
    'event Snapshot(uint256 indexed snapshotIndex, uint256 indexed requestId, uint256 blockNumber, uint256 timestamp, bytes32 resultsRoot, bytes32[] queryIds, bytes32[] results)',
]);

/** The `Snapshot` event's topic. */
const SNAPSHOT_TOPIC = snapshotEvent.getEvent('Snapshot')?.topicHash ?? '';

/** One NoriSnapshot transaction, from its `Snapshot` event alone. */
export interface SnapshotFact {
    index: bigint;
    requestId: bigint;
    blockNumber: bigint;
    /** The snapshot block's time, unix seconds. */
    timestamp: bigint;
    /** Each query's id and its 32-byte result, 0x-hex, in order. */
    queryIds: string[];
    results: string[];
    /** The snapshot transaction. */
    txHash: string;
}

/** One read of the tab: the snapshots, how far Nori has proven, and the guards that name queries. */
export interface Facts {
    /** The newest snapshots, newest first. */
    snapshots: SnapshotFact[];
    /** The first request id Nori has not proven yet. */
    queueCursor: bigint;
    /** The guards, for naming their backing and pause queries. */
    guards: GuardState[];
}

/** The `Snapshot` event's fields, as ethers decodes them. */
interface SnapshotArgs {
    snapshotIndex: bigint;
    requestId: bigint;
    blockNumber: bigint;
    timestamp: bigint;
    queryIds: string[];
    results: string[];
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
 * NoriSnapshot's `Snapshot` logs in a block range.
 *
 * @param provider Where to read.
 * @param fromBlock The first block.
 * @param toBlock The last block.
 * @returns The logs, oldest first.
 */
const snapshotLogs = async (
    provider: EthereumProvider,
    fromBlock: number,
    toBlock: number,
): Promise<Log[]> =>
    provider.getLogs({
        address: NORI_WEB_ENV.ethereum.snapshotAddress,
        topics: [SNAPSHOT_TOPIC],
        fromBlock,
        toBlock,
    });

/**
 * The newest snapshots: `Snapshot` logs read newest first in windows of
 * `LOG_WINDOW` blocks, from the latest block down to the queue's deploy
 * block, until `SNAPSHOTS` are found.
 *
 * shortcut: it scans back to the deploy block when there are fewer than
 * `SNAPSHOTS`; once history grows past a few days of blocks without that
 * many, scan a bounded window instead.
 *
 * @param ethereum The Ethereum chain.
 * @returns The snapshots, newest first.
 */
async function newestSnapshots(ethereum: Ethereum): Promise<SnapshotFact[]> {
    const latest = await forCalls(ethereum, async (provider) => provider.getBlockNumber());
    const deployBlock = NORI_WEB_ENV.ethereum.proofQueueDeployBlock;
    const found: SnapshotFact[] = [];
    for (let to = latest; to >= deployBlock && found.length < SNAPSHOTS; to -= LOG_WINDOW) {
        const logs = await forLogs(
            ethereum,
            snapshotLogs,
            Math.max(deployBlock, to - LOG_WINDOW + 1),
            to,
        );
        found.push(...logs.flatMap((log) => snapshotOf(log) ?? []));
    }
    return found
        .sort((a, b) => (a.index < b.index ? 1 : a.index > b.index ? -1 : 0))
        .slice(0, SNAPSHOTS);
}

/**
 * The facts tab's read: once when the tab opens, as soon as both chains
 * can serve it, and again on each `readAgain()`, with no timer, as a snapshot lands every 15 min at most.
 * Each read emits `undefined` first, then the facts or why reading failed.
 */
@Injectable([ConnectionsService, GuardBoardService])
export class FactsService {
    readonly facts$: Observable<Facts | string | undefined>;
    private readonly refresh = new Subject<void>();

    /**
     * @param connections The connections: snapshots from Ethereum, the queue cursor from Solana.
     * @param guardBoard The guards, read once per read to name their queries.
     */
    constructor(connections: ConnectionsService, guardBoard: GuardBoardService) {
        const { ethereum, solana } = connections.connections;
        const read = async (): Promise<Facts> => {
            const [snapshots, state, guards] = await Promise.all([
                newestSnapshots(ethereum),
                getBridgeState(solana, NORI_WEB_ENV.solana.programAddress),
                // Taken once: staying subscribed would keep the guards' 30 s poll running.
                firstValueFrom(guardBoard.guards$),
            ]);
            return {
                snapshots,
                queueCursor: state.queueCursor,
                guards: typeof guards === 'string' ? [] : guards.map(({ guard }) => guard),
            };
        };
        // The read needs both chains: wait until both can serve it, once.
        this.facts$ = bothReady$(connections.connections).pipe(
            switchMap(() => this.refresh.pipe(startWith(undefined))),
            switchMap(() =>
                defer(read).pipe(
                    catchError((error: unknown) =>
                        of(error instanceof Error ? error.message : String(error)),
                    ),
                    startWith(undefined),
                ),
            ),
            startWith(undefined),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    /** Reads the snapshots again. */
    readAgain(): void {
        this.refresh.next();
    }
}
