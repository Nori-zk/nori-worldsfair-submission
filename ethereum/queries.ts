import { AbiCoder, Interface, keccak256 } from 'ethers';

const abi = AbiCoder.defaultAbiCoder();

/** A view call `NoriSnapshot` can commit to: it must return one 32-byte word. */
export interface SnapshotQuery {
    /** Stable label used by keepers, guards and dashboards. */
    name: string;
    /** The contract called. */
    target: string;
    /** Human-readable function fragment, e.g. `balanceOf(address)`. */
    signature: string;
    /** Arguments encoded against `signature`. */
    args: readonly unknown[];
    /** What the word means. */
    description: string;
}

/** The calldata `NoriSnapshot` static-calls `target` with. */
export function encodeQueryData(
    query: Pick<SnapshotQuery, 'signature' | 'args'>
): string {
    const iface = new Interface([`function ${query.signature}`]);
    return iface.encodeFunctionData(query.signature, query.args);
}

/** `NoriSnapshot.queryIdOf`: `keccak256(abi.encode(target, data))`. */
export function queryIdOf(target: string, data: string): string {
    return keccak256(abi.encode(['address', 'bytes'], [target, data]));
}

/** Ethereum mainnet contracts the mainnet queries read. */
export const MAINNET = {
    WORMHOLE_TOKEN_BRIDGE: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    USDS: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
    SKY_USDS_OFT_ADAPTER: '0x1e1d42781fc170ef9da004fb735f56f0276d01b8',
    AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    AAVE_NTT_MANAGER: '0x197a0364267e48b9d46c5ff0e14d0a89c2d9fc1b',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    UNI_NTT_MANAGER: '0x755d0e80b038d10a2e44f128276f3f0a8428c4ee',
} as const;

/**
 * Backing and pause facts for the Ethereum-bridged assets on Solana that the
 * guards check.
 */
export const MAINNET_SNAPSHOT_QUERIES: readonly SnapshotQuery[] = [
    {
        name: 'wormhole-weth-outstanding',
        target: MAINNET.WORMHOLE_TOKEN_BRIDGE,
        signature: 'outstandingBridged(address)',
        args: [MAINNET.WETH],
        description:
            'WETH the Wormhole Portal has bridged out to all chains, 8-decimal normalized',
    },
    {
        name: 'wormhole-weth-custody',
        target: MAINNET.WETH,
        signature: 'balanceOf(address)',
        args: [MAINNET.WORMHOLE_TOKEN_BRIDGE],
        description: 'WETH held in custody by the Wormhole Portal',
    },
    {
        name: 'wormhole-wbtc-outstanding',
        target: MAINNET.WORMHOLE_TOKEN_BRIDGE,
        signature: 'outstandingBridged(address)',
        args: [MAINNET.WBTC],
        description:
            'WBTC the Wormhole Portal has bridged out to all chains, 8 decimals',
    },
    {
        name: 'wormhole-wbtc-custody',
        target: MAINNET.WBTC,
        signature: 'balanceOf(address)',
        args: [MAINNET.WORMHOLE_TOKEN_BRIDGE],
        description: 'WBTC held in custody by the Wormhole Portal',
    },
    {
        name: 'usds-lockbox',
        target: MAINNET.USDS,
        signature: 'balanceOf(address)',
        args: [MAINNET.SKY_USDS_OFT_ADAPTER],
        description:
            'USDS locked in the Sky LayerZero OFT adapter, which serves only Solana',
    },
    {
        name: 'usds-lockbox-paused',
        target: MAINNET.SKY_USDS_OFT_ADAPTER,
        signature: 'paused()',
        args: [],
        description: 'Whether the Sky USDS OFT adapter is paused',
    },
    {
        name: 'aave-ntt-hub',
        target: MAINNET.AAVE,
        signature: 'balanceOf(address)',
        args: [MAINNET.AAVE_NTT_MANAGER],
        description:
            'AAVE locked in the Wormhole NTT locking hub, which serves only Solana',
    },
    {
        name: 'aave-ntt-hub-paused',
        target: MAINNET.AAVE_NTT_MANAGER,
        signature: 'isPaused()',
        args: [],
        description: 'Whether the AAVE NTT manager is paused',
    },
    {
        name: 'uni-ntt-hub',
        target: MAINNET.UNI,
        signature: 'balanceOf(address)',
        args: [MAINNET.UNI_NTT_MANAGER],
        description:
            'UNI locked in the Wormhole NTT locking hub, which serves only Solana',
    },
    {
        name: 'uni-ntt-hub-paused',
        target: MAINNET.UNI_NTT_MANAGER,
        signature: 'isPaused()',
        args: [],
        description: 'Whether the UNI NTT manager is paused',
    },
];
