import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';

/**
 * One guard's `assert_healthy`, the call a lender makes by CPI before
 * acting on the mint, run in a simulated Solana transaction through the
 * Solana connection (`readThroughConnectionsOf`): no signature, no fee.
 * `guard` and `mint`, the guard it is made for, are its starting data.
 * `simulated` is `undefined` until run: then the transaction's error
 * (`null` when the guard allows it; `customErrorOf` reads its code) and
 * what it cost. It is run once.
 */
export const AssertHealthyGraph = define(
    readThroughConnectionsOf({
        guard: '',
        mint: '',
        simulated: undefined as
            { err: unknown; unitsConsumed: bigint } | undefined,
    })
);

/** The `assert_healthy` simulation's state: a node of the graph and its data. */
export type AssertHealthyState = StateUnion<typeof AssertHealthyGraph.nodes>;
