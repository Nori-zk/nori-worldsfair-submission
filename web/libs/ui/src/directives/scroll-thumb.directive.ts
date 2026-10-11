import { Directive } from '@yaw-rx/core';
import type { RxElementLike } from '@yaw-rx/core';
import {
    animationFrameScheduler,
    auditTime,
    finalize,
    fromEvent,
    map,
    merge,
    Observable,
    startWith,
    type Subscription,
} from 'rxjs';

/** Screens whose own scrollbars are overlays that fade out: phones and tablets. */
const TOUCH_SCREEN = '(pointer: coarse)';
/** The shortest the thumb gets, in pixels. */
const MIN_THUMB_PX = 24;

/** Where the thumb is: hidden, or its length and offset in pixels. */
type Thumb = { hidden: true } | { hidden: false; height: number; offset: number };

/**
 * Each change of an element's size.
 *
 * @param node The element.
 * @returns A stream that emits on each resize.
 */
const resized$ = (node: Element): Observable<void> =>
    new Observable<void>((subscriber) => {
        const observer = new ResizeObserver(() => subscriber.next());
        observer.observe(node);
        return () => observer.disconnect();
    });

/**
 * Each change of an element's content, as rows open, close and change.
 *
 * @param node The element.
 * @returns A stream that emits on each change below it.
 */
const contentChanged$ = (node: Node): Observable<void> =>
    new Observable<void>((subscriber) => {
        const observer = new MutationObserver(() => subscriber.next());
        observer.observe(node, { childList: true, subtree: true });
        return () => observer.disconnect();
    });

/**
 * Where the thumb is for a scrolling element: its length is the share of the
 * content in view and its offset the scroll position. Hidden while the
 * content fits or the screen is not a touch screen.
 *
 * @param node The scrolling element.
 * @param touchScreen Whether the screen is a touch screen.
 * @returns The thumb.
 */
const thumbOf = (
    { scrollHeight, clientHeight, scrollTop }: Element,
    touchScreen: boolean,
): Thumb => {
    if (!touchScreen || scrollHeight <= clientHeight + 1) return { hidden: true };
    const height = Math.max(MIN_THUMB_PX, (clientHeight * clientHeight) / scrollHeight);
    const offset = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
    return { hidden: false, height, offset };
};

/**
 * A scrollbar that stays in view on touch screens, where the browser's own
 * fades out. The element it sits on scrolls; its first child becomes a
 * `.scroll-thumb` track holding the thumb (a `div`). The thumb's length and
 * offset are set as `--scroll-thumb-height` and `--scroll-thumb-offset` on
 * the element, at most once a frame, from the screen, the scroll, the
 * element's size and its content. The track is `hidden` while the content
 * fits or the screen is not a touch screen. The element's component styles
 * the track and the thumb.
 */
@Directive({ selector: '[scroll-thumb]' })
export class ScrollThumb {
    node!: RxElementLike;
    private thumb: Subscription | undefined;

    onInit(): void {
        const { node } = this;
        const track = document.createElement('div');
        track.className = 'scroll-thumb';
        track.hidden = true;
        track.appendChild(document.createElement('div'));
        node.prepend(track);
        const touchScreen = window.matchMedia(TOUCH_SCREEN);
        this.thumb = merge(
            fromEvent(touchScreen, 'change'),
            fromEvent(node, 'scroll', { passive: true }),
            resized$(node),
            contentChanged$(node),
        )
            .pipe(
                startWith(undefined),
                auditTime(0, animationFrameScheduler),
                map(() => thumbOf(node, touchScreen.matches)),
                finalize(() => track.remove()),
            )
            .subscribe((thumb) => {
                track.hidden = thumb.hidden;
                if (thumb.hidden) return;
                node.style.setProperty('--scroll-thumb-height', `${thumb.height.toFixed(1)}px`);
                node.style.setProperty('--scroll-thumb-offset', `${thumb.offset.toFixed(1)}px`);
            });
    }

    onDestroy(): void {
        this.thumb?.unsubscribe();
    }
}
