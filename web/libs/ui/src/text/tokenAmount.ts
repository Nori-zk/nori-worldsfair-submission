/** The most decimals an amount shows. */
export const TOKEN_AMOUNT_DECIMALS_SHOWN = 6;

/**
 * A token amount in words: the whole part grouped by thousands, at most
 * {@link TOKEN_AMOUNT_DECIMALS_SHOWN} decimals cut (never rounded up), then
 * the symbol. An amount too small to show is "< 0.000001".
 *
 * @param amount The amount in the token's smallest unit.
 * @param decimals The token's decimals.
 * @param symbol The token's symbol.
 * @returns The amount, e.g. "1,234.5678 ETH".
 */
export const tokenAmountText = (amount: bigint, decimals: number, symbol: string): string => {
    const base = 10n ** BigInt(decimals);
    const whole = amount / base;
    const fraction = (amount % base)
        .toString()
        .padStart(decimals, '0')
        .slice(0, TOKEN_AMOUNT_DECIMALS_SHOWN)
        .replace(/0+$/, '');
    if (whole === 0n && fraction === '' && amount > 0n)
        return `< 0.${'0'.repeat(TOKEN_AMOUNT_DECIMALS_SHOWN - 1)}1 ${symbol}`;
    const grouped = whole.toLocaleString('en-US');
    return `${fraction === '' ? grouped : `${grouped}.${fraction}`} ${symbol}`;
};
