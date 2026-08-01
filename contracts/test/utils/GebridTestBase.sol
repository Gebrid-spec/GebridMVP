// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {AgentNFT} from "../../src/core/AgentNFT.sol";
import {AgentPermissions} from "../../src/core/AgentPermissions.sol";
import {AgentTBA} from "../../src/core/AgentTBA.sol";
import {ERC6551Registry} from "../../src/core/ERC6551Registry.sol";
import {RiskEngine} from "../../src/core/RiskEngine.sol";
import {IAgentNFT} from "../../src/interfaces/IAgentNFT.sol";
import {IAgentPermissions} from "../../src/interfaces/IAgentPermissions.sol";
import {IERC6551Registry} from "../../src/interfaces/IERC6551Registry.sol";
import {IRiskEngine} from "../../src/interfaces/IRiskEngine.sol";

/// @notice Deploys the full enforcement core the way the deploy script does, and provides the
///         grant-building helpers the adversarial tests need.
abstract contract GebridTestBase is Test {
    AgentNFT internal nft;
    ERC6551Registry internal registry;
    RiskEngine internal risk;
    AgentPermissions internal perms;
    AgentTBA internal accountImpl;

    address internal admin = makeAddr("admin");
    address internal holder;
    uint256 internal holderKey;
    address internal delegate;
    uint256 internal delegateKey;
    address internal attacker;
    uint256 internal attackerKey;

    /// @dev Delay on a DEFAULT_ADMIN_ROLE handover; matches the deploy script default.
    uint48 internal constant ADMIN_TRANSFER_DELAY = 3 days;

    uint256 private _nonceCounter;

    function setUp() public virtual {
        // Realistic clock: several validity windows depend on `block.timestamp` not being 0 or 1.
        vm.warp(1_800_000_000);

        (holder, holderKey) = makeAddrAndKey("holder");
        (delegate, delegateKey) = makeAddrAndKey("delegate");
        (attacker, attackerKey) = makeAddrAndKey("attacker");

        nft = new AgentNFT("GEBRID Agent", "AGENT", admin, ADMIN_TRANSFER_DELAY);
        registry = new ERC6551Registry();
        risk = new RiskEngine(admin, ADMIN_TRANSFER_DELAY);
        perms = new AgentPermissions(IAgentNFT(address(nft)), IERC6551Registry(address(registry)));
        accountImpl = new AgentTBA(IAgentPermissions(address(perms)), IRiskEngine(address(risk)));

        // The test contract is the deployer, so it is the one that may close the binding.
        perms.setAccountImplementation(address(accountImpl));
    }

    // --------------------------------------------------------------------------------------
    // Agent helpers
    // --------------------------------------------------------------------------------------

    function _mintAgent(address to) internal returns (uint256 tokenId, address payable account) {
        vm.prank(admin);
        tokenId = nft.mint(to);
        account =
            payable(registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId));
    }

    // --------------------------------------------------------------------------------------
    // Permission helpers
    // --------------------------------------------------------------------------------------

    function _basePermissionSet(address account, uint256 tokenId, address to)
        internal
        returns (AgentPermissions.PermissionSet memory p)
    {
        p.account = account;
        p.tokenId = tokenId;
        p.accountSalt = bytes32(0);
        p.delegate = to;
        p.parent = bytes32(0);
        p.notBefore = uint64(block.timestamp);
        p.expiry = uint64(block.timestamp + 1 days);
        p.agentEpoch = nft.agentEpoch(tokenId);
        p.maxValuePerCall = 1 ether;
        p.maxTotalValue = 5 ether;
        p.maxCalls = 10;
        p.canSign = true;
        p.nonce = ++_nonceCounter;
    }

    /// @notice Canonical leaf array for a single (target, selector) pair.
    function _leaves(address target, bytes4 selector) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](1);
        leaves[0] = perms.leafOf(target, selector);
    }

    /// @notice Canonical leaf array for two pairs, sorted as the contract requires.
    function _leaves(address target0, bytes4 selector0, address target1, bytes4 selector1)
        internal
        view
        returns (bytes32[] memory leaves)
    {
        bytes32 a = perms.leafOf(target0, selector0);
        bytes32 b = perms.leafOf(target1, selector1);
        leaves = new bytes32[](2);
        (leaves[0], leaves[1]) = a < b ? (a, b) : (b, a);
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice Signs and registers a grant, returning its id.
    function _issueGrant(AgentPermissions.PermissionSet memory p, bytes32[] memory leaves, uint256 authorityKey)
        internal
        returns (bytes32 grantId)
    {
        p.targetsRoot = _root(leaves);
        bytes32 digest = perms.grantIdOf(p);
        return perms.grant(p, leaves, _sign(authorityKey, digest));
    }

    /// @dev Mirrors CanonicalMerkle.root off-chain, so tests build roots independently of the
    ///      library they are checking rather than asking it for the answer.
    function _root(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        bytes32[] memory level = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) {
            level[i] = leaves[i];
        }
        while (n > 1) {
            uint256 width = 0;
            for (uint256 i = 0; i < n; i += 2) {
                level[width++] = (i + 1 < n)
                    ? (level[i] < level[i + 1]
                            ? keccak256(abi.encodePacked(bytes1(0x01), level[i], level[i + 1]))
                            : keccak256(abi.encodePacked(bytes1(0x01), level[i + 1], level[i])))
                    : level[i];
            }
            n = width;
        }
        return level[0];
    }

    // --------------------------------------------------------------------------------------
    // Risk helpers
    // --------------------------------------------------------------------------------------

    /// @notice Packs eight severities into the word RiskEngine expects.
    function _severities(uint8[8] memory values) internal pure returns (uint64 packed) {
        for (uint256 i = 0; i < 8; ++i) {
            // Widening uint8 -> uint64 before the shift; no truncation is possible.
            // forge-lint: disable-next-line(unsafe-typecast)
            packed |= uint64(values[i]) << uint64(i * 8);
        }
    }

    /// @notice Severity vector that scores over the block threshold under the default weights.
    function _blockingSeverities() internal pure returns (uint64) {
        return _severities([uint8(100), 100, 0, 0, 100, 100, 100, 100]);
    }

    /// @notice Severity vector that scores under the warn threshold.
    function _clearSeverities() internal pure returns (uint64) {
        return _severities([uint8(0), 0, 0, 0, 0, 0, 0, 0]);
    }

    /// @notice Severity vector between the warn and block thresholds.
    function _warnSeverities() internal pure returns (uint64) {
        return _severities([uint8(100), 100, 0, 0, 100, 0, 0, 0]);
    }
}
