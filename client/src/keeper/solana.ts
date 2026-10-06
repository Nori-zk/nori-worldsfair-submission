import { readFileSync } from 'node:fs';
import {
    appendTransactionMessageInstructions,
    assertIsTransactionWithBlockhashLifetime,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Address,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export interface Solana {
    rpc: SolanaRpc;
    signer: KeyPairSigner;
    send(instruction: Instruction): Promise<string>;
    accountData(account: Address): Promise<Uint8Array | null>;
}

export async function connectSolana(
    rpcUrl: string,
    wsUrl: string,
    keypairPath: string
): Promise<Solana> {
    const rpc = createSolanaRpc(rpcUrl);
    const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
    const signer = await createKeyPairSignerFromBytes(
        new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')))
    );
    const sendAndConfirm = sendAndConfirmTransactionFactory({
        rpc,
        rpcSubscriptions,
    });

    return {
        rpc,
        signer,
        async send(instruction) {
            const { value: blockhash } = await rpc.getLatestBlockhash().send();
            const message = pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(signer, m),
                (m) =>
                    setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([instruction], m)
            );
            const transaction =
                await signTransactionMessageWithSigners(message);
            assertIsTransactionWithBlockhashLifetime(transaction);
            await sendAndConfirm(transaction, { commitment: 'confirmed' });
            return getSignatureFromTransaction(transaction);
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

/** The custom program error code of a failed send (from @solana/kit's error context or logs). */
export function customErrorCode(error: unknown): number | undefined {
    const e = error as {
        context?: { logs?: string[] };
        cause?: { context?: { code?: unknown } };
    };
    if (typeof e?.cause?.context?.code === 'number')
        return e.cause.context.code;
    const text = e?.context?.logs?.join('\n') ?? String(error);
    const match = /custom program error: 0x([0-9a-f]+)/i.exec(text);
    return match?.[1] ? parseInt(match[1], 16) : undefined;
}
