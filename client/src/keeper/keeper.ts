import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FetchRequest, isError, JsonRpcProvider, Wallet } from 'ethers';
import { firstValueFrom } from 'rxjs';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import {
    bothReady$,
    createConnections,
    getBridgeState,
    getProofQueueHead,
    type Connections,
} from '@nori-zk/nori-bridge-solana-sdk';
import { findStatePda } from '@nori-zk/nori-bridge-solana-sdk/program';
import {
    assertHealthyInstruction,
    BackstopError,
    backstopErrorName,
    checkpointInstruction,
    createGuardInstruction,
    decodeGuard,
    findGuardAddress,
    guardStatus,
    ReadKind,
    submitReadInstruction,
    unlatchInstruction,
} from '../backstop.js';
import {
    fetchProvenSnapshot,
    type ProvenSnapshot,
} from '../fetchProvenSnapshot.js';
import { mintSupply } from '../guard.js';
import { readSnapshotResultInstruction } from '../noriRead.js';
import {
    guardConfigOf,
    queryOf,
    type GuardEntry,
    type KeeperConfig,
} from './config.js';
import {
    connectSolana,
    customErrorCode,
    customErrorOf,
    RPC_TIMEOUT_MS,
    type Solana,
    transactionErrorText,
} from './solana.js';
import type { TransactionError } from '@solana/kit';

/** How long `snapshot` waits for its transaction to be mined. */
const SNAPSHOT_WAIT_MS = 3 * 60_000;
/** The sdk's requests have no timeout of their own; a hung one would stall the loop. */
const PROVEN_SNAPSHOT_TIMEOUT_MS = 2 * 60_000;

interface KeeperState {
    /** Snapshot transactions whose reads are not all submitted yet. */
    pending: string[];
    /** The last snapshot: when it was sent (unix seconds) and its results root. */
    lastSnapshot?: { sentAt: number; resultsRoot: string };
}

export class Keeper {
    private constructor(
        private readonly config: KeeperConfig,
        private readonly solana: Solana,
        private readonly provider: JsonRpcProvider,
        private readonly connections: Connections
    ) {}

    /** The keeper signs through its own clients and reads through the sdk's connections. */
    static async connect(config: KeeperConfig): Promise<Keeper> {
        const solana = await connectSolana(
            config.solana.rpcUrl,
            config.solana.keypair
        );
        // ethers' default is 5 min per request; a hung one would stall the loop
        const request = new FetchRequest(config.ethereum.rpcUrl);
        request.timeout = RPC_TIMEOUT_MS;
        const provider = new JsonRpcProvider(request);
        const [{ chainId }, genesisHash] = await Promise.all([
            provider.getNetwork(),
            solana.rpc.getGenesisHash().send(),
        ]);
        const connections = createConnections({
            ethereum: {
                expectedChainId: chainId,
                http: { rpcUrl: config.ethereum.rpcUrl },
            },
            solana: {
                expectedGenesisHash: genesisHash,
                http: { rpcUrls: [config.solana.rpcUrl] },
            },
        });
        await withTimeout(
            firstValueFrom(bothReady$(connections)),
            RPC_TIMEOUT_MS,
            'Ethereum and Solana connections'
        );
        return new Keeper(config, solana, provider, connections);
    }

    private log(message: string) {
        console.log(`${new Date().toISOString()} ${message}`);
    }

    private guardAddress(guard: GuardEntry) {
        return findGuardAddress(guard.mint, this.solana.signer.address);
    }

    private loadState(): KeeperState {
        return existsSync(this.config.stateFile)
            ? (JSON.parse(
                  readFileSync(this.config.stateFile, 'utf8')
              ) as KeeperState)
            : { pending: [] };
    }

    private saveState(patch: Partial<KeeperState>) {
        writeFileSync(
            this.config.stateFile,
            JSON.stringify({ ...this.loadState(), ...patch }, null, 2) + '\n'
        );
    }

    /** Creates each configured guard that does not exist yet; the keeper key is its admin. */
    async createGuards() {
        const { noriProgram } = this.config.solana;
        const [noriState] = await findStatePda({ programAddress: noriProgram });
        if (!(await this.solana.accountData(noriState)))
            throw new Error(
                `Nori program ${noriProgram} has no state at ${noriState}; initialize it before creating guards`
            );
        for (const guard of this.config.guards) {
            const address = await this.guardAddress(guard);
            if (await this.solana.accountData(address)) {
                this.log(`${guard.name}: guard ${address} exists`);
                continue;
            }
            const instruction = await createGuardInstruction({
                admin: this.solana.signer.address,
                mint: guard.mint,
                config: guardConfigOf(this.config, guard),
            });
            await this.solana.send(instruction);
            this.log(`${guard.name}: created guard ${address}`);
        }
    }

    /** NoriSnapshot, signed by ETH_PRIVATE_KEY, and every configured query once. */
    private noriSnapshot() {
        const key = process.env.ETH_PRIVATE_KEY;
        if (!key) throw new Error('Missing env: ETH_PRIVATE_KEY');
        const contract = NoriSnapshot__factory.connect(
            this.config.ethereum.noriSnapshot,
            new Wallet(key, this.provider)
        );
        const queries = new Map<string, { target: string; data: string }>();
        for (const guard of this.config.guards) {
            for (const query of [guard.backing, guard.pause]) {
                if (!query) continue;
                const { target, data, queryId } = queryOf(query);
                queries.set(queryId, { target, data });
            }
        }
        return { contract, queries: [...queries.values()] };
    }

    /** The results root a snapshot would commit now: it hashes only the query ids and results. */
    private async resultsRoot(): Promise<string> {
        const { contract, queries } = this.noriSnapshot();
        const fee = await contract.snapshotFee();
        return (await contract.snapshot.staticCall(queries, { value: fee }))
            .resultsRoot;
    }

    /** One NoriSnapshot transaction covering every configured query; `reason` goes in the log. */
    async snapshot(reason?: string) {
        const { contract, queries } = this.noriSnapshot();
        const resultsRoot = await this.resultsRoot();
        const fee = await contract.snapshotFee();
        const tx = await contract.snapshot(queries, { value: fee });
        // Pending as soon as it is sent: a slow block can't lose it or stall the loop
        const { pending } = this.loadState();
        this.saveState({
            pending: [...pending, tx.hash],
            lastSnapshot: { sentAt: Date.now() / 1000, resultsRoot },
        });
        try {
            const receipt = await tx.wait(1, SNAPSHOT_WAIT_MS);
            this.log(
                `snapshot ${tx.hash}: ${queries.length} queries, block ${receipt?.blockNumber}` +
                    (reason ? ` (${reason})` : '')
            );
        } catch (error) {
            if (isError(error, 'CALL_EXCEPTION')) {
                // Reverted (e.g. the queue fee changed): it has no reads, and `run` sends another
                this.saveState({
                    pending: this.loadState().pending.filter(
                        (hash) => hash !== tx.hash
                    ),
                    lastSnapshot: undefined,
                });
                throw new Error(`snapshot ${tx.hash} reverted`);
            }
            this.log(
                `snapshot ${tx.hash}: not mined after ${SNAPSHOT_WAIT_MS / 60_000} min; its reads go in once it is`
            );
        }
    }

    /** Records each guard's mint supply (skips guards checkpointed too recently). */
    async checkpoint() {
        for (const guard of this.config.guards) {
            try {
                await this.solana.send(
                    checkpointInstruction({
                        guard: await this.guardAddress(guard),
                        mint: guard.mint,
                    })
                );
                this.log(`${guard.name}: checkpoint`);
            } catch (error) {
                if (customErrorCode(error) !== BackstopError.CheckpointTooSoon)
                    this.log(
                        `${guard.name}: checkpoint failed: ${errorMessage(error)}`
                    );
            }
        }
    }

    /**
     * Submits every pending snapshot's reads whose batch is proven. A read the
     * program rejects is logged and dropped; one that fails in transit is
     * retried next round. Neither blocks other guards or snapshots.
     */
    async submit(quiet = false) {
        const pending = this.loadState().pending;
        const stillPending: string[] = [];
        for (const snapshotTxHash of pending) {
            let done = false;
            try {
                done = await this.submitSnapshot(snapshotTxHash);
            } catch (error) {
                this.log(
                    `snapshot ${snapshotTxHash}: failed: ${errorMessage(error)}`
                );
            }
            if (done) this.log(`snapshot ${snapshotTxHash}: reads submitted`);
            else stillPending.push(snapshotTxHash);
        }
        // Keep what another keeper process (a CLI `snapshot`) added meanwhile
        const added = this.loadState().pending.filter(
            (hash) => !pending.includes(hash)
        );
        this.saveState({ pending: [...stillPending, ...added] });
        if (stillPending.length && !quiet)
            this.log(
                `${stillPending.length} snapshot(s) pending: waiting for a proof or retrying`
            );
    }

    /** True once the snapshot is proven and every guard's reads are applied. */
    private async submitSnapshot(snapshotTxHash: string): Promise<boolean> {
        const snapshot = await withTimeout(
            fetchProvenSnapshot({
                connections: this.connections,
                noriSnapshot: this.config.ethereum.noriSnapshot,
                proofQueue: this.config.ethereum.proofQueue,
                snapshotTxHash,
                noriProgram: this.config.solana.noriProgram,
            }),
            PROVEN_SNAPSHOT_TIMEOUT_MS,
            'reading the proof request'
        );
        if (!snapshot.proven) return false;
        let done = true;
        for (const guard of this.config.guards) {
            try {
                await this.submitGuardReads(guard, snapshot);
            } catch (error) {
                this.log(
                    `${guard.name}: snapshot ${snapshotTxHash} failed: ${errorMessage(error)}`
                );
                done = false;
            }
        }
        return done;
    }

    /** Applies the guard's backing and pause results (an already-applied read is skipped). */
    private async submitGuardReads(
        guard: GuardEntry,
        snapshot: Extract<ProvenSnapshot, { proven: true }>
    ) {
        const reads = [
            [ReadKind.Backing, guard.backing],
            [ReadKind.Pause, guard.pause],
        ] as const;
        for (const [kind, query] of reads) {
            if (!query) continue;
            try {
                await this.solana.send(
                    submitReadInstruction({
                        guard: await this.guardAddress(guard),
                        mint: guard.mint,
                        proofQueueBatch: snapshot.proofQueueBatch,
                        kind,
                        witness: snapshot.witnessFor(queryOf(query).queryId),
                    })
                );
            } catch (error) {
                const code = customErrorCode(error);
                // A program error is final for this read; only transport errors retry
                if (code === undefined) throw error;
                if (code !== BackstopError.ReadNotNewer)
                    this.log(
                        `${guard.name}: read rejected: ${backstopErrorName(code) ?? 'program error'} (${code}), dropped`
                    );
            }
        }
    }

    /**
     * Clears each tripped guard's latch (the keeper key must be its admin).
     * Testing and demos only: one key reopens the guard, so a production
     * guard needs a timelock or governance instead. Unlatch after a proven
     * read shows the backing restored, or the next read trips it again.
     */
    async unlatch() {
        for (const guard of this.config.guards) {
            const address = await this.guardAddress(guard);
            const data = await this.solana.accountData(address);
            if (!data) {
                this.log(`${guard.name}: no guard at ${address}`);
                continue;
            }
            const state = decodeGuard(data);
            if (!state.tripped) {
                this.log(`${guard.name}: not tripped`);
                continue;
            }
            await this.solana.send(
                unlatchInstruction({
                    admin: this.solana.signer.address,
                    guard: address,
                })
            );
            this.log(
                `${guard.name}: unlatched (backing ${state.backing} at Ethereum block ${state.backingEthBlock})`
            );
        }
    }

    /**
     * Each guard's `assert_healthy`, the call a lender makes: simulated, or
     * with `send` landed even when it fails (no preflight).
     */
    async assertHealthy(send = false) {
        for (const guard of this.config.guards) {
            const instruction = assertHealthyInstruction({
                guard: await this.guardAddress(guard),
                mint: guard.mint,
            });
            if (send) {
                const { err, signature } = await this.solana.land(instruction);
                this.log(
                    `${guard.name}: ${verdictOf(err)} | tx ${signature}${this.explorer(signature)}`
                );
            } else {
                const { err, unitsConsumed } =
                    await this.solana.simulate(instruction);
                this.log(
                    `${guard.name}: ${verdictOf(err)} | ${unitsConsumed} CU`
                );
            }
        }
    }

    /**
     * Verifies each result of a proven snapshot on Solana with
     * nori-read-example, in real transactions: the on-chain record of what
     * Prove balance only simulates.
     */
    async verify(snapshotTxHash: string) {
        const snapshot = await withTimeout(
            fetchProvenSnapshot({
                connections: this.connections,
                noriSnapshot: this.config.ethereum.noriSnapshot,
                proofQueue: this.config.ethereum.proofQueue,
                snapshotTxHash,
                noriProgram: this.config.solana.noriProgram,
            }),
            PROVEN_SNAPSHOT_TIMEOUT_MS,
            'reading the proof request'
        );
        if (!snapshot.proven) {
            this.log(`snapshot ${snapshotTxHash}: not proven yet`);
            return;
        }
        const { event, proofQueueBatch } = snapshot;
        this.log(
            `snapshot ${snapshotTxHash}: Ethereum block ${event.blockNumber}, batch ${proofQueueBatch}`
        );
        for (const [i, queryId] of event.queryIds.entries()) {
            const signature = await this.solana.send(
                readSnapshotResultInstruction({
                    proofQueueBatch,
                    noriSnapshot: this.config.ethereum.noriSnapshot,
                    queryId,
                    witness: snapshot.witnessFor(queryId),
                })
            );
            this.log(
                `query ${queryId}: ${BigInt(event.results[i] ?? 0)} verified | tx ${signature}${this.explorer(signature)}`
            );
        }
    }

    /** A Solana Explorer link when the RPC is devnet's; never prints the RPC URL. */
    private explorer(signature: string) {
        return this.config.solana.rpcUrl.includes('devnet')
            ? ` https://explorer.solana.com/tx/${signature}?cluster=devnet`
            : '';
    }

    /** Prints Nori's progress through the proof queue, then each guard's status. */
    async status() {
        for (const line of await this.statusLines()) this.log(line);
    }

    private async statusLines(): Promise<string[]> {
        const lines: string[] = [];
        const now = BigInt(Math.floor(Date.now() / 1000));
        const { noriProgram } = this.config.solana;
        const { ethereum, solana } = this.connections;
        const [nori, requests] = await withTimeout(
            Promise.all([
                getBridgeState(solana, noriProgram).catch((): null => null),
                getProofQueueHead(ethereum, this.config.ethereum.proofQueue),
            ]),
            RPC_TIMEOUT_MS,
            "reading Nori's progress"
        );
        if (nori) {
            lines.push(
                `nori: beacon slot ${nori.latestHead} | ${nori.queueCursor} of ${requests} queue requests proven` +
                    ` | ${nori.proofQueueBatchCount} batches | ${this.loadState().pending.length} snapshot(s) waiting`
            );
        } else {
            lines.push(`nori: no state for ${noriProgram}`);
        }
        for (const guard of this.config.guards) {
            const address = await this.guardAddress(guard);
            const [guardData, mintData] = await Promise.all([
                this.solana.accountData(address),
                this.solana.accountData(guard.mint),
            ]);
            if (!guardData || !mintData) {
                lines.push(`${guard.name}: no guard at ${address}`);
                continue;
            }
            const state = decodeGuard(guardData);
            const supply = mintSupply(mintData);
            lines.push(
                `${guard.name}: ${guardStatus(state, supply, now)} | backing ${state.backing} | supply ${supply}` +
                    ` | Ethereum block ${state.backingEthBlock} | paused ${state.paused}` +
                    (state.tripped
                        ? ` | tripped at block ${state.tripEthBlock}, deficit ${state.tripDeficit}`
                        : '')
            );
        }
        return lines;
    }

    /**
     * Checkpoints, snapshots and submits on the configured intervals, forever,
     * and prints each status line when it changes. One job at a time, so jobs
     * never race on the state file.
     */
    async run() {
        const { snapshotSecs, checkpointSecs, pollSecs } =
            this.config.intervals;
        const last = { checkpoint: 0 };
        const shown = new Set<string>();
        for (;;) {
            const now = Date.now() / 1000;
            const jobs: Array<[string, () => Promise<void>]> = [];
            if (now - last.checkpoint >= checkpointSecs) {
                last.checkpoint = now;
                jobs.push(['checkpoint', () => this.checkpoint()]);
            }
            // The heartbeat, or as soon as a watched result changed. shortcut: a
            // vault that changes every poll is snapshotted every poll; add a
            // minimum gap before watching busy vaults
            jobs.push([
                'snapshot',
                async () => {
                    const last = this.loadState().lastSnapshot;
                    if (!last || now - last.sentAt >= snapshotSecs)
                        await this.snapshot('heartbeat');
                    else if ((await this.resultsRoot()) !== last.resultsRoot)
                        await this.snapshot('results changed');
                },
            ]);
            jobs.push(['submit', () => this.submit(true)]);
            for (const [name, job] of jobs) {
                try {
                    await job();
                } catch (error) {
                    this.log(`${name} failed: ${errorMessage(error)}`);
                }
            }
            try {
                const lines = await this.statusLines();
                for (const line of lines) if (!shown.has(line)) this.log(line);
                shown.clear();
                for (const line of lines) shown.add(line);
            } catch (error) {
                this.log(`status failed: ${errorMessage(error)}`);
            }
            await new Promise((resolve) =>
                setTimeout(resolve, pollSecs * 1000)
            );
        }
    }
}

/** `allowed`, or `blocked: <BackstopError> (<code>)`. */
function verdictOf(err: TransactionError | null): string {
    if (!err) return 'allowed';
    const code = customErrorOf(err);
    return code === undefined
        ? `blocked: ${transactionErrorText(err)}`
        : `blocked: ${backstopErrorName(code) ?? 'program error'} (${code})`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Rejects once `ms` pass; the work itself is left to finish or fail on its own. */
function withTimeout<T>(
    work: Promise<T>,
    ms: number,
    what: string
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${what} timed out after ${ms / 1000} s`)),
            ms
        );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
