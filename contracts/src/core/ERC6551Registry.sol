// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {IERC6551Registry} from "../interfaces/IERC6551Registry.sol";

/// @title ERC6551Registry
/// @notice ERC-6551 account registry. Deploys accounts whose runtime bytecode is byte-identical
///         to the layout fixed by the ERC, so any 6551-aware tooling can read them.
/// @dev Account runtime (173 = 0xad bytes):
///
///        [0x00 .. 0x2c]  ERC-1167 minimal proxy, 45 bytes, delegating to `implementation`
///        [0x2d .. 0x4c]  salt          (bytes32)
///        [0x4d .. 0x6c]  chainId       (uint256)
///        [0x6d .. 0x8c]  tokenContract (uint256-padded address)
///        [0x8d .. 0xac]  tokenId       (uint256)
///
///      `AgentTBA.token()` reads 0x60 bytes at offset 0x4d, which is why the footer fields are
///      each padded to 32 bytes. Encoding `tokenContract` as a bare 20-byte `address` is the
///      classic way to get this wrong: it shifts `tokenId` and every account misreports its token.
///
///      This is a fresh registry instance rather than the canonical singleton at
///      0x000000006551c19487814612e58FE06813775758. CREATE2 mixes in the deployer, so accounts
///      created here have different addresses than the same (implementation, salt, token) tuple
///      created through the singleton — see ADR-0002 for why that is the intended trade-off and
///      what it would take to switch.
contract ERC6551Registry is IERC6551Registry {
    /// @inheritdoc IERC6551Registry
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        bytes memory creationCode = _creationCode(implementation, salt, chainId, tokenContract, tokenId);
        address predicted = Create2.computeAddress(salt, keccak256(creationCode), address(this));

        // Idempotent by ERC-6551: a second call is not an error.
        if (predicted.code.length != 0) return predicted;

        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        if (deployed == address(0)) revert AccountCreationFailed();

        emit ERC6551AccountCreated(deployed, implementation, salt, chainId, tokenContract, tokenId);
        return deployed;
    }

    /// @inheritdoc IERC6551Registry
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address)
    {
        return Create2.computeAddress(
            salt, keccak256(_creationCode(implementation, salt, chainId, tokenContract, tokenId)), address(this)
        );
    }

    /// @dev `3d60ad80600a3d3981f3` is the constructor: return the 0xad bytes that follow it.
    ///      `363d3d373d3d3d363d73 <impl> 5af43d82803e903d91602b57fd5bf3` is the ERC-1167 proxy.
    function _creationCode(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) private pure returns (bytes memory) {
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
}
