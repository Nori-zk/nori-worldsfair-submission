// Saves the tokens of the apps' chain, with their icons, to
// src/tokens/token-list.json, which the apps bundle. The chain's Blockscout
// explorer (found in Blockscout's chain registry) lists its ERC-20 tokens by
// holders; only those Blockscout has an icon for are kept, which leaves out
// spam, and each icon is stored as a data URI. Works for any chain the
// registry has. Run with `npm run tokens:fetch -w web/libs/ui`.
import { readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';

const REGISTRY_URL = 'https://chains.blockscout.com/api/chains';
const PAGES = 20;
const ENV = new URL('../../../.env', import.meta.url);
const OUTPUT = new URL('../src/tokens/token-list.json', import.meta.url);

const env = { ...dotenv.parse(await readFile(ENV)), ...process.env };
const chainId = Number(env.NORI_WEB_ETH_CHAIN_ID);
if (!Number.isSafeInteger(chainId)) throw new Error('NORI_WEB_ETH_CHAIN_ID is not set');

const getJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
};

/** The icon at `url` as a data URI, or undefined when it cannot be fetched. */
const dataUri = async (url) => {
    const response = await fetch(url).catch(() => undefined);
    if (!response?.ok) return undefined;
    const type = response.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    const body = Buffer.from(await response.arrayBuffer()).toString('base64');
    return `data:${type};base64,${body}`;
};

const chain = (await getJson(REGISTRY_URL))[String(chainId)];
const explorer = chain?.explorers?.find((entry) => entry.hostedBy === 'blockscout')?.url;
if (!explorer) throw new Error(`Blockscout has no explorer for chain ${chainId}`);

const base = `${new URL('api/v2/tokens?type=ERC-20', explorer)}`;
const tokens = [];
let url = base;
for (let page = 0; page < PAGES && url; page++) {
    const { items, next_page_params: next } = await getJson(url);
    for (const item of items) {
        const address = item.address_hash ?? item.address;
        if (!item.icon_url || item.decimals === null) continue;
        if (tokens.some((token) => token.address === address)) continue;
        const logoURI = await dataUri(item.icon_url);
        if (!logoURI) continue;
        tokens.push({
            chainId,
            address,
            symbol: item.symbol,
            name: item.name,
            decimals: Number(item.decimals),
            logoURI,
        });
    }
    url = next
        ? `${base}&${new URLSearchParams(Object.entries(next).map(([key, value]) => [key, String(value)]))}`
        : undefined;
}

await writeFile(
    OUTPUT,
    `${JSON.stringify({ name: `${chain.name} tokens (Blockscout)`, chainId, tokens }, null, 4)}\n`,
);
console.log(`Saved ${tokens.length} ${chain.name} tokens from ${explorer}`);
