import {
    defer,
    EMPTY,
    finalize,
    ignoreElements,
    merge,
    type Observable,
    ReplaySubject,
    share,
    tap,
    timer,
} from 'rxjs';
import { readMachineValue$ } from '@nori-zk/nori-bridge-solana-sdk';
import {
    type GraphState,
    type StartedMachine,
} from '@nori-zk/nori-bridge-solana-sdk/utils';

/**
 * Shares a stream the edges of several nodes follow, held while the machine
 * moves between them: ystate unsubscribes the left node's `$` and
 * subscribes the entered node's in one tick, so the stream ends only when
 * no `$` holds it after that tick. A new subscriber gets the latest value.
 *
 * @returns The operator.
 */
export const heldAcrossMoves = <T>() =>
    share<T>({
        connector: () => new ReplaySubject<T>(1),
        resetOnRefCountZero: () => timer(0),
    });

/**
 * The value a read machine reads, for a one-off command: the machine is
 * made on subscribe, gives its first `current` data (or errors with its
 * failure, `readMachineValue$`), and is closed.
 *
 * @param create Makes the read machine.
 * @returns Its `current` data, once.
 */
export const valueOnce$ = <TState extends GraphState>(
    create: () => StartedMachine<TState> & { close(): void }
): Observable<Extract<TState, { node: 'current' }>['data']> =>
    defer(() => {
        const machine = create();
        return readMachineValue$(machine).pipe(finalize(() => machine.close()));
    });

/**
 * The states of a machine made for one thing inside a stream: made on
 * subscribe, read again on each `retry$`, and closed on unsubscribe, so it
 * lives exactly as long as the stream that follows it.
 *
 * @param create Makes the machine.
 * @param retry$ Each emission calls the machine's `retry()` (default: never).
 * @returns The machine's states.
 */
export const followedStates$ = <TState>(
    create: () => {
        state$: Observable<TState>;
        retry?: () => void;
        close(): void;
    },
    retry$: Observable<unknown> = EMPTY
): Observable<TState> =>
    defer(() => {
        const machine = create();
        return merge(
            machine.state$,
            retry$.pipe(
                tap(() => machine.retry?.()),
                ignoreElements()
            )
        ).pipe(finalize(() => machine.close()));
    });
