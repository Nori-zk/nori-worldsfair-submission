// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INoriProofRequestQueue} from './interfaces/INoriProofRequestQueue.sol';

/// @title NoriSnapshot
/// @notice Makes the results of any Ethereum view calls provable on Solana.
///         `snapshot` runs up to 256 static calls, stores one Merkle root of
///         the results (write-once) and enqueues one Nori proof request for it.
/// @dev No owner, proxy or admin. STORAGE LAYOUT IS PROOF-CRITICAL:
///
///        slot 0 : commitments[snapshotIndex] = uint256(resultsRoot) | 1 << 255
///        slot 1 : snapshotCount (indices start at 1)
///
///      Request: slotKey = keccak256(abi.encode(index, 0)),
///               keys = [index, block.number << 64 | block.timestamp].
///      Results tree: leaves sha256(0x00 ++ queryId ++ result) with
///      queryId = keccak256(abi.encode(target, data)), zero-padded to a power
///      of two, nodes sha256(left ++ right) as in nori-hash.
///
///      The 0x00 prefix keeps a leaf (65 bytes) from posing as a node (64
///      bytes); without it a crafted result proves any value one level up.
///      The top bit and non-zero keys let readers reject false zeros.
contract NoriSnapshot {
    // -------------------------------
    // Constants
    // -------------------------------
    /// @notice Set on every committed word in place of the root's top bit.
    uint256 public constant SENTINEL = 1 << 255;
    /// @notice Storage index of `_commitments`.
    /// @dev Proof-critical: `slotKeyOf` derives every request's slot from it.
    uint256 public constant COMMITMENTS_SLOT_INDEX = 0;
    /// @notice Most queries in one snapshot; bounds a result path to 8 hashes.
    uint256 public constant MAX_QUERIES = 256;
    /// @notice Prefixed to every results leaf so it can never pass for a node.
    bytes1 public constant RESULT_LEAF_PREFIX = 0x00;

    // -------------------------------
    // Immutables
    // -------------------------------
    /// @notice The queue every snapshot enqueues its proof request on.
    INoriProofRequestQueue public immutable proofQueue;

    // -------------------------------
    // Provable State (proof-critical layout — do not reorder)
    // -------------------------------
    /// @notice snapshot index => `uint256(resultsRoot) | SENTINEL`.
    /// @dev Slot 0. Written once per index, never edited.
    mapping(uint256 snapshotIndex => uint256 word) public commitments;

    // -------------------------------
    // State (not provable)
    // -------------------------------
    /// @notice Snapshots taken so far; also the index of the latest one, as
    ///         indices start at 1.
    /// @dev Slot 1.
    uint256 public snapshotCount;

    // -------------------------------
    // Types
    // -------------------------------
    /// @param target The contract to call.
    /// @param data The calldata of a view function returning one 32-byte word.
    struct Query {
        address target;
        bytes data;
    }

    // -------------------------------
    // Custom Errors
    // -------------------------------
    error ZeroAddress();
    error NoQueries();
    error TooManyQueries(uint256 count, uint256 max);
    error IncorrectFee(uint256 expected, uint256 actual);
    error QueryFailed(uint256 index, bytes32 queryId, bytes reason);
    error InvalidResultLength(uint256 index, bytes32 queryId, uint256 length);

    // -------------------------------
    // Events
    // -------------------------------
    /// @notice Everything a witness builder needs to rebuild the results tree.
    /// @param snapshotIndex The snapshot's index and first collection key.
    /// @param requestId The proof request queue id of its commitment.
    /// @param blockNumber The snapshot block.
    /// @param timestamp The snapshot block's timestamp.
    /// @param resultsRoot The results root, with its original top bit.
    /// @param queryIds `keccak256(abi.encode(target, data))` per query, in order.
    /// @param results Each query's 32-byte result, in order.
    event Snapshot(
        uint256 indexed snapshotIndex,
        uint256 indexed requestId,
        uint256 blockNumber,
        uint256 timestamp,
        bytes32 resultsRoot,
        bytes32[] queryIds,
        bytes32[] results
    );

    // -------------------------------
    // Constructor
    // -------------------------------
    /// @param _proofQueue The `NoriProofRequestQueue` to enqueue on.
    constructor(address _proofQueue) {
        if (_proofQueue == address(0)) revert ZeroAddress();
        proofQueue = INoriProofRequestQueue(_proofQueue);
    }

    // -------------------------------
    // Snapshot
    // -------------------------------
    /// @notice Call every query read-only, commit to the results and enqueue
    ///         one proof of the commitment. Reverts as a whole if any call
    ///         fails or returns anything but exactly 32 bytes.
    /// @dev Send exactly `snapshotFee()`: the queue's current per-request
    ///      fee, read in this transaction and forwarded to it.
    /// @param queries The calls to snapshot, in order; repeats are allowed.
    /// @return snapshotIndex The snapshot's index.
    /// @return requestId The proof request queue id.
    /// @return resultsRoot The results root, with its original top bit.
    function snapshot(
        Query[] calldata queries
    )
        external
        payable
        returns (uint256 snapshotIndex, uint256 requestId, bytes32 resultsRoot)
    {
        uint256 count = queries.length;
        if (count == 0) revert NoQueries();
        if (count > MAX_QUERIES) revert TooManyQueries(count, MAX_QUERIES);

        uint256 fee = proofQueue.proofRequestQueueFee();
        if (msg.value != fee) revert IncorrectFee(fee, msg.value);

        bytes32[] memory queryIds = new bytes32[](count);
        bytes32[] memory results = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            bytes32 queryId = queryIdOf(queries[i].target, queries[i].data);
            (bool ok, bytes memory returned) = queries[i].target.staticcall(
                queries[i].data
            );
            if (!ok) revert QueryFailed(i, queryId, returned);
            if (returned.length != 32)
                revert InvalidResultLength(i, queryId, returned.length);

            queryIds[i] = queryId;
            results[i] = bytes32(returned);
        }
        resultsRoot = resultsRootOf(queryIds, results);

        // Effects before interaction
        snapshotIndex = ++snapshotCount;
        commitments[snapshotIndex] = uint256(resultsRoot) | SENTINEL;

        bytes32[] memory collectionKeys = new bytes32[](2);
        collectionKeys[0] = bytes32(snapshotIndex);
        collectionKeys[1] = timeKeyOf(block.number, block.timestamp);

        requestId = proofQueue.requestProof{value: fee}(
            slotKeyOf(snapshotIndex),
            collectionKeys
        );

        emit Snapshot(
            snapshotIndex,
            requestId,
            block.number,
            block.timestamp,
            resultsRoot,
            queryIds,
            results
        );
    }

    // -------------------------------
    // Views
    // -------------------------------
    /// @notice The fee to send with a snapshot, in wei.
    function snapshotFee() external view returns (uint256) {
        return proofQueue.proofRequestQueueFee();
    }

    /// @notice The id a query's results are committed under.
    function queryIdOf(
        address target,
        bytes calldata data
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, data));
    }

    /// @notice A result's leaf in the results tree: `sha256(0x00 ++ queryId ++ result)`.
    function resultLeafOf(
        bytes32 queryId,
        bytes32 result
    ) public pure returns (bytes32) {
        return sha256(abi.encodePacked(RESULT_LEAF_PREFIX, queryId, result));
    }

    /// @notice The SHA-256 Merkle root over `resultLeafOf(queryIds[k], results[k])`,
    ///         padded with zero leaves to the next power of two.
    function resultsRootOf(
        bytes32[] memory queryIds,
        bytes32[] memory results
    ) public pure returns (bytes32) {
        uint256 count = queryIds.length;
        if (count == 0) revert NoQueries();

        uint256 width = 1;
        while (width < count) width <<= 1;

        bytes32[] memory nodes = new bytes32[](width);
        for (uint256 i = 0; i < count; i++) {
            nodes[i] = resultLeafOf(queryIds[i], results[i]);
        }
        while (width > 1) {
            width >>= 1;
            for (uint256 i = 0; i < width; i++) {
                nodes[i] = sha256(
                    abi.encodePacked(nodes[2 * i], nodes[2 * i + 1])
                );
            }
        }
        return nodes[0];
    }

    /// @notice The storage key of `commitments[snapshotIndex]`.
    function slotKeyOf(uint256 snapshotIndex) public pure returns (bytes32) {
        return keccak256(abi.encode(snapshotIndex, COMMITMENTS_SLOT_INDEX));
    }

    /// @notice The second collection key: the snapshot block and its time.
    function timeKeyOf(
        uint256 blockNumber,
        uint256 timestamp
    ) public pure returns (bytes32) {
        return bytes32((blockNumber << 64) | timestamp);
    }
}
