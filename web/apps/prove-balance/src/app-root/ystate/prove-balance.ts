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

/**
 * Proving a balance: the user picks an asset and a holder, the balance and
 * fee are read as soon as both are valid, and one `NoriSnapshot.snapshot`
 * transaction enqueues the proof request. No node is a dead end.
 *
 * - Every edit carries the whole request. `editIncomplete` (the asset or
 *   holder is not valid yet) goes to `editing`; `editComplete` goes to
 *   `reading`, from any node where the form is open, including `reading`
 *   itself, which reads again for the new request.
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
 *   machine follows it from there, through mining, the bridge's stages and
 *   the proof landing on Solana. `another` starts another proof, reading
 *   the same asset and holder again. A transaction that reverts on Ethereum
 *   goes to `sendFailed`, to send again or edit.
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
    },
    edges: {
        editedIncomplete: { from: 'editing', to: 'editing', on: 'editIncomplete.next' },
        editedComplete: { from: 'editing', to: 'reading', on: 'editComplete.next' },
        editedIncompleteWhileReading: { from: 'reading', to: 'editing', on: 'editIncomplete.next' },
        editedWhileReading: { from: 'reading', to: 'reading', on: 'editComplete.next' },
        editedIncompleteWhileWaiting: {
            from: 'waitingForConnection',
            to: 'editing',
            on: 'editIncomplete.next',
        },
        editedWhileWaiting: {
            from: 'waitingForConnection',
            to: 'reading',
            on: 'editComplete.next',
        },
        editedIncompleteAfterFailure: {
            from: 'readFailed',
            to: 'editing',
            on: 'editIncomplete.next',
        },
        editedAfterFailure: { from: 'readFailed', to: 'reading', on: 'editComplete.next' },
        editedIncompleteAfterRead: {
            from: 'balanceRead',
            to: 'editing',
            on: 'editIncomplete.next',
        },
        editedAfterRead: { from: 'balanceRead', to: 'reading', on: 'editComplete.next' },
        editedIncompleteAfterDecline: {
            from: 'declined',
            to: 'editing',
            on: 'editIncomplete.next',
        },
        editedAfterDecline: { from: 'declined', to: 'reading', on: 'editComplete.next' },
        editedIncompleteAfterSendFailure: {
            from: 'sendFailed',
            to: 'editing',
            on: 'editIncomplete.next',
        },
        editedAfterSendFailure: { from: 'sendFailed', to: 'reading', on: 'editComplete.next' },

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
    },
});

/** Proving a balance: a node of the graph and its data. */
export type ProveBalanceState = StateUnion<typeof ProveBalanceGraph.nodes>;
