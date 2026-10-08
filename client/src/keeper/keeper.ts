import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FetchRequest, JsonRpcProvider, Wallet } from 'ethers';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import { fetchBridgeState } from '@nori-zk/nori-bridge-solana-sdk';
import { findStatePda } from '@nori-zk/nori-bridge-solana-sdk/program';
import {
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

export class Keeper {
    private constructor(
        private readonly config: KeeperConfig,
        private readonly solana: Solana,
        private readonly provider: JsonRpcProvider
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
        } catch {
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
                if (customErrorCode(error) !== ERR_CHECKPOINT_TOO_SOON)
                    this.log(
                        `${guard.name}: checkpoint failed: ${errorMessage(error)}`
                    );
            }
        }
    }

    /**
     * Submits every pending snapshot's reads whose batch is proven. A failed
     * read is logged and retried next round; it never blocks other guards or
     * snapshots.
     */
    async submit(quiet = false) {
        const stillPending: string[] = [];
        for (const snapshotTxHash of this.loadState().pending) {
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
        this.saveState({ pending: stillPending });
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
                if (customErrorCode(error) !== ERR_READ_NOT_NEWER) throw error;
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
        for (const line of await this.statusLines()) this.log(line);
    }

    private async statusLines(): Promise<string[]> {
        const lines: string[] = [];
        const now = BigInt(Math.floor(Date.now() / 1000));
        const { noriProgram } = this.config.solana;
        const queue = NoriProofRequestQueue__factory.connect(
            this.config.ethereum.proofQueue,
            this.provider
        );
        const [nori, requests] = await Promise.all([
            fetchBridgeState(this.solana.rpc, noriProgram).catch(
                (): null => null
            ),
            queue.head(),
        ]);
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
        const last = { checkpoint: 0, snapshot: 0 };
        const shown = new Set<string>();
        for (;;) {
            const now = Date.now() / 1000;
            const jobs: Array<[string, () => Promise<void>]> = [];
            if (now - last.checkpoint >= checkpointSecs) {
                last.checkpoint = now;
                jobs.push(['checkpoint', () => this.checkpoint()]);
            }
            if (now - last.snapshot >= snapshotSecs) {
                last.snapshot = now;
                jobs.push(['snapshot', () => this.snapshot()]);
            }
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
