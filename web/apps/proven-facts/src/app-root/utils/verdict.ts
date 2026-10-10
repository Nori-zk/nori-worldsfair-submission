import type { VerifyVerdict } from '@nori-zk/solana-web-ui';

/**
 * A verify's verdict in a sentence: `verifiedText`'s and `verifyFailedText`'s
 * (the dashboard's fact line), reworded for this page, same colour.
 *
 * @param verdict The shared library's verdict.
 * @returns `Verified by nori-read-example on Solana (2,751 CU).`, or `Could not verify: …`.
 */
export function verdictSentence({ text, style }: VerifyVerdict): VerifyVerdict {
    const verified = /^verified by nori-read-example · (.+) CU$/.exec(text);
    if (verified)
        return {
            text: `Verified by nori-read-example on Solana (${verified[1] ?? ''} CU).`,
            style,
        };
    return { text: text.replace(/^did not verify: /, 'Could not verify: '), style };
}
