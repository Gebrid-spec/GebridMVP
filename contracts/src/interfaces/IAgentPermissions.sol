// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title IAgentPermissions
/// @notice Enforcement-side view of the permission registry, as consumed by AgentTBA.
interface IAgentPermissions {
    /// @notice Charges one call against `delegate`'s active grant on the calling account.
    /// @dev The caller MUST be the agent account itself; the implementation reads `msg.sender`
    ///      as the account, so a third party cannot spend someone else's budget.
    ///      Reverts unless the grant (and every ancestor of it) authorises the call.
    function consume(address delegate, address target, bytes4 selector, uint256 value)
        external
        returns (bytes32 grantId);

    /// @notice True when `signer` holds a live, signing-enabled grant on `account`.
    function canSignFor(address account, address signer) external view returns (bool);
}
