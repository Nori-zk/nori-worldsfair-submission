# Docs

## Start here

- [README](../README.md): what this is, how to run it, how to deploy.
- [Quickstart](quickstart.md): read any Ethereum view function from Solana, locally in ~4 min, live on Sepolia → devnet, or in your own program.
- [How a read works](how-it-works.drawio.png): the whole loop, Ethereum to any Solana program.
- [AGENTS.md](../AGENTS.md): commands, quirks and the rules that bite (for developers and coding agents).

## By part

| Doc                                                                             | What                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ethereum/README.md](../ethereum/README.md)                                     | `NoriSnapshot`: the proven leaf, what a consumer must check, commands, gas        |
| [nori-read/README.md](../nori-read/README.md)                                   | Verify a snapshot result in your Solana program                                   |
| [programs/backstop/README.md](../programs/backstop/README.md)                   | Circuit breaker for one bridged asset; [guard diagram](backstop-guard.drawio.png) |
| [keeper/README.md](../keeper/README.md)                                         | Keeper CLI, its library and the local dry run                                     |
| [web/README.md](../web/README.md)                                               | Browser apps: prove a balance, guard status, proven facts, bridge dashboard       |
| [test-vectors/nori-snapshot/README.md](../test-vectors/nori-snapshot/README.md) | Test data shared by the TS and Rust tests                                         |

Upstream: the Nori SDK at the pinned release (npm 0.3.0, git `ee4cc78`)
[README](https://github.com/Nori-zk/nori-solana-sdk/blob/ee4cc78d96054d8e0238d2c44f4495a021ab7ffb/README.md),
[TypeScript SDK](https://github.com/Nori-zk/nori-solana-sdk/blob/ee4cc78d96054d8e0238d2c44f4495a021ab7ffb/sdk/README.md) and
[deployment runbook](https://github.com/Nori-zk/nori-solana-sdk/blob/ee4cc78d96054d8e0238d2c44f4495a021ab7ffb/DEPLOYMENT.md),
and the [bridge-head (prover) README](https://github.com/Nori-zk/nori-bridge-head/blob/FEAT/solana-bridge-sepolia-glamsterdam/README.md).

## Diagrams

Edit the `.drawio` files in [draw.io](https://app.diagrams.net); the `.drawio.png` exports embed them, so either one opens for editing.

## Test deployments (Sepolia + Solana devnet, 6–8 Oct 2026)

| What                           | Address                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proof queue (Sepolia)          | [`0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e`](https://sepolia.etherscan.io/address/0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e)                                                                                                                                                                                                                     |
| NoriSnapshot (Sepolia)         | [`0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340`](https://sepolia.etherscan.io/address/0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340)                                                                                                                                                                                                                     |
| Demo lockbox (Sepolia)         | [`0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543`](https://sepolia.etherscan.io/address/0xC8e4AAF5Db40bCE6aC2Ed89e1676D882044FD543)                                                                                                                                                                                                                     |
| Shadow lockbox (Sepolia)       | [`0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9`](https://sepolia.etherscan.io/address/0xC1E34c6f16d4284520EFE86AE304a895F1Be84C9)                                                                                                                                                                                                                     |
| Nori verifier program (devnet) | [`EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg`](https://explorer.solana.com/address/EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg?cluster=devnet)                                                                                                                                                                                                   |
| Backstop (devnet)              | [`JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9`](https://explorer.solana.com/address/JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9?cluster=devnet)                                                                                                                                                                                                   |
| nori-read-example (devnet)     | [`5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7`](https://explorer.solana.com/address/5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7?cluster=devnet)                                                                                                                                                                                                   |
| Demo mint / guard (devnet)     | [`Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi`](https://explorer.solana.com/address/Fhw5m3W34LuGNNuTWxHu8wVbre7wUE445hxir3Xwcbhi?cluster=devnet) / [`E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD`](https://explorer.solana.com/address/E8M7dU4Dp3j6AE3FnFv6fNJXp5tBg3xEUw1xg4eF7PYD?cluster=devnet)                                               |
| Shadow mint / guard (devnet)   | [`Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX`](https://explorer.solana.com/address/Dnt2Mjnvj38E59bnUBkw8EEoW1sy6HzMavbDSQkXTuoX?cluster=devnet) / [`3YPpzexzi6MyTnbqHesq63Jchir5gnaBgKk7PmNq9vgN`](https://explorer.solana.com/address/3YPpzexzi6MyTnbqHesq63Jchir5gnaBgKk7PmNq9vgN?cluster=devnet)                                               |
| Test lockbox A / B (Sepolia)   | [`0x61c2f92a1E158e8bffC03e68bA4125F296B55442`](https://sepolia.etherscan.io/address/0x61c2f92a1E158e8bffC03e68bA4125F296B55442) / [`0x3317556e295319B9F2828fadDaCAc93352F9dbB0`](https://sepolia.etherscan.io/address/0x3317556e295319B9F2828fadDaCAc93352F9dbB0)                                                                                   |
| Test A mint / guard (devnet)   | [`CXXcBPT6xCKZjooV8UpqPc1vHGQwPGkzkisNYxZXCFX3`](https://explorer.solana.com/address/CXXcBPT6xCKZjooV8UpqPc1vHGQwPGkzkisNYxZXCFX3?cluster=devnet) / [`DUxFyC8pyfPFCSpMuuR3728Uydad1hbgEioL6iyzjhWG`](https://explorer.solana.com/address/DUxFyC8pyfPFCSpMuuR3728Uydad1hbgEioL6iyzjhWG?cluster=devnet)                                               |
| Test B mint / guard (devnet)   | [`3Q9xNZr7iSkUZBEbLHkvap8Ece6aBSVskPCUPLWhtkTo`](https://explorer.solana.com/address/3Q9xNZr7iSkUZBEbLHkvap8Ece6aBSVskPCUPLWhtkTo?cluster=devnet) / [`3sEXwB7brVAubrB5JirkxLq2EEaP3FQaJTSWZ6gh8Bky`](https://explorer.solana.com/address/3sEXwB7brVAubrB5JirkxLq2EEaP3FQaJTSWZ6gh8Bky?cluster=devnet)                                               |
| Stale mint / guard (devnet)    | [`B6cveUAMmg5x1vfnjUCmW2dws18owYNSE9RQ2LN48JQC`](https://explorer.solana.com/address/B6cveUAMmg5x1vfnjUCmW2dws18owYNSE9RQ2LN48JQC?cluster=devnet) / [`4cCDYS3vR4KdRNFyvbbhAfvvN4yceRxjrxSqsL5pUPkV`](https://explorer.solana.com/address/4cCDYS3vR4KdRNFyvbbhAfvvN4yceRxjrxSqsL5pUPkV?cluster=devnet) (reads the demo lockbox; no keeper serves it) |

Every steady guard state, on purpose: `scripts/demo-states.sh` trips test B (its lockbox
at 223.52), pauses test A at source and creates a stale guard nothing is proven for; demo and
shadow stay HEALTHY. Its header is the runbook: which step runs where, how long, how to undo.
Set on 12 Oct ~17:20 UTC (trip, pause) and 17:16 UTC (stale), after the keeper restart below.

Measured on real proofs (Sepolia → devnet):

- **10-hour soak (7–8 Oct, `scripts/soak.sh`):** 39 of 39 snapshots proven and applied;
  Ethereum block → read applied on Solana in 15–22 min, median 18. Of that, ~3 min waiting
  for the next checkpoint block, ~15 min Ethereum finality + proving, ~30 s the keeper.
  The shadow guard (a lockbox nobody touches) stayed HEALTHY all night: no false alarms.
- **17.8-hour soak (11–12 Oct, four guards, `keeper.soak-all.json`):** 69 snapshots sent, 68 proven
  and applied by the stop (the last was in flight); Ethereum block → read applied min 15.0,
  median 18.3, p90 21.1, max 25.3 min; one keeper failure line (a transition without an error edge,
  the snapshot was retried). Stopped 12 Oct 17:05 UTC to restart the keeper with the memo on its
  reads; the soak continues from its state file. Reports: [docs/evidence](evidence/README.md).
- **Scripted campaign (8–9 Oct, 272 min, `campaign.sh` on three guards):** 21 scenario steps and
  17 claims from the spec, each with its Sepolia and devnet transactions in the
  [report](evidence/campaign-2026-10-08.md): nothing changes → HEALTHY; no proof → STALE; pause →
  PAUSED_AT_SOURCE; a transfer within the proof lag → WARN at most; burn then unlock → no trip; a
  forged mint → TRIPPED once the window is past; the Kelp drain → TRIPPED with the deficit; a
  refill stays latched; unlatch while under-backed trips again; unlatch after a full refill →
  HEALTHY. After every applied read: 264 of 264 replayed or forged reads refused, 66 of 66
  non-admin unlatches refused, `assert_healthy` refused unless HEALTHY; `submit_read` 17.7–18.5k
  CU, `assert_healthy` under 6k CU; latency median 17.7 min (n=26). The runner lives on the
  [`FEAT/campaign`](https://github.com/Nori-zk/nori-worldsfair-submission/tree/FEAT/campaign)
  branch, not in `develop`.
- **Drain demo:** the lockbox drained to 223.52 tripped the guard (deficit 116,475.48); a
  refill to 40,300 plus a pause kept it tripped; `unlatch` plus a full refill → HEALTHY.
- **Costs:** Nori `update` with requests ~110k CU; `submit_read` ~17k CU (backing),
  ~14k (pause); a 4-query snapshot 753,817 gas on Sepolia (see `ethereum/README.md`).

`npm run keeper -w keeper -- status` shows how far Nori has proven the queue, and each guard.
