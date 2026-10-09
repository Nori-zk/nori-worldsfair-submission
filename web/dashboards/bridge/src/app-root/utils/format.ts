import { formatUnits } from 'ethers';

/** Each Ethereum chain's block explorer. */
const EXPLORERS: Record<number, string> = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
};

/** The block explorer of the chain this build reads. */
const EXPLORER = EXPLORERS[NORI_WEB_ENV.ethereum.chainId] ?? EXPLORERS[1];

/**
 * A long hex string cut to its start and end.
 *
 * @param hex The string, such as a transaction hash.
 * @returns `0x8a1f…9c2d`.
 */
export const shortHex = (hex: string): string =>
    hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;

/**
 * A transaction's page on the block explorer.
 *
 * @param txHash The transaction's hash.
 * @returns The URL.
 */
export const transactionUrl = (txHash: string): string => `${EXPLORER}/tx/${txHash}`;

/**
 * An address's page on the block explorer.
 *
 * @param address The address.
 * @returns The URL.
 */
export const addressUrl = (address: string): string => `${EXPLORER}/address/${address}`;

/**
 * A block on the explorer.
 *
 * @param block The block number.
 * @returns Its explorer URL.
 */
export const blockUrl = (block: bigint): string => `${EXPLORER}/block/${block.toString()}`;

/**
 * An account on the Solana explorer, for the cluster this build reads.
 *
 * @param address The account.
 * @returns Its explorer URL.
 */
export const solanaAccountUrl = (address: string): string =>
    `https://explorer.solana.com/address/${address}` +
    (NORI_WEB_ENV.solana.cluster === 'mainnet' ? '' : `?cluster=${NORI_WEB_ENV.solana.cluster}`);

/**
 * A block number with thousands separators.
 *
 * @param block The block number.
 * @returns `7,401,512`.
 */
export const blockText = (block: number | bigint): string => block.toLocaleString('en-US');

/**
 * Request ids as a range and a count.
 *
 * @param ids The ids, in any order.
 * @returns `#209–#212 (4)`, `#208 (1)`, or `none` when empty.
 */
export function idRange(ids: readonly bigint[]): string {
    if (ids.length === 0) return 'none';
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const count = `(${ids.length.toString()})`;
    return first === last
        ? `#${first.toString()} ${count}`
        : `#${first.toString()}–#${last.toString()} ${count}`;
}

/**
 * A batch's request ids, from its cursors.
 *
 * @param inputQueueCursor The first request id it holds.
 * @param outputQueueCursor One past the last.
 * @returns `#209–#212 (4)`, or `#208 (1)`.
 */
export function cursorRange(inputQueueCursor: bigint, outputQueueCursor: bigint): string {
    const count = `(${(outputQueueCursor - inputQueueCursor).toString()})`;
    const last = outputQueueCursor - 1n;
    return last === inputQueueCursor
        ? `#${last.toString()} ${count}`
        : `#${inputQueueCursor.toString()}–#${last.toString()} ${count}`;
}

/**
 * The contract that submitted a request, by name when it is NoriSnapshot.
 *
 * @param target The submitting address.
 * @returns `NoriSnapshot`, or the address cut short.
 */
export const contractName = (target: string): string =>
    target.toLowerCase() === NORI_WEB_ENV.ethereum.snapshotAddress.toLowerCase()
        ? 'NoriSnapshot'
        : shortHex(target);

/**
 * An amount in a mint's units, for reading.
 *
 * @param value The amount in the mint's smallest unit.
 * @param decimals The mint's decimals.
 * @returns `116,723.52`.
 */
export const amount = (value: bigint, decimals: number): string =>
    Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * How long ago something happened, roughly.
 *
 * @param secs Seconds since.
 * @returns `12 min ago`, `3 h ago` or `2 d ago`.
 */
export const ago = (secs: number): string =>
    secs < 3600
        ? `${Math.floor(secs / 60).toString()} min ago`
        : secs < 172_800
          ? `${Math.floor(secs / 3600).toString()} h ago`
          : `${Math.floor(secs / 86_400).toString()} d ago`;

/**
 * A time of day in UTC.
 *
 * @param secs Unix seconds.
 * @returns `18:59:48`.
 */
export const clock = (secs: number): string => new Date(secs * 1000).toISOString().slice(11, 19);
