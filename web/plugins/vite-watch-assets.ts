import type { Plugin } from 'vite';

const RAW_ASSET = '?raw-asset';

/**
 * Watches each file `viteAssets` imports as a string (`…?raw-asset`), so an
 * edit to one outside the app's root, such as a `libs/ui` component's
 * `.css`, reloads the page.
 *
 * @returns The vite plugin.
 */
export function viteWatchAssets(): Plugin {
    return {
        name: 'web-watch-assets',
        transform(_code, id) {
            if (id.endsWith(RAW_ASSET)) this.addWatchFile(id.slice(0, -RAW_ASSET.length));
            return null;
        },
    };
}
