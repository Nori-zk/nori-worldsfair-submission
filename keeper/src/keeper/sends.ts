import { type Instruction, type TransactionSigner } from '@solana/kit';
import { type Signer } from 'ethers';
import {
    filter,
    ignoreElements,
    map,
    merge,
    type Observable,
    switchMap,
    tap,
    timer,
} from 'rxjs';
import {
    createSignerTransactionMachine,
    createSolanaSignerTransactionMachine,
    type ProgramErrorNames,
    type ProofRequestConnections,
    type SignerTransactionState,
    type SolanaSignerTransactionState,
    type SolanaTransactionMachineOptions,
    type TransactionCall,
    type TransactionMachineOptions,
} from '@nori-zk/nori-bridge-solana-sdk';
import { followedStates$ } from '../followedStates.js';
import { BACKSTOP_PROGRAM, BackstopError } from '../guard.js';

/** The Backstop's custom error names, by code, for the transaction machines to name a refusal. */
export const BACKSTOP_ERROR_NAMES: ProgramErrorNames = {
    [BACKSTOP_PROGRAM]: Object.fromEntries(
        Object.entries(BackstopError).map(([name, code]) => [code, name])
    ),
};

/** A send that is over: landed (`confirmed` or `reverted`), or refused by the program in preflight. */
export type SendOver = Extract<
    SolanaSignerTransactionState,
    { node: 'confirmed' | 'reverted' | 'refused' }
>;

/** A send that ended without the program's verdict: it failed to send, waits for Solana, or expired. */
export type SendLost = Extract<
    SolanaSignerTransactionState,
    { node: 'sendFailed' | 'notReadyToSend' | 'expired' }
>;

/**
 * Whether a send is over: landed, or refused by the program.
 *
 * @param state Its signer transaction machine's state.
 * @returns `true` once it is.
 */
export const sendOver = (
    state: SolanaSignerTransactionState
): state is SendOver =>
    state.node === 'confirmed' ||
    state.node === 'reverted' ||
    state.node === 'refused';

/**
 * Whether a send ended without the program's verdict.
 *
 * @param state Its signer transaction machine's state.
 * @returns `true` once it did.
 */
export const sendLost = (
    state: SolanaSignerTransactionState
): state is SendLost =>
    state.node === 'sendFailed' ||
    state.node === 'notReadyToSend' ||
    state.node === 'expired';

/**
 * How a send that is over ended.
 *
 * @param state Its signer transaction machine's state, landed or refused.
 * @returns `confirmed`, `reverted` with the program's error, or the error the program refused it with.
 */
export const sendOutcomeOf = (state: SendOver): string => {
    switch (state.node) {
        case 'confirmed':
            return 'confirmed';
        case 'reverted':
            return state.data.errorName === ''
                ? 'reverted'
                : `reverted: ${state.data.errorName}`;
        case 'refused':
            return state.data.errorName !== ''
                ? state.data.errorName
                : state.data.errorCode !== undefined
                  ? `program error ${state.data.errorCode.toString()}`
                  : 'refused';
    }
};

/**
 * Why a send ended without the program's verdict, in words.
 *
 * @param state Its signer transaction machine's state.
 * @returns The reason.
 */
export const sendLostReason = (state: SendLost): string => {
    switch (state.node) {
        case 'sendFailed':
            return state.data.error;
        case 'notReadyToSend':
            return `not ready to send: waiting on ${state.data.waitingOn.join(', ')}`;
        case 'expired':
            return `expired before it landed (${state.data.signature})`;
    }
};

/**
 * One Ethereum transaction signed by the keeper, made for its call when
 * subscribed and closed when unsubscribed. It is sent on each entry into
 * `ready` (made, or back from `notReadyToSend`).
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param signer The keeper's Ethereum signer.
 * @param call The contract, its data and the value.
 * @param options The contract's error ABI, to name a refusal.
 * @returns The signer transaction machine's states.
 */
export const ethereumSignerSend$ = (
    connections: ProofRequestConnections,
    signer: Signer,
    call: TransactionCall,
    options: TransactionMachineOptions
): Observable<SignerTransactionState> =>
    followedStates$(() => {
        const transaction = createSignerTransactionMachine(
            connections,
            signer,
            call,
            options
        );
        const sendWhenReady$ = transaction.state$.pipe(
            filter(({ node }) => node === 'ready'),
            tap(() => transaction.send()),
            ignoreElements()
        );
        return {
            state$: merge(transaction.state$, sendWhenReady$),
            retry: () => transaction.retry(),
            close: () => transaction.close(),
        };
    });

/**
 * One Solana transaction signed and fee-paid by the keeper, made for its
 * instructions when subscribed and closed when unsubscribed. It is sent on
 * each entry into `ready` (made, or back from `notReadyToSend`), and again
 * `resendAfterMs` after it failed to send or expired, until it is over.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param signer The keeper's Solana signer.
 * @param instructions The instructions.
 * @param options The programs' error names and the commitment.
 * @param resendAfterMs How long a send that failed or expired waits before it is sent again.
 * @returns The signer transaction machine's states.
 */
export const signerSend$ = (
    connections: ProofRequestConnections,
    signer: TransactionSigner,
    instructions: readonly Instruction[],
    options: SolanaTransactionMachineOptions,
    resendAfterMs: number
): Observable<SolanaSignerTransactionState> =>
    followedStates$(() => {
        const transaction = createSolanaSignerTransactionMachine(
            connections,
            signer,
            instructions,
            options
        );
        const sendWhenDue$ = transaction.state$.pipe(
            map(({ node }) => node),
            filter(
                (node) =>
                    node === 'ready' ||
                    node === 'sendFailed' ||
                    node === 'expired'
            ),
            switchMap((node) => timer(node === 'ready' ? 0 : resendAfterMs)),
            tap(() => transaction.send()),
            ignoreElements()
        );
        return {
            state$: merge(transaction.state$, sendWhenDue$),
            retry: () => transaction.retry(),
            close: () => transaction.close(),
        };
    });
