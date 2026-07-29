// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IAgentPermissions} from "../interfaces/IAgentPermissions.sol";
import {IERC6551Account, IERC6551Executable} from "../interfaces/IERC6551Account.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @title AgentTBA
/// @notice ERC-6551 token bound account for a GEBRID agent, with permission and risk enforcement
///         on the execution path.
///
/// @dev **Deployment shape.** This contract is the shared implementation behind ERC-1167 proxies
///      created by `ERC6551Registry`. `PERMISSIONS` and `RISK_ENGINE` are immutables, so they live
///      in the implementation's runtime code and are read correctly through `delegatecall`, while
///      being impossible to rewrite per account. There is no initializer, so there is no
///      initialisation front-running surface and no uninitialised-account state to reason about.
///      Rewiring the enforcement stack means deploying a new implementation, which changes every
///      account address — the dependency is as immutable as the account identity itself.
///
///      **BLOCK applies to the token holder too.** The risk check is not skipped for the root
///      authority. A control plane whose owner can wave a block through is not a control plane.
///      Liveness is preserved by BLOCK attestations being time-bounded rather than by an override.
///
///      **Re-entrancy.** There is no guard, on purpose: agent flows legitimately nest. Safety comes
///      from ordering instead. Permission budgets are charged and `_state` is advanced before the
///      outbound call, so a re-entering callee is metered exactly like any other caller, and it
///      re-enters as itself — an address with no grant — rather than as the owner.
contract AgentTBA is IERC165, IERC1271, IERC6551Account, IERC6551Executable, IERC721Receiver, IERC1155Receiver {
    /// @dev ERC-6551: the only operation this account supports.
    uint8 private constant OP_CALL = 0;

    /// @dev ERC-6551 `isValidSigner` success value.
    bytes4 private constant ERC6551_SIGNER_MAGIC = 0x523e3260;

    /// @dev ERC-1271 success and failure values.
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    /// @dev Offset of the ERC-6551 footer's `chainId` word: 45-byte proxy + 32-byte salt.
    uint256 private constant FOOTER_OFFSET = 0x4d;
    uint256 private constant FOOTER_LENGTH = 0x60;

    IAgentPermissions public immutable PERMISSIONS;
    IRiskEngine public immutable RISK_ENGINE;

    /// @notice ERC-6551 account state, bumped on every successful execution. Storage slot 0.
    uint256 private _state;

    event Executed(address indexed caller, address indexed target, uint256 value, bytes4 selector, uint256 newState);

    error UnsupportedOperation(uint8 operation);
    error CrossChainExecutionDisabled(uint256 accountChainId, uint256 currentChainId);
    error Unauthorized(address caller);
    error ZeroAddress();

    constructor(IAgentPermissions permissions, IRiskEngine riskEngine) {
        if (address(permissions) == address(0) || address(riskEngine) == address(0)) revert ZeroAddress();
        PERMISSIONS = permissions;
        RISK_ENGINE = riskEngine;
    }

    receive() external payable {}

    // --------------------------------------------------------------------------------------
    // ERC-6551 identity
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IERC6551Account
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(FOOTER_LENGTH);
        assembly ("memory-safe") {
            extcodecopy(address(), add(footer, 0x20), FOOTER_OFFSET, FOOTER_LENGTH)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @inheritdoc IERC6551Account
    function state() external view returns (uint256) {
        return _state;
    }

    /// @notice Root authority over this account: the current holder of the bound token.
    /// @dev Returns `address(0)` — rather than reverting — when the token is burned or the account
    ///      is being read on the wrong chain, so signature checks can answer "not valid" instead of
    ///      reverting at callers that are not prepared for it.
    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        try IERC721(tokenContract).ownerOf(tokenId) returns (address holder) {
            return holder;
        } catch {
            return address(0);
        }
    }

    /// @inheritdoc IERC6551Account
    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        return _isAuthorizedSigner(signer) ? ERC6551_SIGNER_MAGIC : bytes4(0);
    }

    function _isAuthorizedSigner(address signer) private view returns (bool) {
        if (signer == address(0)) return false;
        if (signer == owner()) return true;
        return PERMISSIONS.canSignFor(address(this), signer);
    }

    // --------------------------------------------------------------------------------------
    // Execution
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IERC6551Executable
    /// @dev Order of checks is deliberate: authority first (cheapest rejection, and it must not be
    ///      possible to probe risk state through an unauthorised call), then risk, then effects,
    ///      then the outbound call.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (operation != OP_CALL) revert UnsupportedOperation(operation);

        (uint256 chainId,,) = token();
        if (chainId != block.chainid) revert CrossChainExecutionDisabled(chainId, block.chainid);

        bytes4 selector = data.length >= 4 ? bytes4(data[0:4]) : bytes4(0);

        address root = owner();
        if (msg.sender != root) {
            // `root == address(0)` means burned token: nobody is authorised, delegates included.
            if (root == address(0)) revert Unauthorized(msg.sender);
            PERMISSIONS.consume(msg.sender, to, selector, value);
        }

        // Applies to the root authority as well. No bypass.
        RISK_ENGINE.enforceIntent(address(this), to, value, selector, keccak256(data));

        uint256 newState;
        unchecked {
            newState = _state + 1;
        }
        _state = newState;
        emit Executed(msg.sender, to, value, selector, newState);

        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    // --------------------------------------------------------------------------------------
    // ERC-1271
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IERC1271
    /// @dev The owner branch goes through `SignatureChecker`, so a smart-contract owner (Safe,
    ///      4337 account) works as well as an EOA. The delegate branch uses `tryRecover`, which
    ///      returns rather than reverts on a malformed or malleable signature.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        address root = owner();
        if (root != address(0) && SignatureChecker.isValidSignatureNow(root, hash, signature)) {
            return ERC1271_MAGIC;
        }

        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err != ECDSA.RecoverError.NoError || recovered == address(0)) return ERC1271_INVALID;
        if (PERMISSIONS.canSignFor(address(this), recovered)) return ERC1271_MAGIC;

        return ERC1271_INVALID;
    }

    // --------------------------------------------------------------------------------------
    // Receivers and introspection
    // --------------------------------------------------------------------------------------

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
