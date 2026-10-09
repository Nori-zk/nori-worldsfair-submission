import { define, type StateUnion } from '@yaw-rx/ystate';
import type { ConnectionName } from '@nori-zk/nori-bridge-solana-sdk';

/** What the user asked to prove: an asset's balance held by an address. */
const request = {
    /** `eth`, or an ERC-20 token's address. */
    asset: '',
    /** The Ethereum address whose balance is proven. */
    holder: '',
};

/** The request with what reading it found. */
const readRequest = {
    ...request,
    /** The asset's symbol: `ETH`, or the token's `symbol()`. */
    symbol: '',
    /** The asset's decimals: 18 for ETH, or the token's `decimals()`. */
    decimals: 18,
    /** The balance the snapshot will record, in the asset's smallest unit. */
    balance: 0n as bigint,
    /** `NoriSnapshot.snapshotFee()`, in wei. */
    fee: 0n as bigint,
};

/** The proof queue batch on Solana that covers the snapshot's proof request. */
const provenIn = {
    /** The batch's index. */
    proofQueueBatchIndex: 0n as bigint,
    /** The batch account, base58. */
    proofQueueBatchAddress: '',
};

/** The request, its snapshot transaction and the batch that proved it, while verifying. */
const verifyRequest = { ...readRequest, txHash: '', ...provenIn, failedReads: 0 };

/**
 * Proving a balance: the user picks an asset and a holder, the balance and
 * fee are read as soon as both are valid, and one `NoriSnapshot.snapshot`
 * transaction enqueues the proof request. No node is a dead end.
 *
 * - Every edit carries the whole request and goes to `editing` at once, from
 *   any node where the form is open, so nothing proves a request the form no
 *   longer shows. `editSettled` (the request is valid and the edits stopped)
 *   goes on to `reading`.
 * - `reading` reads the balance through the wallet with the same call the
 *   snapshot makes, and the snapshot fee, through Ethereum's calls order
 *   (`forCalls`). A connection that is down is
 *   `waitingForConnection`, naming it in `waitingOn` and reading again once
 *   both are `ready`; a call that fails or returns anything but one 32-byte
 *   word is `readFailed`, which reads again by itself after a wait that
 *   doubles with each failed read in a row (`failedReads`), or at once on
 *   `retry`.
 * - `balanceRead` shows the balance and fee. `prove` sends the transaction
 *   through the wallet (`awaitingSignature`). The user declining goes to
 *   `declined`; any other failure to `sendFailed`. Both can send again or
 *   be edited.
 * - `proving` carries the signed transaction's hash. The sdk's proof request
 *   machine follows it from there, through mining and the bridge's stages,
 *   until a proof queue batch on Solana covers it: `proofAvailable` moves on
 *   to `verifying`. `another` starts another proof, reading the same asset
 *   and holder again, from here and every node after. A transaction that
 *   reverts on Ethereum goes to `sendFailed`, to send again or edit.
 * - `verifying` checks the result on Solana: it builds the result's witness
 *   from the snapshot and the batch, and simulates nori-read-example's
 *   `read_snapshot_result` (no signature, no fee). `verified` holds what the
 *   program verified: the balance, the Ethereum block and its time, and the
 *   compute units. A read or simulation that fails is `verifyFailed`, which
 *   verifies again as `readFailed` reads again.
 */
export const ProveBalanceGraph = define({
    nodes: {
        editing: { ...request },
        reading: { ...request, failedReads: 0 },
        waitingForConnection: { ...request, waitingOn: [] as ConnectionName[] },
        readFailed: { ...request, error: '', failedReads: 0 },
        balanceRead: { ...readRequest },
        awaitingSignature: { ...readRequest },
        declined: { ...readRequest },
        sendFailed: { ...readRequest, error: '' },
        proving: { ...readRequest, txHash: '' },
        verifying: { ...verifyRequest },
        verifyFailed: { ...verifyRequest, error: '' },
        verified: {
            ...readRequest,
            txHash: '',
            ...provenIn,
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
        edited: { from: 'editing', to: 'editing', on: 'edit.next' },
        editSettled: { from: 'editing', to: 'reading', on: 'editSettled.next' },
        editedWhileReading: { from: 'reading', to: 'editing', on: 'edit.next' },
        editedWhileWaiting: {
            from: 'waitingForConnection',
            to: 'editing',
            on: 'edit.next',
        },
        editedAfterFailure: {
            from: 'readFailed',
            to: 'editing',
            on: 'edit.next',
        },
        editedAfterRead: {
            from: 'balanceRead',
            to: 'editing',
            on: 'edit.next',
        },
        editedAfterDecline: {
            from: 'declined',
            to: 'editing',
            on: 'edit.next',
        },
        editedAfterSendFailure: {
            from: 'sendFailed',
            to: 'editing',
            on: 'edit.next',
        },

        balanceArrived: { from: 'reading', to: 'balanceRead', on: 'balanceArrived.next' },
        readErrored: { from: 'reading', to: 'readFailed', on: 'readError.next' },
        connectionLost: { from: 'reading', to: 'waitingForConnection', on: 'connectionLost.next' },
        connectionsChanged: {
            from: 'waitingForConnection',
            to: 'waitingForConnection',
            on: 'connectionsChanged.next',
        },
        connectionRestored: {
            from: 'waitingForConnection',
            to: 'reading',
            on: 'connectionRestored.next',
        },
        retried: { from: 'readFailed', to: 'reading', on: 'retry.next' },
        retryStarted: { from: 'readFailed', to: 'reading', on: 'retryDue.next' },

        proveRequested: { from: 'balanceRead', to: 'awaitingSignature', on: 'prove.next' },
        signed: { from: 'awaitingSignature', to: 'proving', on: 'signed.next' },
        userDeclined: { from: 'awaitingSignature', to: 'declined', on: 'userDeclined.next' },
        sendRejected: { from: 'awaitingSignature', to: 'sendFailed', on: 'sendRejected.next' },
        proveRetriedAfterDecline: { from: 'declined', to: 'awaitingSignature', on: 'prove.next' },
        proveRetriedAfterFailure: { from: 'sendFailed', to: 'awaitingSignature', on: 'prove.next' },
        anotherRequested: { from: 'proving', to: 'reading', on: 'another.next' },
        transactionReverted: { from: 'proving', to: 'sendFailed', on: 'transactionReverted.next' },

        proofLanded: { from: 'proving', to: 'verifying', on: 'proofAvailable.next' },
        resultVerified: { from: 'verifying', to: 'verified', on: 'verified.next' },
        verifyErrored: { from: 'verifying', to: 'verifyFailed', on: 'verifyError.next' },
        verifyRetried: { from: 'verifyFailed', to: 'verifying', on: 'verifyRetry.next' },
        verifyRetryStarted: {
            from: 'verifyFailed',
            to: 'verifying',
            on: 'verifyRetryDue.next',
        },
        anotherRequestedWhileVerifying: { from: 'verifying', to: 'reading', on: 'another.next' },
        anotherRequestedAfterVerifyFailure: {
            from: 'verifyFailed',
            to: 'reading',
            on: 'another.next',
        },
        anotherRequestedAfterVerified: { from: 'verified', to: 'reading', on: 'another.next' },
    },
});

/** Proving a balance: a node of the graph and its data. */
export type ProveBalanceState = StateUnion<typeof ProveBalanceGraph.nodes>;
