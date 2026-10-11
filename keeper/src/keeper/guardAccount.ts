import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type AsNodeData } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type GuardState } from '../guard.js';

/**
 * One guard the keeper administers, read through the Solana connection
 * (`readThroughConnectionsOf`): its account and its mint's supply, read at
 * once, then again on each transaction calling Backstop and every poll
 * interval, as its status moves with time. `mint` and `admin`, the guard it
 * is made for, are its starting data. `address` is the guard account, `''`
 * until read; `guard` stays `undefined` while the guard or its mint does
 * not exist.
 */
export const GuardAccountGraph = define(
    readThroughConnectionsOf({
        mint: '',
        admin: '',
        address: '',
        guard: undefined as AsNodeData<GuardState> | undefined,
        supply: 0n as bigint,
    })
);

/** The guard account's state: a node of the graph and its data. */
export type GuardAccountState = StateUnion<typeof GuardAccountGraph.nodes>;
