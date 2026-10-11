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
| [web/README.md](../web/README.md)                                               | Browser apps: prove a balance, bridge dashboard                                   |
| [test-vectors/nori-snapshot/README.md](../test-vectors/nori-snapshot/README.md) | Test data shared by the TS and Rust tests                                         |

Upstream: the Nori SDK at the pinned release (npm 0.2.0, git `cbcfcc0`)
[README](https://github.com/Nori-zk/nori-solana-sdk/blob/cbcfcc0d95be60d8214f1ccba82aebe057f9cc4d/README.md),
[TypeScript SDK](https://github.com/Nori-zk/nori-solana-sdk/blob/cbcfcc0d95be60d8214f1ccba82aebe057f9cc4d/sdk/README.md) and
[deployment runbook](https://github.com/Nori-zk/nori-solana-sdk/blob/cbcfcc0d95be60d8214f1ccba82aebe057f9cc4d/DEPLOYMENT.md),
and the [bridge-head (prover) README](https://github.com/Nori-zk/nori-bridge-head/blob/FEAT/solana-bridge-sepolia-glamsterdam/README.md).

## Diagrams

Edit the `.drawio` files in [draw.io](https://app.diagrams.net); the `.drawio.png` exports embed them, so either one opens for editing.

## Test deployments (Sepolia + Solana devnet, 6–8 Oct 2026)

| What                         | Address                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proof queue (Sepolia)        | [`0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e`](https://sepolia.etherscan.io/address/0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e)                                                                                                                                                                       |
| NoriSnapshot (Sepolia)       | [`0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340`](https://sepolia.etherscan.io/address/0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340)                                                                                                                                                                       |
| Demo lockbox (Sepolia)       | [`0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543`](https://sepolia.etherscan.io/address/0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543)                                                                                                                                                                       |
| Shadow lockbox (Sepolia)     | [`0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9`](https://sepolia.etherscan.io/address/0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9)                                                                                                                                                                       |
| Nori light client (devnet)   | [`EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg`](https://explorer.solana.com/address/EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg?cluster=devnet)                                                                                                                                                     |
| Backstop (devnet)            | [`JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9`](https://explorer.solana.com/address/JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9?cluster=devnet)                                                                                                                                                     |
| nori-read-example (devnet)   | [`5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7`](https://explorer.solana.com/address/5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7?cluster=devnet)                                                                                                                                                     |
| Demo mint / guard (devnet)   | [`Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi`](https://explorer.solana.com/address/Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi?cluster=devnet) / [`E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD`](https://explorer.solana.com/address/E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD?cluster=devnet) |
| Shadow mint / guard (devnet) | [`Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX`](https://explorer.solana.com/address/Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX?cluster=devnet) / [`3YPpzexzi6MyTnbqHesq63Jchir5gnaBgKk7PmNq9vgN`](https://explorer.solana.com/address/3YPpzexzi6MyTnbqHesq63Jchir5gnaBgKk7PmNq9vgN?cluster=devnet) |

Measured on real proofs (Sepolia → devnet):

- **10-hour soak (7–8 Oct, `scripts/soak.sh`):** 39 of 39 snapshots proven and applied;
  Ethereum block → read applied on Solana in 15–22 min, median 18. Of that, ~3 min waiting
  for the next checkpoint block, ~15 min Ethereum finality + proving, ~30 s the keeper.
  The shadow guard (a lockbox nobody touches) stayed HEALTHY all night: no false alarms.
- **Drain demo:** the lockbox drained to 223.52 tripped the guard (deficit 116,475.48); a
  refill to 40,300 plus a pause kept it tripped; `unlatch` plus a full refill → HEALTHY.
- **Costs:** Nori `update` with requests ~110k CU; `submit_read` ~17k CU (backing),
  ~14k (pause); a 4-query snapshot 753,817 gas on Sepolia (see `ethereum/README.md`).

`npm run keeper -w client -- status` shows how far Nori has proven the queue, and each guard.
