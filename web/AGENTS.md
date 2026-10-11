# web/AGENTS.md

The browser apps ([README](README.md)), built with yaw + ystate. The root
[AGENTS.md](../AGENTS.md) (commands, repo-wide rules) applies here too.

## Required reading

At the start of every new session, before anything else, prompt the user to have you read everything below, every cited file and link. Doing anything else first is irresponsible.

Read all of it, in full, before any work in a session, and tell the user what you have read. Grepping or skimming parts does not count. Code written before reading invents what already exists.

- This repo: [AGENTS.md](../AGENTS.md), [README.md](../README.md), [docs/README.md](../docs/README.md), [docs/how-it-works.drawio.png](../docs/how-it-works.drawio.png), [ethereum/README.md](../ethereum/README.md), every contract in `ethereum/contracts/` (`NoriSnapshot.sol`, `interfaces/INoriProofRequestQueue.sol`, `demo/DemoLockbox.sol`, and the test contracts in `test/`), [nori-read/README.md](../nori-read/README.md), [programs/backstop/README.md](../programs/backstop/README.md), [client/README.md](../client/README.md), [web/README.md](README.md).
- The sdk: read the sibling checkout `../nori-solana-sdk`, at the pinned commit (root AGENTS.md, Quirks: one sdk release). Use what the sdk exports before writing anything of your own; changing it follows its AGENTS.md procedure. In `../nori-solana-sdk`:
    - `AGENTS.md`, `README.md`, `sdk/README.md`
    - `ethereum/contracts/NoriProofRequestQueue.sol`, `ethereum/contracts/NoriTokenBridge.sol`
    - The Solana program: every file in `programs/token/src/`
    - `sdk/src/index.ts`; `sdk/src/api/` `connections.ts`, `ethereum.ts`, `solana.ts`, `nori.ts`, `proofRequests.ts`, `proofQueue.ts`; `sdk/src/utils/` (`@nori-zk/nori-bridge-solana-sdk/utils`) `index.ts`, `machines.ts`, `messageOf.ts`, `arrays.ts`
    - The read shape every value is built on, and one machine on it end to end: `sdk/src/rpc/connection/readThroughConnections.ts` and `.impl.ts` (with `readMachineValue$` and `readMachineChanged$`, one read machine gated on another), `sdk/src/rpc/connection/chainChanges.ts` and `.impl.ts`, `sdk/src/rpc/solana/solanaChanges.impl.ts`, then `sdk/src/proofQueue/bridgeState.ts` and `.impl.ts`
    - Machines, each graph with its `.impl.ts`:
        - `sdk/src/proofRequest/`: `proofRequest`, `proofRequestOfTransaction`, `unprocessed`, `proofRequestWitness`, `proofRequestBlockTime`, `proofRequestHistory`, `latestProofRequests`, `proofRequestCounts`
        - `sdk/src/proofQueue/`: `bridgeState`, `ethereumBlocks`, `proofQueueHead`, `proofQueueBatches`, `proofQueueBatchRequests`, `committedProofQueueBatches`
        - `sdk/src/transaction/`: `sentTransaction` and `signerTransaction` (Ethereum), `solanaTransaction`, `solanaSignerTransaction` and `solanaWalletTransaction`, `signatureStatus`
        - `sdk/src/solana/` (`account`, `transactionLogs`), `sdk/src/tokenBridge/` (`mintedSoFar`, `tokenBalance`)
        - `sdk/src/rpc/connection/`: `network`, `httpConnection`, `websocketConnection`, `connectionStatus`, `transactionReceipt`, `walletTransaction`; `sdk/src/rpc/eth/` `ethereumWallet`, `walletAccount`; `sdk/src/rpc/solana/solanaWallet`; `sdk/src/rpc/nori/noriBridgeInfraTransitions`
    - Connections and reads: `sdk/src/rpc/connection/` `connections.ts`, `connectionNotReady.ts`, `healthCheckTimings.ts`, `websocket.ts`, `jsonRpcTopic.ts`; `sdk/src/proofRequest/` `connectedRead.ts`, `getProofRequestStateSnapshot.ts`, `fetchProofRequestHistory.ts`, `proofRequestSnapshots.ts`, `waitingProofRequests.ts`, `types.ts`
    - The lowest steps, one RPC call each, that a read is built from: `sdk/src/rpc/eth/` `ethRpcRead.ts`, `blockRanges.ts`, `blockNumber.ts`, `blockTimestamp.ts`, `enqueuedProofRequests.ts`, `proofRequest.ts`, `proofRequestsByTarget.ts`, `proofRequestBatch.ts`, `proofQueueHead.ts`, `transactionReceipt.ts`, `topics.ts`, `errors.ts`, `eip1193.ts`, `ethereumHttp.ts`, `ethereumWebsocket.ts`, `walletSubscriptions.ts`; `sdk/src/rpc/solana/` `solanaRpcRead.ts`, `programAddresses.ts`, `bridgeState.ts`, `proofQueueBatches.ts`, `proofQueueBatchSummaries.ts`, `proofQueueBatchCovering.ts`, `account.ts`, `signatureStatus.ts`, `transactionLogs.ts`, `slots.ts`, `accountChecks.ts`, `errors.ts`, `solanaHttp.ts`, `solanaWebsocket.ts`
    - Nori websocket: `sdk/src/rpc/nori/` `noriWebsocket.ts`, `topics.ts`, `state.ts`, `proofRequest.ts`, `commitTimes.ts`
- ystate: the whole [README](https://github.com/yaw-rx/ystate/blob/main/packages/ystate/README.md) and the studio's [default-workspaces.ts](https://github.com/yaw-rx/ystate/blob/main/packages/studio/src/app-root/default-workspaces.ts) (local: `../yaw/ystate`).
- yaw: [yaw-example](https://github.com/yaw-rx/yaw/tree/main/packages/yaw-example) and the [docs](https://yaw-rx.github.io/docs/) (local: `../yaw/yaw`).
- This file, then the "web/ (yaw + ystate)" section again before any `web/` change.

## Quirks

- `web/`: run only each package's scripts (`lint`, `typecheck`, `build`, `dev`). Prefer `npm run lint` for checking code: `typecheck` also runs, but it reports spurious errors on code the yaw ts-patch transformer leaves untransformed. Every `web/` tsconfig is `noEmit`: a bare `tsc` in a yaw package can write `.js` next to the sources, which Vite then serves instead of the yaw-transformed `.ts`. `libs/ui` ships its TypeScript source (`exports` → `src/index.ts`) and each app's Vite compiles it with its `.css`; `tsc` never copies `.css`. `prepare` runs `ts-patch install` so `tsc` applies the yaw transformer (`@state` accessors, `x$` subjects); ts-patch 4 needs TypeScript 6, so stay on ts-patch 3.
- `web/` unit tests: `npm run test -w web/libs/ui` runs `src/**/*.test.ts` under `node --test`, with `web/test/resolve-ts.mjs` preloaded to map the browser's `.js` imports onto the `.ts` sources and define `NORI_WEB_ENV`. Test plain functions only; components need the yaw transformer.
- `web/` dev server: `viteAssets` imports each `.css` as `…css?raw-asset`, and `web/plugins/vite-watch-assets.ts` watches those files, so editing one (`libs/ui`'s included) reloads the page. After editing any `.css`, check the page (headless `google-chrome --screenshot`, desktop and phone widths) before asking the user to look.
- `web/` build constants: only the names `web/env.ts` reads reach the browser (`NORI_WEB_ENV`); `web/.env` holds public values only and is committed. It is not sensitive: every value is on-chain or a public endpoint, and the build ships it to the browser anyway. Never gitignore, delete or untrack it, and never replace it with a `.env.example`. Ethereum reads go through the user's wallet in the prove-balance app, the only one that sends a transaction, and through `NORI_WEB_ETH_RPC_URL` in guard-status, proven-facts and the dashboard, which have no wallet; Solana reads through the cluster's public endpoint.
- `web/` browser code imports `@nori-zk/backstop-client/read`, never the client's root: the root re-exports the Backstop encoders, which load the sdk's generated `/program` client, and that reads `process.env` at load.
- `web/` runs on one rxjs, as the ystate studio does: every `web/` package depends on `rxjs` `8.0.0-alpha.14` (`@yaw-rx/core`'s version), `web/tsconfig.base.json` maps `rxjs` and `rxjs/*` to the package's own `node_modules/rxjs` (`paths`, `${configDir}`), and each app's vite config has `resolve.dedupe: ['rxjs']`. The sdk and `@yaw-rx/ystate` are typed against rxjs 7 and resolve to the same copy.

## Conventions

- `web/` follows yaw and ystate idiom. Read these before writing UI code:
    - [yaw-example](https://github.com/yaw-rx/yaw/tree/main/packages/yaw-example): components, `@state`, services and DI, `rx-for`/`rx-if`, and nesting a component's children and services in its own folder (`drum-machine/`).
    - [ystate studio default workspaces](https://github.com/yaw-rx/ystate/blob/main/packages/studio/src/app-root/default-workspaces.ts): idiomatic machines (heater physics, traffic with a disjoint dep, checkout with a unioned dep) and forms reading `state$` by node.
    - [YState Studio](https://ystate.github.io/): the same machines live.
- `web/` UIs render machine state: each view switches on `state.node` of an sdk or app machine and reads that node's `data`; actions call the machine's controls. App flows get their own ystate graph (`define` → `implement`, types from `StateUnion`), not component flags.

## web/ (yaw + ystate)

References: yaw docs and examples at [yaw-rx.github.io](https://yaw-rx.github.io/) ([docs](https://yaw-rx.github.io/docs/), [examples](https://yaw-rx.github.io/examples/)), built from [yaw-example](https://github.com/yaw-rx/yaw/tree/main/packages/yaw-example). ystate at [ystate.github.io](https://ystate.github.io/) (the studio; its default workspaces are [default-workspaces.ts](https://github.com/yaw-rx/ystate/blob/main/packages/studio/src/app-root/default-workspaces.ts)) and the [ystate README](https://github.com/yaw-rx/ystate/blob/main/packages/ystate/README.md). yaw-example's `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js` and `.prettierrc.json` are the template for a yaw app.

### Toolchain

| Package               | Role                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaw-rx/core`        | Runtime: `RxElement`, `@Component`, `@state`, `@Injectable`/`@Inject`, `bootstrap`, `Router`, `rx-if`, `rx-for`                                                                      |
| `@yaw-rx/transformer` | ts-patch program transformer: adds `accessor` to `@state` fields, emits `__stateTypes`, declares each `x$: StateSubject`                                                             |
| `@yaw-rx/ts-plugin`   | Editor support for the same types                                                                                                                                                    |
| `@yaw-rx/vite`        | `viteTransform()` runs the transformer on each `.ts` the app's tsconfig program covers (outside `node_modules`); `viteAssets(['.css', '.html'])` imports those files as strings      |
| `ts-patch` 3          | `prepare: ts-patch install` patches the workspace `tsc` so `typecheck` sees the transformer's types                                                                                  |
| `@yaw-rx/ssg`         | `yaw-ssg dist public`: serves `dist`, captures every route in a local Chromium (`@sparticuz/chromium` in CI), writes static HTML with a hydration blob of `@state` and service state |
| `@yaw-rx/vscode`      | Highlighting and completion inside `template`/`styles`; pick "Use Workspace Version" of TypeScript so the patched one runs                                                           |

- Scripts, as yaw-example: `dev` (`vite`), `build` (`vite build`), `build:ssg` (`yaw-ssg dist public`), `typecheck`, `lint` (`eslint src/`), `format` (`prettier --check src/`), plus `:fix` variants.
- tsconfig: `web/tsconfig.base.json` (ES2022, `moduleResolution: bundler`, the two plugins). yaw uses TC39 decorators, and the repo root tsconfig sets `experimentalDecorators`, so `web/` never extends the root one.
- eslint for yaw code is type-checked with `parserOptions.projectService.loadTypeScriptPlugins: true` so it sees the transformer's `x$` members; without it eslint reports false positives.
- Prettier (`.prettierrc.json`): 4 spaces, single quotes, trailing commas, width 100.
- Local vite plugins live in `web/plugins/`, as the studio keeps its own in `plugins/`. `web/plugins/vite-wasm.ts` loads wasm-pack bundler output (the sdk's hash utils): each imported `.wasm` becomes a module that fetches the binary as an asset, instantiates it with its `_bg.js` glue and re-exports its exports. Apps list it in `plugins` and exclude `@nori-zk/nori-bridge-solana-sdk` and `@nori-zk/ethereum-solana-proof-queue-utils-glam` from `optimizeDeps`, so the dev server's pre-bundling leaves the `.wasm` import to the plugin.
- Brand assets (Nori logo, favicon, light-shaft art, Clash Display) live in `libs/ui/src/brand/`, from the bridge zkapp. Assets are imported as URLs (`import url from './x.svg'`, declared in `src/extensions/assets.d.ts`); `brandStyles` holds the `@font-face` and `--nori-*` colour tokens, and each app passes `brandStyles + globalStyles` to `bootstrap`. Components use the `--nori-*` tokens, not literal colours.
- Editor ([yaw docs: VSCode extension](https://yaw-rx.github.io/docs/getting-started/vscode-extension/)): `@yaw-rx/ts-plugin` runs only inside the editor's TypeScript server, never in `tsc`. To get it:
    1. `npm install`, then `npm run vscode:install` (links `node_modules/@yaw-rx/vscode` into `~/.vscode/extensions/yaw-rx.yaw-vscode`), then reload VS Code. `.vscode/extensions.json` recommends it.
    2. `.vscode/settings.json` points VS Code at the workspace TypeScript (`typescript.tsdk`, `js/ts.tsdk.promptToUseWorkspaceVersion`) and enables the extension (`yaw-rx.yaw.enable`).
    3. Manual, once per workspace: open a `.ts` file (the command only exists while a TypeScript or JavaScript file is the active editor), then `Ctrl+Shift+P` → **TypeScript: Select TypeScript Version** → **Use Workspace Version**, or click the TypeScript version in the status bar. Without it VS Code runs its built-in TypeScript, which has neither the ts-patch transformer nor the plugin, and shows false errors on `@state`/`x$`.
    - Open this repo itself as the VS Code folder (`code nori-worldsfair-submission`), or as a folder of a multi-root workspace. VS Code reads `.vscode/settings.json` only from the opened folder, and `typescript.tsdk` resolves against it, so opening a parent directory loses both.
    - Agents can't do the reload in step 1 or step 3. After setting up or reinstalling `web/` (or `npm run vscode:install`), tell the user to open this repo as the VS Code folder if they haven't, reload VS Code (**Developer: Reload Window**) and select the workspace TypeScript version.
- rxjs: `@yaw-rx/core` depends on rxjs 8 alpha, the sdk and `@yaw-rx/ystate` on rxjs 7. Bindings accept anything with `subscribe`.

### Components (yaw)

- A component is a class extending `RxElement` with `@Component({ selector, template, styles, providers, directives })`. The selector is its custom element tag; importing the file registers it, so a parent imports its children's files.
- Styles live in `<name>.component.css` next to the component and are imported (`import styles from './x.component.css'`); they are scoped to the selector, with `:host` for the element. A subclass inherits its base component's styles (`DocSection`).
- State: `@state count = 0` creates `count$` (a `BehaviorSubject`). Derived values are getters returning observables (`get label$(): Observable<string>`). Templates hold binding paths only, never expressions.
- Template bindings: `{{x}}` text; `[value]`, `[class.on]`, `[style]` properties; `onclick="method"`, `oninput="method($event)"`, `onclick="method(arg)"` events; `^method()` calls the parent host; `#name` assigns the element to a field. A path resolves `x`, then `x$`, then the plain value.
- Directives: `rx-if="flag"` shows children while truthy; `rx-for="item of items by id"` gives each child an `item` scope, `rx-for="items by id"` assigns each item's fields onto a child component's `@state`. List them in `directives: [RxIf, RxFor]`.
- Lifecycle: `onInit` (DI and bindings ready), `onRender` (children and `#refs` ready), `onDestroy` (unsubscribe what you subscribed).
- Services: `@Injectable([deps])` classes take deps as constructor arguments; components declare `@Inject(Token) private readonly x!: X`. A component's `providers` scopes an instance to its subtree (its `onDestroy` runs with the component); `bootstrap` providers are app-wide. Tokens are classes or symbols (`{ provide: TOKEN, useValue }`).
- `main.ts` calls `await bootstrap({ root, providers, globals: { styles, directives } })`; `index.html` only loads `/src/main.ts`. Pages use `Router`, `ROUTES` and `<rx-router-outlet>`.
- Folders: `app-root.ts` with `app-root/{components,directives,pages,services}`; a component's own children, services, utils and types live in a folder named after it (`drum-machine.component.ts`, `drum-machine/track-row.component.ts`, `drum-machine/utils/step-ticker.service.ts`).

### Directives and lifecycle (yaw)

Docs: [lifecycle](https://yaw-rx.github.io/docs/components/lifecycle/), [bindings](https://yaw-rx.github.io/docs/components/bindings/), [directives](https://yaw-rx.github.io/docs/directives/), [hooks](https://yaw-rx.github.io/docs/directives/hooks/), [services](https://yaw-rx.github.io/docs/services/); source in [docs-page/](https://github.com/yaw-rx/yaw/tree/main/packages/yaw-example/src/app-root/pages/docs-page).

| Hook        | Component                                                                                                                 | Directive                                                | Service                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `onInit`    | DI injected, attributes hydrated, bindings live, template in the DOM                                                      | after the framework sets `node` and the parsed attribute | when the injector first resolves it      |
| `onRender`  | one microtask after `onInit`: children are bound and `#ref` elements exist; start canvases, observers and animations here |                                                          |                                          |
| `onDestroy` | on removal, after the framework tore down its own bindings and directives; clean up only what you own                     | on removal of its element                                | when the providing injector is destroyed |

- A directive is a class with `@Directive({ selector: '[name]' })`, a `node` field (its element) and `onInit`/`onDestroy`. A component lists it in `directives: [...]`; app-wide ones go in `bootstrap({ globals: { directives } })`. Animation directives follow yaw-example's `[bounce]`/`[blink]` (start on `onInit`, cancel on `onDestroy`) and `[perlin-bg]` (a WebGPU background canvas appended to its element).
- A directive can parse its attribute (`parseBindingPath`) and subscribe through the binding system (`subscribeToBinding`) to react to a host value.
- Hooks (mutation, scope, binding) extend the binding system for directives such as `rx-for` and virtual scroll; each registers through an `Arc`, acquired by the first instance and released by the last.
- `#name` assigns an element to the host field `name`, available from `onRender`. `<slot>` in a template receives the element's children. `[(prop)]="path"` (tap) writes an element's own `@state` back to a host field.
- Rich `@state` types (dates, decimals, addresses) cross attributes through attribute codecs registered in `bootstrap({ globals: { attributeCodecs } })` or a component's `attributeCodecs`.

### Machines (ystate)

- `define({ nodes, deps?, edges })` → `.implement({ name: { $, next, error?, complete? } })` → `.close()` → `.start(entry, runningMachines?, initialNodeData?)`. The topology is the contract: handler parameters and state types come from the graph (`StateUnion<typeof Graph.nodes>`); never hand-write a parallel union.
- Transitions are pure; side effects subscribe to `state$`/`event$` outside the machine. Machines couple through shared streams (the heater and its physics loop).
- Machines are isolated by domain: each holds only its own domain's states. An app flow uses an sdk machine by gating its own transitions on that machine's `state$`, as the ystate README shows: the heater's transitions gate on `temperature$` (the physics example, "Coupled systems"), and Payment's `pay` gates on `deps.auth.state$` (the auth example, README "Quick look" and the studio's checkout workspace). A flow can also spread an sdk graph's nodes and edges into its own (`...readThroughConnectionsOf(...)`, run by `startReadThroughConnectionsMachine` with `ownTransitions`, as prove-balance's flow does). Never copy another machine's states into the flow's data.
- A machine describes one domain; everything else is the outside world, which it reaches only through `$`. Fixed configuration is not input: an address or an RPC URL known when the machine is made defines the machine. What arrives or changes during its life (data, another machine's state, the user, the chain) comes in through `$`, and the graph shows three things for it: the input arriving through `$`, an edge that fires only when the outside allows it (the gate), and the node the machine waits in until it does. That node is usually the one the gated edge leaves from: the heater waits in `idle` until `belowLowerLimit` lets it through, and Payment waits in `checkout` until `payRequest` brings the card. A node of its own is needed only when why it waits is something the domain shows or handles: Payment's `notLoggedIn`, which the user sees and `dismiss` leaves, or `waitingForConnectionWhile…`, which names the chain it waits on.
- A machine made for one thing (a transaction, a batch, a query) holds it as its starting data, never in a closure. Its owner makes it inside the stream that needs it (a `switchMap` on the state that brings that thing, or `dataOnEntry$` of the node that needs it) and closes it when that stream ends: `followedStates$` (`@nori-zk/backstop-client/read`) does both. A stream the edges of several nodes follow is held across the moves between them with `heldAcrossMoves()`, or the move closes and remakes the machine.
- `deps`: a dep whose node an edge targets (`refs.payment.nodes.processing`) is unioned into the supergraph, its states emitted as `payment.processing`; any other dep is disjoint, started by its owner and passed to `.start`, and read in `$` through `deps.auth.state$`.
- `state$` is typed by the supergraph: narrow on `state.node`, then read `state.data`. `runningMachines[k]` is typed per dep.
- A terminal node (no outgoing edges) completes `state$`. A graph without one ends only through the owner's `.stop()`; disjoint machines passed in are not stopped.
- Each graph has an SVG drawn by `ystate-visualizer --strict -o <dir> <file.ts>`, kept next to it. A two-line read graph, `define(readThroughConnectionsOf({ … }))`, has none: from an app, `readThroughConnectionsOf` resolves to the sdk's built `.d.ts`, which the visualizer cannot follow.
- Views read machine state as the studio's forms do (`authToken$ = auth.state$.pipe(map((s) => (s.node === 'authenticated' ? s.data.token : '')))`), with `rx-if` around controls that belong to one node.
