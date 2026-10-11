/** A link along the top of every page. */
export interface NavLink {
    label: string;
    url: string;
    /** The link's `aria-current`: `'page'` on the app the page is. */
    current: 'page' | null;
}

/**
 * The links along the top of every page, one per app and dashboard with an
 * address. Each is labelled with its app's page heading, so the page's own
 * heading marks its link current.
 *
 * @param urls The addresses from `web/.env`.
 * @param heading The page's heading.
 * @returns The links, in nav order.
 */
export function navLinks(urls: typeof NORI_WEB_ENV.urls, heading: string): NavLink[] {
    const links: [label: string, url: string][] = [
        ['Prove balance', urls.proveBalance],
        ['Guard status', urls.guardStatus],
        ['Proven facts', urls.provenFacts],
        ['Bridge dashboard', urls.dashboard],
        ['Tempo dashboard', urls.tempoDashboard],
    ];
    return links
        .filter(([, url]) => url !== '')
        .map(([label, url]) => ({ label, url, current: label === heading ? 'page' : null }));
}
