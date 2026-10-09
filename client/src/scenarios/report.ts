// report.md and dashboard.html from OUT/events.jsonl and OUT/flights.json,
// arranged as the product has to show it: the board (every number with its
// Ethereum block, age and explorer links), the spec's acceptance claims with
// the evidence for each, a timeline per guard, latency and costs. Raw tables
// go in an appendix.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findGuardAddress } from '../backstop.js';
import type { Keeper } from '../keeper/keeper.js';
import { EventLog, type Event } from './log.js';

interface Flight {
    txHash: string;
    sentAt: number;
    block?: number;
    blockTime?: number;
    finalizedAt?: number;
    provenAt?: number;
    appliedAt?: number;
    reads: Array<{ guard: string; kind: number; signature: string }>;
}

const ETHERSCAN = 'https://sepolia.etherscan.io';
const EXPLORER = (kind: 'tx' | 'address', id: string) =>
    `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const CLUSTERS = 'Ethereum Sepolia → Solana devnet';

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + 'Z';
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + 'Z';
const min1 = (ms: number) => (ms / 60_000).toFixed(1);
const short = (s: string) => s.slice(0, 8) + '…';
const tokens = (units: bigint | string | number) =>
    (Number(units) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 });
const quantile = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length
        ? (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0)
        : 0;
};
const range = (xs: number[]) =>
    xs.length
        ? `${Math.min(...xs).toLocaleString()}–${Math.max(...xs).toLocaleString()}`
        : '–';

type Result = 'pass' | 'fail' | 'pending';
interface Link {
    label: string;
    url: string;
}
interface Claim {
    claim: string;
    source: string;
    test: string;
    result: Result;
    evidence: Link[];
    note?: string;
}
interface Row {
    name: string;
    role: string;
    status: string;
    backing: bigint;
    supply: bigint;
    ethBlock: bigint;
    ethTime: number;
    paused: boolean;
    tripped: boolean;
    tripDeficit: bigint;
    links: Link[];
}
interface Moment {
    at: number;
    kind: 'action' | 'read' | 'pass' | 'fail' | 'status';
    text: string;
    link?: Link;
}
interface StatusGuard {
    name: string;
    status: string;
    backing: string;
    supply: string;
    backingEthBlock: string;
    backingEthTime: string;
    paused: boolean;
    tripped: boolean;
    tripDeficit: string;
}
const statusGuards = (e: Event | undefined) =>
    (e?.guards ?? []) as StatusGuard[];

export async function writeReport(outDir: string, keeper?: Keeper) {
    const events = EventLog.read(path.join(outDir, 'events.jsonl'));
    const flightsPath = path.join(outDir, 'flights.json');
    const flights: Flight[] = existsSync(flightsPath)
        ? (JSON.parse(readFileSync(flightsPath, 'utf8')) as Flight[])
        : [];
    for (const f of flights)
        if (f.provenAt && f.appliedAt && f.provenAt > f.appliedAt)
            f.provenAt = f.appliedAt;
    const now = Date.now();
    const first = events[0]?.at ?? now;
    const last = events[events.length - 1]?.at ?? now;
    const of = (type: string) => events.filter((e) => e.type === type);
    const statusEvents = of('status');
    const steps = of('step').filter((e) => e.result !== 'start');
    const started = of('step').filter((e) => e.result === 'start');
    const attacks = of('attack');
    const checks = of('status.check');
    const units = of('units');
    const actions = of('action');
    const reads = of('read');
    const errors = of('error');
    const lastStatus = statusEvents[statusEvents.length - 1];
    const tracks = [...new Set(actions.map((a) => String(a.track)))].sort();

    // ---- Board: the last status of each guard, with links
    const board: Row[] = [];
    for (const g of statusGuards(lastStatus)) {
        const links: Link[] = [];
        const entry = keeper?.config.guards.find((x) => x.name === g.name);
        if (entry && keeper) {
            const guard = await findGuardAddress(
                entry.mint,
                keeper.solana.signer.address
            );
            links.push(
                { label: 'guard', url: EXPLORER('address', guard) },
                { label: 'mint', url: EXPLORER('address', entry.mint) },
                {
                    label: 'lockbox',
                    url: `${ETHERSCAN}/address/${entry.backing.target}`,
                }
            );
        }
        const lastRead = [...reads]
            .reverse()
            .find((r) => r.guard === g.name && r.kind === 'backing');
        if (lastRead)
            links.push({
                label: 'last read',
                url: EXPLORER('tx', String(lastRead.signature)),
            });
        board.push({
            name: g.name,
            role: tracks.includes(g.name) ? 'scenarios' : 'control (untouched)',
            status: g.status,
            backing: BigInt(g.backing),
            supply: BigInt(g.supply),
            ethBlock: BigInt(g.backingEthBlock),
            ethTime: Number(g.backingEthTime) * 1000,
            paused: g.paused,
            tripped: g.tripped,
            tripDeficit: BigInt(g.tripDeficit),
            links,
        });
    }

    // ---- Status history per guard
    const history = new Map<string, Array<{ at: number; status: string }>>();
    for (const s of statusEvents)
        for (const g of statusGuards(s)) {
            const list = history.get(g.name) ?? [];
            if (list[list.length - 1]?.status !== g.status)
                list.push({ at: s.at, status: g.status });
            history.set(g.name, list);
        }

    // ---- Claims (spec §6 acceptance criteria and the pitch's numbers)
    const txLinks = (s: Event): Link[] => {
        const act = [...actions]
            .reverse()
            .find((x) => x.track === s.track && x.at <= s.at);
        const read = [...reads]
            .reverse()
            .find(
                (r) =>
                    r.guard === s.track && r.at <= s.at && r.kind === 'backing'
            );
        const out: Link[] = [];
        if (act?.txHash)
            out.push({
                label: `${String(act.name)} (Sepolia)`,
                url: `${ETHERSCAN}/tx/${String(act.txHash)}`,
            });
        else if (act?.signature)
            out.push({
                label: `${String(act.name)} (devnet)`,
                url: EXPLORER('tx', String(act.signature)),
            });
        if (read)
            out.push({
                label: 'read applied',
                url: EXPLORER('tx', String(read.signature)),
            });
        return out;
    };
    /** A claim backed by the steps of `scenario` whose name contains one of `names` (all steps when empty). */
    const claimOf = (
        claim: string,
        source: string,
        scenario: string,
        test: string,
        ...names: string[]
    ): Claim => {
        const match = (s: Event) =>
            s.scenario === scenario &&
            (!names.length || names.some((n) => String(s.step).includes(n)));
        const done = steps.filter(match);
        const open = started
            .filter(match)
            .filter(
                (s) =>
                    !done.some((d) => d.step === s.step && d.track === s.track)
            );
        const failed = done.find((s) => s.result === 'fail');
        const result: Result = failed
            ? 'fail'
            : done.length && !open.length
              ? 'pass'
              : 'pending';
        return {
            claim,
            source,
            test,
            result,
            evidence: [
                ...new Map(
                    done.flatMap(txLinks).map((l) => [l.url, l])
                ).values(),
            ],
            note: failed
                ? String(failed.reason)
                : done.length
                  ? `${done.map((s) => `${String(s.step)}: ${String(s.minutes)} min`).join('; ')}${open.length ? '; next step running' : ''}`
                  : open.length
                    ? 'running'
                    : undefined,
        };
    };
    const attackClaim = (claim: string, names: string[]): Claim => {
        const list = attacks.filter((x) =>
            names.some((n) => String(x.name).startsWith(n))
        );
        const failed = list.filter((x) => !x.pass);
        return {
            claim,
            source: 'spec §6, pitch §6',
            test: `simulated after each applied read: ${names.join('; ')}`,
            result: !list.length ? 'pending' : failed.length ? 'fail' : 'pass',
            evidence: [],
            note: list.length
                ? `${list.length - failed.length} of ${list.length} rejected with the expected error${failed.length ? `; got ${[...new Set(failed.map((x) => String(x.got)))].join(', ')}` : ''}`
                : undefined,
        };
    };

    const control = board.find((b) => b.role.startsWith('control'));
    const controlHistory = history.get(control?.name ?? '') ?? [];
    const controlBad = controlHistory.filter(
        (h) => h.status === 'TRIPPED' || h.status === 'WARN'
    );
    const staleFirst = [...history]
        .filter(([, h]) => h[0]?.status === 'STALE')
        .map(([n]) => n);
    const baseline = claimOf(
        'Nothing changes → HEALTHY',
        'spec §6',
        'S0',
        'S0: a snapshot with nothing changed, on each test guard'
    );

    const dur = (f: Flight, a: keyof Flight, b: keyof Flight) =>
        f[a] && f[b] ? Number(f[b]) - Number(f[a]) : undefined;
    const pick = (a: keyof Flight, b: keyof Flight) =>
        flights
            .map((f) => dur(f, a, b))
            .filter((x): x is number => x !== undefined);
    const total = pick('blockTime', 'appliedAt');
    const toFinal = pick('blockTime', 'finalizedAt');
    const toProven = pick('finalizedAt', 'provenAt');
    const toApplied = pick('provenAt', 'appliedAt');
    const median = quantile(total, 0.5) / 60_000;
    const cuOf = (name: string) =>
        units.filter((u) => u.instruction === name).map((u) => Number(u.units));
    const cu = {
        backing: cuOf('submit_read.backing'),
        pause: cuOf('submit_read.pause'),
        assert: attacks
            .filter(
                (x) =>
                    String(x.name).startsWith('assert_healthy') &&
                    x.units !== undefined
            )
            .map((x) => Number(x.units)),
        status: checks
            .filter((c) => c.units !== undefined)
            .map((c) => Number(c.units)),
    };
    const checkFails = checks.filter((c) => !c.pass);

    const claims: Claim[] = [
        {
            ...baseline,
            claim: 'Nothing changes → HEALTHY; an untouched guard never warns or trips',
            test: `${baseline.test}; ${control?.name ?? 'the control guard'} observed every round`,
            result: controlBad.length ? 'fail' : baseline.result,
            note: `${baseline.note ?? ''}${controlHistory.length ? `${baseline.note ? '. ' : ''}${control?.name}: ${controlHistory.map((h) => `${h.status} ${hhmm(h.at)}`).join(' → ')}` : ''}`,
        },
        {
            claim: 'No proof → STALE',
            source: 'spec §6',
            test: 'a fresh guard before its first read',
            result: staleFirst.length
                ? 'pass'
                : statusEvents.length
                  ? 'fail'
                  : 'pending',
            evidence: [],
            note: staleFirst.length
                ? `${staleFirst.join(', ')} started STALE`
                : undefined,
        },
        claimOf(
            'Paused on Ethereum → PAUSED_AT_SOURCE; unpaused → HEALTHY',
            'spec §6, pitch §5 "pause mirroring"',
            'S1',
            'S1: pause the lockbox, then unpause'
        ),
        claimOf(
            'An inbound transfer within the proof lag → WARN at most, never TRIPPED',
            'spec §6, §2.2 rules',
            'S2',
            'S2: lock +100 on Ethereum, mint +100 on Solana 20 s later; then settled; then restored'
        ),
        claimOf(
            'Burn then unlock → no trip',
            'spec §6',
            'S3',
            'S3: burn 100, unlock 100 five minutes later'
        ),
        claimOf(
            'A fast burn then unlock inside one checkpoint interval → no trip',
            'a70c997 regression',
            'S4',
            'S4: burn 1,000 and unlock 1,000 at once'
        ),
        claimOf(
            'A forged Solana mint → WARN, then TRIPPED once the window is past it',
            'spec §6, pitch §6 (Wormhole 2022)',
            'S5',
            'S5: mint 120,000 with no lock',
            'mint 120',
            'whole window'
        ),
        claimOf(
            'An Ethereum drain → TRIPPED, with the deficit',
            'spec §6, pitch §6 (Kelp)',
            'S6',
            'S6: lockbox 116,723.52 → 223.52',
            'drain'
        ),
        claimOf(
            'A refill after a trip → still TRIPPED (latched); a pause shows too',
            'spec §6, §2.2 latch',
            'S6',
            'S6: refill to 40,300 and pause',
            'refills'
        ),
        claimOf(
            'Unlatch while still under-backed → the next read trips again',
            'spec §2.2',
            'S6',
            'S6: unlatch at 40,300',
            'under-backed'
        ),
        claimOf(
            'Admin unlatch after the backing is back → HEALTHY',
            'pitch §6',
            'S6',
            'S6: full refill, then unlatch',
            'full refill',
            'backing restored'
        ),
        attackClaim('Old and forged reads are refused', [
            'replay',
            'tamper',
            'the pause result',
            'a proof queue batch',
        ]),
        attackClaim('Only the admin can unlatch', ['unlatch signed']),
        attackClaim(
            'assert_healthy fails unless HEALTHY (a lender’s deposit stops there)',
            ['assert_healthy']
        ),
        {
            claim: 'About 20 minutes end to end (soak: median 18, 15–22)',
            source: 'pitch §3, review §2',
            test: 'Ethereum block time → read applied on Solana, every snapshot',
            result:
                total.length < 3
                    ? 'pending'
                    : median >= 14 && median <= 25
                      ? 'pass'
                      : 'fail',
            evidence: [],
            note: total.length
                ? `n=${total.length}: median ${median.toFixed(1)}, min ${min1(quantile(total, 0))}, p90 ${min1(quantile(total, 0.9))}, max ${min1(quantile(total, 1))} min`
                : undefined,
        },
        {
            claim: 'submit_read ≈ 17.6k CU; assert_healthy under 30k CU',
            source: 'spec §6, pitch §4',
            test: 'compute units of every confirmed read; assert_healthy and status simulated',
            result: !cu.backing.length
                ? 'pending'
                : Math.max(...cu.backing) < 25_000 &&
                    Math.max(...cu.assert, 0) < 30_000
                  ? 'pass'
                  : 'fail',
            evidence: [],
            note: cu.backing.length
                ? `submit_read backing ${range(cu.backing)}, pause ${range(cu.pause)}, assert_healthy ${range(cu.assert)}, status ${range(cu.status)} CU`
                : undefined,
        },
        {
            claim: 'The TypeScript status mirror agrees with the program',
            source: 'client/README',
            test: 'guardStatus() vs a simulated status instruction, every fourth round',
            result: !checks.length
                ? 'pending'
                : checkFails.length
                  ? 'fail'
                  : 'pass',
            evidence: [],
            note: checks.length
                ? `${checks.length - checkFails.length} of ${checks.length} agree`
                : undefined,
        },
    ];

    // ---- Timeline per track (action → read → verdict)
    const stories = new Map<string, Moment[]>();
    for (const track of tracks) {
        const moments: Moment[] = [];
        for (const x of actions.filter((a) => a.track === track)) {
            const {
                at: _a,
                type: _t,
                track: _k,
                name,
                txHash,
                signature,
                ethBlock: _b,
                gasUsed: _g,
                ...rest
            } = x;
            const detail = Object.entries(rest)
                .map(([k, v]) => `${k} ${String(v)}`)
                .join(', ');
            moments.push({
                at: x.at,
                kind: 'action',
                text: `${String(name)}${detail ? ` (${detail})` : ''}`,
                link: txHash
                    ? {
                          label: 'Sepolia tx',
                          url: `${ETHERSCAN}/tx/${String(txHash)}`,
                      }
                    : signature
                      ? {
                            label: 'devnet tx',
                            url: EXPLORER('tx', String(signature)),
                        }
                      : undefined,
            });
        }
        for (const r of reads.filter(
            (r) => r.guard === track && r.kind === 'backing'
        )) {
            const g = statusGuards(
                statusEvents.find((s) => s.at >= r.at) ?? lastStatus
            ).find((y) => y.name === track);
            moments.push({
                at: r.at,
                kind: 'read',
                text: `read applied${g ? `: backing ${tokens(g.backing)} at Ethereum block ${g.backingEthBlock}` : ''}`,
                link: {
                    label: 'devnet tx',
                    url: EXPLORER('tx', String(r.signature)),
                },
            });
        }
        for (const s of steps.filter((s) => s.track === track))
            moments.push({
                at: s.at,
                kind: s.result === 'pass' ? 'pass' : 'fail',
                text: `${String(s.scenario)} ${String(s.step)}: ${String(s.result)}${s.reason ? ` (${String(s.reason)})` : ''}, ${String(s.minutes)} min`,
            });
        for (const h of history.get(track) ?? [])
            moments.push({ at: h.at, kind: 'status', text: h.status });
        stories.set(
            track,
            moments.sort((a, b) => a.at - b.at)
        );
    }

    // ---- Summary numbers
    const passed = claims.filter((c) => c.result === 'pass').length;
    const failed = claims.filter((c) => c.result === 'fail').length;
    const stepsPassed = steps.filter((s) => s.result === 'pass').length;
    const nori = (lastStatus?.nori ?? null) as {
        latestHead?: string;
        queueCursor?: string;
        batches?: string;
    } | null;
    const queueHead = String(lastStatus?.queueHead ?? '');
    const gas = actions
        .filter((x) => x.name === 'lockbox.set' && x.gasUsed)
        .map((x) => Number(x.gasUsed));
    const errorMap = new Map<string, number>();
    for (const e of errors) {
        const key = `${String(e.job)}: ${String(e.message)
            .replace(/0x[0-9a-f]{8,}/gi, '0x…')
            .slice(0, 140)}`;
        errorMap.set(key, (errorMap.get(key) ?? 0) + 1);
    }
    const running = now - last < 10 * 60_000;

    // ---- Markdown
    const resultMark = (r: Result) =>
        r === 'pass' ? '✅ pass' : r === 'fail' ? '❌ fail' : '⏳ pending';
    const links = (ls: Link[]) =>
        ls.map((l) => `[${l.label}](${l.url})`).join(', ');
    const md: string[] = [
        `# Backstop campaign: ${CLUSTERS}`,
        '',
        `${iso(first)} → ${iso(last)} (${min1(last - first)} min${running ? ', running' : ''}). ` +
            `Claims: **${passed} pass, ${failed} fail, ${claims.length - passed - failed} pending**. ` +
            `Scenario steps ${stepsPassed} of ${steps.length} passed. ` +
            (nori
                ? `Nori: beacon slot ${nori.latestHead}, ${nori.queueCursor} of ${queueHead} queue requests proven, ${nori.batches} batches.`
                : ''),
        '',
        '## Board',
        '',
        '| Guard | Role | Status | Backing (Ethereum) | Supply (Solana) | Ratio | Ethereum block | Age | Links |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...board.map(
            (b) =>
                `| ${b.name} | ${b.role} | **${b.status}**${b.paused ? ' (paused)' : ''}${b.tripped ? ` deficit ${tokens(b.tripDeficit)}` : ''} | ${tokens(b.backing)} | ${tokens(b.supply)} | ${b.supply ? (Number(b.backing) / Number(b.supply)).toFixed(5) : '-'}x | ${b.ethBlock} | ${b.ethTime ? min1(now - b.ethTime) + ' min' : '-'} | ${links(b.links)} |`
        ),
        '',
        'Backing is the lockbox’s `locked()` proven through Nori; supply is the mint’s live supply. Age is since the read’s Ethereum block.',
        '',
        '## Claims and evidence',
        '',
        '| Claim | Source | Test | Result | Evidence |',
        '| --- | --- | --- | --- | --- |',
        ...claims.map(
            (c) =>
                `| ${c.claim} | ${c.source} | ${c.test} | ${resultMark(c.result)}${c.note ? `<br>${c.note}` : ''} | ${links(c.evidence)} |`
        ),
        '',
        '## Timeline per guard',
        '',
    ];
    for (const [track, moments] of stories) {
        md.push(
            `### ${track}`,
            '',
            '| UTC | +min | Event | Tx |',
            '| --- | --- | --- | --- |'
        );
        let t0 = moments[0]?.at ?? 0;
        for (const m of moments) {
            if (m.kind === 'action') t0 = m.at;
            const mark =
                m.kind === 'pass'
                    ? '✅ '
                    : m.kind === 'fail'
                      ? '❌ '
                      : m.kind === 'status'
                        ? '→ '
                        : m.kind === 'read'
                          ? '⛓ '
                          : '▶ ';
            md.push(
                `| ${hhmm(m.at)} | ${m.kind === 'action' ? '0' : '+' + min1(m.at - t0)} | ${mark}${m.text} | ${m.link ? `[${m.link.label}](${m.link.url})` : ''} |`
            );
        }
        md.push('');
    }
    md.push(
        '## Latency',
        '',
        `Ethereum block → applied on Solana: n=${total.length}, median ${median.toFixed(1)} min (min ${min1(quantile(total, 0))}, p90 ${min1(quantile(total, 0.9))}, max ${min1(quantile(total, 1))}). ` +
            `Of that: block → finalized median ${min1(quantile(toFinal, 0.5))}, finalized → proven by Nori median ${min1(quantile(toProven, 0.5))}, proven → applied by the keeper median ${min1(quantile(toApplied, 0.5))} (poll granularity 0.5 min).`,
        '',
        '## Costs',
        '',
        '| Item | Measured |',
        '| --- | --- |',
        `| submit_read, backing | ${range(cu.backing)} CU (n=${cu.backing.length}) |`,
        `| submit_read, pause | ${range(cu.pause)} CU (n=${cu.pause.length}) |`,
        `| assert_healthy (simulated) | ${range(cu.assert)} CU |`,
        `| status (simulated) | ${range(cu.status)} CU |`,
        `| DemoLockbox.set on Sepolia | ${range(gas)} gas |`,
        `| Snapshots sent / applied | ${flights.length} / ${flights.filter((f) => f.appliedAt).length} (6 queries each) |`,
        '',
        '## Errors',
        '',
        ...(errorMap.size
            ? [...errorMap].map(([k, n]) => `- ${n}× ${k}`)
            : ['None.']),
        '',
        '## Appendix: snapshots',
        '',
        '| Tx | Block | Block time | → finalized | → proven | → applied | Total (min) | Reads |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...flights.map((f) => {
            const bt = f.blockTime;
            const seg = (a: keyof Flight, b: keyof Flight) => {
                const d = dur(f, a, b);
                return d === undefined ? '' : min1(d);
            };
            return `| [${short(f.txHash)}](${ETHERSCAN}/tx/${f.txHash}) | ${f.block ?? ''} | ${bt ? iso(bt) : iso(f.sentAt) + ' (sent)'} | ${seg('blockTime', 'finalizedAt')} | ${seg('finalizedAt', 'provenAt')} | ${seg('provenAt', 'appliedAt')} | ${f.appliedAt ? seg('blockTime', 'appliedAt') : 'in flight'} | ${f.reads.length} |`;
        }),
        '',
        `Generated ${iso(now)} from \`events.jsonl\` (${events.length} events).`,
        ''
    );
    writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));
    writeFileSync(
        path.join(outDir, 'dashboard.html'),
        dashboard({
            first,
            last,
            running,
            nori,
            queueHead,
            board,
            claims,
            stories,
            flights,
            total,
            toFinal,
            toProven,
            toApplied,
            cu,
            gas,
            errorMap,
            stepsPassed,
            stepsTotal: steps.length,
            now,
        })
    );
}

function dashboard(m: {
    first: number;
    last: number;
    running: boolean;
    nori: {
        latestHead?: string;
        queueCursor?: string;
        batches?: string;
    } | null;
    queueHead: string;
    board: Row[];
    claims: Claim[];
    stories: Map<string, Moment[]>;
    flights: Flight[];
    total: number[];
    toFinal: number[];
    toProven: number[];
    toApplied: number[];
    cu: {
        backing: number[];
        pause: number[];
        assert: number[];
        status: number[];
    };
    gas: number[];
    errorMap: Map<string, number>;
    stepsPassed: number;
    stepsTotal: number;
    now: number;
}): string {
    const esc = (s: unknown) =>
        String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const a = (l: Link) =>
        `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
    const chip = (status: string) =>
        `<span class="chip ${status}">${status}</span>`;
    const res = (r: Result) =>
        `<span class="res ${r}">${r === 'pass' ? '✓ pass' : r === 'fail' ? '✗ fail' : '… pending'}</span>`;
    const passed = m.claims.filter((c) => c.result === 'pass').length;
    const failed = m.claims.filter((c) => c.result === 'fail').length;
    const median = quantile(m.total, 0.5) / 60_000;

    const boardHtml = m.board
        .map(
            (b) => `
    <div class="card">
      <div class="card-head"><b>${esc(b.name)}</b> <span class="muted">${esc(b.role)}</span> ${chip(b.status)}</div>
      <div class="nums">
        <div><span class="muted">Backing (Ethereum)</span><br><span class="mono">${tokens(b.backing)}</span></div>
        <div><span class="muted">Supply (Solana)</span><br><span class="mono">${tokens(b.supply)}</span></div>
        <div><span class="muted">Ratio</span><br><span class="mono">${b.supply ? (Number(b.backing) / Number(b.supply)).toFixed(5) : '–'}x</span></div>
        <div><span class="muted">Ethereum block</span><br><span class="mono">${b.ethBlock}</span> <span class="muted">${b.ethTime ? min1(m.now - b.ethTime) + ' min ago' : ''}</span></div>
      </div>
      ${b.tripped ? `<div class="bad">Tripped: deficit ${tokens(b.tripDeficit)} tokens. Latched until the admin unlatches.</div>` : ''}
      ${b.paused ? `<div class="warnline">Paused on Ethereum.</div>` : ''}
      <div class="links">${b.links.map(a).join(' · ')}</div>
    </div>`
        )
        .join('');

    const claimsHtml = m.claims
        .map(
            (c) => `
    <tr><td>${esc(c.claim)}<div class="muted small">${esc(c.source)}</div></td>
        <td class="small">${esc(c.test)}</td>
        <td>${res(c.result)}${c.note ? `<div class="small muted">${esc(c.note)}</div>` : ''}</td>
        <td class="small">${c.evidence.map(a).join('<br>')}</td></tr>`
        )
        .join('');

    const storiesHtml = [...m.stories]
        .map(([track, moments]) => {
            let t0 = moments[0]?.at ?? 0;
            const rows = moments
                .map((mo) => {
                    if (mo.kind === 'action') t0 = mo.at;
                    const plus =
                        mo.kind === 'action' ? '0' : '+' + min1(mo.at - t0);
                    const text =
                        mo.kind === 'status' ? chip(mo.text) : esc(mo.text);
                    return `<tr class="${mo.kind}"><td class="mono">${hhmm(mo.at)}</td><td class="mono">${plus}</td><td>${text}</td><td class="small">${mo.link ? a(mo.link) : ''}</td></tr>`;
                })
                .join('');
            return `<h3>${esc(track)}</h3><table class="timeline"><thead><tr><th>UTC</th><th>+min</th><th>Event</th><th>Tx</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join('');

    // Latency: one bar per applied snapshot, split in three
    const done = m.flights.filter((f) => f.blockTime && f.appliedAt);
    const W = 720;
    const H = 180;
    const maxMin =
        Math.max(
            25,
            ...done.map(
                (f) => ((f.appliedAt ?? 0) - (f.blockTime ?? 0)) / 60_000
            )
        ) * 1.1;
    const bw = Math.max(
        6,
        Math.min(28, (W - 50) / Math.max(1, done.length) - 3)
    );
    let svg = '';
    for (let y = 0; y <= maxMin; y += 5) {
        const py = H - 18 - (y / maxMin) * (H - 30);
        svg += `<line x1="34" x2="${W}" y1="${py}" y2="${py}" class="grid"/><text x="2" y="${py + 4}" class="axis">${y}</text>`;
    }
    done.forEach((f, i) => {
        const x = 40 + i * (bw + 3);
        const bt = f.blockTime ?? 0;
        const ap = f.appliedAt ?? 0;
        const parts: Array<[string, number, string]> = [
            [
                'p-final',
                f.finalizedAt ? f.finalizedAt - bt : 0,
                'block → finalized',
            ],
            [
                'p-proven',
                f.finalizedAt && f.provenAt ? f.provenAt - f.finalizedAt : 0,
                'finalized → proven',
            ],
            [
                'p-applied',
                f.provenAt ? ap - f.provenAt : ap - bt,
                'proven → applied',
            ],
        ];
        let acc = 0;
        for (const [cls, ms, label] of parts) {
            const h = (ms / 60_000 / maxMin) * (H - 30);
            svg += `<rect class="${cls}" x="${x}" y="${H - 18 - acc - h}" width="${bw}" height="${h}"><title>${short(f.txHash)}: ${label} ${min1(ms)} min, total ${min1(ap - bt)} min</title></rect>`;
            acc += h;
        }
    });

    const flightRows = m.flights
        .map((f) => {
            const bt = f.blockTime;
            const seg = (x?: number, y?: number) => (x && y ? min1(y - x) : '');
            return `<tr><td>${a({ label: short(f.txHash), url: `${ETHERSCAN}/tx/${f.txHash}` })}</td><td class="mono">${f.block ?? ''}</td><td class="mono">${bt ? iso(bt) : iso(f.sentAt) + ' (sent)'}</td><td class="mono">${seg(bt, f.finalizedAt)}</td><td class="mono">${seg(f.finalizedAt, f.provenAt)}</td><td class="mono">${seg(f.provenAt, f.appliedAt)}</td><td class="mono">${f.appliedAt ? seg(bt, f.appliedAt) : 'in flight'}</td><td class="mono">${f.reads.length}</td></tr>`;
        })
        .join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backstop campaign: ${CLUSTERS}</title>
<style>
  :root { --bg:#f4f6f7; --surface:#fff; --ink:#13202a; --muted:#586672; --rule:#d9e0e5; --accent:#245e8f; --ok:#17734a; --ok-soft:#dff1e7; --warn:#8f5e10; --warn-soft:#f6ecd8; --bad:#b42318; --bad-soft:#fae5e2; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e141a; --surface:#141c24; --ink:#e4e9ed; --muted:#94a1ac; --rule:#25313b; --accent:#80b3e2; --ok:#54c38f; --ok-soft:#13281e; --warn:#e1b15e; --warn-soft:#2a2316; --bad:#f07366; --bad-soft:#321a17; } }
  body { margin:0; background:var(--bg); color:var(--ink); font: 15px/1.5 "Source Sans 3", "Segoe UI", system-ui, sans-serif; }
  .sheet { max-width: 66rem; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; } h2 { font-size: 1.15rem; margin: 2.2rem 0 .6rem; padding-top: 1rem; border-top: 1px solid var(--rule); } h3 { font-size: 1rem; margin: 1.2rem 0 .4rem; }
  .muted { color: var(--muted); } .small { font-size: .85rem; } .mono { font-family: var(--mono); font-size: .92em; }
  .summary { display:flex; gap: 1.5rem; flex-wrap: wrap; margin: .75rem 0 0; }
  .summary div b { font-size: 1.4rem; display:block; }
  .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: .8rem; }
  .card { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: .8rem 1rem; }
  .card-head { display:flex; gap:.6rem; align-items:center; margin-bottom:.5rem; }
  .nums { display:grid; grid-template-columns: 1fr 1fr; gap: .4rem .8rem; }
  .links { margin-top:.5rem; } a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .bad { color: var(--bad); margin-top:.4rem; } .warnline { color: var(--warn); margin-top:.4rem; }
  .chip { display:inline-block; padding: 0 .5rem; border-radius: 999px; font-family: var(--mono); font-size: .8rem; font-weight: 600; }
  .HEALTHY { background: var(--ok-soft); color: var(--ok); } .WARN, .PAUSED_AT_SOURCE { background: var(--warn-soft); color: var(--warn); }
  .STALE { background: var(--rule); color: var(--muted); } .TRIPPED { background: var(--bad-soft); color: var(--bad); }
  .res { font-weight: 600; } .res.pass { color: var(--ok); } .res.fail { color: var(--bad); } .res.pending { color: var(--muted); }
  table { border-collapse: collapse; width: 100%; background: var(--surface); } th, td { text-align:left; vertical-align: top; padding: .45rem .6rem; border-bottom: 1px solid var(--rule); } th { color: var(--muted); font-weight: 600; font-size: .85rem; }
  .timeline tr.action td { font-weight: 600; } .timeline tr.pass td:nth-child(3) { color: var(--ok); } .timeline tr.fail td:nth-child(3) { color: var(--bad); } .timeline tr.read td:nth-child(3), .timeline tr.status td:nth-child(3) { color: var(--muted); }
  svg { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; max-width: 100%; }
  .grid { stroke: var(--rule); } .axis { fill: var(--muted); font-size: 10px; } .p-final { fill: #8a97a3; } .p-proven { fill: var(--accent); } .p-applied { fill: var(--ok); }
  .legend span { display:inline-block; width: .8rem; height: .8rem; border-radius: 2px; vertical-align: middle; margin: 0 .3rem 0 .8rem; }
  details { margin-top: 1rem; } summary { cursor: pointer; color: var(--muted); }
</style></head><body><div class="sheet">
<h1>Backstop on real proofs</h1>
<div class="muted">${CLUSTERS}. Run ${iso(m.first)} → ${iso(m.last)}${m.running ? ' (running)' : ''}. ${m.nori ? `Nori light client: beacon slot ${m.nori.latestHead}, ${m.nori.queueCursor} of ${m.queueHead} queue requests proven, ${m.nori.batches} batches.` : ''}</div>
<div class="summary">
  <div><b>${passed} / ${m.claims.length}</b><span class="muted">claims verified${failed ? `, <span class="res fail">${failed} failed</span>` : ''}</span></div>
  <div><b>${m.total.length ? median.toFixed(1) + ' min' : '–'}</b><span class="muted">median, Ethereum block → read on Solana (n=${m.total.length})</span></div>
  <div><b>${range(m.cu.backing)}</b><span class="muted">CU per submit_read</span></div>
  <div><b>${m.stepsPassed} / ${m.stepsTotal}</b><span class="muted">scenario steps passed</span></div>
</div>

<h2>Board</h2>
<div class="muted small">Each guard compares the lockbox’s <code>locked()</code> on Ethereum, proven through Nori, with the mint’s supply on Solana. Every number carries its Ethereum block and age.</div>
<div class="cards" style="margin-top:.6rem">${boardHtml}</div>

<h2>Claims and evidence</h2>
<div class="muted small">The spec’s acceptance criteria (§6) and the pitch’s numbers, each checked on the live loop. Evidence links open the transaction on Etherscan or the Solana explorer.</div>
<table style="margin-top:.6rem"><thead><tr><th>Claim</th><th>Test</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${claimsHtml}</tbody></table>

<h2>Timeline per guard</h2>
<div class="muted small">Minutes count from the last action, like the Kelp timeline: action on a chain → the proven read lands on the guard → verdict.</div>
${storiesHtml}

<h2>Latency</h2>
<div class="muted small">Per snapshot: Ethereum block → finalized (two epochs) → proven by Nori → applied by the keeper. Median ${m.total.length ? median.toFixed(1) : '–'} min; block → finalized median ${min1(quantile(m.toFinal, 0.5))}, finalized → proven ${min1(quantile(m.toProven, 0.5))}, proven → applied ${min1(quantile(m.toApplied, 0.5))} (30 s poll).</div>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="margin-top:.6rem">${svg}</svg>
<div class="legend small muted"><span style="background:#8a97a3"></span>block → finalized <span style="background:var(--accent)"></span>finalized → proven <span style="background:var(--ok)"></span>proven → applied</div>

<h2>Costs</h2>
<table><tbody>
<tr><td>submit_read, backing / pause</td><td class="mono">${range(m.cu.backing)} / ${range(m.cu.pause)} CU</td></tr>
<tr><td>assert_healthy / status (simulated)</td><td class="mono">${range(m.cu.assert)} / ${range(m.cu.status)} CU</td></tr>
<tr><td>DemoLockbox.set on Sepolia</td><td class="mono">${range(m.gas)} gas</td></tr>
<tr><td>Snapshots sent / applied</td><td class="mono">${m.flights.length} / ${m.flights.filter((f) => f.appliedAt).length}</td></tr>
</tbody></table>

<h2>Errors</h2>
${m.errorMap.size ? `<ul>${[...m.errorMap].map(([k, n]) => `<li>${n}× ${esc(k)}</li>`).join('')}</ul>` : '<div class="muted">None.</div>'}

<details><summary>Appendix: every snapshot</summary>
<table><thead><tr><th>Tx</th><th>Block</th><th>Block time</th><th>→ finalized</th><th>→ proven</th><th>→ applied</th><th>Total</th><th>Reads</th></tr></thead><tbody>${flightRows}</tbody></table></details>
<div class="muted small" style="margin-top:2rem">Generated ${iso(m.now)}.</div>
</div></body></html>`;
}
