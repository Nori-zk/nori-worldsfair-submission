// TEMPORARY: synthetic waiting requests to preview populated rows. Remove before committing.
import { type EnqueuedProofRequest } from '@nori-zk/nori-bridge-solana-sdk';
import { type NoriBridgeInfraState } from '@nori-zk/solana-web-ui';

/** Whether the page asked for synthetic rows (`?synthetic`). */
export const SYNTHETIC = new URLSearchParams(window.location.search).has('synthetic');

const synthetic = (id: number, blockNumber: number): EnqueuedProofRequest => ({
    requestId: BigInt(id),
    target: NORI_WEB_ENV.ethereum.snapshotAddress,
    slotKey: '0x' + '00'.repeat(32),
    blockNumber,
    transactionHash: '0x' + id.toString(16).padStart(64, '0'),
    collectionKeys: [],
});

/**
 * Two requests for each row: above the finalized block, finalized but
 * outside Nori's job, and inside its job while one runs.
 *
 * @param finalizedBlock Ethereum's finalized block.
 * @param bridge Nori's state, if known.
 * @returns The synthetic requests.
 */
export function syntheticRequests(finalizedBlock: number, bridge?: NoriBridgeInfraState): EnqueuedProofRequest[] {
    const requests = [synthetic(900004, finalizedBlock + 10), synthetic(900005, finalizedBlock + 20)];
    const before = bridge ? bridge.input_block_number - 3 : finalizedBlock - 3;
    requests.push(synthetic(900000, before), synthetic(900001, before - 1));
    if (bridge)
        requests.push(
            synthetic(900002, bridge.output_block_number - 5),
            synthetic(900003, bridge.output_block_number - 4),
        );
    return requests;
}
