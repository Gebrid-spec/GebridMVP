// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title ERC6551Bytecode
/// @notice The ERC-6551 account creation code and its CREATE2 address derivation, in one place.
///
/// @dev Extracted from `ERC6551Registry` so the same derivation can be used to *verify* a registry
///      we did not deploy. `DeployCore` calls `computeAccount` against the registry address it is
///      told to use and compares the result with what that registry's own `account()` view returns.
///      A registry that does not implement the ERC exactly will disagree, and the deployment aborts.
///      That check replaces trusting a hardcoded code hash for the canonical singleton.
///
///      Account runtime (173 = 0xad bytes):
///
///        [0x00 .. 0x2c]  ERC-1167 minimal proxy, 45 bytes, delegating to `implementation`
///        [0x2d .. 0x4c]  salt          (bytes32)
///        [0x4d .. 0x6c]  chainId       (uint256)
///        [0x6d .. 0x8c]  tokenContract (uint256-padded address)
///        [0x8d .. 0xac]  tokenId       (uint256)
///
///      `tokenContract` occupying a full 32-byte word is the detail everything else rests on:
///      packing it as a bare 20-byte `address` shifts `tokenId` twelve bytes and every account
///      then misreports which token owns it.
library ERC6551Bytecode {
    /// @notice Creation code for an ERC-6551 account.
    /// @dev `3d60ad80600a3d3981f3` is the constructor: return the 0xad bytes that follow it.
    ///      `363d3d373d3d3d363d73 <impl> 5af43d82803e903d91602b57fd5bf3` is the ERC-1167 proxy.
    function creationCode(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            salt,
            chainId,
            uint256(uint160(tokenContract)),
            tokenId
        );
    }

    /// @notice Runtime code an ERC-6551 account must have once deployed.
    function runtimeCode(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            salt,
            chainId,
            uint256(uint160(tokenContract)),
            tokenId
        );
    }

    /// @notice CREATE2 address of an ERC-6551 account, for an arbitrary registry.
    /// @param registry The registry that would deploy it. CREATE2 mixes in the deployer, so this
    ///        is what makes the same tuple resolve differently under different registries.
    function computeAccount(
        address registry,
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (address) {
        bytes32 codeHash = keccak256(creationCode(implementation, salt, chainId, tokenContract, tokenId));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), registry, salt, codeHash)))));
    }
}
