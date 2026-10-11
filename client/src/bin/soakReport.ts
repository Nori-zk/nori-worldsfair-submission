#!/usr/bin/env node
// Summarizes a `keeper run` log as Markdown: snapshots, time from each
// snapshot's Ethereum block to its reads applied on Solana, failures,
// checkpoint gaps and status changes, then each guard's status now.
// Usage: soak-report <config.json> <keeper.log>
import { readFileSync } from 'node:fs';
import { FetchRequest, JsonRpcProvider } from 'ethers';
import { switchMap } from 'rxjs';
import { loadConfig, loadEnv } from '../keeper/config.js';
import { Keeper } from '../keeper/keeper.js';
import { RPC_TIMEOUT_MS } from '../keeper/solana.js';

const [configPath, logPath] = process.argv.slice(2);
if (!configPath || !logPath) {
    console.error('Usage: soak-report <config.json> <keeper.log>');
    process.exit(1);
}
loadEnv();
const config = loadConfig(configPath);
const request = new FetchRequest(config.ethereum.rpcUrl);
request.timeout = RPC_TIMEOUT_MS;
const provider = new JsonRpcProvider(request);

interface Line {
    at: number;
    text: string;
}
const lines: Line[] = readFileSync(logPath, 'utf8')
    .split('\n')
    .map((raw) => /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(raw))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ at: Date.parse(m[1] ?? ''), text: m[2] ?? '' }));
if (!lines.length) {
    console.log('# Soak report\n\nNo keeper output in the log.');
    process.exit(0);
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const mins = (ms: number) => (ms / 60_000).toFixed(1);
const first = lines[0]?.at ?? 0;
const last = lines[lines.length - 1]?.at ?? 0;

// Snapshots: sent, then "reads submitted" once proven and applied
const sent = new Map<string, number>();
const applied = new Map<string, number>();
const failures = new Map<string, number>();
const checkpoints = new Map<string, number[]>();
const statusChanges: string[] = [];
const lastStatus = new Map<string, string>();
for (const { at, text } of lines) {
    const snapshot = /^snapshot (0x[0-9a-f]{64}): (.*)$/.exec(text);
    if (snapshot?.[1] && snapshot[2]) {
        if (snapshot[2] === 'reads submitted') applied.set(snapshot[1], at);
        // "N queries, block B" or "not mined after …": the keeper sent it
        else if (
            /queries|not mined/.test(snapshot[2]) &&
            !sent.has(snapshot[1])
        )
            sent.set(snapshot[1], at);
    }
    if (/failed|FAILED/.test(text)) {
        const key = text
            .replace(/0x[0-9a-f]{8,}/gi, '0x…')
            .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, '<address>')
            .slice(0, 160);
        failures.set(key, (failures.get(key) ?? 0) + 1);
    }
    const checkpoint = /^(\S+): checkpoint$/.exec(text);
    if (checkpoint?.[1])
        checkpoints.set(checkpoint[1], [
            ...(checkpoints.get(checkpoint[1]) ?? []),
            at,
        ]);
    const status = /^(\S+): ([A-Z_]+) \|/.exec(text);
    if (status?.[1] && status[2] && lastStatus.get(status[1]) !== status[2]) {
        lastStatus.set(status[1], status[2]);
        statusChanges.push(`| ${iso(at)} | ${status[1]} | ${status[2]} |`);
    }
}

// Latency: the snapshot's Ethereum block time to its reads applied
const rows: string[] = [];
const latencies: number[] = [];
for (const [hash, sentAt] of sent) {
    let blockTime: number | undefined;
    try {
        const receipt = await provider.getTransactionReceipt(hash);
        const block = receipt && (await provider.getBlock(receipt.blockNumber));
        if (block) blockTime = block.timestamp * 1000;
    } catch {
        // left blank in the table
    }
    const appliedAt = applied.get(hash);
    const latency =
        blockTime !== undefined && appliedAt !== undefined
            ? appliedAt - blockTime
            : undefined;
    if (latency !== undefined) latencies.push(latency);
    rows.push(
        `| ${hash.slice(0, 12)}… | ${blockTime ? iso(blockTime) : iso(sentAt) + ' (sent)'} | ${appliedAt ? iso(appliedAt) : 'not yet'} | ${latency !== undefined ? mins(latency) : ''} |`
    );
}
const sorted = [...latencies].sort((a, b) => a - b);
const pick = (q: number) =>
    sorted.length
        ? mins(
              sorted[
                  Math.min(sorted.length - 1, Math.floor(q * sorted.length))
              ] ?? 0
          )
        : '-';
const gaps = [...checkpoints].map(([guard, times]) => {
    const longest = times
        .slice(1)
        .reduce((max, at, i) => Math.max(max, at - (times[i] ?? at)), 0);
    return `${guard}: ${times.length} checkpoints, longest gap ${mins(longest)} min`;
});

const out: string[] = [
    '# Soak report',
    '',
    `Log: ${iso(first)} → ${iso(last)} (${mins(last - first)} min), config \`${configPath}\``,
    '',
    '| | |',
    '| --- | --- |',
    `| Snapshots sent | ${sent.size} |`,
    `| Snapshots applied | ${applied.size} |`,
    `| Not applied by the end | ${[...sent.keys()].filter((h) => !applied.has(h)).length} |`,
    `| Ethereum block → reads applied (min) | min ${pick(0)} · median ${pick(0.5)} · p90 ${pick(0.9)} · max ${pick(1)} |`,
    `| Failure lines | ${[...failures.values()].reduce((a, b) => a + b, 0)} |`,
    `| Checkpoints | ${gaps.join('; ') || 'none'} |`,
    '',
    '## Status changes',
    '',
    '| When | Guard | Status |',
    '| --- | --- | --- |',
    ...statusChanges,
    '',
    '## Failures (by message)',
    '',
    ...(failures.size
        ? [...failures].map(([text, n]) => `- ${n}× ${text}`)
        : ['None.']),
    '',
    '## Snapshots',
    '',
    '| Tx | Ethereum block time | Reads applied | Minutes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Status now',
    '',
    '```',
];
console.log(out.join('\n'));
let connected: Keeper | undefined;
Keeper.connect$(config)
    .pipe(
        switchMap((keeper) => {
            connected = keeper;
            return keeper.status$();
        })
    )
    .subscribe({
        complete: () => {
            console.log('```');
            connected?.close();
            process.exit(0);
        },
        error: (error: unknown) => {
            console.error(error);
            connected?.close();
            process.exit(1);
        },
    });
