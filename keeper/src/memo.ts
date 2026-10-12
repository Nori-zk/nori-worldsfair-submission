// The memo on each keeper transaction that verifies a snapshot result:
// browser-safe, so the apps can find the keeper's transactions by it.
import { address, type Instruction } from '@solana/kit';

/** SPL Memo v2. */
export const MEMO_PROGRAM = address(
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
);

/** Which read a transaction makes: a guard's backing or pause read, or nori-read-example's. */
export type SnapshotReadKind = 'backing' | 'pause' | 'example';

/** What a keeper transaction's memo names. */
export interface SnapshotReadMemo {
    /** The snapshot transaction on Ethereum, 0x-hex. */
    snapshotTxHash: string;
    /** The query whose result it verifies, 0x-hex. */
    queryId: string;
    kind: SnapshotReadKind;
}

/**
 * The memo of a transaction that verifies a snapshot result.
 *
 * @param memo The snapshot, the query and the read.
 * @returns `nori snapshot 0x… query 0x… backing`.
 */
export const snapshotReadMemo = ({
    snapshotTxHash,
    queryId,
    kind,
}: SnapshotReadMemo): string =>
    `nori snapshot ${snapshotTxHash.toLowerCase()} query ${queryId.toLowerCase()} ${kind}`;

/** A memo `snapshotReadMemo` wrote, bare or as the RPC returns it (`[<length>] <memo>`). */
const SNAPSHOT_READ_MEMO =
    /^(?:\[\d+\] )?nori snapshot (0x[0-9a-f]{64}) query (0x[0-9a-f]{64}) (backing|pause|example)$/;

/**
 * What a memo names, if `snapshotReadMemo` wrote it.
 *
 * @param memo The memo, bare or with the RPC's length prefix; `null` when the transaction has none.
 * @returns The snapshot, the query and the read, or `undefined`.
 */
export function parseSnapshotReadMemo(
    memo: string | null | undefined
): SnapshotReadMemo | undefined {
    const match = SNAPSHOT_READ_MEMO.exec(memo ?? '');
    if (!match) return undefined;
    const [, snapshotTxHash = '', queryId = '', kind = ''] = match;
    return { snapshotTxHash, queryId, kind: kind as SnapshotReadKind };
}

/**
 * An SPL Memo instruction, with no signers.
 *
 * @param memo The text.
 * @returns The instruction.
 */
export const memoInstruction = (memo: string): Instruction => ({
    programAddress: MEMO_PROGRAM,
    data: new TextEncoder().encode(memo),
});

/** One entry of `getSignaturesForAddress`, as far as the memo is read. */
export interface MemoSignature {
    signature: string;
    slot: bigint;
    /** `null` when the transaction succeeded. */
    err: unknown;
    /** `[<length>] <memo>`, or `null` when it has none. */
    memo: string | null;
}

/** A successful transaction whose memo names a snapshot it verified, with the query and read (lowercase). */
export interface SnapshotReadTransaction extends SnapshotReadMemo {
    signature: string;
    slot: bigint;
}

/**
 * The successful transactions whose memo names a snapshot.
 *
 * shortcut: anyone can write the memo into a transaction that names a
 * guard; the page trusts it as written. Check the transaction's
 * instructions (`getTransaction`) if that ever matters.
 *
 * @param signatures An account's signatures.
 * @returns Those transactions, in the same order.
 */
export const snapshotReadTransactionsOf = (
    signatures: readonly MemoSignature[]
): SnapshotReadTransaction[] =>
    signatures.flatMap(({ signature, slot, err, memo }) => {
        const read = err === null ? parseSnapshotReadMemo(memo) : undefined;
        return read ? [{ signature, slot, ...read }] : [];
    });

/**
 * The transactions that verified one snapshot, newest first, so the first
 * of a query and read is its newest.
 *
 * @param transactions The transactions found, from any accounts, in any order.
 * @param snapshotTxHash The snapshot transaction.
 * @returns Those that name it.
 */
export const snapshotReadsOf = (
    transactions: readonly SnapshotReadTransaction[],
    snapshotTxHash: string
): SnapshotReadTransaction[] => {
    const hash = snapshotTxHash.toLowerCase();
    return transactions
        .filter((transaction) => transaction.snapshotTxHash === hash)
        .sort((a, b) => (a.slot < b.slot ? 1 : a.slot > b.slot ? -1 : 0));
};
