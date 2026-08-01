// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {IERC6551Registry} from "../interfaces/IERC6551Registry.sol";
import {ERC6551Bytecode} from "../libraries/ERC6551Bytecode.sol";

/// @title ERC6551Registry
/// @notice ERC-6551 account registry. Deploys accounts whose runtime bytecode is byte-identical
///         to the layout fixed by the ERC, so any 6551-aware tooling can read them.
///
/// @dev **This is not the registry GEBRID deploys to a public network.** ADR-0002 selects the
///      canonical singleton at 0x000000006551c19487814612e58FE06813775758, because CREATE2 mixes
///      in the deployer and agents created through a private registry would be invisible to every
///      6551-aware wallet, indexer and explorer — which undercuts the whole ecosystem argument of
///      phases 1-3.
///
///      This contract stays in the tree for two jobs:
///        1. local and CI testing, where no singleton exists (anvil, `forge test`);
///        2. a fallback for any future chain where the singleton is genuinely absent, selected
///           explicitly via `GEBRID_DEPLOY_OWN_REGISTRY=true`.
///
///      The byte layout lives in `ERC6551Bytecode` so that `DeployCore` can use the same
///      derivation to verify a registry it did not deploy.
contract ERC6551Registry is IERC6551Registry {
    /// @inheritdoc IERC6551Registry
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        bytes memory creationCode = ERC6551Bytecode.creationCode(implementation, salt, chainId, tokenContract, tokenId);
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
        return ERC6551Bytecode.computeAccount(address(this), implementation, salt, chainId, tokenContract, tokenId);
    }
}
