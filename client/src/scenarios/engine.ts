// A track runs one guard through a list of steps, one per round of the
// campaign loop. A step acts on a chain (or waits), then waits until a
// proven read reflecting the action has reached the guard, then checks the
// guard. Actions must be quick (a few confirmations); long waits are steps.
import { type Address } from '@solana/kit';
import { findGuardAddress, unlatchInstruction } from '../backstop.js';
import type { GuardEntry } from '../keeper/config.js';
import type { GuardReport, Keeper } from '../keeper/keeper.js';
import { burn, lockboxSet, mintTo } from './chains.js';
import type { EventLog } from './log.js';

export const UNIT = 1_000_000_000n; // the demo mints have 9 decimals
export const ETH = 10n ** 18n; // DemoLockbox.locked has 18

export const BASE_LOCKED = 116_723.52;
export const BASE_SUPPLY = 116_700;

export const toUnits = (tokens: number) =>
    BigInt(Math.round(tokens * 1e9)) * (UNIT / 1_000_000_000n);
export const toWei = (tokens: number) =>
    BigInt(Math.round(tokens * 1e9)) * (ETH / 1_000_000_000n);

/** Where the last action left the chains; the default `until` waits past it. */
export interface Mark {
    /** The Ethereum block the action landed in, or the head when it was on Solana. */
    ethBlock: number;
    at: number; // ms
}

export interface Step {
    name: string;
    act?: (c: Ctx) => Promise<void>;
    /** True once the read that reflects the action is on the guard. */
    until?: (c: Ctx, g: GuardReport) => boolean;
    /** Checked once `until` holds; returns why it failed, or nothing. */
    expect?: (c: Ctx, g: GuardReport) => string | undefined;
    timeoutMin?: number;
}

export interface Scenario {
    id: string;
    title: string;
    steps: Step[];
}

export class Ctx {
    mark: Mark = { ethBlock: 0, at: 0 };
    /** Recent statuses of this track's guard, newest last. */
    seen: string[] = [];

    constructor(
        readonly track: string,
        readonly keeper: Keeper,
        readonly log: EventLog,
        readonly guard: GuardEntry,
        readonly lockbox: string
    ) {}

    get mint(): Address {
        return this.guard.mint;
    }

    private setMark(ethBlock: number) {
        this.mark = { ethBlock, at: Date.now() };
    }

    /** Asks the keeper for a snapshot on its next tick. */
    snapshotNow() {
        this.keeper.last.snapshot = 0;
    }

    private action(name: string, fields: Record<string, unknown>) {
        this.log.write('action', { track: this.track, name, ...fields });
    }

    /** Sets the lockbox, then asks for a snapshot. */
    async set(lockedTokens: number, paused = false) {
        const { txHash, block, gasUsed } = await lockboxSet(
            this.keeper.provider,
            this.lockbox,
            toWei(lockedTokens),
            paused
        );
        this.setMark(block);
        this.action('lockbox.set', {
            locked: lockedTokens,
            paused,
            txHash,
            ethBlock: block,
            gasUsed,
        });
        this.snapshotNow();
    }

    async mintTokens(tokens: number) {
        const signature = await mintTo(
            this.keeper.solana,
            this.mint,
            toUnits(tokens)
        );
        this.setMark(await this.keeper.provider.getBlockNumber());
        this.action('mint', {
            tokens,
            signature,
            ethBlock: this.mark.ethBlock,
        });
    }

    async burnTokens(tokens: number) {
        const signature = await burn(
            this.keeper.solana,
            this.mint,
            toUnits(tokens)
        );
        this.setMark(await this.keeper.provider.getBlockNumber());
        this.action('burn', {
            tokens,
            signature,
            ethBlock: this.mark.ethBlock,
        });
    }

    /** Admin `unlatch` on this track's guard only, then a snapshot. */
    async unlatch() {
        const address = await this.guardAddress();
        const signature = await this.keeper.solana.send(
            unlatchInstruction({
                admin: this.keeper.solana.signer.address,
                guard: address,
            })
        );
        this.setMark(await this.keeper.provider.getBlockNumber());
        this.action('unlatch', { signature, ethBlock: this.mark.ethBlock });
        this.snapshotNow();
    }

    /** Marks now and asks for a snapshot (a read with nothing changed). */
    async snapshot() {
        this.setMark(await this.keeper.provider.getBlockNumber());
        this.action('snapshot', { ethBlock: this.mark.ethBlock });
        this.snapshotNow();
    }

    guardAddress() {
        return findGuardAddress(this.mint, this.keeper.solana.signer.address);
    }

    /** Both reads (backing and, if any, pause) from after the mark. */
    readAfterMark(g: GuardReport): boolean {
        const after = BigInt(this.mark.ethBlock);
        return (
            g.state.backingEthBlock > after &&
            (!this.guard.pause || g.state.pauseEthBlock > after)
        );
    }

    /** A backing read whose Ethereum time is `secs` after the mark. */
    readSecsAfterMark(secs: number) {
        return (g: GuardReport) =>
            Number(g.state.backingEthTime) * 1000 > this.mark.at + secs * 1000;
    }
}

/** Expectation helpers. */
export const expectStatus =
    (...allowed: string[]) =>
    (_: Ctx, g: GuardReport) =>
        allowed.includes(g.status)
            ? undefined
            : `status ${g.status}, expected ${allowed.join(' or ')}`;

export const expectDeficit = (tokens: number) => (_: Ctx, g: GuardReport) =>
    g.state.tripDeficit === toUnits(tokens)
        ? undefined
        : `deficit ${g.state.tripDeficit}, expected ${toUnits(tokens)} (${tokens})`;

export const all =
    (...checks: Array<(c: Ctx, g: GuardReport) => string | undefined>) =>
    (c: Ctx, g: GuardReport) =>
        checks.map((check) => check(c, g)).find(Boolean);

/** A step that only waits `secs` (the keeper keeps running meanwhile). */
export const wait = (secs: number): Step => {
    let from = 0;
    return {
        name: `wait ${secs}s`,
        act: async () => {
            from = Date.now();
        },
        until: () => Date.now() >= from + secs * 1000,
    };
};

type Phase = 'idle' | 'acting' | 'waiting';

/** Advances one guard through its scenarios, one check per round. */
export class Track {
    private scenario = 0;
    private step = 0;
    private phase: Phase = 'idle';
    private startedAt = 0;
    done = false;

    constructor(
        readonly ctx: Ctx,
        readonly scenarios: Scenario[]
    ) {}

    private get current(): { scenario: Scenario; step: Step } | undefined {
        const scenario = this.scenarios[this.scenario];
        const step = scenario?.steps[this.step];
        return scenario && step ? { scenario, step } : undefined;
    }

    private finish(result: 'pass' | 'fail', reason?: string) {
        const { scenario, step } = this.current;
        this.ctx.log.write('step', {
            track: this.ctx.track,
            scenario: scenario.id,
            title: scenario.title,
            step: step.name,
            result,
            reason,
            minutes: +((Date.now() - this.startedAt) / 60_000).toFixed(1),
        });
        this.phase = 'idle';
        this.step += 1;
        if (this.step >= scenario.steps.length) {
            this.step = 0;
            this.scenario += 1;
            if (this.scenario >= this.scenarios.length) this.done = true;
        }
    }

    /** Restarts the scenarios from the first (continuous mode). */
    restart() {
        this.scenario = 0;
        this.step = 0;
        this.phase = 'idle';
        this.done = false;
    }

    async advance(report: GuardReport | undefined) {
        const current = this.current;
        if (!current || this.done) return;
        const { scenario, step } = current;
        const { ctx } = this;
        if (report) ctx.seen.push(report.status);
        if (this.phase === 'idle') {
            this.phase = 'acting';
            this.startedAt = Date.now();
            ctx.seen = [];
            ctx.log.write('step', {
                track: ctx.track,
                scenario: scenario.id,
                title: scenario.title,
                step: step.name,
                result: 'start',
            });
            try {
                await step.act?.(ctx);
            } catch (error) {
                this.finish('fail', `action failed: ${message(error)}`);
                return;
            }
            this.phase = 'waiting';
            return;
        }
        if (this.phase !== 'waiting' || !report) return;
        const until = step.until ?? ((c, g) => c.readAfterMark(g));
        if (!until(ctx, report)) {
            const limit = (step.timeoutMin ?? 45) * 60_000;
            if (Date.now() - this.startedAt > limit)
                this.finish(
                    'fail',
                    `no read after ${step.timeoutMin ?? 45} min`
                );
            return;
        }
        const reason = step.expect?.(ctx, report);
        this.finish(reason ? 'fail' : 'pass', reason);
    }
}

function message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
