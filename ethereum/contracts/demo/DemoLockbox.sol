// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DemoLockbox
/// @notice Testnet demo only: a bridge lockbox whose locked amount and pause
///         flag the owner sets by hand, to replay a drain (e.g. Kelp) live.
///         A Backstop guard reads `locked()` as backing and `paused()`.
contract DemoLockbox {
    address public immutable owner;
    /// @notice Tokens locked (18 decimals): the backing a guard checks.
    uint256 public locked;
    bool public paused;

    error NotOwner();

    event Set(uint256 locked, bool paused);

    constructor(uint256 initialLocked) {
        owner = msg.sender;
        locked = initialLocked;
        emit Set(initialLocked, false);
    }

    function set(uint256 newLocked, bool newPaused) external {
        if (msg.sender != owner) revert NotOwner();
        locked = newLocked;
        paused = newPaused;
        emit Set(newLocked, newPaused);
    }
}
