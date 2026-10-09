import { defineConfig } from 'vite';
import { viteAssets, viteTransform } from '@yaw-rx/vite';
import { loadWebEnv } from '../../env.js';
import { viteWasm } from '../../plugins/vite-wasm.js';
import { viteWatchAssets } from '../../plugins/vite-watch-assets.js';

export default defineConfig({
    root: '.',
    plugins: [viteAssets(['.css', '.html']), viteWatchAssets(), viteTransform(), viteWasm()],
    define: { NORI_WEB_ENV: JSON.stringify(loadWebEnv()) },
    esbuild: { target: 'es2022' },
    resolve: { dedupe: ['rxjs', '@nori-zk/nori-bridge-solana-sdk'] },
    optimizeDeps: {
        exclude: [
            '@nori-zk/nori-bridge-solana-sdk',
            '@nori-zk/ethereum-solana-proof-queue-utils-glam',
        ],
    },
    server: { port: 5182 },
    publicDir: false,
    build: { outDir: 'dist', target: 'es2022' },
});
