// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only target for NoriSnapshot: views with every result shape
///         the snapshot must accept or reject.
contract SnapshotTargetMock {
    uint256 public value;

    function setValue(uint256 newValue) external {
        value = newValue;
    }

    function isPaused() external view returns (bool) {
        return value != 0;
    }

    function twoWords() external pure returns (uint256, uint256) {
        return (1, 2);
    }

    function nothing() external pure {}

    function reverts() external pure {
        revert('SnapshotTargetMock: reverts');
    }

    /// @dev Writes state, so a static call to it fails.
    function bump() external returns (uint256) {
        return ++value;
    }
}
