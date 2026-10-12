# Read any Ethereum view function from Solana

The full quickstart. The [README](../README.md#quickstart-read-any-ethereum-view-function-from-solana) has the short form.

`NoriSnapshot` runs view calls on Sepolia (`eth_call`s that return one 32-byte word, up to 256 at
once) and commits their results under one root that Nori proves to Solana; `nori-read` checks one
result inside your program for about 3,200 CU.

**1. On your machine, no keys (about 4 min).** Needs Rust via rustup (`rust-toolchain.toml` pins
1.98.0), solana-cli 3.1 or later whose `cargo build-sbf --version` shows platform-tools v1.54
(else add `--tools-version v1.54`), and surfpool 1.5 or later. No npm needed.

```sh
git clone https://github.com/Nori-zk/nori-worldsfair-submission && cd nori-worldsfair-submission
export CFLAGS="-isystem $HOME/.cache/solana/v1.54/platform-tools/llvm/sbpf/include"
cargo build-sbf --manifest-path programs/nori-read-example/Cargo.toml   # ~1 min
cargo test --locked -p nori-read-example -- --nocapture                # ~3 min
```

The test deploys `nori-read-example` on surfpool, plants a proof queue batch as Nori's `update`
writes it, verifies the 10 results of a mainnet snapshot on-chain (3,184–3,205 CU each), and
rejects a forged result and a batch account the Nori program does not own.

**2. A live read, Sepolia → Solana devnet (about 20 min, mostly Ethereum finality).** Needs a
Sepolia key with a little ETH (a snapshot is ~740k gas); no Solana wallet or SOL. Start with
`npm ci && npm run build` (Node 23 or later).

- **A balance, in the browser:** `npm run dev -w web/apps/prove-balance`, open
  http://localhost:5180, connect MetaMask on Sepolia, pick ETH or any ERC-20 and any holder, then
  "Prove on Solana". The app follows the proof (~18 min) and verifies the balance on Solana by
  simulating `nori-read-example`: no signature, no fee.
- **Any view call, from the CLI** (one `--target`, `--signature` and comma-separated `--args`):

```sh
cp .env.example .env    # then set ETH_PRIVATE_KEY (0x-hex) to your Sepolia key
echo NORI_ETH_SNAPSHOT_ADDRESS=0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340 >> .env
npm run preview-snapshot -w ethereum -- --target 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 --signature 'totalSupply()'  # read-only
npm run snapshot -w ethereum -- --target 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 --signature 'totalSupply()'  # one transaction
npm run dev -w web/apps/proven-facts    # http://localhost:5182: once proven, [ Verify on Solana ]
```

Proven facts shows it as "Query 0x… returned …" and verifies it by simulation. To record the check
in a Solana transaction: `npm run keeper -w keeper -- verify <snapshot tx>` (devnet SOL; see Deploy).

**3. In your own program**, as [`nori-read-example`](../programs/nori-read-example/src/lib.rs) does:

```rust
let batch = load_proof_queue_batch(&ctx.accounts.proof_queue_batch, &NORI_PROGRAM_ID)
    .map_err(|_| error!(MyError::UntrustedBatch))?;
let proven = verify_snapshot_result(&batch, &NORI_SNAPSHOT, &QUERY_ID, &witness)
    .map_err(|_| error!(MyError::InvalidRead))?;
// proven.result, proven.eth_block_number, proven.eth_timestamp
```

Pin the Nori program, `NoriSnapshot` and your query ids, reject stale results ([nori-read](../nori-read/README.md));
build the witness from the `Snapshot` event (`snapshotResultWitness` in [`keeper/`](../keeper)).

**What a live read proves:** the result is what the view returned at an Ethereum block that Helios,
inside SP1, saw finalized; Nori's light client verifies the SP1 Groth16 proof on Solana, and
`nori-read` the result's Merkle path to the proven root. No signers, oracles or relayers in
between. Path 1 plants the batch instead of proving it.
