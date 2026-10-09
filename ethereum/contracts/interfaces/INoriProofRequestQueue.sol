// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title INoriProofRequestQueue
/// @notice The subset of `NoriProofRequestQueue` (nori-solana-sdk,
///         ethereum/contracts) that `NoriSnapshot` calls.
interface INoriProofRequestQueue {
    /// @notice Fee charged per enqueued request, in wei.
    function proofRequestQueueFee() external view returns (uint256);

    /// @notice Enqueue a request to prove one slot of the caller's own storage
    ///         alongside the next consensus proof.
    /// @param slotKey Raw 32-byte storage key to prove under `msg.sender`.
    /// @param collectionKeys Up to two identifiers relayed into the leaf.
    /// @return requestId Queue index assigned to this request.
    function requestProof(
        bytes32 slotKey,
        bytes32[] calldata collectionKeys
    ) external payable returns (uint256 requestId);
}
