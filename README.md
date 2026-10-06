# Nori: World's Fair submission

Read Ethereum state from any Solana program, proven instead of relayed.

![How a read works](docs/how-it-works.drawio.png)

## Repo

| Path | What |
| --- | --- |
| `ethereum/` | `NoriSnapshot` contract, query list, deploy and snapshot tasks |
| `nori-read/` | Rust crate: verify a snapshot result on Solana in one call |
| `programs/` | Solana programs: `nori-read-example`, [`backstop`](programs/backstop) (circuit breaker) |
| `client/` | Sample TS client: snapshot transaction to Backstop `submit_read` |
| `test-vectors/` | Test data shared by the TS and Rust tests |
| `sdk/`, `bridge-head/` | Submodules: Nori Solana SDK and the prover |
| `docs/` | Diagrams (`.drawio`, editable) |

## Run

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission --recursive
npm install && npm run build
npm test                 # Ethereum contracts
cargo test -p nori-read  # Solana-side verification
```

Validator tests and toolchain notes: [AGENTS.md](AGENTS.md).

**Roadmap:** each Nori update already puts Ethereum's state root on Solana,
so storage proofs could be checked directly, with no Ethereum transaction.
The hackathon build uses snapshots through the existing proof queue.
