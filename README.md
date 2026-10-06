# Nori: World's Fair submission

Read Ethereum state from any Solana program, proven instead of relayed.

![How a read works](docs/how-it-works.drawio.png)

## Repo

| Path | What |
| --- | --- |
| `ethereum/` | `NoriSnapshot` contract, query list, deploy and snapshot tasks |
| `nori-read/` | Rust crate: verify a snapshot result on Solana in one call |
| `programs/` | Solana programs: `nori-read-example`, [`backstop`](programs/backstop) (circuit breaker) |
| `client/` | Sample TS client and keeper CLI (snapshot, checkpoint, submit, status) |
| `test-vectors/` | Test data shared by the TS and Rust tests |
| `sdk/`, `bridge-head/` | Submodules: Nori Solana SDK and the prover |
| `docs/` | Diagrams (`.drawio`, editable) |

## Run

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission --recursive
npm install && npm run build
npm test                 # Ethereum contracts
cargo test -p nori-read  # Solana-side verification
scripts/dry-run.sh       # the whole loop on local chains, with a fake prover
```

Validator tests and toolchain notes: [AGENTS.md](AGENTS.md).

## Deploy (Sepolia + Solana devnet)

Keys and addresses live in one `.env`: `cp .env.example .env`, then fill it in.

```sh
set -a; . ./.env; set +a     # for the solana and spl-token commands below

# Ethereum: NoriSnapshot on the existing queue, and a demo lockbox
npm run deploy -w ethereum                     # -> ethereum/.env.nori-eth-snapshot
npm run deploy-demo -w ethereum -- 116723.52   # -> ethereum/.env.nori-eth-demo

# Solana: Backstop, and a demo mint (put it in .env as BACKSTOP_DEMO_MINT)
cargo build-sbf --manifest-path programs/backstop/Cargo.toml
solana program deploy target/deploy/backstop.so --program-id programs/backstop/backstop-keypair.json \
  -k $SOLANA_PAYER_KEYPAIR_PATH -u $SOLANA_RPC_NETWORK_URL
spl-token create-token --decimals 9 -u $SOLANA_RPC_NETWORK_URL --fee-payer $SOLANA_PAYER_KEYPAIR_PATH --mint-authority $SOLANA_PAYER_KEYPAIR_PATH
spl-token create-account <mint> -u $SOLANA_RPC_NETWORK_URL --owner $SOLANA_PAYER_KEYPAIR_PATH --fee-payer $SOLANA_PAYER_KEYPAIR_PATH
spl-token mint <mint> 116700 -u $SOLANA_RPC_NETWORK_URL --mint-authority $SOLANA_PAYER_KEYPAIR_PATH --fee-payer $SOLANA_PAYER_KEYPAIR_PATH

# Keeper: client/keeper.demo.json reads .env and the deploy outputs
npm run keeper -w client -- create-guards
npm run keeper -w client -- run
```

bridge-head proves `NORI_ETH_PROOF_QUEUE_ADDRESS` and updates `NORI_SOL_TOKEN_PROGRAM_ID`.
Create guards only after that program is initialized: a guard pins it.

**Roadmap:** each Nori update already puts Ethereum's state root on Solana,
so storage proofs could be checked directly, with no Ethereum transaction.
The hackathon build uses snapshots through the existing proof queue.
