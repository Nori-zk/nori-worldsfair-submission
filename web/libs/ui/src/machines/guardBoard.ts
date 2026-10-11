import { define, type StateUnion } from '@yaw-rx/ystate';
import { type Address } from '@solana/kit';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type guardStatus, type GuardState } from '@nori-zk/backstop-keeper/guard';

/** One guard and its mint's live supply. */
export interface GuardRead {
    address: Address;
    guard: GuardState;
    supply: bigint;
    decimals: number;
    status: ReturnType<typeof guardStatus>;
}

/**
 * Every Backstop guard on the cluster with its mint's live supply, read
 * through the Solana connection (`readThroughConnectionsOf`): read at once,
 * then again on each transaction calling Backstop and every interval, as a
 * guard's status moves with the clock. `guards` holds the guards whose mint
 * exists; it is empty until the first read.
 */
export const GuardBoardGraph = define(readThroughConnectionsOf({ guards: [] as GuardRead[] }));

/** The guard board's state: a node of the graph and its data. */
export type GuardBoardState = StateUnion<typeof GuardBoardGraph.nodes>;
