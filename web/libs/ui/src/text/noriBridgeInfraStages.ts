import type { NoriBridgeInfraTransitionState } from '@nori-zk/nori-bridge-solana-sdk';

/** A node of Nori's bridge infra transition graph. */
export type NoriBridgeInfraStage = NoriBridgeInfraTransitionState['node'];

/** What each node of Nori's bridge infra transition graph is shown as. */
export const NORI_BRIDGE_INFRA_STAGE_TEXT: Record<NoriBridgeInfraStage, string> = {
    BridgeHeadJobCreated: 'Proving light client inside zkVM',
    BridgeHeadJobSucceeded: 'Light client proof ready',
    BridgeHeadJobFailed: 'Light client proof failed, proving again',
    EthProcessorTransactionSubmitting: 'Settling proof on Solana',
    EthProcessorTransactionSubmitSucceeded: 'Waiting for Solana confirmation',
    EthProcessorTransactionSubmitFailed: 'Settling proof on Solana failed, retrying',
    EthProcessorTransactionFinalizationSucceeded: 'Proof confirmed on Solana',
    EthProcessorTransactionFinalizationFailed: 'Proof failed to be confirmed on Solana, retrying',
    BridgeHeadAdvanced: 'Bridge head advanced, waiting for the next Ethereum finality',
};

/** The loop's nodes in order; a failure takes the place of the step that failed. */
export const NORI_BRIDGE_INFRA_STAGE_ORDER: readonly NoriBridgeInfraStage[] = [
    'BridgeHeadJobCreated',
    'BridgeHeadJobSucceeded',
    'EthProcessorTransactionSubmitting',
    'EthProcessorTransactionSubmitSucceeded',
    'EthProcessorTransactionFinalizationSucceeded',
    'BridgeHeadAdvanced',
];

/** The step of the loop each failure takes the place of. */
const FAILED_STEP: Partial<Record<NoriBridgeInfraStage, NoriBridgeInfraStage>> = {
    BridgeHeadJobFailed: 'BridgeHeadJobSucceeded',
    EthProcessorTransactionSubmitFailed: 'EthProcessorTransactionSubmitSucceeded',
    EthProcessorTransactionFinalizationFailed: 'EthProcessorTransactionFinalizationSucceeded',
};

/**
 * The previous, current and next stage's text around a node, along the loop.
 *
 * @param stage The current node.
 * @returns The three texts.
 */
export function noriBridgeInfraStagesAround(stage: NoriBridgeInfraStage): [string, string, string] {
    const order = NORI_BRIDGE_INFRA_STAGE_ORDER;
    const index = order.indexOf(FAILED_STEP[stage] ?? stage);
    const previous = order[(index - 1 + order.length) % order.length];
    const next = order[(index + 1) % order.length];
    return [
        NORI_BRIDGE_INFRA_STAGE_TEXT[previous],
        NORI_BRIDGE_INFRA_STAGE_TEXT[stage],
        NORI_BRIDGE_INFRA_STAGE_TEXT[next],
    ];
}
