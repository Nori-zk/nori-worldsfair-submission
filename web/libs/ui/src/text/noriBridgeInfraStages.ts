import type { NoriBridgeInfraTransitionState } from '@nori-zk/nori-bridge-solana-sdk';

/** A node of Nori's bridge infra transition graph. */
export type NoriBridgeInfraStage = NoriBridgeInfraTransitionState['node'];

/**
 * What each node of Nori's bridge infra transition graph is shown as. A
 * notice reports a step that has just finished, so each text is the work
 * until the next notice.
 */
export const NORI_BRIDGE_INFRA_STAGE_TEXT: Record<NoriBridgeInfraStage, string> = {
    BridgeHeadAdvanced: 'Waiting for the next Ethereum finality',
    BridgeHeadJobCreated: 'Proving light client inside zkVM',
    BridgeHeadJobFailed: 'Light client proof failed, proving again',
    BridgeHeadJobSucceeded: 'Light client proof ready, settling on Solana',
    EthProcessorTransactionSubmitting: 'Settling proof on Solana',
    EthProcessorTransactionSubmitFailed: 'Settling proof on Solana failed, retrying',
    EthProcessorTransactionSubmitSucceeded: 'Waiting for Solana confirmation',
    EthProcessorTransactionFinalizationFailed: 'Proof failed to be confirmed on Solana, retrying',
    EthProcessorTransactionFinalizationSucceeded:
        'Proof confirmed on Solana, waiting for the next Ethereum finality',
};

/**
 * The loop's steps in order, ending at the proof confirmed on Solana.
 * `BridgeHeadAdvanced` is the loop's start, before the first step: waiting
 * for the Ethereum finality that starts the next job.
 */
export const NORI_BRIDGE_INFRA_STAGE_ORDER: readonly NoriBridgeInfraStage[] = [
    'BridgeHeadJobCreated',
    'BridgeHeadJobSucceeded',
    'EthProcessorTransactionSubmitting',
    'EthProcessorTransactionSubmitSucceeded',
    'EthProcessorTransactionFinalizationSucceeded',
];

/** The step each failure stays at while that step is retried. */
const FAILED_STEP: Partial<Record<NoriBridgeInfraStage, NoriBridgeInfraStage>> = {
    BridgeHeadJobFailed: 'BridgeHeadJobCreated',
    EthProcessorTransactionSubmitFailed: 'EthProcessorTransactionSubmitting',
    EthProcessorTransactionFinalizationFailed: 'EthProcessorTransactionSubmitSucceeded',
};

/**
 * A node's place along the loop; a failure stays at the step it retries.
 *
 * @param stage The node.
 * @returns Its index in {@link NORI_BRIDGE_INFRA_STAGE_ORDER}, or -1 for `BridgeHeadAdvanced`, the loop's start.
 */
export function noriBridgeInfraStageIndex(stage: NoriBridgeInfraStage): number {
    return NORI_BRIDGE_INFRA_STAGE_ORDER.indexOf(FAILED_STEP[stage] ?? stage);
}

/**
 * The previous, current and next stage's text around a node, along the loop.
 *
 * @param stage The current node.
 * @returns The three texts.
 */
export function noriBridgeInfraStagesAround(stage: NoriBridgeInfraStage): [string, string, string] {
    const order = NORI_BRIDGE_INFRA_STAGE_ORDER;
    const index = noriBridgeInfraStageIndex(stage);
    // The start (-1) comes after the last step and before the first.
    const previous =
        order[index < 0 ? order.length - 1 : (index - 1 + order.length) % order.length]!;
    const next = order[(index + 1) % order.length]!;
    return [
        NORI_BRIDGE_INFRA_STAGE_TEXT[previous],
        NORI_BRIDGE_INFRA_STAGE_TEXT[stage],
        NORI_BRIDGE_INFRA_STAGE_TEXT[next],
    ];
}
