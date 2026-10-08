# Nori: World's Fair submission

Read Ethereum state from any Solana program, proven instead of relayed.

![How a read works](docs/how-it-works.drawio.png)

## Where it stands (8 Oct)

- **Live on real Nori proofs**, Ethereum Sepolia → Solana devnet, since 7 Oct.
- **10-hour soak:** 39 of 39 snapshots proven and applied; a read reaches Solana a median
  18 min after its Ethereum block (15–22), almost all of it Ethereum finality. An untouched
  guard stayed HEALTHY all night.
- **Drain demo:** draining the lockbox trips the guard; a refill doesn't reset it; the
  admin's `unlatch` does, once the backing is back.
- **Next:** Ethereum + Solana mainnet, once Nori proves mainnet.

Addresses and numbers: [docs/README.md](docs/README.md).

## Repo

| Path            | What                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ethereum/`     | `NoriSnapshot` contract, query list, deploy and snapshot tasks                                                                |
| `nori-read/`    | Rust crate: verify a snapshot result on Solana in one call ([README](nori-read/README.md))                                    |
| `programs/`     | Solana programs: `nori-read-example`, [`backstop`](programs/backstop) (circuit breaker)                                       |
| `client/`       | Sample TS client and keeper CLI: create-guards, snapshot, checkpoint, submit, status, unlatch, run                            |
| `test-vectors/` | Test data shared by the TS and Rust tests                                                                                     |
| `test-harness/` | Surfpool helpers for the program tests                                                                                        |
| `scripts/`      | `dry-run.sh` (the whole loop locally), `deploy-devnet.sh` (Backstop + demo mint), `soak.sh` (keeper for hours, then a report) |
| `docs/`         | [Index of all docs](docs/README.md), diagrams, test deployments                                                               |

## Run

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission
npm install && npm run build
npm test                 # Ethereum contracts
cargo test --locked -p nori-read  # Solana-side verification
scripts/dry-run.sh       # the whole loop on local chains, with a fake prover
```

Validator tests and toolchain notes: [AGENTS.md](AGENTS.md).
The Nori SDK comes from npm (`@nori-zk/nori-bridge-solana-sdk` and friends) and,
for Rust, a cargo git dependency, both pinned to one sdk release; TypeScript needs no Rust.

## Deploy (Sepolia + Solana devnet)

Keys and addresses live in one `.env`: `cp .env.example .env`, then fill it in.

```sh
# Ethereum: NoriSnapshot on the existing queue, and a demo lockbox
npm run deploy -w ethereum                     # -> ethereum/.env.nori-eth-snapshot
npm run deploy-demo -w ethereum -- 116723.52   # -> ethereum/.env.nori-eth-demo

# Solana: Backstop, and a demo mint of 116,700 (-> .env.nori-sol-demo); safe to rerun
scripts/deploy-devnet.sh

# Keeper: client/keeper.demo.json reads .env and the deploy outputs
npm run keeper -w client -- create-guards
npm run keeper -w client -- status   # Nori's progress through the queue, then each guard
npm run keeper -w client -- run
```

bridge-head proves `NORI_ETH_PROOF_QUEUE_ADDRESS` and updates `NORI_SOL_TOKEN_PROGRAM_ID`.
Create guards only after that program is initialized: a guard pins it.

## Built vs roadmap

|                                                                                          | Status                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| NoriSnapshot (batched reads) and `nori-read`                                             | Built                                                                                                              |
| Backstop guards: trip rule, latch, paused-at-source, stale, `assert_healthy` for lenders | Built                                                                                                              |
| Keeper, local dry run                                                                    | Built                                                                                                              |
| Live loop on Sepolia + Solana devnet                                                     | Running on real proofs since 7 Oct ([results](docs/README.md#test-deployments-sepolia--solana-devnet-68-oct-2026)) |
| `enforce`: pause a Token-2022 mint when its guard trips                                  | Roadmap                                                                                                            |
| Separate warn tolerance (in-flight transfers) from the trip tolerance                    | Roadmap (one `tolerance` today)                                                                                    |
| Auto-unlatch for Solana-only custody; timelocked admin `unlatch`                         | Roadmap (admin `unlatch` today)                                                                                    |
| Check the Solana mint's authority is the expected bridge                                 | Roadmap                                                                                                            |
| Direct storage proofs: any slot, no Ethereum transaction                                 | Roadmap                                                                                                            |

Direct proofs work because each Nori update already puts Ethereum's state
root on Solana. The hackathon build uses snapshots through the existing proof queue.
