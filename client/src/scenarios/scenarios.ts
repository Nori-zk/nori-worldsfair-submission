// The scenarios, as steps on a guard's lockbox and mint (engine.ts). Every
// amount is in tokens; the lockbox starts at 116,723.52, the mint at 116,700.
// `tolerance` is 1 token, so supply may exceed backing by up to 1 without a
// trip. Each track's lockbox and mint are restored at the end.
import {
    all,
    BASE_LOCKED,
    BASE_SUPPLY,
    expectDeficit,
    expectStatus,
    wait,
    type Scenario,
} from './engine.js';

const healthy = expectStatus('HEALTHY');
const notTripped = expectStatus('HEALTHY', 'WARN');

/** The first read on a fresh guard, and a baseline for every later check. */
export const baseline: Scenario = {
    id: 'S0',
    title: 'Baseline: nothing changes, the read says HEALTHY',
    steps: [
        {
            name: 'snapshot with nothing changed',
            act: (c) => c.snapshot(),
            expect: healthy,
        },
    ],
};

export const pause: Scenario = {
    id: 'S1',
    title: 'Pause at source, then unpause',
    steps: [
        {
            name: 'pause the lockbox',
            act: (c) => c.set(BASE_LOCKED, true),
            expect: expectStatus('PAUSED_AT_SOURCE'),
        },
        {
            name: 'unpause',
            act: (c) => c.set(BASE_LOCKED, false),
            expect: healthy,
        },
    ],
};

/** Lock on Ethereum, then mint on Solana: a transfer in flight. */
export const inFlight: Scenario = {
    id: 'S2',
    title: 'Inbound transfer in flight: lock +100, then mint +100',
    steps: [
        {
            name: 'lock +100 on Ethereum, mint +100 on Solana 20 s later',
            act: async (c) => {
                await c.set(BASE_LOCKED + 100);
                await new Promise((r) => setTimeout(r, 20_000));
                await c.mintTokens(100);
            },
            // The backing read at the lock's block covers the mint
            expect: notTripped,
        },
        {
            name: 'next read, both sides settled',
            act: (c) => c.snapshot(),
            expect: healthy,
        },
        {
            name: 'restore: burn 100, unlock 100',
            act: async (c) => {
                await c.burnTokens(100);
                await c.set(BASE_LOCKED);
            },
            expect: healthy,
        },
    ],
};

/** Burn on Solana, unlock on Ethereum minutes later: must never trip. */
export const burnThenUnlock: Scenario = {
    id: 'S3',
    title: 'Burn 100 on Solana, unlock 100 on Ethereum 5 min later',
    steps: [
        {
            name: 'burn 100',
            act: (c) => c.burnTokens(100),
            // Supply fell below backing: still HEALTHY (backing ≥ supply)
            until: () => true,
            expect: healthy,
        },
        wait(300),
        {
            name: 'unlock 100 (backing drops to supply + 23.52)',
            act: (c) => c.set(BASE_LOCKED - 100),
            expect: healthy,
        },
        {
            name: 'restore: mint 100, lock 100',
            act: async (c) => {
                await c.mintTokens(100);
                await c.set(BASE_LOCKED);
            },
            expect: healthy,
        },
    ],
};

/**
 * The a70c997 case: burn, unlock and snapshot inside one checkpoint
 * interval. The checkpoint before the burn shows the higher supply, and only
 * a checkpoint after the snapshot's block time shows the burn.
 */
export const fastBurnThenUnlock: Scenario = {
    id: 'S4',
    title: 'Fast burn 1,000 then unlock 1,000 within 30 s (regression a70c997)',
    steps: [
        {
            name: 'burn 1,000, unlock 1,000 at once',
            act: async (c) => {
                await c.burnTokens(1_000);
                await c.set(BASE_LOCKED - 1_000);
            },
            expect: healthy,
        },
        {
            name: 'restore: mint 1,000, lock 1,000',
            act: async (c) => {
                await c.mintTokens(1_000);
                await c.set(BASE_LOCKED);
            },
            expect: healthy,
        },
    ],
};

/** Tokens minted on Solana with no lock behind them. */
export const forgedMint: Scenario = {
    id: 'S5',
    title: 'Forged mint of 120,000 on Solana: WARN, then TRIPPED, then unlatch',
    steps: [
        {
            name: 'mint 120,000 with no lock',
            act: async (c) => {
                await c.mintTokens(120_000);
                await c.snapshot();
            },
            // This read's window still holds pre-forgery checkpoints (the
            // minimum), so no trip yet; live supply is above backing: WARN
            expect: expectStatus('WARN'),
        },
        {
            // That read landed ~18 min after the mint, so this snapshot's
            // window (±10 min) holds only post-forgery checkpoints
            name: 'a read with the whole window after the forgery trips',
            act: (c) => c.snapshot(),
            expect: all(
                expectStatus('TRIPPED'),
                expectDeficit(120_000 - 23.52 - 1)
            ),
        },
        {
            name: 'burn the forged 120,000 and unlatch: HEALTHY again',
            act: async (c) => {
                await c.burnTokens(120_000);
                await c.unlatch();
            },
            expect: healthy,
        },
    ],
};

/** The Kelp drain on Ethereum. */
export const drain: Scenario = {
    id: 'S6',
    title: 'Kelp drain: lockbox to 223.52, refill + pause, unlatch too early, full refill',
    steps: [
        {
            name: 'drain to 223.52',
            act: (c) => c.set(223.52),
            expect: all(
                expectStatus('TRIPPED'),
                expectDeficit(BASE_SUPPLY - 223.52 - 1)
            ),
        },
        {
            name: 'attacker refills to 40,300 and pauses: still tripped',
            act: (c) => c.set(40_300, true),
            expect: (_, g) =>
                g.status === 'TRIPPED' && g.state.paused
                    ? undefined
                    : `status ${g.status}, paused ${g.state.paused}`,
        },
        {
            name: 'unlatch while still under-backed: the next read re-trips',
            act: async (c) => {
                await c.set(40_300, false);
                await c.unlatch();
            },
            expect: all(
                expectStatus('TRIPPED'),
                expectDeficit(BASE_SUPPLY - 40_300 - 1)
            ),
        },
        {
            name: 'full refill, then unlatch: HEALTHY',
            act: async (c) => {
                await c.set(BASE_LOCKED);
            },
            // Still tripped (latched) once the refill is read
            expect: expectStatus('TRIPPED'),
        },
        {
            name: 'unlatch with the backing restored',
            act: (c) => c.unlatch(),
            expect: healthy,
        },
    ],
};

/** Order for the two destructive tracks: short ones first. */
export const trackA: Scenario[] = [
    baseline,
    pause,
    inFlight,
    fastBurnThenUnlock,
    drain,
];
export const trackB: Scenario[] = [baseline, burnThenUnlock, forgedMint];
