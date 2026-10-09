import { CHECKPOINTS, type Checkpoint, type GuardState } from '@nori-zk/backstop-client/guard';
import { asciiBar } from './ascii.js';
import { amount, clock } from './format.js';

/** How many checkpoints the pane lists, newest first. */
const LISTED = 12;

/** The trip rule re-run on the checkpoints a guard keeps now. */
export interface GuardWindow {
    /** The window's start and end, unix seconds: `T ± window`. */
    from: bigint;
    to: bigint;
    /** The kept checkpoints inside the window, oldest first. */
    inWindow: Checkpoint[];
    /** The lowest supply among them, the first one on a tie. */
    lowest?: Checkpoint;
    /** The rule's verdict, as one line. */
    verdict: string;
    /** The lowest supply over backing + tolerance, when positive. */
    deficit?: bigint;
    /** The ring has wrapped past the window's start, so some of it is gone. */
    rotatedOut: boolean;
}

/**
 * The trip rule on a guard's latest backing, as `rules.rs`
 * `window_min_supply` and `apply_backing` compute it: the checkpoints with
 * `time ∈ [T − window, T + window]`, one of them at or before `T − skew`,
 * then `deficit = lowest supply − (backing + tolerance)`. It runs on the
 * checkpoints the guard keeps now, which are the ones the program used only
 * when the read landed more than a window after `T`.
 *
 * @param guard The guard, with its checkpoints oldest first.
 * @param decimals The mint's decimals: backing, supply and tolerance are in mint units.
 * @returns The window, its checkpoints and the verdict.
 */
export function windowOf(guard: GuardState, decimals: number): GuardWindow {
    const t = guard.backingEthTime;
    const window = BigInt(guard.config.windowSecs);
    const from = t - window;
    const to = t + window;
    const inWindow = guard.checkpoints.filter((c) => c.time >= from && c.time <= to);
    const oldest = guard.checkpoints[0];
    const rotatedOut =
        guard.checkpointCount > BigInt(CHECKPOINTS) && oldest !== undefined && oldest.time > from;
    const base = { from, to, inWindow, rotatedOut };

    if (t === 0n) return { ...base, verdict: 'No backing proven yet' };
    if (inWindow.length === 0)
        return {
            ...base,
            verdict: rotatedOut
                ? 'The window has rotated out of the 64 kept checkpoints'
                : 'No checkpoint in the window',
        };
    if (!inWindow.some((c) => c.time <= t - BigInt(guard.config.skewSecs)))
        return { ...base, verdict: 'No checkpoint before T − skew yet: no verdict' };

    const lowest = inWindow.reduce((low, c) => (c.supply < low.supply ? c : low));
    const limit = guard.backing + guard.config.tolerance;
    const deficit = lowest.supply > limit ? lowest.supply - limit : undefined;
    const verdict = [
        `window ${clock(Number(from))}–${clock(Number(to))}`,
        `${inWindow.length.toString()} checkpoint${inWindow.length === 1 ? '' : 's'}`,
        `lowest ${amount(lowest.supply, decimals)} vs backing + tolerance ${amount(limit, decimals)}`,
        deficit === undefined ? 'no deficit' : `deficit ${amount(deficit, decimals)}`,
        ...(rotatedOut ? ["the window's start has rotated out"] : []),
    ].join(' · ');
    return { ...base, lowest, verdict, ...(deficit === undefined ? {} : { deficit }) };
}

/**
 * The window's checkpoints as lines, newest first and at most `LISTED`:
 * the time, the supply and a bar against the window's highest, with the
 * lowest marked.
 *
 * @param window The window, from `windowOf`.
 * @param decimals The mint's decimals.
 * @returns `21:36:12  116,700  ▓▓▓▓▓▓▓▓▓▓  ◂ lowest`, one per line.
 */
export function checkpointLines({ inWindow, lowest }: GuardWindow, decimals: number): string[] {
    const max = inWindow.reduce((high, c) => (c.supply > high ? c.supply : high), 0n);
    const shown = inWindow.slice(-LISTED).reverse();
    const supplies = shown.map((c) => amount(c.supply, decimals));
    const width = Math.max(0, ...supplies.map((s) => s.length));
    const lines = shown.map((c, i) =>
        [
            clock(Number(c.time)),
            (supplies[i] ?? '').padStart(width),
            asciiBar(max === 0n ? 0 : Number(c.supply) / Number(max)),
            ...(c === lowest ? ['◂ lowest'] : []),
        ].join('  '),
    );
    const more = inWindow.length - shown.length;
    return more > 0 ? [...lines, `… ${more.toString()} older`] : lines;
}
