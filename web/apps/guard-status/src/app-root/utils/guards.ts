import type { GuardRead } from '@nori-zk/solana-web-ui';

/**
 * The guards' mints with a name, from the devnet deployment in
 * docs/README.md. A shortcut: guards carry no name on-chain, so any other
 * mint reads `Mint`.
 */
const MINT_NAMES: Partial<Record<string, string>> = {
    Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi: 'Demo mint',
    Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX: 'Shadow mint',
};

/**
 * The Ethereum lockbox each named mint's backing is read from, from the same
 * deployment.
 */
const LOCKBOXES: Partial<Record<string, { name: string; address: string }>> = {
    Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi: {
        name: 'Demo lockbox',
        address: '0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543',
    },
    Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX: {
        name: 'Shadow lockbox',
        address: '0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9',
    },
};

/**
 * A Solana address cut to its start and end.
 *
 * @param address The address.
 * @returns `Fhw5…cbhi`.
 */
export const shortAddress = (address: string): string =>
    `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * A mint's name.
 *
 * @param mint The mint's address.
 * @returns `Demo mint`, `Shadow mint`, or `Mint`.
 */
export const mintName = (mint: string): string => MINT_NAMES[mint] ?? 'Mint';

/**
 * The Ethereum lockbox a mint's backing is read from, when it is known.
 *
 * @param mint The mint's address.
 * @returns Its name and address, or nothing.
 */
export const lockboxOf = (mint: string): { name: string; address: string } | undefined =>
    LOCKBOXES[mint];

/**
 * Where a status sorts: the guards a lender can use first, then the ones
 * that block for a reason (tripped, paused), then the stale ones.
 *
 * @param status The guard's status.
 * @returns 0, 1 or 2.
 */
export function statusRank(status: GuardRead['status']): number {
    switch (status) {
        case 'HEALTHY':
        case 'WARN':
            return 0;
        case 'TRIPPED':
        case 'PAUSED_AT_SOURCE':
            return 1;
        case 'STALE':
            return 2;
    }
}

/**
 * The guards in the order the page shows them: by `statusRank`, then by
 * address so a refresh keeps them in place.
 *
 * @param guards The guards.
 * @returns A sorted copy.
 */
export const ordered = <T extends { address: string; status: GuardRead['status'] }>(
    guards: readonly T[],
): T[] =>
    [...guards].sort(
        (a, b) =>
            statusRank(a.status) - statusRank(b.status) ||
            (a.address < b.address ? -1 : a.address > b.address ? 1 : 0),
    );
