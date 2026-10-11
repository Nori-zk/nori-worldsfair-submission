import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import type { Preview } from './prove-balance.js';

/** The request a snapshot transaction sent, and what reading it again found. */
interface ResumedRequest {
    /** `eth`, or an ERC-20 token's address. */
    asset: string;
    /** The Ethereum address whose balance is proven. */
    holder: string;
    /** Its symbol and decimals read again, the balance at the latest block, and the fee the transaction paid. */
    preview: Preview;
}

/**
 * The request a snapshot transaction sent, read back from Ethereum through
 * the Ethereum connection (`readThroughConnectionsOf`), so a page opened at
 * `?tx=` follows that proof again. `txHash`, the transaction it is made for,
 * is its starting data. Only a snapshot of one balance query, as this app
 * sends, resumes: `current` holds its `request`, or `undefined` for any
 * other transaction. A sent transaction never changes, so it is never read
 * again.
 */
export const ResumeGraph = define(
    readThroughConnectionsOf({
        txHash: '',
        request: undefined as ResumedRequest | undefined,
    }),
);

/** The resume's state: a node of the graph and its data. */
export type ResumeState = StateUnion<typeof ResumeGraph.nodes>;
