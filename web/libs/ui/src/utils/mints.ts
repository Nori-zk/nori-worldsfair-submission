/**
 * The guards' mints with a name, from the devnet deployment in
 * docs/README.md, for guard status and proven facts alike.
 *
 * shortcut: a fixed list for the devnet guards, as guards carry no name
 * on-chain, so any other mint reads by its address; a mainnet build would
 * name mints from the token list instead. The stale mint's guard
 * (`scripts/demo-states.sh stale`) reads the demo lockbox and is served by
 * no keeper.
 */
export const MINT_NAMES: Partial<Record<string, string>> = {
    Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi: 'Demo mint',
    Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX: 'Shadow mint',
    CXXcBPT6xCKZjooV8UpqPc1vHGQwPGkzkisNYxZXCFX3: 'Test mint A',
    '3Q9xNZr7iSkUZBEbLHkvap8Ece6aBSVskPCUPLWhtkTo': 'Test mint B',
    B6cveUAMmg5x1vfnjUCmW2dws18owYNSE9RQ2LN48JQC: 'Stale mint',
};

/**
 * The Ethereum lockbox each named mint's backing is read from, from the same
 * deployment.
 */
export const LOCKBOXES: Partial<Record<string, { name: string; address: string }>> = {
    Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi: {
        name: 'Demo lockbox',
        address: '0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543',
    },
    Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX: {
        name: 'Shadow lockbox',
        address: '0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9',
    },
    CXXcBPT6xCKZjooV8UpqPc1vHGQwPGkzkisNYxZXCFX3: {
        name: 'Test lockbox A',
        address: '0x61c2f92a1E158e8bffC03e68bA4125F296B55442',
    },
    '3Q9xNZr7iSkUZBEbLHkvap8Ece6aBSVskPCUPLWhtkTo': {
        name: 'Test lockbox B',
        address: '0x3317556e295319B9F2828fadDaCAc93352F9dbB0',
    },
    B6cveUAMmg5x1vfnjUCmW2dws18owYNSE9RQ2LN48JQC: {
        name: 'Demo lockbox',
        address: '0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543',
    },
};
