# Nori: World's Fair submission

Nori is infrastructure for reading Ethereum state from Solana (and Tempo), proven instead of
relayed: no signers or oracles in between. This repo is the Solana side of Nori's World's Fair
entry: `NoriSnapshot` batches any Ethereum view calls on Sepolia, Nori's prover proves them with
Helios inside SP1, and [`nori-read`](nori-read/README.md) checks one answer inside any Solana
program on devnet, in one call. The first consumer is Backstop, a circuit breaker that trips when
a bridged token's proven backing on Ethereum falls below its supply on Solana.

![How a read works](docs/how-it-works.drawio.png)

## Where it stands (12 Oct)

- **Live on real Nori proofs**, Ethereum Sepolia → Solana devnet: the prover since 7 Oct;
  the Backstop keeper, paused on 11 Oct, has run on its own server since 12 Oct, in a 7-day soak.
- **10-hour soak (7–8 Oct):** 39 of 39 snapshots proven and applied; a read reaches Solana a median
  18 min after its Ethereum block (15–22), almost all of it Ethereum finality. An untouched
  guard stayed HEALTHY all night.
- **Drain demo:** draining the lockbox trips the guard; a refill doesn't reset it; the
  admin's `unlatch` does, once the backing is back (a testing and demo shortcut: one key;
  production needs a timelock or governance, on the roadmap).
- **Apps:** in the browser ([web/](web/README.md)): guard status for lenders, proven facts for anyone, a prove-balance app, and the bridge dashboard for operators.
- **Next:** Ethereum + Solana mainnet, once Nori proves mainnet.

Addresses and numbers: [docs/README.md](docs/README.md).

## Quickstart: read any Ethereum view function from Solana

Three steps, one proof, no signers:

```text
NoriSnapshot.snapshot(target, "totalSupply()")    # Sepolia: batch any view calls under one root
Nori proves that root to Solana                   # Helios inside SP1 -> Groth16, ~18 min, nothing to run
verify_snapshot_result(batch, query, witness)     # your Solana program: one call, ~3,200 CU
```

Pick a path in [docs/quickstart.md](docs/quickstart.md):

- **No keys, about 4 min:** build `nori-read-example`, watch surfpool verify 10 mainnet results and reject a forged one.
- **A live read, about 20 min, a Sepolia key:** prove any balance in the browser, or any view call from the CLI.
- **In your program:** two calls from [`nori-read`](nori-read/README.md), as the example does.

## Repo

| Path            | What                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ethereum/`     | `NoriSnapshot` contract, query list, deploy and snapshot tasks                                                                                                            |
| `nori-read/`    | Rust crate: verify a snapshot result on Solana in one call ([README](nori-read/README.md))                                                                                |
| `programs/`     | Solana programs: `nori-read-example`, [`backstop`](programs/backstop) (circuit breaker)                                                                                   |
| `keeper/`       | Backstop keeper CLI and its TS library: create-guards, snapshot, checkpoint, submit, status, assert, unlatch, run                                                         |
| `web/`          | Browser apps: guard status, proven facts, prove a balance, and the bridge dashboard (proof queue and read latency) ([README](web/README.md))                              |
| `test-vectors/` | Test data shared by the TS and Rust tests                                                                                                                                 |
| `test-harness/` | Surfpool helpers for the program tests                                                                                                                                    |
| `scripts/`      | `dry-run.sh` (the whole loop locally), `deploy-devnet.sh` (programs + demo mint), `soak.sh` (keeper for hours, then a report), `replay-wormhole.sh` (Wormhole 2022, live) |
| `docs/`         | [Index of all docs](docs/README.md), diagrams, test deployments                                                                                                           |

## Run

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission
npm install && npm run build
npm test                 # ethereum contracts, then the keeper
npm run test --workspaces --if-present  # the same, plus the web apps' unit tests
npm run lint             # every workspace
cargo test --locked -p nori-read  # Solana-side verification
cargo test --locked -p backstop -p nori-read-example  # the programs on surfpool; cargo build-sbf them first (AGENTS.md)
scripts/dry-run.sh       # the whole loop on local chains, with a fake prover
```

Validator tests and toolchain notes: [AGENTS.md](AGENTS.md).
The Nori SDK comes from npm (`@nori-zk/nori-bridge-solana-sdk` and friends) and,
for Rust, a cargo git dependency, both pinned to one sdk release; TypeScript needs no Rust.

## Apps

Browser apps on Sepolia + Solana devnet ([web/README.md](web/README.md)):

```sh
npm run dev -w web/apps/prove-balance   # prove an address's ETH or token balance on Solana: http://localhost:5180
npm run dev -w web/apps/guard-status    # each Backstop guard in plain words: http://localhost:5181
npm run dev -w web/apps/proven-facts    # what NoriSnapshot read on Ethereum, proven on Solana: http://localhost:5182
npm run dev -w web/dashboards/bridge    # every proof request from Ethereum to Solana, live: http://localhost:7400
```

Every page links to the others along its top; to host them, set their addresses
(`NORI_WEB_*_URL`) as [web/README.md](web/README.md#hosting) says.

## Deploy (Sepolia + Solana devnet)

Keys and addresses live in one `.env`: `cp .env.example .env`, then fill it in.

```sh
# Ethereum: NoriSnapshot on the existing queue, and a demo lockbox
npm run deploy -w ethereum                     # -> ethereum/.env.nori-eth-snapshot
npm run deploy-demo -w ethereum -- 116723.52   # -> ethereum/.env.nori-eth-demo

# Solana: Backstop, nori-read-example, and a demo mint of 116,700 (-> .env.nori-sol-demo); safe to rerun
scripts/deploy-devnet.sh

# Keeper: keeper/keeper.demo.json reads .env and the deploy outputs
npm run keeper -w keeper -- create-guards
npm run keeper -w keeper -- status   # Nori's progress through the queue, then each guard
npm run keeper -w keeper -- run      # snapshots on the heartbeat and as soon as a watched result changes
npm run keeper -w keeper -- assert   # each guard's assert_healthy, as a lender calls it (--send lands it)
npm run keeper -w keeper -- verify <snapshot tx>   # nori-read-example verifies each result, on-chain
```

bridge-head proves `NORI_ETH_PROOF_QUEUE_ADDRESS` and updates `NORI_SOL_TOKEN_PROGRAM_ID`.
Create guards only after that program is initialized: a guard pins it.

## Built vs roadmap

|                                                                                          | Status                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NoriSnapshot (batched reads) and `nori-read`                                             | Built                                                                                                                                                  |
| Backstop guards: trip rule, latch, paused-at-source, stale, `assert_healthy` for lenders | Built                                                                                                                                                  |
| Keeper (`keeper/`), local dry run                                                        | Built                                                                                                                                                  |
| Browser apps: prove a balance, guard status, proven facts, bridge dashboard              | Built (Sepolia + Solana devnet)                                                                                                                        |
| Live loop on Sepolia + Solana devnet                                                     | Prover on real proofs since 7 Oct, keeper in a 7-day soak since 12 Oct ([results](docs/README.md#test-deployments-sepolia--solana-devnet-68-oct-2026)) |
| Separate warn tolerance (in-flight transfers) from the trip tolerance                    | Roadmap (one `tolerance` today)                                                                                                                        |
| Auto-unlatch for Solana-only custody; timelocked admin `unlatch`                         | Roadmap (admin `unlatch` today)                                                                                                                        |
| Check the Solana mint's authority is the expected bridge                                 | Roadmap                                                                                                                                                |
| Direct storage proofs: any slot, no Ethereum transaction                                 | Roadmap                                                                                                                                                |

Direct proofs work because each Nori update already puts Ethereum's state
root on Solana. The hackathon build uses snapshots through the existing proof queue.

## Tempo

[nori-worldsfair-submission-tempo](https://github.com/Nori-zk/nori-worldsfair-submission-tempo)
ports `NoriRead` and Backstop to Solidity on Tempo. Each reader chain has its own proof request
queue and its own Groth16 proof from the same Helios-in-SP1 program, so a similar proof feeds
Tempo. The contracts pass local dry runs (a Sepolia fork and a local Tempo node, with a fake
prover); there is no live Tempo infrastructure for the hackathon, as the team had limited time
and resources to run a second one. The token-migration app is still being worked on.

## What was built during the hackathon

Before the World's Fair started on 14 Sep 2026, Nori had its prover,
[nori-bridge-head](https://github.com/Nori-zk/nori-bridge-head) (Helios inside SP1, a fork of
Succinct's sp1-helios), and its SP1 v6 fork of Succinct's
[sp1-solana](https://github.com/Nori-zk/sp1-solana), the Groth16 verifier, used as is;
[nori-solana-sdk](https://github.com/Nori-zk/nori-solana-sdk) held a 332-line stub program.
Built during the hackathon, from 14 Sep on: the prover's port to Solana and Tempo, the SDK's
real work (the light-client program, proof submission, the TypeScript SDK), and everything in
this repo: NoriSnapshot, `nori-read`, Backstop, the keeper and the four web apps.
