import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';

/** What the user asked to prove: an asset's balance held by an address. */
const request = {
    /** `eth`, or an ERC-20 token's address. */
    asset: '',
    /** The Ethereum address whose balance is proven. */
    holder: '',
};

/** What reading a request finds: the asset, the balance the snapshot will record, and the fee. */
export interface Preview {
    /** The asset's symbol: `ETH`, or the token's `symbol()`. */
    symbol: string;
    /** The asset's decimals: 18 for ETH, or the token's `decimals()`. */
    decimals: number;
    /** The balance the snapshot will record, in the asset's smallest unit. */
    balance: bigint;
    /** `NoriSnapshot.snapshotFee()`, in wei. */
    fee: bigint;
}

/** A preview read, before there is one. */
const noPreview: Preview = { symbol: '', decimals: 18, balance: 0n, fee: 0n };

/** The balance and fee, read through the wallet and kept current: the read shape, spread. */
const previewing = readThroughConnectionsOf({
    ...request,
    preview: undefined as Preview | undefined,
});

/** The request with what reading it found. */
const readRequest = { ...request, preview: noPreview };

/** The proof queue batch on Solana that covers the snapshot's proof request. */
const provenIn = {
    /** The batch's index. */
    proofQueueBatchIndex: 0n as bigint,
    /** The batch account, base58. */
    proofQueueBatchAddress: '',
};

/** The request, its snapshot transaction and the batch that proved it, while verifying. */
const verifyRequest = { ...readRequest, txHash: '', ...provenIn };

/**
 * Proving a balance: the user picks an asset and a holder, the balance and
 * fee are read as soon as both are valid, and one `NoriSnapshot.snapshot`
 * transaction enqueues the proof request. The balance and fee are this
 * graph's own read (`readThroughConnectionsOf`, spread): `loading`,
 * `current`, `refreshing` and their waits and failures are the user looking
 * at the balance of the request their data holds, read again by the read
 * itself after a failure, or at once on `retry`. No node is a dead end.
 *
 * - `resuming`: a page opened at `?tx=` reads that snapshot transaction (the
 *   resume machine, as a gate). A snapshot of one balance query, as this app
 *   sends, resumes at `proving` with its request and preview; any other
 *   transaction goes on to `noAccount`.
 * - `noAccount`: the wallet shares no account yet. The first account it
 *   shares (the account machine, as a gate) reads ETH for it (`loading`).
 *   A new account moves the holder with it while they were the same.
 * - Every edit carries the whole request and goes to `editing` at once, from
 *   every node where the form is open, so nothing proves a request the form
 *   no longer shows. `editSettled` (the request is valid and the edits
 *   stopped) reads it (`loading`).
 * - `current` (or `refreshing`, holding a balance): `prove` asks the wallet
 *   to sign one `NoriSnapshot.snapshot` (`awaitingSignature`, gated by the
 *   wallet transaction machine made for that call). The user declining goes
 *   to `declined`; the wallet or contract refusing to `sendFailed`; a sent
 *   transaction to `proving`, with its hash. Both can send again or be
 *   edited.
 * - `proving` follows the transaction on Ethereum and the proof request
 *   (the proof request machine, as a gate) until a proof queue batch on
 *   Solana covers it: `proofAvailable` moves on to `verifying`. A
 *   transaction that reverts, is replaced or is dropped goes to
 *   `sendFailed`, to send again or edit. `another` starts another proof,
 *   reading the same asset and holder again, from here and every node
 *   after.
 * - `verifying` checks the result on Solana (the snapshot verification
 *   machine, as a gate): it builds the result's witness from the snapshot
 *   and the batch, and simulates nori-read-example's `read_snapshot_result`
 *   (no signature, no fee). `verified` holds what the program verified: the
 *   balance, the Ethereum block and its time, and the compute units. A
 *   simulation that fails is `verifyFailed`, which verifies again when the
 *   simulation reads again, by itself or on `retry`.
 */
export const ProveBalanceGraph = define({
    nodes: {
        resuming: { txHash: '' },
        noAccount: { ...request },
        editing: { ...request },
        ...previewing.nodes,
        awaitingSignature: { ...readRequest },
        declined: { ...readRequest },
        sendFailed: { ...readRequest, error: '' },
        proving: { ...readRequest, txHash: '' },
        verifying: { ...verifyRequest },
        verifyFailed: { ...verifyRequest },
        verified: {
            ...verifyRequest,
            /** The balance the program verified, in the asset's smallest unit. */
            provenBalance: 0n as bigint,
            /** The Ethereum block the balance was read in, and its time (seconds). */
            ethBlockNumber: 0n as bigint,
            ethTimestamp: 0n as bigint,
            /** The finalized Ethereum block whose state the batch proved. */
            provenBlockNumber: 0n as bigint,
            /** What `read_snapshot_result` cost. */
            unitsConsumed: 0n as bigint,
        },
    },
    edges: {
        ...previewing.edges,

        resumed: { from: 'resuming', to: 'proving', on: 'resumed.next' },
        notResumable: { from: 'resuming', to: 'noAccount', on: 'notResumable.next' },

        accountShared: { from: 'noAccount', to: 'loading', on: 'accountShared.next' },
        accountChangedWhileEditing: {
            from: 'editing',
            to: 'editing',
            on: 'accountChangedWhileEditing.next',
        },
        accountChangedWhileLoading: { from: 'loading', to: 'loading', on: 'accountChanged.next' },
        accountChangedWhileCurrent: { from: 'current', to: 'loading', on: 'accountChanged.next' },
        accountChangedWhileRefreshing: {
            from: 'refreshing',
            to: 'loading',
            on: 'accountChanged.next',
        },
        accountChangedWhileWaitingForConnectionWhileLoading: {
            from: 'waitingForConnectionWhileLoading',
            to: 'loading',
            on: 'accountChanged.next',
        },
        accountChangedWhileWaitingForConnectionWhileRefreshing: {
            from: 'waitingForConnectionWhileRefreshing',
            to: 'loading',
            on: 'accountChanged.next',
        },
        accountChangedWhileFailedWhileLoading: {
            from: 'failedWhileLoading',
            to: 'loading',
            on: 'accountChanged.next',
        },
        accountChangedWhileFailedWhileRefreshing: {
            from: 'failedWhileRefreshing',
            to: 'loading',
            on: 'accountChanged.next',
        },

        edited: { from: 'editing', to: 'editing', on: 'edit.next' },
        editSettled: { from: 'editing', to: 'loading', on: 'editSettled.next' },
        editedWhileLoading: { from: 'loading', to: 'editing', on: 'edit.next' },
        editedWhileCurrent: { from: 'current', to: 'editing', on: 'edit.next' },
        editedWhileRefreshing: { from: 'refreshing', to: 'editing', on: 'edit.next' },
        editedWhileWaitingForConnectionWhileLoading: {
            from: 'waitingForConnectionWhileLoading',
            to: 'editing',
            on: 'edit.next',
        },
        editedWhileWaitingForConnectionWhileRefreshing: {
            from: 'waitingForConnectionWhileRefreshing',
            to: 'editing',
            on: 'edit.next',
        },
        editedWhileFailedWhileLoading: {
            from: 'failedWhileLoading',
            to: 'editing',
            on: 'edit.next',
        },
        editedWhileFailedWhileRefreshing: {
            from: 'failedWhileRefreshing',
            to: 'editing',
            on: 'edit.next',
        },
        editedAfterDecline: { from: 'declined', to: 'editing', on: 'edit.next' },
        editedAfterSendFailure: { from: 'sendFailed', to: 'editing', on: 'edit.next' },

        proveRequested: { from: 'current', to: 'awaitingSignature', on: 'prove.next' },
        proveRequestedWhileRefreshing: {
            from: 'refreshing',
            to: 'awaitingSignature',
            on: 'prove.next',
        },
        signed: { from: 'awaitingSignature', to: 'proving', on: 'signed.next' },
        userDeclined: { from: 'awaitingSignature', to: 'declined', on: 'userDeclined.next' },
        sendRejected: { from: 'awaitingSignature', to: 'sendFailed', on: 'sendRejected.next' },
        proveRetriedAfterDecline: { from: 'declined', to: 'awaitingSignature', on: 'prove.next' },
        proveRetriedAfterFailure: { from: 'sendFailed', to: 'awaitingSignature', on: 'prove.next' },
        anotherRequested: { from: 'proving', to: 'loading', on: 'another.next' },
        transactionReverted: { from: 'proving', to: 'sendFailed', on: 'transactionReverted.next' },
        transactionReplaced: { from: 'proving', to: 'sendFailed', on: 'transactionReplaced.next' },
        transactionDropped: { from: 'proving', to: 'sendFailed', on: 'transactionDropped.next' },

        proofLanded: { from: 'proving', to: 'verifying', on: 'proofAvailable.next' },
        resultVerified: { from: 'verifying', to: 'verified', on: 'verified.next' },
        verifyErrored: { from: 'verifying', to: 'verifyFailed', on: 'verifyError.next' },
        verifyRetried: { from: 'verifyFailed', to: 'verifying', on: 'verifyRetry.next' },
        anotherRequestedWhileVerifying: { from: 'verifying', to: 'loading', on: 'another.next' },
        anotherRequestedAfterVerifyFailure: {
            from: 'verifyFailed',
            to: 'loading',
            on: 'another.next',
        },
        anotherRequestedAfterVerified: { from: 'verified', to: 'loading', on: 'another.next' },
    },
});

/** Proving a balance: a node of the graph and its data. */
export type ProveBalanceState = StateUnion<typeof ProveBalanceGraph.nodes>;
