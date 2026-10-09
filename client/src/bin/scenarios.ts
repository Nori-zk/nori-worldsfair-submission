#!/usr/bin/env node
// Runs the keeper and the test scenarios in one process (one Ethereum key, one
// nonce), and records everything to OUT/events.jsonl:
//
//   keeper jobs  → snapshot / checkpoint / read / applied, with CU and the
//                  Ethereum block → finalized → proven → applied split
//   scenarios    → each step's action, the read it waited for, pass/fail
//   attacks      → after each applied read, simulated attacks on each guard
//   status       → each round, every guard; TypeScript vs program `status`
//
// Usage: scenarios <config.json> <OUT dir> [--once | --continuous]
//   Guards named in TRACKS below get scenarios; the others are observed only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Signature } from '@solana/kit';
import { fetchBridgeState } from '@nori-zk/nori-bridge-solana-sdk';
import { parseSnapshotEvent } from '../snapshotWitness.js';
import { loadConfig, loadEnv } from '../keeper/config.js';
import { Keeper, statusLines } from '../keeper/keeper.js';
import { programStatus, runAttacks } from '../scenarios/attacks.js';
import { computeUnits } from '../scenarios/chains.js';
import { Ctx, Track } from '../scenarios/engine.js';
import { EventLog } from '../scenarios/log.js';
import { trackA, trackB } from '../scenarios/scenarios.js';
import { writeReport } from '../scenarios/report.js';

const [configPath, outDir, mode = '--once'] = process.argv.slice(2);
if (!configPath || !outDir) {
    console.error(
        'Usage: scenarios <config.json> <OUT dir> [--once | --continuous]'
    );
    process.exit(1);
}
loadEnv();
const config = loadConfig(configPath);
mkdirSync(outDir, { recursive: true });
const log = new EventLog(path.join(outDir, 'events.jsonl'));
const keeper = await Keeper.connect(config);

/** Which guard runs which scenarios; its lockbox comes from the env. */
const TRACKS: Record<string, { scenarios: typeof trackA; lockboxEnv: string }> =
    {
        'test-a': {
            scenarios: trackA,
            lockboxEnv: 'NORI_ETH_TEST_A_LOCKBOX_ADDRESS',
        },
        'test-b': {
            scenarios: trackB,
            lockboxEnv: 'NORI_ETH_TEST_B_LOCKBOX_ADDRESS',
        },
    };
const tracks: Track[] = [];
for (const guard of config.guards) {
    const spec = TRACKS[guard.name];
    if (!spec) continue;
    const lockbox = process.env[spec.lockboxEnv];
    if (!lockbox) throw new Error(`Missing env: ${spec.lockboxEnv}`);
    tracks.push(
        new Track(
            new Ctx(guard.name, keeper, log, guard, lockbox),
            spec.scenarios
        )
    );
}

// Snapshots in flight: sent → block → finalized → proven → applied
interface Flight {
    txHash: string;
    sentAt: number;
    block?: number;
    blockTime?: number;
    requestId?: number;
    finalizedAt?: number;
    provenAt?: number;
    appliedAt?: number;
    reads: Array<{ guard: string; kind: number; signature: string }>;
}
const flightsPath = path.join(outDir, 'flights.json');
const flights: Map<string, Flight> = new Map(
    existsSync(flightsPath)
        ? (JSON.parse(readFileSync(flightsPath, 'utf8')) as Flight[]).map(
              (f) => [f.txHash, f]
          )
        : []
);
const saveFlights = () =>
    writeFileSync(flightsPath, JSON.stringify([...flights.values()], null, 2));

/** Which applied snapshot each guard last read, for the attacks. */
const lastApplied = new Map<string, string>();

keeper.onEvent = (event) => {
    switch (event.type) {
        case 'snapshot': {
            const flight: Flight = {
                txHash: event.txHash,
                sentAt: Date.now(),
                block: event.block,
                reads: [],
            };
            flights.set(event.txHash, flight);
            log.write('snapshot', {
                txHash: event.txHash,
                block: event.block,
                queries: event.queries,
            });
            break;
        }
        case 'checkpoint':
            log.write('checkpoint', {
                guard: event.guard,
                signature: event.signature,
            });
            break;
        case 'read': {
            flights.get(event.txHash)?.reads.push({
                guard: event.guard,
                kind: event.kind,
                signature: event.signature,
            });
            lastApplied.set(event.guard, event.txHash);
            log.write('read', {
                guard: event.guard,
                txHash: event.txHash,
                kind: event.kind === 0 ? 'backing' : 'pause',
                signature: event.signature,
            });
            break;
        }
        case 'applied': {
            const flight = flights.get(event.txHash);
            if (flight) flight.appliedAt = Date.now();
            log.write('applied', { txHash: event.txHash });
            break;
        }
        case 'error':
            log.write('error', { job: event.job, message: event.message });
            break;
    }
    saveFlights();
};

const nothing = (): null => null;

/**
 * Fills in block time, finality and proof time for snapshots in flight. The
 * poll interval bounds each timestamp's precision (pollSecs).
 */
async function observeFlights() {
    const finalized = await keeper.provider
        .getBlock('finalized')
        .catch(nothing);
    const nori = await fetchBridgeState(
        keeper.solana.rpc,
        config.solana.noriProgram
    ).catch(nothing);
    for (const flight of flights.values()) {
        if (flight.appliedAt && flight.blockTime && flight.provenAt) continue;
        if (!flight.block) {
            const receipt = await keeper.provider
                .getTransactionReceipt(flight.txHash)
                .catch(nothing);
            if (receipt) flight.block = receipt.blockNumber;
        }
        if (flight.block && !flight.blockTime) {
            const block = await keeper.provider
                .getBlock(flight.block)
                .catch(nothing);
            if (block) flight.blockTime = block.timestamp * 1000;
        }
        if (
            flight.block &&
            !flight.finalizedAt &&
            finalized &&
            finalized.number >= flight.block
        )
            flight.finalizedAt = Date.now();
        if (flight.block && !flight.requestId) {
            const receipt = await keeper.provider
                .getTransactionReceipt(flight.txHash)
                .catch(nothing);
            const event =
                receipt &&
                parseSnapshotEvent(receipt, config.ethereum.noriSnapshot);
            if (event) flight.requestId = Number(event.requestId);
        }
        // Proven once Nori's queue cursor is past the request id
        if (
            flight.requestId !== undefined &&
            !flight.provenAt &&
            nori &&
            nori.queueCursor > BigInt(flight.requestId)
        )
            flight.provenAt = Math.min(
                Date.now(),
                flight.appliedAt ?? Infinity
            );
        // Old flights that never finish: give up after 2 h
        if (!flight.appliedAt && Date.now() - flight.sentAt > 2 * 3_600_000) {
            log.write('flight.abandoned', { txHash: flight.txHash });
            flights.delete(flight.txHash);
        }
    }
    saveFlights();
}

/** CU for reads and checkpoints, once; the keeper's tick sends them. */
const unitsSeen = new Set<string>();
async function observeUnits() {
    for (const flight of flights.values()) {
        for (const read of flight.reads) {
            if (unitsSeen.has(read.signature)) continue;
            const units = await computeUnits(
                keeper.solana,
                read.signature as Signature
            ).catch((): undefined => undefined);
            if (units === undefined) continue;
            unitsSeen.add(read.signature);
            log.write('units', {
                instruction:
                    read.kind === 0
                        ? 'submit_read.backing'
                        : 'submit_read.pause',
                guard: read.guard,
                signature: read.signature,
                units,
            });
        }
    }
}

const attacked = new Set<string>();
let round = 0;
let shown = new Set<string>();

for (;;) {
    round += 1;
    // Observe before the tick: a read the tick applies was proven before it
    try {
        await observeFlights();
    } catch (error) {
        log.write('error', {
            job: 'observe',
            message: error instanceof Error ? error.message : String(error),
        });
    }
    await keeper.tick();
    try {
        await observeUnits();
        const report = await keeper.statusReport();
        const lines = statusLines(report);
        for (const line of lines)
            if (!shown.has(line))
                console.log(`${new Date().toISOString()} ${line}`);
        shown = new Set(lines);
        log.write('status', {
            nori: report.nori,
            queueHead: report.queueHead,
            pending: report.pending,
            guards: report.guards.map((g) => ({
                name: g.name,
                status: g.status,
                backing: g.state.backing,
                supply: g.supply,
                backingEthBlock: g.state.backingEthBlock,
                backingEthTime: g.state.backingEthTime,
                paused: g.state.paused,
                tripped: g.state.tripped,
                tripDeficit: g.state.tripDeficit,
                checkpointCount: g.state.checkpointCount,
            })),
        });

        // The program's status vs the TypeScript mirror, and attacks after a new read
        for (const guard of config.guards) {
            const g = report.guards.find((r) => r.name === guard.name);
            if (!g) continue;
            if (round % 4 === 1) {
                const onChain = await programStatus(keeper, guard);
                log.write('status.check', {
                    guard: guard.name,
                    typescript: g.status,
                    ...onChain,
                    pass: 'status' in onChain && onChain.status === g.status,
                });
            }
            const txHash = lastApplied.get(guard.name);
            const key = `${guard.name}:${txHash}`;
            if (txHash && !attacked.has(key)) {
                attacked.add(key);
                const results = await runAttacks(keeper, guard, g, txHash);
                for (const r of results)
                    log.write('attack', { guard: guard.name, txHash, ...r });
            }
        }

        for (const track of tracks) {
            await track.advance(
                report.guards.find((g) => g.name === track.ctx.track)
            );
            if (track.done && mode === '--continuous') {
                log.write('track.restart', { track: track.ctx.track });
                track.restart();
            }
        }
        if (tracks.length && tracks.every((t) => t.done) && mode === '--once') {
            // Every scenario has its verdict: stop snapshotting, let the reads
            // already in flight land (their latency counts), then stop
            keeper.last.snapshot = Infinity;
            if ([...flights.values()].every((f) => f.appliedAt)) {
                log.write('campaign.done', {});
                await writeReport(outDir, keeper);
                process.exit(0);
            }
        }
        if (round % 10 === 0) await writeReport(outDir, keeper);
    } catch (error) {
        log.write('error', {
            job: 'round',
            message:
                error instanceof Error
                    ? (error.stack ?? error.message)
                    : String(error),
        });
    }
    await new Promise((r) => setTimeout(r, config.intervals.pollSecs * 1000));
}
