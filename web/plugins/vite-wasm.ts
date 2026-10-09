import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Loads `.wasm` files imported as ES modules (wasm-pack's bundler target):
 * each becomes a module that fetches the binary as an asset, instantiates it
 * with the modules it imports (its `_bg.js` glue), and re-exports its
 * exports.
 *
 * @returns The vite plugin.
 */
export function viteWasm(): Plugin {
    return {
        name: 'web-wasm',
        enforce: 'pre',
        load(id) {
            if (!id.endsWith('.wasm')) return null;
            const wasm = new WebAssembly.Module(readFileSync(id));
            const sources = [
                ...new Set(WebAssembly.Module.imports(wasm).map((entry) => entry.module)),
            ];
            const exportNames = WebAssembly.Module.exports(wasm)
                .map((entry) => entry.name)
                .filter((name) => IDENTIFIER.test(name));
            return [
                ...sources.map(
                    (source, index) =>
                        `import * as imports${String(index)} from ${JSON.stringify(source)};`,
                ),
                `import url from ${JSON.stringify(`${id}?url`)};`,
                `const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {`,
                ...sources.map(
                    (source, index) => `    ${JSON.stringify(source)}: imports${String(index)},`,
                ),
                `});`,
                ...exportNames.map((name) => `export const ${name} = instance.exports.${name};`),
            ].join('\n');
        },
    };
}
