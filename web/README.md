# web: browser apps

Two apps on Sepolia + Solana devnet, built with [yaw](https://yaw-rx.github.io/) and
[ystate](https://ystate.github.io/) on the Nori SDK. Each app's flow is a ystate graph,
drawn next to it (`ProveBalanceGraph.svg`, `BridgeBatchesGraph.svg`).

| Package                  | What                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/prove-balance`     | Prove on Solana what an Ethereum address holds: one `NoriSnapshot` transaction from your wallet, proven and verified on Solana |
| `dashboards/bridge`      | The whole proof queue: every batch Nori has settled on Solana, the requests still waiting, and the stage Nori's prover is in   |
| `libs/ui`                | Shared: wallet and connection buttons, the connection status bar, following a proof request, Nori's page layout and look       |
| `.env.example`, `env.ts` | Public build constants: the template, and their checks (values below)                                                          |

```sh
cp web/.env.example web/.env            # once (gitignored), then fill it in from the table below
npm run dev -w web/apps/prove-balance   # http://localhost:5180
npm run dev -w web/dashboards/bridge    # http://localhost:7400
```

`build`, `build:ssg` (static pages) and `preview` work the same way. Values for Sepolia + devnet
(addresses: [docs/README.md](../docs/README.md)); everything in `.env` reaches the browser:

| Name                                | Value                                          |
| ----------------------------------- | ---------------------------------------------- |
| `NORI_WEB_ETH_CHAIN_ID`             | `11155111`                                     |
| `NORI_WEB_ETH_RPC_URL`              | `https://sepolia.gateway.tenderly.co`          |
| `NORI_ETH_PROOF_QUEUE_ADDRESS`      | `0x9AeAc0174f7bDf397C6dB1f62c120E8170e5B87e`   |
| `NORI_WEB_PROOF_QUEUE_DEPLOY_BLOCK` | `11856173`                                     |
| `NORI_ETH_SNAPSHOT_ADDRESS`         | `0xC377EbBF516a9DB2Fe5AEB65fA19D4dca1717340`   |
| `NORI_WEB_SOLANA_CLUSTER`           | `devnet`                                       |
| `NORI_SOL_TOKEN_PROGRAM_ID`         | `EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg` |
| `NORI_WEB_SOLANA_FEE_PAYER`         | `EuRkxPWMLFrNqzNFZYsC7JQZhNewxLfLz3aQFVzts27Y` |
| `NORI_WEB_BRIDGE_WSS_URL`           | `wss://wss.solana.nori.it.com`                 |

## Prove balance

Connect an Ethereum wallet. The app asks you to install MetaMask if you have none, to pick
one if you have several, and to switch to Sepolia if needed. The form starts with your
account and ETH; choose ETH, a listed token or any ERC-20 address, and any holder. The app
reads the balance with the same view call the snapshot will make (ETH through Multicall3's
`getEthBalance`, tokens through `balanceOf`) and shows it with the snapshot fee.

"Prove on Solana" sends one `NoriSnapshot` transaction, which enqueues a proof request. The
app then follows it: found on Ethereum, waiting for finality, waiting for the batch ahead,
being proven, and settled in a batch on Solana. A declined signature, a failed read or a
dropped connection is shown, and you carry on from there.

Once the batch lands, the app verifies the balance on Solana: it builds the result's witness
(`verifySnapshotResult` in [`client/`](../client/README.md)) and simulates
[`nori-read-example`](../programs/nori-read-example/src/lib.rs)'s `read_snapshot_result`. It
shows what the program verified: the balance, the Ethereum block and its time, the Nori batch,
and the compute units (~2.5k). A simulation needs no wallet and no fee; it names
`NORI_WEB_SOLANA_FEE_PAYER` as fee payer, which signs and pays nothing. Any Solana program can
make the same check with [`nori-read`](../nori-read/README.md). To record it on-chain, with a
transaction to link to: `npm run keeper -w client -- verify <snapshot tx>`.

## Bridge dashboard

Batches Nori has settled on Solana, newest first. Above them, the requests no batch covers
yet, in three rows: waiting for Ethereum finality, scheduled for processing, and processing
in Nori's current job, each with a countdown. Open a batch or a row to see its requests,
each with the submitting contract and the enqueuing transaction, linked to Etherscan.

Filter by contract in the box, or share a filtered view as `?target=<address>`.
`?synthetic` fills the waiting rows with made-up requests, to preview the layout.

Conventions, toolchain and editor setup for this folder: [AGENTS.md](AGENTS.md).
