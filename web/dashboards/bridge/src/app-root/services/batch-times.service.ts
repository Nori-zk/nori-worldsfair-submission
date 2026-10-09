import { Injectable } from '@yaw-rx/core';
import { address } from '@solana/kit';
import { ConnectionsService } from '@nori-zk/solana-web-ui';
import { type ProofQueueBatchSummary } from '@nori-zk/nori-bridge-solana-sdk';
import { landingOf, type BatchLanding } from '../utils/batch-landing.js';

export type { BatchLanding };

/** How many Nori program signatures one read covers: about 4 days of updates. */
const NORI_SIGNATURES = 1000;

/**
 * When each proof queue batch landed on Solana. A batch account holds no
 * time, so its landing is the transaction that created it (`landingOf`),
 * read from the batch PDA's signatures and checked against the Nori
 * program's. A landing never changes, so each is read once and kept.
 *
 * shortcut: a Nori `mint` naming batch N would also match; there are none on
 * this deployment.
 */
@Injectable([ConnectionsService])
export class BatchTimesService {
    private readonly known = new Map<bigint, BatchLanding>();

    /** @param connections The connections: the signatures come from Solana. */
    constructor(private readonly connections: ConnectionsService) {}

    /**
     * The landings of some batches: one read of the Nori program's signatures,
     * then one per batch not read before, one at a time (public devnet allows
     * about 40 per 10 s per method).
     *
     * @param batches The batches.
     * @returns Each batch's landing by index; a batch with none is left out.
     */
    async landings(batches: ProofQueueBatchSummary[]): Promise<Map<bigint, BatchLanding>> {
        const unknown = batches.filter(
            ({ proofQueueBatchIndex }) => !this.known.has(proofQueueBatchIndex),
        );
        if (unknown.length > 0) {
            const rpc = await this.connections.connections.solana.http.ready();
            const program = await rpc
                .getSignaturesForAddress(NORI_WEB_ENV.solana.programAddress, {
                    limit: NORI_SIGNATURES,
                })
                .send();
            const nori = new Set(
                program.filter(({ err }) => err === null).map(({ signature }) => signature),
            );
            for (const batch of unknown) {
                const signatures = await rpc
                    .getSignaturesForAddress(address(batch.proofQueueBatchAddress))
                    .send();
                const landing = landingOf(signatures, nori);
                if (landing) this.known.set(batch.proofQueueBatchIndex, landing);
            }
        }
        return new Map(
            batches.flatMap(({ proofQueueBatchIndex }): [bigint, BatchLanding][] => {
                const landing = this.known.get(proofQueueBatchIndex);
                return landing ? [[proofQueueBatchIndex, landing]] : [];
            }),
        );
    }
}
