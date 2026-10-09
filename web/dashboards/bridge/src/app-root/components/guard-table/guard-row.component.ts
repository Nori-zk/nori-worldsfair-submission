import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable } from 'rxjs';
import { type GuardRead } from '../../services/guard-board.service.js';
import './guard-pane.component.js';
import styles from './guard-row.component.css';

/** One guard row's text and links, and the read it is made from. */
export interface GuardRowView {
    key: string;
    /** The guard and its mint's supply, for the pane the row opens. */
    read: GuardRead;
    mint: string;
    mintUrl: string;
    status: string;
    statusStyle: string;
    /** The status's colour, as a CSS value. */
    statusColour: string;
    backing: string;
    supply: string;
    ratio: string;
    block: string;
    blockUrl: string;
    age: string;
}

/** What the row's pane is built from, while the row is open. */
interface GuardPaneView {
    key: string;
    read: GuardRead;
    statusColour: string;
}

/**
 * One guard: its mint, status, backing, supply and ratio, and the Ethereum
 * block it was proven at. Opening it (▸ to ▾) shows its pane, built fresh
 * through `rx-for` each time. `open` is the row's own, not a view field, so
 * the table's refresh keeps it.
 */
@Component({
    selector: 'guard-row',
    directives: [RxFor],
    template: `
        <div class="row">
            <button type="button" class="marker" onclick="toggle">{{ marker }}</button>
            <a [href]="mintUrl" target="_blank" rel="noopener">{{ mint }} ↗</a>
            <span class="status" [style]="statusStyle">{{ status }}</span>
            <span>{{ backing }}</span>
            <span>{{ supply }}</span>
            <span>{{ ratio }}</span>
            <a [href]="blockUrl" target="_blank" rel="noopener">{{ block }} ↗</a>
            <span>{{ age }}</span>
        </div>
        <div rx-for="panes by key">
            <guard-pane></guard-pane>
        </div>
    `,
    styles,
})
export class GuardRow extends RxElement {
    @state read: GuardRead | undefined = undefined;
    @state mint = '';
    @state mintUrl = '';
    @state status = '';
    @state statusStyle = '';
    @state statusColour = '';
    @state backing = '';
    @state supply = '';
    @state ratio = '';
    @state block = '';
    @state blockUrl = '';
    @state age = '';
    @state open = false;

    get marker$(): Observable<string> {
        return this.open$.pipe(map((open) => (open ? '▾' : '▸')));
    }

    /** The pane while the row is open, as a list of one. */
    get panes$(): Observable<GuardPaneView[]> {
        return combineLatest([this.open$, this.read$, this.statusColour$]).pipe(
            map(([open, read, statusColour]) =>
                open && read !== undefined ? [{ key: read.address, read, statusColour }] : [],
            ),
        );
    }

    toggle(): void {
        this.open = !this.open;
    }
}
