// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title IERC6551Account
/// @notice Verbatim ERC-6551 account interface. Interface id MUST equal 0x6faff5f1;
///         `AgentTBA_Interfaces.t.sol` asserts that against this declaration.
interface IERC6551Account {
    /// @dev Allows the account to receive native token. Not part of the interface id.
    receive() external payable;

    /// @notice Returns a value that changes on every successful state-mutating call.
    function state() external view returns (uint256);

    /// @notice Returns 0x523e3260 when `signer` is authorised to act for this account.
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4 magicValue);

    /// @notice Returns the identifier of the non-fungible token that owns this account.
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
}

/// @title IERC6551Executable
/// @notice Verbatim ERC-6551 execution interface. Interface id MUST equal 0x51945447.
interface IERC6551Executable {
    /// @notice Executes a low-level operation on behalf of the account.
    /// @param operation Only operation 0 (CALL) is supported by AgentTBA.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}
