// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IERC6551Registry
/// @notice Verbatim ERC-6551 registry interface. Kept in-tree (rather than pulled from a
///         dependency) so the byte-level account layout this repo relies on is auditable
///         from a single place.
interface IERC6551Registry {
    /// @notice Emitted when a token bound account is created.
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    /// @notice Thrown when the CREATE2 deployment of a token bound account fails.
    error AccountCreationFailed();

    /// @notice Creates a token bound account for a non-fungible token.
    /// @dev MUST be idempotent: returns the existing address if the account is already deployed.
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    /// @notice Returns the counterfactual address of a token bound account, deployed or not.
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
}
