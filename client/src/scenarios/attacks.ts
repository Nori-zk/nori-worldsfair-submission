// Attacks on a guard, simulated (no state changes, no fees): each must be
// rejected with its specific error. Run against the last applied snapshot.
import { address, type Address } from '@solana/kit';
import {
    assertHealthyInstruction,
    findGuardAddress,
    ReadKind,
    STATUS_NAMES,
    statusInstruction,
    submitReadInstruction,
    unlatchInstruction,
} from '../backstop.js';
import { fetchProvenSnapshot } from '../fetchProvenSnapshot.js';
import { queryOf, type GuardEntry } from '../keeper/config.js';
import type { GuardReport, Keeper } from '../keeper/keeper.js';
import { simulate } from './chains.js';

// programs/backstop/src/lib.rs `BackstopError`, in order from 6000
export const ERR = {
    InvalidProofQueueBatch: 6002,
    InvalidSnapshotResult: 6003,
    ReadNotNewer: 6005,
    SupplyAboveBacking: 6007,
    Stale: 6008,
    PausedAtSource: 6009,
    Tripped: 6010,
    /** Anchor `has_one` constraint */
    ConstraintHasOne: 2001,
} as const;

export interface AttackResult {
    name: string;
    expected: number | 'ok';
    got: number | 'ok' | string;
    pass: boolean;
    units?: bigint;
}

/** The error codes `assert_healthy` returns for each status. */
const ASSERT_HEALTHY: Record<string, number | 'ok'> = {
    HEALTHY: 'ok',
    WARN: ERR.SupplyAboveBacking,
    STALE: ERR.Stale,
    PAUSED_AT_SOURCE: ERR.PausedAtSource,
    TRIPPED: ERR.Tripped,
};

/**
 * Runs every attack on `guard` using `snapshotTxHash`, a snapshot whose
 * reads this guard already applied.
 */
export async function runAttacks(
    keeper: Keeper,
    guard: GuardEntry,
    report: GuardReport,
    snapshotTxHash: string
): Promise<AttackResult[]> {
    const { solana, config } = keeper;
    const guardAddress = await findGuardAddress(
        guard.mint,
        solana.signer.address
    );
    const snapshot = await fetchProvenSnapshot({
        rpc: solana.rpc,
        provider: keeper.provider,
        noriSnapshot: config.ethereum.noriSnapshot,
        proofQueue: config.ethereum.proofQueue,
        snapshotTxHash,
        noriProgram: config.solana.noriProgram,
    });
    if (!snapshot.proven) throw new Error(`${snapshotTxHash} is not proven`);
    const backingWitness = snapshot.witnessFor(queryOf(guard.backing).queryId);
    const read = (
        witness: typeof backingWitness,
        kind: ReadKind = ReadKind.Backing,
        proofQueueBatch: Address = snapshot.proofQueueBatch
    ) =>
        submitReadInstruction({
            guard: guardAddress,
            mint: guard.mint,
            proofQueueBatch,
            kind,
            witness,
        });

    const tampered = structuredClone(backingWitness);
    const result = new Uint8Array(tampered.result[0]);
    result[31] ^= 1; // one bit of the proven result
    tampered.result = [result];

    const cases: Array<{
        name: string;
        ix: ReturnType<typeof read>;
        expected: number | 'ok';
        feePayer?: Address;
    }> = [
        {
            name: 'replay an applied read',
            ix: read(backingWitness),
            expected: ERR.ReadNotNewer,
        },
        {
            name: 'tamper with the proven result (one bit)',
            ix: read(tampered),
            expected: ERR.InvalidSnapshotResult,
        },
        {
            name: 'a proof queue batch the Nori program does not own',
            ix: read(backingWitness, ReadKind.Backing, guardAddress),
            expected: ERR.InvalidProofQueueBatch,
        },
        {
            name: 'unlatch signed by someone who is not the admin',
            ix: unlatchInstruction({
                admin: address('11111111111111111111111111111112'),
                guard: guardAddress,
            }),
            expected: ERR.ConstraintHasOne,
        },
        {
            name: `assert_healthy while ${report.status}`,
            ix: assertHealthyInstruction({
                guard: guardAddress,
                mint: guard.mint,
            }),
            expected: ASSERT_HEALTHY[report.status] ?? 'ok',
        },
    ];
    if (guard.pause) {
        cases.splice(2, 0, {
            name: 'the pause result posing as the backing',
            ix: read(snapshot.witnessFor(queryOf(guard.pause).queryId)),
            expected: ERR.InvalidSnapshotResult,
        });
    }

    const results: AttackResult[] = [];
    for (const { name, ix, expected, feePayer } of cases) {
        try {
            const sim = await simulate(solana, ix, feePayer);
            const got: number | 'ok' | string =
                sim.errorCode ?? (sim.err ? JSON.stringify(sim.err) : 'ok');
            results.push({
                name,
                expected,
                got,
                pass: got === expected,
                units: sim.unitsConsumed,
            });
        } catch (error) {
            results.push({
                name,
                expected,
                got: error instanceof Error ? error.message : String(error),
                pass: false,
            });
        }
    }
    return results;
}

/**
 * The program's own `status` (return data) for a guard, to check the
 * TypeScript `guardStatus` against it.
 */
export async function programStatus(
    keeper: Keeper,
    guard: GuardEntry
): Promise<{ status: string; units?: bigint } | { error: string }> {
    const guardAddress = await findGuardAddress(
        guard.mint,
        keeper.solana.signer.address
    );
    const sim = await simulate(
        keeper.solana,
        statusInstruction({ guard: guardAddress, mint: guard.mint })
    );
    if (sim.err) return { error: JSON.stringify(sim.err) };
    const code = sim.returnData?.[0];
    const status = code === undefined ? undefined : STATUS_NAMES[code];
    return status
        ? { status, units: sim.unitsConsumed }
        : {
              error: `no status in return data (${sim.returnData?.length ?? 0} bytes)`,
          };
}
