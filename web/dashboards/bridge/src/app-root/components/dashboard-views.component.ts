import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import './batch-table.component.js';
import './facts-table.component.js';
import './guard-table.component.js';
import './infra-state.component.js';
import styles from './dashboard-views.component.css';

/** The dashboard's views: the proof queue, Backstop's guards (`?view=guards`) or the facts (`?view=facts`). */
type View = 'queue' | 'guards' | 'facts';

/**
 * The view a link opens.
 *
 * @param view The `?view=` parameter.
 * @returns The view it names, or the queue.
 */
const viewOf = (view: string | null): View =>
    view === 'guards' || view === 'facts' ? view : 'queue';

/**
 * The proof queue, Backstop's guards or the facts, one at a time, picked
 * with three tabs, over Nori's loop. All share one place, so the card keeps
 * the queue's height on any tab. The queue is hidden rather than removed: it
 * keeps its filter and open batches. The guards and the facts are removed,
 * so they are read only while shown, and built again on each showing through
 * `rx-for`: a component that `rx-if` shows a second time is never bound again.
 */
@Component({
    selector: 'dashboard-views',
    directives: [RxFor],
    template: `
        <nav class="views">
            <button [class.current]="queueShown" onclick="showQueue">[ Proof queue ]</button>
            <button [class.current]="guardsShown" onclick="showGuards">[ Backstop guards ]</button>
            <button [class.current]="factsShown" onclick="showFacts">[ Facts ]</button>
        </nav>
        <div class="panes">
            <div [class.hidden]="queueHidden"><batch-table></batch-table></div>
            <div rx-for="guardsPane by key"><guard-table></guard-table></div>
            <div rx-for="factsPane by key"><facts-table></facts-table></div>
        </div>
        <infra-state></infra-state>
    `,
    styles,
})
export class DashboardViews extends RxElement {
    @state view: View = viewOf(new URLSearchParams(window.location.search).get('view'));

    get queueShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'queue'));
    }

    get queueHidden$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view !== 'queue'));
    }

    get guardsShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'guards'));
    }

    /** The guards table while its tab is shown, as a list of one. */
    get guardsPane$(): Observable<{ key: string }[]> {
        return this.view$.pipe(map((view) => (view === 'guards' ? [{ key: 'guards' }] : [])));
    }

    get factsShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'facts'));
    }

    /** The facts table while its tab is shown, as a list of one. */
    get factsPane$(): Observable<{ key: string }[]> {
        return this.view$.pipe(map((view) => (view === 'facts' ? [{ key: 'facts' }] : [])));
    }

    showQueue(): void {
        this.show('queue');
    }

    showGuards(): void {
        this.show('guards');
    }

    showFacts(): void {
        this.show('facts');
    }

    /** Shows a view and keeps it in the URL, so a link opens it. */
    private show(view: View): void {
        this.view = view;
        const url = new URL(window.location.href);
        if (view !== 'queue') url.searchParams.set('view', view);
        else url.searchParams.delete('view');
        window.history.replaceState(null, '', url);
    }
}
