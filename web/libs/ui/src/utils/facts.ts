import { type GuardState } from '@nori-zk/backstop-keeper/guard';
import { amount, shortHex } from './format.js';

/** What a guard tells about a query id: its mint, its two queries and the backing's decimals. */
export type GuardQueries = Pick<GuardState, 'mint'> & {
    config: Pick<GuardState['config'], 'backingQuery' | 'pauseQuery' | 'backingDecimals'>;
};

/** What a query is, as far as the guards know. */
export interface FactLabel {
    /** `Fhw5…cbhi backing`, `Fhw5…cbhi paused`, or the query id cut short. */
    text: string;
    kind: 'backing' | 'pause' | 'unknown';
    /** The backing's decimals, for a backing query. */
    decimals?: number;
}

/**
 * Names a query by the guard that reads it.
 *
 * @param queryId The query id, 0x-hex.
 * @param guards The guards on the cluster.
 * @returns The first guard's backing or pause query it matches, or the short query id.
 */
export function labelOf(queryId: string, guards: readonly GuardQueries[]): FactLabel {
    const id = queryId.toLowerCase();
    for (const { mint, config } of guards) {
        const name = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
        if (config.backingQuery.toLowerCase() === id)
            return { text: `${name} backing`, kind: 'backing', decimals: config.backingDecimals };
        if (config.pauseQuery.toLowerCase() === id)
            return { text: `${name} paused`, kind: 'pause' };
    }
    return { text: shortHex(queryId), kind: 'unknown' };
}

/**
 * A recorded result, for reading.
 *
 * @param word The 32-byte result, 0x-hex.
 * @param label What the query is.
 * @returns A backing in its units, `true`/`false` for a pause, or the integer with separators.
 */
export function valueOf(word: string, label: FactLabel): string {
    const value = BigInt(word);
    switch (label.kind) {
        case 'backing':
            return amount(value, label.decimals ?? 0);
        case 'pause':
            return value === 0n ? 'false' : 'true';
        case 'unknown':
            return value.toLocaleString('en-US');
    }
}

/** A verify line's text and its colour. */
export interface VerifyVerdict {
    text: string;
    style: string;
}

/** Errors an Ethereum RPC gives for state it no longer keeps. */
const PRUNED = /missing trie node|historical state|state.*(not available|unavailable)|pruned/i;

/**
 * What nori-read-example verified, against what the event recorded.
 *
 * @param result The result nori-read-example verified, 0x-hex.
 * @param word The result the `Snapshot` event recorded, 0x-hex.
 * @param unitsConsumed The simulation's compute units.
 * @returns `verified by nori-read-example · N CU` in green, or `did not verify: …` muted.
 */
export function verifiedText(result: string, word: string, unitsConsumed: bigint): VerifyVerdict {
    if (result.toLowerCase() !== word.toLowerCase()) {
        return {
            text: `did not verify: Solana verified ${shortHex(result)}, the event recorded ${shortHex(word)}`,
            style: 'color: var(--nori-muted)',
        };
    }
    return {
        text: `verified by nori-read-example · ${Number(unitsConsumed).toLocaleString('en-US')} CU`,
        style: 'color: var(--nori-light-green)',
    };
}

/**
 * A verify that threw, as the line shows it.
 *
 * @param error What was thrown.
 * @returns `did not verify: <message>`, muted, saying when the RPC may have pruned the state.
 */
export function verifyFailedText(error: unknown): VerifyVerdict {
    const message = error instanceof Error ? error.message : String(error);
    const pruned = PRUNED.test(message)
        ? " (the Ethereum RPC may have pruned that block's state)"
        : '';
    return { text: `did not verify: ${message}${pruned}`, style: 'color: var(--nori-muted)' };
}
