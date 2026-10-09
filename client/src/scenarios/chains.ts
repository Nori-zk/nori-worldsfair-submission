// The campaign's own chain actions: set a DemoLockbox on Ethereum, mint or
// burn on Solana, simulate an instruction, and read a transaction's cost.
import { Wallet, type JsonRpcProvider } from 'ethers';
import { DemoLockbox__factory } from '@nori-zk/ethereum-snapshot';
import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    compileTransaction,
    createTransactionMessage,
    getAddressEncoder,
    getBase64EncodedWireTransaction,
    getProgramDerivedAddress,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type Address,
    type Instruction,
    type Signature,
} from '@solana/kit';
import type { Solana } from '../keeper/solana.js';

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Sets a DemoLockbox's `locked` (18-decimal units) and `paused`; returns the block. */
export async function lockboxSet(
    provider: JsonRpcProvider,
    lockbox: string,
    locked: bigint,
    paused: boolean
): Promise<{ txHash: string; block: number; gasUsed: bigint }> {
    const key = process.env.ETH_PRIVATE_KEY;
    if (!key) throw new Error('Missing env: ETH_PRIVATE_KEY');
    const contract = DemoLockbox__factory.connect(
        lockbox,
        new Wallet(key, provider)
    );
    const tx = await contract.set(locked, paused);
    const receipt = await tx.wait(1, 3 * 60_000);
    if (!receipt) throw new Error(`lockbox set ${tx.hash}: not mined`);
    return {
        txHash: tx.hash,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
    };
}

/** The payer's associated token account for `mint` (deploy-devnet.sh funds it). */
export async function payerTokenAccount(
    mint: Address,
    owner: Address
): Promise<Address> {
    const bytes = (a: Address) => getAddressEncoder().encode(a);
    const [ata] = await getProgramDerivedAddress({
        programAddress: ATA_PROGRAM,
        seeds: [bytes(owner), bytes(TOKEN_PROGRAM), bytes(mint)],
    });
    return ata;
}

function u64le(value: bigint): Uint8Array {
    const out = new Uint8Array(8);
    for (let i = 0; i < 8; i++)
        out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
    return out;
}

/** SPL Token `MintTo` (the payer is the mint authority). */
export async function mintTo(
    solana: Solana,
    mint: Address,
    amount: bigint
): Promise<Signature> {
    const account = await payerTokenAccount(mint, solana.signer.address);
    return solana.send({
        programAddress: TOKEN_PROGRAM,
        accounts: [
            { address: mint, role: AccountRole.WRITABLE },
            { address: account, role: AccountRole.WRITABLE },
            {
                address: solana.signer.address,
                role: AccountRole.READONLY_SIGNER,
            },
        ],
        data: new Uint8Array([7, ...u64le(amount)]),
    }) as Promise<Signature>;
}

/** SPL Token `Burn` from the payer's token account. */
export async function burn(
    solana: Solana,
    mint: Address,
    amount: bigint
): Promise<Signature> {
    const account = await payerTokenAccount(mint, solana.signer.address);
    return solana.send({
        programAddress: TOKEN_PROGRAM,
        accounts: [
            { address: account, role: AccountRole.WRITABLE },
            { address: mint, role: AccountRole.WRITABLE },
            {
                address: solana.signer.address,
                role: AccountRole.READONLY_SIGNER,
            },
        ],
        data: new Uint8Array([8, ...u64le(amount)]),
    }) as Promise<Signature>;
}

export interface Simulation {
    /** The custom program error code, or undefined when it succeeded. */
    errorCode?: number;
    err?: unknown;
    logs: string[];
    unitsConsumed?: bigint;
    /** Return data of the last instruction, when the program set any. */
    returnData?: Uint8Array;
}

/**
 * Simulates an instruction without signatures (`sigVerify: false`), so an
 * attack can pose as any signer without a key.
 */
export async function simulate(
    solana: Solana,
    instruction: Instruction,
    feePayer: Address = solana.signer.address
): Promise<Simulation> {
    const { value: blockhash } = await solana.rpc
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions([instruction], m)
    );
    const { value } = await solana.rpc
        .simulateTransaction(
            getBase64EncodedWireTransaction(compileTransaction(message)),
            {
                encoding: 'base64',
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: 'confirmed',
            }
        )
        .send();
    const custom = /"Custom":\s*(\d+)/.exec(
        JSON.stringify(value.err, (_, v: unknown) =>
            typeof v === 'bigint' ? Number(v) : v
        )
    );
    return {
        errorCode: custom?.[1] ? Number(custom[1]) : undefined,
        err: value.err ?? undefined,
        logs: [...(value.logs ?? [])],
        unitsConsumed: value.unitsConsumed,
        returnData: value.returnData
            ? Buffer.from(value.returnData.data[0], 'base64')
            : undefined,
    };
}

/** Compute units a confirmed transaction used (undefined until it is available). */
export async function computeUnits(
    solana: Solana,
    signature: Signature
): Promise<bigint | undefined> {
    const tx = await solana.rpc
        .getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
            encoding: 'base64',
        })
        .send();
    return tx?.meta?.computeUnitsConsumed ?? undefined;
}
