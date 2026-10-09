/** How many blocks a bar is wide. */
const BAR_CELLS = 10;

/**
 * A bar drawn in blocks: `▓` for the part done, `░` for the rest.
 *
 * @param fraction The part done, from 0 to 1.
 * @returns The bar.
 */
export function asciiBar(fraction: number): string {
    const done = Number.isFinite(fraction)
        ? Math.round(Math.min(1, Math.max(0, fraction)) * BAR_CELLS)
        : 0;
    return '▓'.repeat(done) + '░'.repeat(BAR_CELLS - done);
}

/** A bar with nothing to show: the stage is not known. */
export const UNKNOWN_BAR = '·'.repeat(BAR_CELLS);

/**
 * The time left in a stage, as a few words.
 *
 * @param remainingSec The time it is expected to take still.
 * @returns `~2m left`, `~40s left`, or `overdue`.
 */
export function timeLeft(remainingSec: number): string {
    if (!Number.isFinite(remainingSec)) return '';
    if (remainingSec <= 0) return 'overdue';
    return remainingSec >= 60
        ? `~${Math.round(remainingSec / 60).toString()}m left`
        : `~${Math.round(remainingSec).toString()}s left`;
}
