/** How many snapshots the list shows at first, and how many more each `[ Show older ]` adds. */
export const REVEAL_STEP = 8;

/** Each Ethereum chain's name, for the line that links to the older snapshots. */
const CHAIN_NAMES: Record<number, string> = {
    1: 'Ethereum',
    11155111: 'Sepolia',
};

/**
 * The snapshots the list shows: the newest `shown`.
 *
 * @param snapshots Every snapshot read, newest first.
 * @param shown How many the list shows.
 * @returns The newest `shown` of them, newest first.
 */
export const visibleOf = <T>(snapshots: readonly T[], shown: number): T[] =>
    snapshots.slice(0, Math.max(0, shown));

/**
 * How many the list shows after one more `[ Show older ]`. It may pass the
 * snapshots read: `visibleOf` stops at them, and the button hides once all show.
 *
 * @param shown How many the list shows now.
 * @returns `shown` plus one step.
 */
export const moreShown = (shown: number): number => shown + REVEAL_STEP;

/**
 * The text of the button that shows older snapshots.
 *
 * @param total How many snapshots were read.
 * @param shown How many the list shows.
 * @returns `[ Show older ]` while some are hidden, else `''`.
 */
export const showOlderText = (total: number, shown: number): string =>
    shown < total ? '[ Show older ]' : '';

/**
 * Whether the list shows every snapshot read, so the line linking to the
 * older ones on the explorer takes the button's place.
 *
 * @param total How many snapshots were read.
 * @param shown How many the list shows.
 * @returns `true` once there are snapshots and all of them show.
 */
export const allShown = (total: number, shown: number): boolean => total > 0 && shown >= total;

/**
 * The link text of the line under the full list.
 *
 * @param chainId The Ethereum chain this build reads.
 * @returns `NoriSnapshot on Sepolia ↗`, or `on chain 5` for a chain without a name here.
 */
export const olderLinkText = (chainId: number): string =>
    `NoriSnapshot on ${CHAIN_NAMES[chainId] ?? `chain ${chainId.toString()}`} ↗`;
