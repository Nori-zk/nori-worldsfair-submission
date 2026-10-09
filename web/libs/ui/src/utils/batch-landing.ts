/** When and in which Solana transaction a proof queue batch landed. */
export interface BatchLanding {
    /** The transaction's block time, unix seconds. */
    atSecs: number;
    signature: string;
}

/** One entry of `getSignaturesForAddress`, as far as the landing reads it. */
export interface SignatureEntry {
    signature: string;
    /** `null` when the transaction succeeded. */
    err: unknown;
    /** Unix seconds, or `null` when the cluster does not know it. */
    blockTime: bigint | number | null;
}

/**
 * The transaction that created a batch account: the newest successful one on
 * the batch's PDA that is also a Nori program transaction.
 *
 * The oldest signature on PDA N is not its creation: every `update` passes the
 * next batch PDA as writable but only creates it when the batch is non-empty,
 * so empty updates come first; failed transactions and Backstop's reads also
 * name it. Later updates pass PDA N+1, and Backstop's transactions don't list
 * the Nori program, so the newest successful Nori transaction is the one.
 *
 * @param batchSignatures The batch PDA's signatures, newest first.
 * @param noriSignatures The Nori program's successful signatures.
 * @returns The landing, or `undefined` when none matches or its time is unknown.
 */
export function landingOf(
    batchSignatures: readonly SignatureEntry[],
    noriSignatures: ReadonlySet<string>,
): BatchLanding | undefined {
    const creation = batchSignatures.find(
        ({ signature, err }) => err === null && noriSignatures.has(signature),
    );
    if (creation === undefined || creation.blockTime === null) return undefined;
    return { atSecs: Number(creation.blockTime), signature: creation.signature };
}
