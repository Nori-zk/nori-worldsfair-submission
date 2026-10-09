import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FetchRequest, isError, JsonRpcProvider, Wallet } from 'ethers';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import { fetchBridgeState } from '@nori-zk/nori-bridge-solana-sdk';
import { findStatePda } from '@nori-zk/nori-bridge-solana-sdk/program';
import type { Address } from '@solana/kit';
import {
    checkpointInstruction,
    createGuardInstruction,
    decodeGuard,
    findGuardAddress,
    guardStatus,
    ReadKind,
    submitReadInstruction,
    unlatchInstruction,
    type GuardState,
} from '../backstop.js';
import {
    fetchProvenSnapshot,
    type ProvenSnapshot,
} from '../fetchProvenSnapshot.js';
import {
    guardConfigOf,
    queryOf,
    type GuardEntry,
    type KeeperConfig,
} from './config.js';
import {
    connectSolana,
    customErrorCode,
    mintSupply,
    RPC_TIMEOUT_MS,
    type Solana,
} from './solana.js';

/** How long `snapshot` waits for its transaction to be mined. */
const SNAPSHOT_WAIT_MS = 3 * 60_000;

// Backstop error codes the keeper treats as "nothing to do" (pinned by
// programs/backstop/tests/instruction_fixture.rs)
const ERR_READ_NOT_NEWER = 6005;
const ERR_CHECKPOINT_TOO_SOON = 6006;

interface KeeperState {
    /** Snapshot transactions whose reads are not all submitted yet. */
    pending: string[];
}

/** What the keeper did, for a runner that records it (bin/scenarios.ts). */
export type KeeperEvent =
    | { type: 'snapshot'; txHash: string; queries: number; block?: number }
    | { type: 'checkpoint'; guard: string; signature: string }
    | {
          type: 'read';
          guard: string;
          txHash: string;
          kind: ReadKind;
          signature: string;
      }
    | { type: 'applied'; txHash: string }
    | { type: 'error'; job: string; message: string };

/** One guard's state and status, as `status` shows it. */
export interface GuardReport {
    name: string;
    address: Address;
    state: GuardState;
    supply: bigint;
    status: ReturnType<typeof guardStatus>;
}

export interface StatusReport {
    nori: { latestHead: bigint; queueCursor: bigint; batches: bigint } | null;
    queueHead: bigint;
    pending: number;
    guards: GuardReport[];
}

export class Keeper {
    /** Called for each event; the default keeps the plain log. */
    onEvent: (event: KeeperEvent) => void = () => {};

    private constructor(
        readonly config: KeeperConfig,
        readonly solana: Solana,
        readonly provider: JsonRpcProvider
    ) {}

    static async connect(config: KeeperConfig): Promise<Keeper> {
        const solana = await connectSolana(
            config.solana.rpcUrl,
            config.solana.keypair
        );
        // ethers' default is 5 min per request; a hung one would stall the loop
        const request = new FetchRequest(config.ethereum.rpcUrl);
        request.timeout = RPC_TIMEOUT_MS;
        return new Keeper(config, solana, new JsonRpcProvider(request));
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

    private saveState(state: KeeperState) {
        writeFileSync(
            this.config.stateFile,
            JSON.stringify(state, null, 2) + '\n'
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

    /** One NoriSnapshot transaction covering every configured query. */
    async snapshot() {
        const key = process.env.ETH_PRIVATE_KEY;
        if (!key) throw new Error('Missing env: ETH_PRIVATE_KEY');
        const snapshot = NoriSnapshot__factory.connect(
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
        const fee = await snapshot.snapshotFee();
        const tx = await snapshot.snapshot([...queries.values()], {
            value: fee,
        });
        // Pending as soon as it is sent: a slow block can't lose it or stall the loop
        const state = this.loadState();
        state.pending.push(tx.hash);
        this.saveState(state);
        try {
            const receipt = await tx.wait(1, SNAPSHOT_WAIT_MS);
            this.log(
                `snapshot ${tx.hash}: ${queries.size} queries, block ${receipt?.blockNumber}`
            );
            this.onEvent({
                type: 'snapshot',
                txHash: tx.hash,
                queries: queries.size,
                block: receipt?.blockNumber,
            });
        } catch (error) {
            if (isError(error, 'CALL_EXCEPTION')) {
                // Reverted (e.g. the queue fee changed): it has no reads
                this.saveState({
                    pending: this.loadState().pending.filter(
                        (hash) => hash !== tx.hash
                    ),
                });
                throw new Error(`snapshot ${tx.hash} reverted`);
            }
            this.log(
                `snapshot ${tx.hash}: not mined after ${SNAPSHOT_WAIT_MS / 60_000} min; its reads go in once it is`
            );
            this.onEvent({
                type: 'snapshot',
                txHash: tx.hash,
                queries: queries.size,
            });
        }
    }

    /** Records each guard's mint supply (skips guards checkpointed too recently). */
    async checkpoint() {
        for (const guard of this.config.guards) {
            try {
                const signature = await this.solana.send(
                    checkpointInstruction({
                        guard: await this.guardAddress(guard),
                        mint: guard.mint,
                    })
                );
                this.log(`${guard.name}: checkpoint`);
                this.onEvent({
                    type: 'checkpoint',
                    guard: guard.name,
                    signature,
                });
            } catch (error) {
                if (customErrorCode(error) !== ERR_CHECKPOINT_TOO_SOON)
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
            if (done) {
                this.log(`snapshot ${snapshotTxHash}: reads submitted`);
                this.onEvent({ type: 'applied', txHash: snapshotTxHash });
            } else stillPending.push(snapshotTxHash);
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
        const snapshot = await fetchProvenSnapshot({
            rpc: this.solana.rpc,
            provider: this.provider,
            noriSnapshot: this.config.ethereum.noriSnapshot,
            proofQueue: this.config.ethereum.proofQueue,
            snapshotTxHash,
            noriProgram: this.config.solana.noriProgram,
        });
        if (!snapshot.proven) return false;
        let done = true;
        for (const guard of this.config.guards) {
            try {
                await this.submitGuardReads(guard, snapshot, snapshotTxHash);
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
        snapshot: Extract<ProvenSnapshot, { proven: true }>,
        txHash: string
    ) {
        const reads = [
            [ReadKind.Backing, guard.backing],
            [ReadKind.Pause, guard.pause],
        ] as const;
        for (const [kind, query] of reads) {
            if (!query) continue;
            try {
                const signature = await this.solana.send(
                    submitReadInstruction({
                        guard: await this.guardAddress(guard),
                        mint: guard.mint,
                        proofQueueBatch: snapshot.proofQueueBatch,
                        kind,
                        witness: snapshot.witnessFor(queryOf(query).queryId),
                    })
                );
                this.onEvent({
                    type: 'read',
                    guard: guard.name,
                    txHash,
                    kind,
                    signature,
                });
            } catch (error) {
                const code = customErrorCode(error);
                // A program error is final for this read; only transport errors retry
                if (code === undefined) throw error;
                if (code !== ERR_READ_NOT_NEWER)
                    this.log(
                        `${guard.name}: read rejected (program error ${code}), dropped`
                    );
            }
        }
    }

    /**
     * Clears each tripped guard's latch (the keeper key must be its admin).
     * Unlatch after a proven read shows the backing restored, or the next
     * read trips it again.
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

    /** Prints Nori's progress through the proof queue, then each guard's status. */
    async status() {
        for (const line of statusLines(await this.statusReport()))
            this.log(line);
    }

    /** Nori's progress through the proof queue, and each guard's state. */
    async statusReport(): Promise<StatusReport> {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const { noriProgram } = this.config.solana;
        const queue = NoriProofRequestQueue__factory.connect(
            this.config.ethereum.proofQueue,
            this.provider
        );
        const [nori, queueHead] = await Promise.all([
            fetchBridgeState(this.solana.rpc, noriProgram).catch(
                (): null => null
            ),
            queue.head(),
        ]);
        const guards: GuardReport[] = [];
        for (const guard of this.config.guards) {
            const address = await this.guardAddress(guard);
            const [guardData, mintData] = await Promise.all([
                this.solana.accountData(address),
                this.solana.accountData(guard.mint),
            ]);
            if (!guardData || !mintData) continue;
            const state = decodeGuard(guardData);
            const supply = mintSupply(mintData);
            guards.push({
                name: guard.name,
                address,
                state,
                supply,
                status: guardStatus(state, supply, now),
            });
        }
        return {
            nori: nori && {
                latestHead: nori.latestHead,
                queueCursor: nori.queueCursor,
                batches: nori.proofQueueBatchCount,
            },
            queueHead,
            pending: this.loadState().pending.length,
            guards,
        };
    }

    /** When `tick` last ran each job (epoch seconds); reset one to force it. */
    readonly last = { checkpoint: 0, snapshot: 0 };

    /**
     * One round: a checkpoint and a snapshot when due, then submit. Errors are
     * logged, never thrown. `run` calls this every `pollSecs`.
     */
    async tick() {
        const { snapshotSecs, checkpointSecs } = this.config.intervals;
        const now = Date.now() / 1000;
        const jobs: Array<[string, () => Promise<void>]> = [];
        if (now - this.last.checkpoint >= checkpointSecs) {
            this.last.checkpoint = now;
            jobs.push(['checkpoint', () => this.checkpoint()]);
        }
        if (now - this.last.snapshot >= snapshotSecs) {
            // Only once sent: a failed snapshot retries next round
            jobs.push([
                'snapshot',
                async () => {
                    await this.snapshot();
                    this.last.snapshot = now;
                },
            ]);
        }
        jobs.push(['submit', () => this.submit(true)]);
        for (const [name, job] of jobs) {
            try {
                await job();
            } catch (error) {
                const message = errorMessage(error);
                this.log(`${name} failed: ${message}`);
                this.onEvent({ type: 'error', job: name, message });
            }
        }
    }

    /**
     * Checkpoints, snapshots and submits on the configured intervals, forever,
     * and prints each status line when it changes. One job at a time, so jobs
     * never race on the state file.
     */
    async run() {
        const shown = new Set<string>();
        for (;;) {
            await this.tick();
            try {
                const lines = statusLines(await this.statusReport());
                for (const line of lines) if (!shown.has(line)) this.log(line);
                shown.clear();
                for (const line of lines) shown.add(line);
            } catch (error) {
                this.log(`status failed: ${errorMessage(error)}`);
            }
            await new Promise((resolve) =>
                setTimeout(resolve, this.config.intervals.pollSecs * 1000)
            );
        }
    }
}

/** The status report as `keeper status` prints it (one line per guard). */
export function statusLines(report: StatusReport): string[] {
    const lines = [
        report.nori
            ? `nori: beacon slot ${report.nori.latestHead} | ${report.nori.queueCursor} of ${report.queueHead} queue requests proven` +
              ` | ${report.nori.batches} batches | ${report.pending} snapshot(s) waiting`
            : 'nori: no state',
    ];
    for (const { name, state, supply, status } of report.guards) {
        lines.push(
            `${name}: ${status} | backing ${state.backing} | supply ${supply}` +
                ` | Ethereum block ${state.backingEthBlock} | paused ${state.paused}` +
                (state.tripped
                    ? ` | tripped at block ${state.tripEthBlock}, deficit ${state.tripDeficit}`
                    : '')
        );
    }
    return lines;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
