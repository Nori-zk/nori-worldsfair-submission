import {
    appendTransactionMessageInstruction,
    blockhash,
    compileTransaction,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type Address,
    type Base64EncodedWireTransaction,
} from '@solana/kit';
import {
    assertHealthyInstruction,
    BACKSTOP_ERROR_MESSAGE,
    backstopErrorName,
    customErrorOf,
    transactionErrorText,
} from '@nori-zk/backstop-keeper/guard';

/**
 * What a simulation gives back that the verdict reads: its error, a
 * `TransactionError` (`null` when it succeeded; `customErrorOf` reads its
 * code), and what it cost.
 */
export interface Simulated {
    err: unknown;
    unitsConsumed?: bigint;
}

/** The lender line's text and its colour. */
export interface Verdict {
    text: string;
    style: string;
}

/** Any blockhash: the simulation replaces it with a recent one. */
const ANY_LIFETIME = {
    blockhash: blockhash('11111111111111111111111111111111'),
    lastValidBlockHeight: 0n,
};

/**
 * A lender's deposit against a guard, as a transaction to simulate: one
 * `assert_healthy` instruction, paid by `feePayer`, which signs and pays
 * nothing in a simulation.
 *
 * @param guard The guard account.
 * @param mint The guard's mint.
 * @param feePayer Any existing system account holding SOL.
 * @returns The transaction, base64, as `simulateTransaction` takes it.
 */
export function depositTransaction(
    guard: Address,
    mint: Address,
    feePayer: Address,
): Base64EncodedWireTransaction {
    return getBase64EncodedWireTransaction(
        compileTransaction(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayer(feePayer, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(ANY_LIFETIME, m),
                (m) =>
                    appendTransactionMessageInstruction(
                        assertHealthyInstruction({ guard, mint }),
                        m,
                    ),
            ),
        ),
    );
}

/**
 * What the lender's deposit got from `assert_healthy`.
 *
 * @param value The simulation's value.
 * @param statusColour The guard's status colour, for a blocked deposit.
 * @returns `deposit allowed · N CU`, `deposit blocked: <Name> (<code>) · <message> · N CU`,
 *   or `simulation failed: <error>` when the failure is not a Backstop error.
 */
export function verdictText(value: Simulated, statusColour: string): Verdict {
    const units = `${Number(value.unitsConsumed ?? 0n).toLocaleString('en-US')} CU`;
    if (value.err === null) {
        return { text: `deposit allowed · ${units}`, style: 'color: var(--nori-light-green)' };
    }
    const code = customErrorOf(value.err);
    const name = code === undefined ? undefined : backstopErrorName(code);
    if (code === undefined || name === undefined) {
        return {
            text: `simulation failed: ${transactionErrorText(value.err)}`,
            style: 'color: var(--nori-muted)',
        };
    }
    const message = BACKSTOP_ERROR_MESSAGE[code];
    return {
        text: `deposit blocked: ${name} (${code.toString()})${message === undefined ? '' : ` · ${message}`} · ${units}`,
        style: `color: ${statusColour}`,
    };
}

/**
 * A simulation that threw, as the lender line shows it.
 *
 * @param error What was thrown.
 * @returns `simulation failed: <message>`, muted.
 */
export const simulationFailed = (error: unknown): Verdict => ({
    text: `simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    style: 'color: var(--nori-muted)',
});
