# Nori: World's Fair submission

Read Ethereum state from any Solana program, proven instead of relayed.

![How a read works](docs/how-it-works.drawio.png)

## Repo

| Path                   | What                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ethereum/`            | `NoriSnapshot` contract, query list, deploy and snapshot tasks                             |
| `nori-read/`           | Rust crate: verify a snapshot result on Solana in one call ([README](nori-read/README.md)) |
| `programs/`            | Solana programs: `nori-read-example`, [`backstop`](programs/backstop) (circuit breaker)    |
| `client/`              | Sample TS client and keeper CLI (snapshot, checkpoint, submit, status)                     |
| `web/apps/prove-balance` | Browser app where anyone proves on Solana what an Ethereum address holds: it sends one `NoriSnapshot` transaction from your wallet and follows the proof request until its batch is settled on Solana ([Prove balance](#prove-balance)) |
| `web/dashboards/bridge` | Browser dashboard of the whole proof queue: every batch Nori has settled on Solana, the proof requests still waiting and the stage Nori's prover is in ([Bridge dashboard](#bridge-dashboard)) |
| `web/libs/ui` | Shared by the apps: the wallet and connection buttons, the connection status bar, following a proof request, and Nori's page layout and look |
| `web/.env` | The public settings the apps are built with: the Ethereum chain id and RPC URL, the proof request queue and the block it was deployed in, `NoriSnapshot`, the Solana cluster, the Nori program on Solana, and Nori's websocket |
| `test-vectors/`        | Test data shared by the TS and Rust tests                                                  |
| `test-harness/`        | Surfpool helpers for the program tests                                                     |
| `scripts/`             | `dry-run.sh` (the whole loop locally), `deploy-devnet.sh` (Backstop + demo mint)           |
| `sdk/`, `bridge-head/` | Submodules: Nori Solana SDK and the prover                                                 |
| `docs/`                | [Index of all docs](docs/README.md), diagrams, test deployments                            |

## Run

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission --recursive
npm install && npm run build
npm test                 # ethereum contracts, then the client
npm run typecheck        # every workspace
npm run lint             # every workspace
cargo test -p nori-read  # Solana-side verification
scripts/dry-run.sh       # the whole loop on local chains, with a fake prover
```

Validator tests and toolchain notes: [AGENTS.md](AGENTS.md).

## Apps

The apps in `web/` run in the browser. They read Ethereum (Sepolia) through your browser wallet and Solana (devnet) through its public endpoint, using the contract and program addresses in [web/.env](web/.env). Each one is started with its own `dev` script and opens on its own port.

### Prove balance

Prove on Solana what an Ethereum address holds.

**Using it.** Open the app and connect your Ethereum wallet. If you have none it asks you to install MetaMask, if you have several it lets you choose one, and if the wallet is on the wrong chain it asks it to switch to Sepolia. The form then starts with your own account and ETH. You can choose ETH, one of the chain's listed tokens, or paste any ERC-20 token address, and type any Ethereum address as the holder. As soon as both are valid the app reads the balance with the same view call the snapshot will make, and shows it with the snapshot fee. When you press "Prove on Solana", your wallet asks you to confirm one `NoriSnapshot` transaction, which enqueues a proof request for that balance. The app then follows the proof request. It shows the request being found on Ethereum, waiting for Ethereum finality, waiting for the batch ahead of it, being proven by Nori, and finally the batch that covers it being settled on Solana. If you decline in your wallet, a read fails or a connection drops, the app says so and lets you carry on from there.

**What you get.** The balance of that address, as Ethereum held it at that block, is committed on Ethereum by `NoriSnapshot` and proven on Solana in a settled batch. Any Solana program can now verify that balance with [`nori-read`](nori-read/README.md), without trusting a relayer.

```sh
npm run dev -w web/apps/prove-balance   # then open http://localhost:5180
```

### Bridge dashboard

Watch every proof request travel from Ethereum to Solana.

**Using it.** The dashboard lists the batches Nori has settled on Solana, newest first. The top row is the run Nori is on now. It shows the proof requests that no batch covers yet, the Ethereum block Nori is proving up to, and a bar with the stage Nori's prover is in and the time it expects to need. Open any batch to see its proof requests, each with the contract that submitted it and the transaction that enqueued it, linked to Etherscan. Type a contract address into the filter to see only that contract's proof requests, or open the page with `?target=<address>` to share that view.

**What you get.** A live view of the whole proof queue. You can see where any proof request is, which batch settled it on Solana, and whether a contract's proof requests are proven yet.

```sh
npm run dev -w web/dashboards/bridge    # then open http://localhost:7400
```

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

**Roadmap:** each Nori update already puts Ethereum's state root on Solana,
so storage proofs could be checked directly, with no Ethereum transaction.
The hackathon build uses snapshots through the existing proof queue.
