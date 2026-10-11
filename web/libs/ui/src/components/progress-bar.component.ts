import { Component, RxElement, state } from '@yaw-rx/core';
import { combineLatest, map, type Observable } from 'rxjs';
import styles from './progress-bar.component.css';

/** How many characters each run holds: more than any bar's width shows. */
const MAX_CELLS = 300;

/** A cell's width: one character and the bar's letter spacing. */
const CELL = '(1ch + 0.05em)';

/**
 * A bar drawn in characters: `▓` for the part done, `░` for the rest. Both
 * runs fill the bar on one grid, so no character moves; only the point where
 * `▓` gives way to `░` (the reveal) moves, which can fall inside a character.
 * Without `cells` the bar fills the width it is given; with `cells` it is
 * that many characters wide.
 */
@Component({
    selector: 'progress-bar',
    template: `
        <div class="runs" [style]="reveal">
            <span class="done">${'▓'.repeat(MAX_CELLS)}</span>
            <span class="rest">${'░'.repeat(MAX_CELLS)}</span>
        </div>
    `,
    styles,
})
export class ProgressBar extends RxElement {
    /** The part done, from 0 to 1. */
    @state fill = 0;
    /** How many characters wide; 0 fills the width it is given. */
    @state cells = 0;

    /** The reveal point, and the width when `cells` is set. */
    get reveal$(): Observable<string> {
        return combineLatest([this.fill$, this.cells$]).pipe(
            map(([fill, cells]) => {
                const shown = Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 0;
                const reveal = `--fill: ${(shown * 100).toFixed(1)}%`;
                return cells > 0 ? `${reveal}; width: calc(${cells.toString()} * ${CELL})` : reveal;
            }),
        );
    }
}
