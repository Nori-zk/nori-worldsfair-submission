import { type Observable, of, switchMap, timer } from 'rxjs';

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
 * The bar's total for one followed request: the time waited plus the time
 * left, taken from the first estimate and only ever extended after that.
 * The bridge's estimate counts down a second at a time between its finality
 * messages and re-bases when one arrives, so a total built from each
 * estimate would sit low and jump; one total fills the bar steadily. When
 * an estimate runs past the total, the total grows to it, and the fill can
 * then step back a little: the bar stays honest rather than smooth.
 *
 * @param previousTotalSec The total so far, or `undefined` before the first estimate.
 * @param elapsedSec The seconds waited.
 * @param remainingSec The seconds left, as estimated; negative counts as none left.
 * @returns The total in seconds; `previousTotalSec` while the estimate is unknown.
 */
export function anchoredTotal(
    previousTotalSec: number | undefined,
    elapsedSec: number,
    remainingSec: number,
): number | undefined {
    const total = Math.max(0, elapsedSec) + Math.max(0, remainingSec);
    if (!Number.isFinite(total)) return previousTotalSec;
    return previousTotalSec === undefined ? total : Math.max(previousTotalSec, total);
}

/**
 * The part of the whole wait that is done: the time waited against the
 * bar's total.
 *
 * @param elapsedSec The seconds waited.
 * @param totalSec The bar's total (`anchoredTotal`), or `undefined` while unknown.
 * @returns From 0 to 1; 0 while the total is unknown.
 */
export function anchoredFill(elapsedSec: number, totalSec: number | undefined): number {
    if (totalSec === undefined || !Number.isFinite(totalSec) || totalSec <= 0) return 0;
    const elapsed = Math.max(0, elapsedSec);
    return Number.isFinite(elapsed) ? Math.min(1, elapsed / totalSec) : 0;
}

/**
 * A bar's total as kept in `sessionStorage`.
 *
 * @param stored The stored value, `null` when none is.
 * @returns The total in seconds, or `undefined` when none is stored or it is not a positive number.
 */
export function storedTotal(stored: string | null): number | undefined {
    const totalSec = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(totalSec) && totalSec > 0 ? totalSec : undefined;
}

/** A proof request machine as `createProofRequestStateMachine` returns it, as far as a follow uses it. */
export interface FollowedMachine<TState> {
    state$: Observable<TState>;
    retry(): void;
    close(): void;
}

/** Ethereum's block time. */
export const ETHEREUM_BLOCK_MS = 12_000;

/** How many times a follow that ended `transactionReplaced` is made again before that stands. */
export const REFOLLOWS = 2;

/**
 * Follows a proof request, and follows it again, from a new machine, when
 * the follow ends `transactionReplaced` within `times` tries, a block later.
 *
 * shortcut: a wallet's RPC can report the sender's nonce past a transaction
 * it still returns, so the sdk's follow can end `transactionReplaced` a
 * block before the receipt lands; drop this once the sdk's rule needs the
 * node to forget the transaction first.
 *
 * @param create A new machine following the request.
 * @param times How many follows again are allowed.
 * @param blockMs How long to wait before following again.
 * @returns The states of the current follow, `retry()` and `close()` for it.
 */
export function followAgainOnReplaced<TState extends { node: string }>(
    create: () => FollowedMachine<TState>,
    times = REFOLLOWS,
    blockMs = ETHEREUM_BLOCK_MS,
): FollowedMachine<TState> {
    // Every machine made, the current one last; a replaced one is terminal and reads no more.
    const machines: FollowedMachine<TState>[] = [];
    const states$ = (attempt: number): Observable<TState> => {
        const machine = create();
        machines.push(machine);
        return machine.state$.pipe(
            switchMap((state) =>
                state.node === 'transactionReplaced' && attempt < times
                    ? timer(blockMs).pipe(switchMap(() => states$(attempt + 1)))
                    : of(state),
            ),
        );
    };
    return {
        state$: states$(0),
        retry: () => machines.at(-1)?.retry(),
        close: () => {
            for (const machine of machines) machine.close();
        },
    };
}
