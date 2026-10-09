import { readFileSync } from 'node:fs';
import {
    appendTransactionMessageInstructions,
    createDefaultRpcTransport,
    createKeyPairSignerFromBytes,
    createSolanaRpcFromTransport,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    getSignatureFromTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Address,
    type Instruction,
    type KeyPairSigner,
    type RpcTransport,
} from '@solana/kit';

/** Any RPC call gives up after this, so a hung connection can't stall the keeper. */
export const RPC_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 2_000;

export function createSolanaRpc(url: string) {
    const http = createDefaultRpcTransport({ url });
    const transport: RpcTransport = (config) =>
        http({
            ...config,
            signal: config.signal ?? AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
    return createSolanaRpcFromTransport(transport);
}

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export interface Solana {
    rpc: SolanaRpc;
    signer: KeyPairSigner;
    send(instruction: Instruction): Promise<string>;
    accountData(account: Address): Promise<Uint8Array | null>;
}

export async function connectSolana(
    rpcUrl: string,
    keypairPath: string
): Promise<Solana> {
    const rpc = createSolanaRpc(rpcUrl);
    const signer = await createKeyPairSignerFromBytes(
        new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')))
    );

    return {
        rpc,
        signer,
        /**
         * Sends and confirms over plain HTTP: polls the signature until it is
         * confirmed or its blockhash expires. A preflight failure (e.g. a
         * custom program error) throws from sendTransaction.
         */
        async send(instruction) {
            const { value: blockhash } = await rpc
                .getLatestBlockhash({ commitment: 'confirmed' })
                .send();
            const message = pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(signer, m),
                (m) =>
                    setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([instruction], m)
            );
            const transaction =
                await signTransactionMessageWithSigners(message);
            const signature = getSignatureFromTransaction(transaction);
            await rpc
                .sendTransaction(getBase64EncodedWireTransaction(transaction), {
                    encoding: 'base64',
                    preflightCommitment: 'confirmed',
                })
                .send();
            for (let expired = false; ;) {
                const {
                    value: [status],
                } = await rpc.getSignatureStatuses([signature]).send();
                if (status?.err)
                    throw new Error(
                        `Transaction ${signature} failed: ${JSON.stringify(status.err, (_, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))}`
                    );
                if (
                    status?.confirmationStatus === 'confirmed' ||
                    status?.confirmationStatus === 'finalized'
                )
                    return signature;
                if (expired)
                    throw new Error(
                        `Transaction ${signature} expired before it was confirmed`
                    );
                const height = await rpc
                    .getBlockHeight({ commitment: 'confirmed' })
                    .send();
                // One last status check after the blockhash expires
                expired = height > blockhash.lastValidBlockHeight;
                if (!expired)
                    await new Promise((resolve) =>
                        setTimeout(resolve, CONFIRM_POLL_MS)
                    );
            }
        },
        async accountData(account) {
            const { value } = await rpc
                .getAccountInfo(account, { encoding: 'base64' })
                .send();
            return value ? Buffer.from(value.data[0], 'base64') : null;
        },
    };
}

/** An SPL mint's supply (u64 at byte 36). */
export function mintSupply(data: Uint8Array): bigint {
    return new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
    ).getBigUint64(36, true);
}

/**
 * The custom program error code of a failed send: from @solana/kit's error
 * context, the logs, or a failed transaction's status.
 */
export function customErrorCode(error: unknown): number | undefined {
    const e = error as {
        context?: { logs?: string[] };
        cause?: { context?: { code?: unknown } };
    };
    if (typeof e?.cause?.context?.code === 'number')
        return e.cause.context.code;
    const text = e?.context?.logs?.join('\n') ?? String(error);
    const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text);
    if (hex?.[1]) return parseInt(hex[1], 16);
    const custom = /"Custom":\s*(\d+)/.exec(text);
    return custom?.[1] ? Number(custom[1]) : undefined;
}
