# web: browser apps

Four apps on Sepolia + Solana devnet, built with [yaw](https://yaw-rx.github.io/) and
[ystate](https://ystate.github.io/) on the Nori SDK. Prove balance's flow is a ystate graph,
drawn next to it (`machines/ProveBalanceGraph.svg`); the bridge dashboard shows the sdk's batches
machines; Guard status and Proven facts show the shared reads, each a machine in `libs/ui`.

| Package              | What                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/prove-balance` | Prove on Solana what an Ethereum address holds: one `NoriSnapshot` transaction from your wallet, proven and verified on Solana                                                                                    |
| `apps/guard-status`  | Each Backstop guard in plain words: is the bridged asset safe to accept now, and what would a lender's deposit get                                                                                                |
| `apps/proven-facts`  | Every `NoriSnapshot` read, told in sentences, whether Nori has proven it on Solana, a one-click verify, and how fast reads land                                                                                   |
| `dashboards/bridge`  | The whole proof queue: every batch Nori has settled on Solana, the requests still waiting, the stage Nori's prover is in, and how long reads take                                                                 |
| `libs/ui`            | Shared: wallet and connection buttons, the connection status bar, following a proof request, Nori's page layout and look                                                                                          |
| `.env`, `env.ts`     | Public build constants: chain id, Ethereum RPC, proof queue and its deploy block, `NoriSnapshot`, Solana cluster and an optional dedicated RPC, Nori program, the verify simulation's fee payer, Nori's websocket |

```sh
npm run dev -w web/apps/prove-balance   # http://localhost:5180
npm run dev -w web/apps/guard-status    # http://localhost:5181
npm run dev -w web/apps/proven-facts    # http://localhost:5182
npm run dev -w web/dashboards/bridge    # http://localhost:7400
```

`build`, `build:ssg` (pre-rendered pages: not needed to host, and the dashboard's fails on its
live batch rows) and `preview` work the same way. After a redeploy, update
the addresses in `web/.env` (committed: public values only; everything in it reaches the browser).

### Hosting

Each app is a static site: build it and serve its `dist/` at the root of its own domain or
subdomain (the build's asset paths are absolute). The apps import `keeper/`, so build it first:

```sh
npm ci && npm run build -w keeper
npm run build -w web/dashboards/bridge    # → web/dashboards/bridge/dist
npm run build -w web/apps/prove-balance   # → web/apps/prove-balance/dist
npm run build -w web/apps/guard-status    # → web/apps/guard-status/dist
npm run build -w web/apps/proven-facts    # → web/apps/proven-facts/dist
```

For dedicated RPCs, set `NORI_WEB_ETH_RPC_URL` (the dashboard's Ethereum reads without a wallet;
Prove balance reads through the wallet) and `NORI_WEB_SOLANA_RPC_URL` (both apps; checked
against the cluster's genesis) in the host's build environment rather than `web/.env`. They are
built into the page, so anyone can read them: restrict each key to your domains at the provider.

Every page links to the others along its top. Set each one's hosted address there too:
`NORI_WEB_PROVE_BALANCE_URL`, `NORI_WEB_GUARD_STATUS_URL`, `NORI_WEB_PROVEN_FACTS_URL` and
`NORI_WEB_DASHBOARD_URL` (`web/.env` has the dev servers'), and `NORI_WEB_TEMPO_DASHBOARD_URL`,
the Tempo submission's bridge dashboard, linked only when set.

## Prove balance

Connect an Ethereum wallet. The app asks you to install MetaMask if you have none, to pick
one if you have several, and to switch to Sepolia if needed. The form starts with your
account and ETH; choose ETH, a listed token or any ERC-20 address, and any holder. The app
reads the balance with the same view call the snapshot will make (ETH through Multicall3's
`getEthBalance`, tokens through `balanceOf`) and shows it with the snapshot fee.

"Prove on Solana" sends one `NoriSnapshot` transaction, which enqueues a proof request. The
app then follows it: found on Ethereum, waiting for finality, waiting for the batch ahead,
being proven, and settled in a batch on Solana, on one bar for the whole wait with the time left
until Solana. The bar measures from the block that enqueued the request against one total, the
first estimate, extended only if the bridge's estimate later runs past it, so it fills steadily;
the tab keeps the total (`sessionStorage`), so a reload keeps the bar.
A declined signature, a failed read or a dropped connection is shown, and you carry on from there. The
page's URL holds the snapshot transaction (`?tx=<hash>`) while it is proven, so a reload or the
link picks the same proof up again once the wallet is connected.

Once the batch lands, the app verifies the balance on Solana: it builds the result's witness
(`createSnapshotVerificationMachine` in [`keeper/`](../keeper/README.md)) and simulates
[`nori-read-example`](../programs/nori-read-example/src/lib.rs)'s `read_snapshot_result`. It
shows what the program verified: the balance, the Ethereum block and its time, the Nori batch,
and the compute units (under 3k). A simulation needs no wallet and no fee; it names
`NORI_WEB_SOLANA_FEE_PAYER` as fee payer, which signs and pays nothing. Any Solana program can
make the same check with [`nori-read`](../nori-read/README.md). To record it on-chain, with a
transaction to link to: `npm run keeper -w keeper -- verify <snapshot tx>`.

## Guard status

One card per Backstop guard on the cluster, for a lender or integrator asking whether a bridged
asset is safe to accept right now. Each card says the guard's status (HEALTHY, WARN, STALE,
PAUSED, TRIPPED) and what it means in one sentence, the backing Nori last proved on Ethereum
(with its block and age) against the mint's live supply on Solana, and whether a lender's
deposit would go through. The guards a lender can use come first, then tripped and paused ones,
then stale ones. Read from Solana every 30 seconds; no keeper running means STALE. The stale
guards fold into one line under the others, `▸ 3 guards with no recent backing`, which shows
their cards on a click (shown from the start when `?guard=` names one, or every guard is stale).

`[ Check my deposit ]` simulates a lender's deposit against that guard: one `assert_healthy` by
CPI, no wallet, no fee, one request. It reads `Your deposit would be allowed (N CU).` or
`Your deposit would be blocked: <error>.`

`▸ How this is checked` opens the guard's settings in a sentence (its backing and pause queries,
window, tolerance, staleness and checkpoints), the trip rule re-run on the checkpoints it keeps,
and links to the guard, its admin, NoriSnapshot and the Nori program. `?guard=<address>` opens
it on load. The Demo, Shadow and Test A and B mints are named from the devnet deployment in
[docs/README.md](../docs/README.md); other mints read `Mint <address>`.

```sh
npm run dev -w web/apps/guard-status # http://localhost:5181
npm run test -w web/apps/guard-status # the cards' sentences
```

## Proven facts

```sh
npm run dev -w web/apps/proven-facts   # http://localhost:5182
```

What `NoriSnapshot` read on Ethereum, proven on Solana, for someone seeing Nori for the first
time. No wallet needed: Ethereum reads fall back to `NORI_WEB_ETH_RPC_URL`.

At the top, one line: how long a read takes from its Ethereum block to the Solana transaction
that lands its batch, as the median over the reads in the 30 newest batches, with p90, fastest
and slowest under it. These are the numbers the dashboard's Latency tab shows; the tab, linked
from the line, lists every read, at `NORI_WEB_DASHBOARD_URL`.

Below it, the 25 newest snapshots, newest first. Each says when and at which Ethereum block its
view calls ran, whether Nori has proven it on Solana yet, and what they returned, one line per
mint, named as Guard status names it: `Demo lockbox · held 116,723.52 · not paused · verified on
Solana ↗ ↗`, the links being the keeper's newest two `submit_read`s by a guard reading that
lockbox, found with no memo as the successful transactions on both the snapshot's batch account
(one read per proven snapshot shown) and the guard (its newest 500). A query no guard names
reads as `Query 0x1234…abcd returned 42`. The list shows the newest 8; `[ Show older ]` adds 8 more at a
time, and once all 25 show, a line links to NoriSnapshot's events on the explorer for the rest.

On a proven snapshot, `[ Verify on Solana ]` checks one result (the backing, else the first)
by simulating `nori-read-example` against the proven batch, as Prove balance does: no wallet,
no fee, one simulation per click. `[ Read again ]` reads the line and the snapshots again.

## Bridge dashboard

Two tabs. **Proof queue**: batches Nori has settled on Solana, newest first. Above them, the
requests no batch covers yet, in three rows: waiting for Ethereum finality, scheduled for
processing, and processing in Nori's current job, each with a countdown. The waiting rows'
bars share one scale, from the request's Ethereum block to its commit on Solana. Open a batch or a row to see its requests, each with the submitting contract and the
enqueuing transaction, linked to Etherscan.

**Latency** (`?view=latency`): every `NoriSnapshot` read in the 30 newest batches, newest
first, each from its Ethereum block time to the Solana transaction that landed its batch, in
minutes and against the median (above p90 in the warning colour), with the median, p90, min
and max. A batch landed in the newest successful Nori `update` on its account. Read when the
tab opens and on `[ Read again ]`.

Under both, Nori's loop: the stage it is in, over a bar that fills through each epoch
until its next job.

Filter by contract in the box, or share a filtered view as `?target=<address>`.
`?synthetic` fills the waiting rows with made-up requests, to preview the layout.

Conventions, toolchain and editor setup for this folder: [AGENTS.md](AGENTS.md).
