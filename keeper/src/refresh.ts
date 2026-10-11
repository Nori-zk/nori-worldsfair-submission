import { interval, merge, type Observable, share, switchMap, take } from 'rxjs';

/**
 * A `refreshOn` for a value that moves with the chain and with time:
 * following once `changes$` is (its first emission), then due on each
 * later change and every `everyMs` from then on.
 *
 * @param changes$ The chain's changes, from `changesOf$`.
 * @param everyMs How often a refresh is due besides the changes.
 * @returns The trigger, as `refreshOn` takes it.
 */
export const changesOrEvery$ = (
    changes$: Observable<unknown>,
    everyMs: number
): Observable<unknown> => {
    const shared$ = changes$.pipe(share());
    return merge(
        shared$,
        shared$.pipe(
            take(1),
            switchMap(() => interval(everyMs))
        )
    );
};
