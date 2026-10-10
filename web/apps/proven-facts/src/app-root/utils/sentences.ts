import type { FactLabel, GuardQueries } from '@nori-zk/solana-web-ui';

/**
 * The devnet guards' mints, by the name the demo gives them.
 *
 * shortcut: a fixed list for the two devnet guards; a mint not in it reads
 * as `mint <short address>`. A mainnet build would name mints from the
 * token list instead.
 */
const MINT_NAMES: Record<string, string> = {
    Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi: 'demo',
    Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX: 'shadow',
};

/** How many sentences a snapshot shows before `… and N more`. */
const MAX_SENTENCES = 4;

/** One result of a snapshot, named by the guard that reads it. */
export interface LabelledLine {
    queryId: string;
    /** The 32-byte result the `Snapshot` event recorded, 0x-hex. */
    word: string;
    /** What the query is (`labelOf`). */
    label: FactLabel;
    /** The result for reading (`valueOf`): an amount, `true`/`false`, or an integer. */
    value: string;
    /** The mint of the guard whose backing or pause query it is, if any. */
    mint?: string;
}

/**
 * A mint's name in a sentence.
 *
 * @param mint The mint's address.
 * @returns `demo`, `shadow`, or `mint Fhw5…cbhi`.
 */
export const mintName = (mint: string): string =>
    MINT_NAMES[mint] ?? `mint ${mint.slice(0, 4)}…${mint.slice(-4)}`;

/**
 * The mint of the guard that reads a query, matched as `labelOf` matches it.
 *
 * @param queryId The query id, 0x-hex.
 * @param guards The guards on the cluster.
 * @returns The first guard's mint whose backing or pause query it is, or `undefined`.
 */
export function mintOf(queryId: string, guards: readonly GuardQueries[]): string | undefined {
    const id = queryId.toLowerCase();
    return guards.find(
        ({ config }) =>
            config.backingQuery.toLowerCase() === id || config.pauseQuery.toLowerCase() === id,
    )?.mint;
}

/** What one mint's lines say, in the order they came. */
interface MintFacts {
    mint: string;
    backing?: string;
    paused?: string;
}

/**
 * What a mint's lockbox held and whether it was paused, as one sentence.
 *
 * @param facts The mint's backing and pause results.
 * @returns The sentence.
 */
function mintSentence({ mint, backing, paused }: MintFacts): string {
    const name = mintName(mint);
    const pause = paused === 'true' ? 'paused' : 'not paused';
    if (backing !== undefined && paused !== undefined) {
        return `The ${name} lockbox held ${backing} and was ${pause}.`;
    }
    if (backing !== undefined) return `The ${name} backing was ${backing}.`;
    return `The ${name} lockbox was ${pause}.`;
}

/**
 * What a snapshot recorded, in sentences: one per guard mint (its backing
 * and pause together), then one per other query, in the order they first
 * appear. After `MAX_SENTENCES`, the rest are counted.
 *
 * @param lines The snapshot's results, labelled.
 * @returns The sentences, the last one `… and N more` when some are left out.
 */
export function sentencesOf(lines: readonly LabelledLine[]): string[] {
    const parts: (MintFacts | string)[] = [];
    const byMint = new Map<string, MintFacts>();
    for (const line of lines) {
        const { kind } = line.label;
        if (kind === 'unknown' || line.mint === undefined) {
            parts.push(`Query ${line.label.text} returned ${line.value}.`);
            continue;
        }
        let facts = byMint.get(line.mint);
        if (facts === undefined) {
            facts = { mint: line.mint };
            byMint.set(line.mint, facts);
            parts.push(facts);
        }
        // A query repeated in one snapshot: its first result is the one told.
        if (kind === 'backing') facts.backing ??= line.value;
        else facts.paused ??= line.value;
    }
    const sentences = parts.map((part) => (typeof part === 'string' ? part : mintSentence(part)));
    if (sentences.length === 0) return ['It recorded no results.'];
    if (sentences.length <= MAX_SENTENCES) return sentences;
    const more = sentences.length - MAX_SENTENCES;
    return [...sentences.slice(0, MAX_SENTENCES), `… and ${more.toString()} more`];
}

/**
 * The result a snapshot's `[ Verify on Solana ]` checks: its first backing,
 * or else its first result.
 *
 * @param lines The snapshot's results, labelled.
 * @returns The line, or `undefined` when there is none.
 */
export const verifyTargetOf = (lines: readonly LabelledLine[]): LabelledLine | undefined =>
    lines.find(({ label }) => label.kind === 'backing') ?? lines[0];
