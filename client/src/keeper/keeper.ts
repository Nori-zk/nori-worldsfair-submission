import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NoriSnapshot__factory } from '@nori-zk/ethereum-snapshot';
import {
    checkpointInstruction,
    createGuardInstruction,
    decodeGuard,
    findGuardAddress,
    findNoriStateAddress,
    guardStatus,
    ReadKind,
    submitReadInstruction,
} from '../backstop.js';
import { fetchSnapshotRead } from '../fetchSnapshotRead.js';
import {
    guardConfigOf,
    queryOf,
    type GuardEntry,
    type KeeperConfig,
    type QueryConfig,
} from './config.js';
import {
    connectSolana,
    customErrorCode,
    mintSupply,
    type Solana,
} from './solana.js';

// Backstop error codes the keeper treats as "nothing to do"
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
            config.solana.wsUrl,
            config.solana.keypair
        );
        return new Keeper(
            config,
            solana,
            new JsonRpcProvider(config.ethereum.rpcUrl)
        );
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
        const receipt = await tx.wait();
        const state = this.loadState();
        state.pending.push(tx.hash);
        this.saveState(state);
        this.log(
            `snapshot ${tx.hash}: ${queries.size} queries, block ${receipt?.blockNumber}`
        );
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
                    throw error;
            }
        }
    }

    /** Submits every pending snapshot's reads whose batch is proven. */
    async submit() {
        const state = this.loadState();
        const stillPending: string[] = [];
        for (const snapshotTxHash of state.pending) {
            if (await this.submitSnapshot(snapshotTxHash)) {
                this.log(`snapshot ${snapshotTxHash}: reads submitted`);
            } else {
                stillPending.push(snapshotTxHash);
            }
        }
        this.saveState({ pending: stillPending });
        if (stillPending.length)
            this.log(`${stillPending.length} snapshot(s) waiting for a proof`);
    }

    /** Returns false while the snapshot's batch is not proven yet. */
    private async submitSnapshot(snapshotTxHash: string): Promise<boolean> {
        for (const guard of this.config.guards) {
            const reads: Array<{ kind: ReadKind; query: QueryConfig }> = [
                { kind: ReadKind.Backing, query: guard.backing },
            ];
            if (guard.pause)
                reads.push({ kind: ReadKind.Pause, query: guard.pause });
            for (const { kind, query } of reads) {
                const read = await fetchSnapshotRead({
                    rpc: this.solana.rpc,
                    provider: this.provider,
                    noriSnapshot: this.config.ethereum.noriSnapshot,
                    proofQueue: this.config.ethereum.proofQueue,
                    snapshotTxHash,
                    queryId: queryOf(query).queryId,
                    noriProgram: this.config.solana.noriProgram,
                });
                if (!read.proven) return false;
                try {
                    await this.solana.send(
                        submitReadInstruction({
                            guard: await this.guardAddress(guard),
                            mint: guard.mint,
                            proofQueueBatch: read.proofQueueBatch,
                            kind,
                            witness: read.witness,
                        })
                    );
                } catch (error) {
                    if (customErrorCode(error) !== ERR_READ_NOT_NEWER)
                        throw error;
                }
            }
        }
        return true;
    }

    /** Prints Nori's progress through the proof queue, then each guard's status. */
    async status() {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const queue = new Contract(
            this.config.ethereum.proofQueue,
            ['function head() view returns (uint256)'],
            this.provider
        );
        const [nori, requests] = await Promise.all([
            this.solana.accountData(
                await findNoriStateAddress(this.config.solana.noriProgram)
            ),
            queue.getFunction('head')() as Promise<bigint>,
        ]);
        if (nori) {
            // NoriSolTokenBridge: latest_head at 72, queue_cursor at 184, batch count at 192
            const view = new DataView(nori.buffer, nori.byteOffset);
            this.log(
                `nori: beacon slot ${view.getBigUint64(72, true)} | ${view.getBigUint64(184, true)} of ${requests} queue requests proven` +
                    ` | ${view.getBigUint64(192, true)} batches | ${this.loadState().pending.length} snapshot(s) waiting`
            );
        } else {
            this.log(`nori: no state for ${this.config.solana.noriProgram}`);
        }
        for (const guard of this.config.guards) {
            const address = await this.guardAddress(guard);
            const [guardData, mintData] = await Promise.all([
                this.solana.accountData(address),
                this.solana.accountData(guard.mint),
            ]);
            if (!guardData || !mintData) {
                this.log(`${guard.name}: no guard at ${address}`);
                continue;
            }
            const state = decodeGuard(guardData);
            const supply = mintSupply(mintData);
            this.log(
                `${guard.name}: ${guardStatus(state, supply, now)} | backing ${state.backing} | supply ${supply}` +
                    ` | Ethereum block ${state.backingEthBlock} | paused ${state.paused}` +
                    (state.tripped
                        ? ` | tripped at block ${state.tripEthBlock}, deficit ${state.tripDeficit}`
                        : '')
            );
        }
    }

    /**
     * Checkpoints, snapshots and submits on the configured intervals, forever.
     * One job at a time, so jobs never race on the state file.
     */
    async run() {
        const { snapshotSecs, checkpointSecs, pollSecs } =
            this.config.intervals;
        const last = { checkpoint: 0, snapshot: 0 };
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
            jobs.push(['submit', () => this.submit()]);
            for (const [name, job] of jobs) {
                try {
                    await job();
                } catch (error) {
                    this.log(`${name} failed: ${(error as Error).message}`);
                }
            }
            await new Promise((resolve) =>
                setTimeout(resolve, pollSecs * 1000)
            );
        }
    }
}
