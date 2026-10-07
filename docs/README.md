# Docs

## Start here

- [README](../README.md): what this is, how to run it, how to deploy.
- [How a read works](how-it-works.drawio.png): the whole loop, Ethereum to any Solana program.
- [AGENTS.md](../AGENTS.md): commands, quirks and the rules that bite (for developers and coding agents).

## By part

| Doc                                                                             | What                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ethereum/README.md](../ethereum/README.md)                                     | `NoriSnapshot`: the proven leaf, what a consumer must check, commands, gas        |
| [nori-read/README.md](../nori-read/README.md)                                   | Verify a snapshot result in your Solana program                                   |
| [programs/backstop/README.md](../programs/backstop/README.md)                   | Circuit breaker for one bridged asset; [guard diagram](backstop-guard.drawio.png) |
| [client/README.md](../client/README.md)                                         | Sample client, keeper CLI and the local dry run                                   |
| [test-vectors/nori-snapshot/README.md](../test-vectors/nori-snapshot/README.md) | Test data shared by the TS and Rust tests                                         |

Upstream: the Nori SDK at the pinned release (npm 0.0.5, git `a712825`)
[README](https://github.com/Nori-zk/nori-solana-sdk/blob/a712825fc660352f75e346da43998256e739f860/README.md),
[TypeScript SDK](https://github.com/Nori-zk/nori-solana-sdk/blob/a712825fc660352f75e346da43998256e739f860/sdk/README.md) and
[deployment runbook](https://github.com/Nori-zk/nori-solana-sdk/blob/a712825fc660352f75e346da43998256e739f860/DEPLOYMENT.md),
and the [bridge-head (prover) README](https://github.com/Nori-zk/nori-bridge-head/blob/FEAT/solana-bridge-sepolia-glamsterdam/README.md).

## Diagrams

Edit the `.drawio` files in [draw.io](https://app.diagrams.net); the `.drawio.png` exports embed them, so either one opens for editing.

## Test deployments (Sepolia + Solana devnet, 6 Oct 2026)

| What                       | Address                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proof queue (Sepolia)      | [`0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e`](https://sepolia.etherscan.io/address/0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e)                   |
| NoriSnapshot (Sepolia)     | [`0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340`](https://sepolia.etherscan.io/address/0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340)                   |
| DemoLockbox (Sepolia)      | [`0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543`](https://sepolia.etherscan.io/address/0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543)                   |
| Nori light client (devnet) | [`EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg`](https://explorer.solana.com/address/EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg?cluster=devnet) |
| Backstop (devnet)          | [`JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9`](https://explorer.solana.com/address/JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9?cluster=devnet) |
| Demo mint (devnet)         | [`Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi`](https://explorer.solana.com/address/Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi?cluster=devnet) |
| Demo guard (devnet)        | [`E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD`](https://explorer.solana.com/address/E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD?cluster=devnet) |

Measured on 7 Oct (real proofs): a snapshot is provable on Solana 14–19 min after its
Ethereum block; Nori's `update` with a request costs ~110k CU and `submit_read` ~17k CU.
The Sepolia drain (223.52) tripped the guard; a refill to 40,300 plus a pause kept it tripped.

`npm run keeper -w client -- status` shows how far Nori has proven the queue, and the guard's status.
