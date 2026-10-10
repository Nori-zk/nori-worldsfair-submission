/**
 * How long a proof request has waited: from its enqueue block's time when it
 * is known, else the unprocessed machine's own count, which starts at zero
 * with each machine and so with each page load.
 *
 * @param nowMs The time now, unix milliseconds.
 * @param enqueuedAtMs The enqueue block's time, unix milliseconds, or `undefined` while it is read or when the read failed.
 * @param machineElapsedSec The unprocessed machine's `waiting_elapsed_sec`.
 * @returns The seconds waited, never negative.
 */
export function waitedSec(
    nowMs: number,
    enqueuedAtMs: number | undefined,
    machineElapsedSec: number,
): number {
    return Math.max(
        0,
        enqueuedAtMs === undefined ? machineElapsedSec : (nowMs - enqueuedAtMs) / 1000,
    );
}

/**
 * The part of the whole wait that is done: the time waited against the time
 * waited plus the time left.
 *
 * @param elapsedSec The seconds waited.
 * @param remainingSec The seconds left, as estimated; negative counts as none left.
 * @returns From 0 to 1; 0 when the total is unknown.
 */
export function fillOf(elapsedSec: number, remainingSec: number): number {
    const elapsed = Math.max(0, elapsedSec);
    const total = elapsed + Math.max(0, remainingSec);
    return Number.isFinite(total) && total > 0 ? Math.min(1, elapsed / total) : 0;
}
