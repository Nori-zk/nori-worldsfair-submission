import { type GuardState } from '@nori-zk/backstop-client/guard';
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
