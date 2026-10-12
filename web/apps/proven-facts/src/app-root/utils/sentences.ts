import type { FactLabel, GuardQueries, KeeperRead } from '@nori-zk/solana-web-ui';
// Its own entry, not the lib's index, which loads components `node --test` cannot run.
import { LOCKBOXES } from '@nori-zk/solana-web-ui/mints';

/** How many lines a snapshot shows before `… and N more`: the five devnet mints and a few more. */
const MAX_LINES = 8;

/** How many of the keeper's reads a mint's line links: its backing and its pause read. */
const MAX_READS = 2;

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
 * A mint's lockbox, as guard status names it.
 *
 * @param mint The mint's address.
 * @returns `Demo lockbox`, or `Mint Fhw5…cbhi` when it has no name.
 */
export const lockboxName = (mint: string): string =>
    LOCKBOXES[mint]?.name ?? `Mint ${mint.slice(0, 4)}…${mint.slice(-4)}`;

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

/** One line of a snapshot: a mint's lockbox, or another query. */
export interface FactLine {
    /** `Demo lockbox · held 116,723.52 · not paused`. */
    text: string;
    /** The keeper's newest transactions on Solana that verified it, newest first, at most two. */
    reads: string[];
}

/** One mint's results, the first of each. */
interface MintFacts {
    mint: string;
    backing?: LabelledLine;
    paused?: LabelledLine;
}

/**
 * A mint's line: its lockbox, what it held, whether it was paused, and the
 * keeper's newest reads on Solana by a guard reading its queries. A guard's
 * backing and pause reads both name the guard and the batch, so they are not
 * told apart.
 *
 * @param facts The mint's backing and pause results.
 * @param reads The keeper's reads of the snapshot's batch, newest first (`keeperReadsOf`).
 * @returns The line.
 */
function mintLine({ mint, backing, paused }: MintFacts, reads: readonly KeeperRead[]): FactLine {
    const parts = [lockboxName(mint)];
    if (backing) parts.push(`held ${backing.value}`);
    if (paused) parts.push(paused.value === 'true' ? 'paused' : 'not paused');
    const ids = [backing, paused].flatMap((line) => (line ? [line.queryId.toLowerCase()] : []));
    return {
        text: parts.join(' · '),
        reads: reads
            .filter((read) => read.queryIds.some((id) => ids.includes(id)))
            .slice(0, MAX_READS)
            .map(({ signature }) => signature),
    };
}

/**
 * What a snapshot recorded, one line per guard mint (its backing and pause
 * together), then one per other query, in the order they first appear.
 * After `MAX_LINES`, the rest are counted.
 *
 * @param lines The snapshot's results, labelled.
 * @param reads The keeper's reads of the snapshot's batch, newest first (`keeperReadsOf`).
 * @returns The lines, the last one `… and N more` when some are left out.
 */
export function factLinesOf(
    lines: readonly LabelledLine[],
    reads: readonly KeeperRead[],
): FactLine[] {
    const parts: (MintFacts | string)[] = [];
    const byMint = new Map<string, MintFacts>();
    for (const line of lines) {
        const { kind } = line.label;
        if (kind === 'unknown' || line.mint === undefined) {
            parts.push(`Query ${line.label.text} returned ${line.value}`);
            continue;
        }
        let facts = byMint.get(line.mint);
        if (facts === undefined) {
            facts = { mint: line.mint };
            byMint.set(line.mint, facts);
            parts.push(facts);
        }
        // A query repeated in one snapshot: its first result is the one told.
        if (kind === 'backing') facts.backing ??= line;
        else facts.paused ??= line;
    }
    const all = parts.map((part): FactLine =>
        typeof part === 'string' ? { text: part, reads: [] } : mintLine(part, reads),
    );
    if (all.length === 0) return [{ text: 'It recorded no results.', reads: [] }];
    if (all.length <= MAX_LINES) return all;
    const more = all.length - MAX_LINES;
    return [...all.slice(0, MAX_LINES), { text: `… and ${more.toString()} more`, reads: [] }];
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
