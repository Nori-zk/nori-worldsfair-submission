import { forkJoin, map, type Observable, of } from 'rxjs';
import { Contract, dataLength } from 'ethers';
import { type EthereumProvider, ethRpcRead$ } from '@nori-zk/nori-bridge-solana-sdk';
import { encodeQueryData, NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { type Preview } from './prove-balance.js';

/** Multicall3, at the same address on every chain: its `getEthBalance` makes an ETH balance a view call. */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** The ERC-20 calls that name a token and scale its balance. */
const TOKEN_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
];

/** The asset and holder the form holds. */
export interface BalanceRequest {
    /** `eth`, or an ERC-20 token's address. */
    asset: string;
    /** The Ethereum address whose balance is proven. */
    holder: string;
}

/**
 * The view call `NoriSnapshot` makes for a balance: `balanceOf(holder)` on
 * the token, or Multicall3's `getEthBalance(holder)` for ETH.
 *
 * @param request The asset and holder.
 * @returns The call's target and calldata.
 */
export const balanceQuery = ({
    asset,
    holder,
}: BalanceRequest): { target: string; data: string } =>
    asset === 'eth'
        ? {
              target: MULTICALL3_ADDRESS,
              data: encodeQueryData({ signature: 'getEthBalance(address)', args: [holder] }),
          }
        : {
              target: asset,
              data: encodeQueryData({ signature: 'balanceOf(address)', args: [holder] }),
          };

/**
 * The balance, read with the call the snapshot will make.
 *
 * @param provider The provider the read goes through.
 * @param request The asset and holder.
 * @returns The balance, once; errors when the call does not return exactly one 32-byte word.
 */
const balance$ = (provider: EthereumProvider, request: BalanceRequest): Observable<bigint> => {
    const query = balanceQuery(request);
    return ethRpcRead$(
        async () => provider.call({ to: query.target, data: query.data }),
        'Failed to read the balance.',
    ).pipe(
        map((word) => {
            if (dataLength(word) !== 32)
                throw new Error(
                    `The balance call returned ${dataLength(word).toString()} bytes, not 32.`,
                );
            return BigInt(word);
        }),
    );
};

/**
 * The asset's symbol and decimals: ETH's, or the token's own.
 *
 * @param provider The provider the read goes through.
 * @param asset `eth`, or an ERC-20 token's address.
 * @returns The symbol and decimals, once.
 */
const assetUnits$ = (
    provider: EthereumProvider,
    asset: string,
): Observable<{ symbol: string; decimals: number }> => {
    if (asset === 'eth') return of({ symbol: 'ETH', decimals: 18 });
    const token = new Contract(asset, TOKEN_ABI, provider);
    return forkJoin({
        symbol: ethRpcRead$(
            async () => token.getFunction('symbol')() as Promise<string>,
            "Failed to read the token's symbol.",
        ),
        decimals: ethRpcRead$(
            async () => token.getFunction('decimals')() as Promise<bigint>,
            "Failed to read the token's decimals.",
        ).pipe(map(Number)),
    });
};

/**
 * The snapshot fee `NoriSnapshot` charges.
 *
 * @param provider The provider the read goes through.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @returns The fee in wei, once.
 */
const snapshotFee$ = (provider: EthereumProvider, snapshotAddress: string): Observable<bigint> =>
    ethRpcRead$(
        async () => NoriSnapshot__factory.connect(snapshotAddress, provider).snapshotFee(),
        'Failed to read the snapshot fee.',
    );

/**
 * The balance, its units and the snapshot fee, read together.
 *
 * @param provider The provider the read goes through.
 * @param snapshotAddress The `NoriSnapshot` address.
 * @param request The asset and holder.
 * @returns The preview, once.
 */
export const preview$ = (
    provider: EthereumProvider,
    snapshotAddress: string,
    request: BalanceRequest,
): Observable<Preview> =>
    forkJoin({
        balance: balance$(provider, request),
        units: assetUnits$(provider, request.asset),
        fee: snapshotFee$(provider, snapshotAddress),
    }).pipe(map(({ balance, units, fee }) => ({ ...units, balance, fee })));
