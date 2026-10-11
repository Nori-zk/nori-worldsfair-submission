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
type Thumb = { hidden: true } | { hidden: false; length: number; offset: number };

/** The direction an element scrolls in: down (`y`, the default) or across (`x`). */
type Axis = 'x' | 'y';

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
 * content in view and its offset the scroll position, along the axis it
 * scrolls in. Hidden while the content fits or the screen is not a touch
 * screen.
 *
 * @param node The scrolling element.
 * @param axis The direction it scrolls in.
 * @param touchScreen Whether the screen is a touch screen.
 * @returns The thumb.
 */
const thumbOf = (node: Element, axis: Axis, touchScreen: boolean): Thumb => {
    const [content, view, scrolled] =
        axis === 'x'
            ? [node.scrollWidth, node.clientWidth, node.scrollLeft]
            : [node.scrollHeight, node.clientHeight, node.scrollTop];
    if (!touchScreen || content <= view + 1) return { hidden: true };
    const length = Math.max(MIN_THUMB_PX, (view * view) / content);
    const offset = (scrolled / (content - view)) * (view - length);
    return { hidden: false, length, offset };
};

/**
 * A scrollbar that stays in view on touch screens, where the browser's own
 * fades out. The element it sits on scrolls, down by default or across with
 * `scroll-thumb="x"`; its first child becomes a `.scroll-thumb` track holding
 * the thumb (a `div`). The thumb's length is set as `--scroll-thumb-height`
 * (down) or `--scroll-thumb-width` (across), and its offset as
 * `--scroll-thumb-offset`, on the element, at most once a frame, from the
 * screen, the scroll, the element's size and its content. The track is
 * `hidden` while the content fits or the screen is not a touch screen. The
 * element's component styles the track and the thumb.
 */
@Directive({ selector: '[scroll-thumb]' })
export class ScrollThumb {
    node!: RxElementLike;
    private thumb: Subscription | undefined;

    onInit(): void {
        const { node } = this;
        const axis: Axis = node.getAttribute('scroll-thumb') === 'x' ? 'x' : 'y';
        const lengthProperty = axis === 'x' ? '--scroll-thumb-width' : '--scroll-thumb-height';
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
                map(() => thumbOf(node, axis, touchScreen.matches)),
                finalize(() => track.remove()),
            )
            .subscribe((thumb) => {
                track.hidden = thumb.hidden;
                if (thumb.hidden) return;
                node.style.setProperty(lengthProperty, `${thumb.length.toFixed(1)}px`);
                node.style.setProperty('--scroll-thumb-offset', `${thumb.offset.toFixed(1)}px`);
            });
    }

    onDestroy(): void {
        this.thumb?.unsubscribe();
    }
}
