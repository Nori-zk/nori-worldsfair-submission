/** The latency headline: one big line and its spread under it. */
export interface Headline {
    /** `Reads land on Solana a median 16.9 min after their Ethereum block`. */
    line: string;
    /** `last 36 reads · p90 20.7 · fastest 14.6 · slowest 27.5`. */
    spread: string;
}

/**
 * The latency headline, with the quantiles picked as `summaryOf` (the
 * dashboard's latency tab) and the soak report pick them:
 * `sorted[min(n − 1, floor(q × n))]`, so both pages show the same median.
 *
 * @param latencies Each landed read's minutes, from `latencyMinutes`, in any order.
 * @returns The headline, or `undefined` when no read has landed.
 */
export function headlineOf(latencies: readonly number[]): Headline | undefined {
    const n = latencies.length;
    if (n === 0) return undefined;
    const sorted = [...latencies].sort((a, b) => a - b);
    const pick = (q: number): string =>
        (sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0).toFixed(1);
    return {
        line: `Reads land on Solana a median ${pick(0.5)} min after their Ethereum block`,
        spread: `last ${n.toString()} read${n === 1 ? '' : 's'} · p90 ${pick(0.9)} · fastest ${pick(0)} · slowest ${pick(1)}`,
    };
}
