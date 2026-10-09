import { Component, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { map, type Observable } from 'rxjs';
import './batch-table.component.js';
import './guard-table.component.js';
import styles from './dashboard-views.component.css';

/** The dashboard's views: the proof queue, or Backstop's guards (`?view=guards`). */
type View = 'queue' | 'guards';

/** The proof queue or Backstop's guards, one at a time, picked with two tabs. */
@Component({
    selector: 'dashboard-views',
    directives: [RxIf],
    template: `
        <nav class="views">
            <button [class.current]="queueShown" onclick="showQueue">[ Proof queue ]</button>
            <button [class.current]="guardsShown" onclick="showGuards">[ Backstop guards ]</button>
        </nav>
        <div rx-if="queueShown"><batch-table></batch-table></div>
        <div rx-if="guardsShown"><guard-table></guard-table></div>
    `,
    styles,
})
export class DashboardViews extends RxElement {
    @state view: View =
        new URLSearchParams(window.location.search).get('view') === 'guards' ? 'guards' : 'queue';

    get queueShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'queue'));
    }

    get guardsShown$(): Observable<boolean> {
        return this.view$.pipe(map((view) => view === 'guards'));
    }

    showQueue(): void {
        this.show('queue');
    }

    showGuards(): void {
        this.show('guards');
    }

    /** Shows a view and keeps it in the URL, so a link opens it. */
    private show(view: View): void {
        this.view = view;
        const url = new URL(window.location.href);
        if (view === 'guards') url.searchParams.set('view', 'guards');
        else url.searchParams.delete('view');
        window.history.replaceState(null, '', url);
    }
}
