import {
    BACKSTOP_ERROR_MESSAGE,
    backstopErrorName,
    customErrorOf,
    transactionErrorText,
} from '@nori-zk/backstop-keeper/guard';
import type { GuardRead, Simulated } from '@nori-zk/solana-web-ui';

// Every sentence the page says about a guard. The numbers come in formatted
// (`amount()`, `blockText()`, `duration()`), so the words are tested alone.

/** A guard's status, as the program's `status` computes it. */
export type GuardStatus = GuardRead['status'];

/** What a status sentence names, already formatted. */
export interface StatusFacts {
    status: GuardStatus;
    /** How far the live supply is above the proven backing, as `1,234.5`. */
    above: string;
    /** The guard's tolerance, as `1`. */
    tolerance: string;
    /** How long since the backing's Ethereum time, as `23 h`; empty when none is proven. */
    staleFor: string;
    /** The deficit the guard tripped on, as `116,475.48`. */
    tripDeficit: string;
    /** The Ethereum block it tripped at, as `11,880,162`; empty when not known. */
    tripBlock: string;
}

/** A sentence with one optional link in it: `text`, the link when not empty, then `end`. */
export interface Sentence {
    text: string;
    link: string;
    end: string;
}

/**
 * A sentence without a link.
 *
 * @param text The sentence.
 * @returns It, with no link and no end.
 */
const plain = (text: string): Sentence => ({ text, link: '', end: '' });

/**
 * The status as one word: `PAUSED_AT_SOURCE` reads `PAUSED`.
 *
 * @param status The guard's status.
 * @returns The word.
 */
export const statusWord = (status: GuardStatus): string =>
    status === 'PAUSED_AT_SOURCE' ? 'PAUSED' : status;

/**
 * What a guard's status means, in one sentence.
 *
 * @param facts The status and the numbers its sentence names.
 * @returns The sentence; TRIPPED's links the block it tripped at.
 */
export function statusSentence(facts: StatusFacts): Sentence {
    switch (facts.status) {
        case 'HEALTHY':
            return plain('Supply is within the proven backing.');
        case 'WARN':
            return plain(
                `Supply is ${facts.above} above the proven backing (tolerance ${facts.tolerance}); the next proven read decides.`,
            );
        case 'STALE':
            return plain(
                facts.staleFor === ''
                    ? 'No backing has been proven yet, so deposits are blocked.'
                    : `No proven backing for ${facts.staleFor}; the keeper is not running, so deposits are blocked.`,
            );
        case 'PAUSED_AT_SOURCE':
            return plain('The Ethereum lockbox is paused; deposits are blocked.');
        case 'TRIPPED': {
            const latched = '; latched until the admin unlatches.';
            return facts.tripBlock === ''
                ? plain(`Supply exceeded the proven backing by ${facts.tripDeficit}${latched}`)
                : {
                      text: `Supply exceeded the proven backing by ${facts.tripDeficit} at block`,
                      link: facts.tripBlock,
                      end: latched,
                  };
        }
    }
}

/**
 * What a lender's deposit would get now, from the status alone.
 *
 * @param status The guard's status.
 * @returns One sentence.
 */
export const lenderSentence = (status: GuardStatus): string =>
    status === 'HEALTHY'
        ? "A lender's deposit would be allowed right now."
        : "A lender's deposit would be blocked right now.";

/**
 * How much of the supply the proven backing covers, to the hundredth of a
 * percent, rounded down.
 *
 * @param backing The proven backing, in mint units.
 * @param supply The live supply, in mint units.
 * @param shortfall `supply − backing`, formatted, for when the backing falls short.
 * @returns `The backing covers 100.02% of the supply.`, `The backing is 1,234.5 short
 *   of the supply.`, or `Nothing is minted yet.`
 */
export function coverageText(backing: bigint, supply: bigint, shortfall: string): string {
    if (supply === 0n) return 'Nothing is minted yet.';
    if (backing < supply) return `The backing is ${shortfall} short of the supply.`;
    const hundredths = (backing * 10_000n) / supply;
    const whole = (hundredths / 100n).toLocaleString('en-US');
    const cents = (hundredths % 100n).toString().padStart(2, '0');
    return `The backing covers ${whole}.${cents}% of the supply.`;
}

/** What a guard checks, formatted, for its settings sentence. */
export interface SettingsFacts {
    /** The backing query, cut short: `0xd5ce…e29d`. */
    query: string;
    /** The lockbox's name when it is known, else empty. */
    lockbox: string;
    /** The pause query cut short, or empty when the guard has none. */
    pauseQuery: string;
    /** `10 min`. */
    window: string;
    /** `1`. */
    tolerance: string;
    /** `2 h`. */
    staleness: string;
    /** `2 min`. */
    interval: string;
    /** How many checkpoints the guard keeps. */
    kept: number;
}

/**
 * A guard's settings in sentences, with the lockbox linked when it is known.
 *
 * @param facts The settings, formatted.
 * @returns `Backing is read from NoriSnapshot query 0x… on the Demo lockbox ↗ in every
 *   snapshot; the guard trips when …`.
 */
export function settingsSentence(facts: SettingsFacts): Sentence {
    const start = `Backing is read from NoriSnapshot query ${facts.query}`;
    const pause =
        facts.pauseQuery === ''
            ? ' It reads no pause flag.'
            : ` The pause flag is query ${facts.pauseQuery}.`;
    const rest =
        ` in every snapshot. The guard trips when the lowest supply checkpointed within ${facts.window}` +
        ` of the backing's Ethereum time exceeds backing + ${facts.tolerance} tolerance;` +
        ` a backing older than ${facts.staleness} is stale; supply is checkpointed every` +
        ` ${facts.interval}, the last ${facts.kept.toString()} kept.${pause}`;
    return facts.lockbox === ''
        ? plain(start + rest)
        : { text: `${start} on the`, link: facts.lockbox, end: rest };
}

/**
 * What a simulated deposit got from `assert_healthy`, as a sentence. Its
 * colour is `verdictText`'s, from the shared library.
 *
 * @param value The simulation's value.
 * @returns `Your deposit would be allowed (3,956 CU).`, `Your deposit would be
 *   blocked: Stale (6008), No recent proven backing.`, or `The check failed: <error>.`
 */
export function depositSentence(value: Simulated): string {
    if (value.err === null) {
        const units = Number(value.unitsConsumed ?? 0n).toLocaleString('en-US');
        return `Your deposit would be allowed (${units} CU).`;
    }
    const code = customErrorOf(value.err);
    const name = code === undefined ? undefined : backstopErrorName(code);
    if (code === undefined || name === undefined)
        return `The check failed: ${transactionErrorText(value.err)}.`;
    const message = BACKSTOP_ERROR_MESSAGE[code];
    return `Your deposit would be blocked: ${name} (${code.toString()})${message === undefined ? '' : `, ${message}`}.`;
}

/**
 * A check that threw, as a sentence.
 *
 * @param error What was thrown.
 * @returns `The check failed: <message>.`
 */
export const checkFailed = (error: unknown): string =>
    `The check failed: ${error instanceof Error ? error.message : String(error)}.`;
