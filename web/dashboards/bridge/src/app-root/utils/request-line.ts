import { type EnqueuedProofRequest } from '@nori-zk/nori-bridge-solana-sdk';
import { addressUrl, contractName, shortHex, transactionUrl } from '@nori-zk/solana-web-ui';

/** A request as `request-line` takes it. */
export interface Line {
    key: string;
    request: string;
    contract: string;
    detail: string;
    detailUrl: string;
    transaction: string;
    transactionUrl: string;
}

/**
 * A request as a line: its id, the contract that submitted it, the
 * contract's address and the transaction that enqueued it.
 *
 * @param request The request.
 * @returns The line.
 */
export const lineOf = (request: EnqueuedProofRequest): Line => ({
    key: request.requestId.toString(),
    request: `#${request.requestId.toString()}`,
    contract: contractName(request.target),
    detail: shortHex(request.target),
    detailUrl: addressUrl(request.target),
    transaction: shortHex(request.transactionHash),
    transactionUrl: transactionUrl(request.transactionHash),
});
