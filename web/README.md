# web: browser apps

Two apps on Sepolia + Solana devnet, built with [yaw](https://yaw-rx.github.io/) and
[ystate](https://ystate.github.io/) on the Nori SDK. Each app's flow is a ystate graph,
drawn next to it (`ProveBalanceGraph.svg`, `BridgeBatchesGraph.svg`).

| Package              | What                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/prove-balance` | Prove on Solana what an Ethereum address holds: one `NoriSnapshot` transaction from your wallet, proven and verified on Solana                                                                                    |
| `dashboards/bridge`  | The whole proof queue: every batch Nori has settled on Solana, the requests still waiting, the stage Nori's prover is in, and how long reads take                                                                 |
| `libs/ui`            | Shared: wallet and connection buttons, the connection status bar, following a proof request, Nori's page layout and look                                                                                          |
| `.env`, `env.ts`     | Public build constants: chain id, Ethereum RPC, proof queue and its deploy block, `NoriSnapshot`, Solana cluster and an optional dedicated RPC, Nori program, the verify simulation's fee payer, Nori's websocket |

```sh
npm run dev -w web/apps/prove-balance   # http://localhost:5180
npm run dev -w web/dashboards/bridge    # http://localhost:7400
```

`build`, `build:ssg` (pre-rendered pages: not needed to host, and the dashboard's fails on its
live batch rows) and `preview` work the same way. After a redeploy, update
the addresses in `web/.env` (committed: public values only; everything in it reaches the browser).

### Hosting

Each app is a static site: build it and serve its `dist/` at the root of its own domain or
subdomain (the build's asset paths are absolute). The apps import the client, so build it first:

```sh
npm ci && npm run build -w client
npm run build -w web/dashboards/bridge    # → web/dashboards/bridge/dist
npm run build -w web/apps/prove-balance   # → web/apps/prove-balance/dist
```

For dedicated RPCs, set `NORI_WEB_ETH_RPC_URL` (the dashboard's Ethereum reads without a wallet;
Prove balance reads through the wallet) and `NORI_WEB_SOLANA_RPC_URL` (both apps; checked
against the cluster's genesis) in the host's build environment rather than `web/.env`. They are
built into the page, so anyone can read them: restrict each key to your domains at the provider.

## Prove balance

Connect an Ethereum wallet. The app asks you to install MetaMask if you have none, to pick
one if you have several, and to switch to Sepolia if needed. The form starts with your
account and ETH; choose ETH, a listed token or any ERC-20 address, and any holder. The app
reads the balance with the same view call the snapshot will make (ETH through Multicall3's
`getEthBalance`, tokens through `balanceOf`) and shows it with the snapshot fee.

"Prove on Solana" sends one `NoriSnapshot` transaction, which enqueues a proof request. The
app then follows it: found on Ethereum, waiting for finality, waiting for the batch ahead,
being proven, and settled in a batch on Solana, on one bar for the whole wait with the time left
until Solana. A declined signature, a failed read or a dropped connection is shown, and you carry on from there. The
page's URL holds the snapshot transaction (`?tx=<hash>`) while it is proven, so a reload or the
link picks the same proof up again once the wallet is connected.

Once the batch lands, the app verifies the balance on Solana: it builds the result's witness
(`verifySnapshotResult` in [`client/`](../client/README.md)) and simulates
[`nori-read-example`](../programs/nori-read-example/src/lib.rs)'s `read_snapshot_result`. It
shows what the program verified: the balance, the Ethereum block and its time, the Nori batch,
and the compute units (~2.5k). A simulation needs no wallet and no fee; it names
`NORI_WEB_SOLANA_FEE_PAYER` as fee payer, which signs and pays nothing. Any Solana program can
make the same check with [`nori-read`](../nori-read/README.md). To record it on-chain, with a
transaction to link to: `npm run keeper -w client -- verify <snapshot tx>`.

## Bridge dashboard

Two tabs. **Proof queue**: batches Nori has settled on Solana, newest first. Above them, the
requests no batch covers yet, in three rows: waiting for Ethereum finality, scheduled for
processing, and processing in Nori's current job, each with a countdown. Open a batch or a row
to see its requests, each with the submitting contract and the enqueuing transaction, linked
to Etherscan.

**Latency** (`?view=latency`): every `NoriSnapshot` read in the 30 newest batches, newest
first, each from its Ethereum block time to the Solana transaction that landed its batch, in
minutes, with the median, p90, min and max. A batch landed in the newest successful Nori
`update` on its account. Read when the tab opens and on `[ Read again ]`.

Under both, Nori's loop: the stage it is in, over a bar that fills through each epoch
until its next job.

Filter by contract in the box, or share a filtered view as `?target=<address>`.
`?synthetic` fills the waiting rows with made-up requests, to preview the layout.

Conventions, toolchain and editor setup for this folder: [AGENTS.md](AGENTS.md).
