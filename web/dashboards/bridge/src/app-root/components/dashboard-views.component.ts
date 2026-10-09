import { Component, RxElement, state } from '@yaw-rx/core';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { map, type Observable } from 'rxjs';
import './batch-table.component.js';
import './infra-state.component.js';
import './latency-table.component.js';
import styles from './dashboard-views.component.css';

/** The dashboard's views: the proof queue or the read latency (`?view=latency`). */
type View = 'queue' | 'latency';

/**
 * The view a link opens.
 *
 * @param view The `?view=` parameter.
 * @returns The view it names, or the queue.
 */
const viewOf = (view: string | null): View => (view === 'latency' ? view : 'queue');

/**
 * The proof queue or the latency, one at a time, picked with two tabs, over
 * Nori's loop. Both share one place, so the card keeps the queue's height on
 * either tab. The queue is hidden rather than removed: it keeps its filter and
 * open batches. The latency view is removed, so it is read only while shown,
 * and built again on each showing through `rx-for`: a component that `rx-if`
 * shows a second time is never bound again.
 */
@Component({
    selector: 'dashboard-views',
    directives: [RxFor],
    template: `
        <nav class="views">
            <button [class.current]="queueShown" onclick="showQueue">[ Proof queue ]</button>
            <button [class.current]="latencyShown" onclick="showLatency">[ Latency ]</button>
        </nav>
        <div class="panes">
            <div [class.hidden]="queueHidden"><batch-table></batch-table></div>
            <div rx-for="latencyPane by key"><latency-table></latency-table></div>
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

    get latencyShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'latency'));
    }

    /** The latency table while its tab is shown, as a list of one. */
    get latencyPane$(): Observable<{ key: string }[]> {
        return this.view$.pipe(map((view) => (view === 'latency' ? [{ key: 'latency' }] : [])));
    }

    showQueue(): void {
        this.show('queue');
    }

    showLatency(): void {
        this.show('latency');
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
