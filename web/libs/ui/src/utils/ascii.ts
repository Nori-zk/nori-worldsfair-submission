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
