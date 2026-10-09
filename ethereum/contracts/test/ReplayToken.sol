// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only token balance sheet for replaying a lockbox drain.
contract ReplayToken {
    mapping(address account => uint256) public balanceOf;

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}
