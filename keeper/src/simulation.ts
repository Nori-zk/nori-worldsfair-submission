import {
    appendTransactionMessageInstructions,
    blockhash,
    compileTransaction,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type Address,
    type Instruction,
    type TransactionError,
} from '@solana/kit';
import { map, type Observable } from 'rxjs';
import {
    solanaRpcRead$,
    type SolanaRpc,
} from '@nori-zk/nori-bridge-solana-sdk';

/** Any blockhash: the simulation replaces it with a recent one. */
const ANY_LIFETIME = {
    blockhash: blockhash('11111111111111111111111111111111'),
    lastValidBlockHeight: 0n,
};

/** How a simulated transaction ran. */
export interface Simulation {
    /** The transaction's error, or `null` when it succeeded. */
    err: TransactionError | null;
    logs: readonly string[];
    unitsConsumed: bigint;
}

/**
 * Runs instructions in a simulated Solana transaction: no signature and no
 * fee, but `feePayer` must be an existing account holding SOL.
 *
 * @param rpc The Solana RPC.
 * @param instructions The instructions.
 * @param feePayer The fee payer, which pays nothing.
 * @param failure What failed, for the error's message.
 * @returns How it ran, once.
 */
export const simulation$ = (
    rpc: SolanaRpc,
    instructions: readonly Instruction[],
    feePayer: Address,
    failure: string
): Observable<Simulation> => {
    const transaction = compileTransaction(
        pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayer(feePayer, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(ANY_LIFETIME, m),
            (m) => appendTransactionMessageInstructions(instructions, m)
        )
    );
    return solanaRpcRead$(
        (abortSignal) =>
            rpc
                .simulateTransaction(
                    getBase64EncodedWireTransaction(transaction),
                    {
                        encoding: 'base64',
                        sigVerify: false,
                        replaceRecentBlockhash: true,
                        commitment: 'confirmed',
                    }
                )
                .send({ abortSignal }),
        failure
    ).pipe(
        map(({ value }) => ({
            err: value.err,
            logs: value.logs ?? [],
            unitsConsumed: value.unitsConsumed ?? 0n,
        }))
    );
};
