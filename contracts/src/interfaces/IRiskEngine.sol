// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IRiskEngine
/// @notice Enforcement-side view of the risk engine, as consumed by AgentTBA.
interface IRiskEngine {
    /// @notice Verdicts, ordered by severity. Ordering is load-bearing: the anti-downgrade rule
    ///         is expressed as `newVerdict >= currentVerdict` while the current one is in window.
    enum Verdict {
        NONE,
        CLEAR,
        WARN,
        BLOCK
    }

    /// @notice Operating modes, ordered by restrictiveness. Ordering is load-bearing: escalation
    ///         is cheap (guardian, immediate), de-escalation is expensive (admin, after a delay).
    enum Mode {
        NORMAL,
        RESTRICTED,
        CRISIS
    }

    /// @notice Reverts when the intent must not be executed. Pure view: it records nothing.
    /// @dev Intentionally a view function. A blocked intent reverts the whole transaction, so any
    ///      event emitted here would be rolled back and could never back a public metric. The
    ///      durable record of a block is `RiskBlocked`, emitted when the attestation is stored.
    function enforceIntent(address account, address target, uint256 value, bytes4 selector, bytes32 dataHash)
        external
        view;
}
