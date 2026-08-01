// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IAgentNFT} from "../interfaces/IAgentNFT.sol";
import {IAgentPermissions} from "../interfaces/IAgentPermissions.sol";
import {IERC6551Account} from "../interfaces/IERC6551Account.sol";
import {IERC6551Registry} from "../interfaces/IERC6551Registry.sol";
import {CanonicalMerkle} from "../libraries/CanonicalMerkle.sol";

/// @title AgentPermissions
/// @notice Canonical permission registry for GEBRID agents: EIP-712 grants, ERC-1271 authorities,
///         and delegation that can only ever narrow (invariant I-P3).
///
/// @dev Three things are worth reading before the code.
///
///      **Narrowing is proved, not declared.** A child grant is registered with its full leaf set
///      spelled out. Every one of those leaves must already be present in the parent's stored leaf
///      set, and every numeric bound must be <= the parent's *remaining* budget. That is an
///      explicit subset proof over the target set and a containment proof over the budgets. The
///      root remains in the signed payload as the canonical commitment, so the authority signs the
///      exact set, but enforcement never has to trust a root it cannot expand.
///
///      **Budgets are charged up the whole chain.** If a child spent only its own allowance, a
///      parent holding 10 ETH could mint two children of 10 ETH each and move 20. `consume` walks
///      to the root and charges every ancestor, so the chain can never spend more than its
///      shallowest ancestor allowed. Depth is capped, so the walk is bounded.
///
///      **Transfer of the NFT kills everything.** Grants pin `agentEpoch`. AgentNFT advances that
///      counter on mint, transfer, burn and explicit bump, so a sale of the agent invalidates
///      every outstanding grant in O(1) with no migration step and no loop to run out of gas.
contract AgentPermissions is IAgentPermissions, EIP712 {
    // --------------------------------------------------------------------------------------
    // Types
    // --------------------------------------------------------------------------------------

    /// @notice The signed authorisation payload.
    /// @dev Every field is a fixed 32-byte word under EIP-712 `encodeData`, which is what lets
    ///      `_hashPermissionSet` split the encoding in two without changing the result.
    struct PermissionSet {
        address account; // agent token bound account this grant applies to
        uint256 tokenId; // AgentNFT id backing `account`
        bytes32 accountSalt; // ERC-6551 salt, so `account` can be re-derived rather than trusted
        address delegate; // grantee
        bytes32 parent; // parent grant id; bytes32(0) for a root grant by the token holder
        uint64 notBefore;
        uint64 expiry;
        uint64 agentEpoch; // AgentNFT epoch this grant is pinned to
        uint256 maxValuePerCall;
        uint256 maxTotalValue;
        uint32 maxCalls;
        bool canSign; // may this delegate satisfy ERC-1271 for the account
        bytes32 targetsRoot; // CanonicalMerkle root over the authorised (target, selector) leaves
        uint256 nonce; // per-authority replay guard
    }

    struct Grant {
        // slot 0
        address account;
        uint64 notBefore;
        uint32 maxCalls;
        // slot 1
        address delegate;
        uint64 expiry;
        uint32 usedCalls;
        // slots 2-6
        bytes32 parent;
        uint256 maxValuePerCall;
        uint256 maxTotalValue;
        uint256 spentValue;
        uint256 tokenId;
        // slot 7
        uint64 agentEpoch;
        uint8 depth;
        bool canSign;
        bool revoked;
        bool exists;
    }

    /// @notice Which narrowing rule a child grant violated.
    enum NarrowField {
        NOT_BEFORE,
        EXPIRY,
        EPOCH,
        VALUE_PER_CALL,
        TOTAL_VALUE,
        CALLS,
        SIGNING,
        TARGET
    }

    // --------------------------------------------------------------------------------------
    // Constants and immutables
    // --------------------------------------------------------------------------------------

    bytes32 public constant PERMISSION_SET_TYPEHASH = keccak256(
        "PermissionSet(address account,uint256 tokenId,bytes32 accountSalt,address delegate,bytes32 parent,"
        "uint64 notBefore,uint64 expiry,uint64 agentEpoch,uint256 maxValuePerCall,uint256 maxTotalValue,"
        "uint32 maxCalls,bool canSign,bytes32 targetsRoot,uint256 nonce)"
    );

    /// @notice Maximum delegation chain length below a root grant.
    uint256 public constant MAX_DELEGATION_DEPTH = 4;

    /// @notice Maximum authorised (target, selector) pairs in one grant.
    uint256 public constant MAX_TARGETS = 32;

    /// @notice Ceiling on `expiry - notBefore`. Bounds the blast radius of a leaked delegate key.
    uint64 public constant MAX_GRANT_LIFETIME = 365 days;

    IAgentNFT public immutable AGENT_NFT;
    IERC6551Registry public immutable REGISTRY;

    /// @notice The address that deployed this contract; the only one that may close the
    ///         `accountImplementation` binding, and only once.
    /// @dev Deliberately not an `Ownable` owner. The sole privilege this contract has ever needed
    ///      is that one write-once setter, which the deployment consumes immediately. Keeping a
    ///      transferable owner afterwards would leave a live privileged role with nothing to do —
    ///      an access-control surface that can only ever be a liability.
    address public immutable DEPLOYER;

    // --------------------------------------------------------------------------------------
    // Storage
    // --------------------------------------------------------------------------------------

    /// @notice AgentTBA implementation used to re-derive account addresses. Write-once.
    address public accountImplementation;

    mapping(bytes32 grantId => Grant) private _grants;
    mapping(bytes32 grantId => mapping(bytes32 leaf => bool)) private _allowedLeaf;

    /// @notice Grant that `consume` and `canSignFor` resolve for a (account, delegate) pair.
    mapping(address account => mapping(address delegate => bytes32 grantId)) public activeGrant;

    /// @notice Per-authority replay guard over `PermissionSet.nonce`.
    mapping(address authority => mapping(uint256 nonce => bool)) public nonceUsed;

    // --------------------------------------------------------------------------------------
    // Events
    // --------------------------------------------------------------------------------------

    event GrantIssued(
        bytes32 indexed grantId,
        address indexed account,
        address indexed delegate,
        bytes32 parent,
        address authority,
        uint64 expiry,
        uint256 maxTotalValue,
        uint32 maxCalls,
        bool canSign
    );
    event GrantRevoked(bytes32 indexed grantId, address indexed revoker);
    event PermissionConsumed(
        address indexed account,
        address indexed delegate,
        bytes32 indexed grantId,
        address target,
        bytes4 selector,
        uint256 value
    );
    event AccountImplementationSet(address implementation);

    // --------------------------------------------------------------------------------------
    // Errors
    // --------------------------------------------------------------------------------------

    error ZeroAddress();
    error AccountIsDelegate();
    error InvalidWindow(uint64 notBefore, uint64 expiry);
    error LifetimeTooLong(uint64 lifetime, uint64 maxLifetime);
    error ZeroCallBudget();
    error TooManyTargets(uint256 count, uint256 max);
    error TargetsRootMismatch(bytes32 computed, bytes32 declared);
    error AccountBindingMismatch();
    error UnknownAgent(uint256 tokenId);
    error EpochMismatch(uint64 expected, uint64 actual);
    error UnknownParent(bytes32 parent);
    error ParentAccountMismatch();
    error ParentNotLive(bytes32 parent);
    error SelfRedelegation();
    error DelegationTooDeep(uint256 depth, uint256 max);
    error NarrowingViolated(NarrowField field);
    error GrantAlreadyExists(bytes32 grantId);
    error NonceAlreadyUsed(address authority, uint256 nonce);
    error NotAuthority(address caller, address authority);
    error InvalidAuthoritySignature(address authority);
    error ImplementationAlreadySet();
    error NotDeployer(address caller, address deployer);
    error NoActiveGrant(address account, address delegate);
    error AccountMismatch(address expected, address actual);
    error TargetNotPermitted(address target, bytes4 selector);
    error PerCallValueExceeded(uint256 value, uint256 maxValue);
    error TotalValueExceeded(bytes32 grantId, uint256 wouldSpend, uint256 maxTotalValue);
    error CallBudgetExceeded(bytes32 grantId, uint32 maxCalls);
    error GrantNotStarted(bytes32 grantId, uint64 notBefore);
    error GrantIsRevoked(bytes32 grantId);
    error GrantExpired(bytes32 grantId, uint64 expiry);
    error EpochInvalidated(bytes32 grantId, uint64 pinned, uint64 current);
    error UnknownGrant(bytes32 grantId);
    error NotAuthorizedToRevoke(bytes32 grantId, address caller);

    // --------------------------------------------------------------------------------------
    // Construction
    // --------------------------------------------------------------------------------------

    constructor(IAgentNFT agentNft, IERC6551Registry registry) EIP712("GEBRID.AgentPermissions", "1") {
        if (address(agentNft) == address(0) || address(registry) == address(0)) {
            revert ZeroAddress();
        }
        AGENT_NFT = agentNft;
        REGISTRY = registry;
        DEPLOYER = msg.sender;
    }

    /// @notice Binds the AgentTBA implementation used to re-derive account addresses.
    /// @dev Write-once, and callable only by the deployer. AgentTBA takes this contract as a
    ///      constructor immutable and this contract needs AgentTBA's address, so one side of the
    ///      cycle has to be closed after deployment. Closing it here — rather than making
    ///      AgentTBA's dependencies mutable — keeps the enforcement path immutable, which is the
    ///      side that matters. After this call the contract has no privileged role at all.
    function setAccountImplementation(address implementation) external {
        if (msg.sender != DEPLOYER) revert NotDeployer(msg.sender, DEPLOYER);
        if (implementation == address(0)) revert ZeroAddress();
        if (accountImplementation != address(0)) revert ImplementationAlreadySet();
        accountImplementation = implementation;
        emit AccountImplementationSet(implementation);
    }

    // --------------------------------------------------------------------------------------
    // Granting
    // --------------------------------------------------------------------------------------

    /// @notice Registers a permission grant signed by its authority.
    /// @param p The signed permission set.
    /// @param leaves The authorised (target, selector) leaves, strictly increasing. Their canonical
    ///        root must equal `p.targetsRoot`, which is what the authority actually signed.
    /// @param signature EIP-712 signature by the authority (ECDSA or ERC-1271). May be empty when
    ///        the authority is `msg.sender`.
    /// @return grantId The EIP-712 digest of `p`, which doubles as the grant identifier.
    function grant(PermissionSet calldata p, bytes32[] calldata leaves, bytes calldata signature)
        external
        returns (bytes32 grantId)
    {
        _validateShape(p, leaves);
        _validateAccountBinding(p);
        address authority = _resolveAuthority(p, leaves);

        grantId = _hashTypedDataV4(_hashPermissionSet(p));
        if (_grants[grantId].exists) revert GrantAlreadyExists(grantId);
        if (nonceUsed[authority][p.nonce]) revert NonceAlreadyUsed(authority, p.nonce);
        nonceUsed[authority][p.nonce] = true;

        if (signature.length == 0) {
            if (msg.sender != authority) revert NotAuthority(msg.sender, authority);
        } else if (!SignatureChecker.isValidSignatureNow(authority, grantId, signature)) {
            revert InvalidAuthoritySignature(authority);
        }

        _store(grantId, p, leaves, authority);
    }

    function _validateShape(PermissionSet calldata p, bytes32[] calldata leaves) private view {
        if (p.account == address(0) || p.delegate == address(0)) revert ZeroAddress();
        if (p.delegate == p.account) revert AccountIsDelegate();
        if (p.expiry <= p.notBefore || p.expiry <= block.timestamp) revert InvalidWindow(p.notBefore, p.expiry);

        uint64 lifetime = p.expiry - p.notBefore;
        if (lifetime > MAX_GRANT_LIFETIME) revert LifetimeTooLong(lifetime, MAX_GRANT_LIFETIME);
        if (p.maxCalls == 0) revert ZeroCallBudget();
        if (leaves.length > MAX_TARGETS) revert TooManyTargets(leaves.length, MAX_TARGETS);

        // Reverts on an empty or non-strictly-increasing set, so the target set is canonical.
        bytes32 computed = CanonicalMerkle.root(leaves);
        if (computed != p.targetsRoot) revert TargetsRootMismatch(computed, p.targetsRoot);
    }

    /// @dev Proves that `p.account` really is the ERC-6551 account of AgentNFT #`p.tokenId`,
    ///      rather than an arbitrary contract that merely claims to be.
    function _validateAccountBinding(PermissionSet calldata p) private view {
        uint64 currentEpoch = AGENT_NFT.agentEpoch(p.tokenId);
        if (currentEpoch == 0) revert UnknownAgent(p.tokenId);
        if (currentEpoch != p.agentEpoch) revert EpochMismatch(p.agentEpoch, currentEpoch);

        address implementation = accountImplementation;
        if (implementation != address(0)) {
            // Counterfactual-safe: works whether or not the account has been deployed yet.
            address derived =
                REGISTRY.account(implementation, p.accountSalt, block.chainid, address(AGENT_NFT), p.tokenId);
            if (derived != p.account) revert AccountBindingMismatch();
        } else {
            (uint256 chainId, address tokenContract, uint256 tokenId) = IERC6551Account(payable(p.account)).token();
            if (chainId != block.chainid || tokenContract != address(AGENT_NFT) || tokenId != p.tokenId) {
                revert AccountBindingMismatch();
            }
        }
    }

    /// @dev Root grants are authorised by the token holder. Child grants are authorised by the
    ///      parent's delegate and must narrow on every axis.
    function _resolveAuthority(PermissionSet calldata p, bytes32[] calldata leaves)
        private
        view
        returns (address authority)
    {
        if (p.parent == bytes32(0)) {
            // Reverts for a burned token, which is the intended outcome.
            return AGENT_NFT.ownerOf(p.tokenId);
        }

        Grant storage parent = _grants[p.parent];
        if (!parent.exists) revert UnknownParent(p.parent);
        if (parent.account != p.account) revert ParentAccountMismatch();
        if (parent.revoked || block.timestamp >= parent.expiry) revert ParentNotLive(p.parent);
        if (p.delegate == parent.delegate) revert SelfRedelegation();

        uint256 depth = uint256(parent.depth) + 1;
        if (depth > MAX_DELEGATION_DEPTH) revert DelegationTooDeep(depth, MAX_DELEGATION_DEPTH);

        if (p.notBefore < parent.notBefore) revert NarrowingViolated(NarrowField.NOT_BEFORE);
        if (p.expiry > parent.expiry) revert NarrowingViolated(NarrowField.EXPIRY);
        if (p.agentEpoch != parent.agentEpoch) revert NarrowingViolated(NarrowField.EPOCH);
        if (p.maxValuePerCall > parent.maxValuePerCall) revert NarrowingViolated(NarrowField.VALUE_PER_CALL);
        if (p.maxTotalValue > parent.maxTotalValue - parent.spentValue) {
            revert NarrowingViolated(NarrowField.TOTAL_VALUE);
        }
        if (p.maxCalls > parent.maxCalls - parent.usedCalls) revert NarrowingViolated(NarrowField.CALLS);
        if (p.canSign && !parent.canSign) revert NarrowingViolated(NarrowField.SIGNING);

        // Explicit subset proof over the target set.
        uint256 length = leaves.length;
        for (uint256 i = 0; i < length; ++i) {
            if (!_allowedLeaf[p.parent][leaves[i]]) revert NarrowingViolated(NarrowField.TARGET);
        }

        return parent.delegate;
    }

    function _store(bytes32 grantId, PermissionSet calldata p, bytes32[] calldata leaves, address authority) private {
        uint8 depth = p.parent == bytes32(0) ? 0 : _grants[p.parent].depth + 1;

        Grant storage g = _grants[grantId];
        g.account = p.account;
        g.notBefore = p.notBefore;
        g.maxCalls = p.maxCalls;
        g.delegate = p.delegate;
        g.expiry = p.expiry;
        g.parent = p.parent;
        g.maxValuePerCall = p.maxValuePerCall;
        g.maxTotalValue = p.maxTotalValue;
        g.tokenId = p.tokenId;
        g.agentEpoch = p.agentEpoch;
        g.depth = depth;
        g.canSign = p.canSign;
        g.exists = true;

        uint256 length = leaves.length;
        for (uint256 i = 0; i < length; ++i) {
            _allowedLeaf[grantId][leaves[i]] = true;
        }

        // One live grant per (account, delegate). Re-issuing supersedes rather than accumulates,
        // so a delegate can never hold two budgets at once.
        bytes32 previous = activeGrant[p.account][p.delegate];
        if (previous != bytes32(0) && !_grants[previous].revoked) {
            _grants[previous].revoked = true;
            emit GrantRevoked(previous, msg.sender);
        }
        activeGrant[p.account][p.delegate] = grantId;

        _emitGrantIssued(grantId, p, authority);
    }

    /// @dev Split out of `_store` purely so the nine event arguments are assembled in a frame with
    ///      a shallow stack; `via_ir` is off by design (ADR-0001).
    function _emitGrantIssued(bytes32 grantId, PermissionSet calldata p, address authority) private {
        emit GrantIssued(
            grantId, p.account, p.delegate, p.parent, authority, p.expiry, p.maxTotalValue, p.maxCalls, p.canSign
        );
    }

    // --------------------------------------------------------------------------------------
    // Enforcement
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IAgentPermissions
    function consume(address delegate, address target, bytes4 selector, uint256 value)
        external
        returns (bytes32 grantId)
    {
        address account = msg.sender;
        grantId = activeGrant[account][delegate];
        if (grantId == bytes32(0)) revert NoActiveGrant(account, delegate);

        Grant storage g = _grants[grantId];
        if (g.account != account) revert AccountMismatch(g.account, account);
        if (!_allowedLeaf[grantId][CanonicalMerkle.leaf(target, selector)]) {
            revert TargetNotPermitted(target, selector);
        }
        if (value > g.maxValuePerCall) revert PerCallValueExceeded(value, g.maxValuePerCall);
        if (block.timestamp < g.notBefore) revert GrantNotStarted(grantId, g.notBefore);

        uint64 currentEpoch = AGENT_NFT.agentEpoch(g.tokenId);
        if (currentEpoch != g.agentEpoch) revert EpochInvalidated(grantId, g.agentEpoch, currentEpoch);

        _chargeChain(grantId, value);

        emit PermissionConsumed(account, delegate, grantId, target, selector, value);
    }

    /// @dev Charges the grant and every ancestor. Without this, sibling children of one parent
    ///      would each carry a full copy of the parent's budget and delegation would widen rights.
    function _chargeChain(bytes32 grantId, uint256 value) private {
        bytes32 cursor = grantId;
        // Root grant plus at most MAX_DELEGATION_DEPTH descendants.
        uint256 remaining = MAX_DELEGATION_DEPTH + 1;

        while (cursor != bytes32(0)) {
            if (remaining == 0) revert DelegationTooDeep(MAX_DELEGATION_DEPTH + 1, MAX_DELEGATION_DEPTH);
            unchecked {
                --remaining;
            }

            Grant storage node = _grants[cursor];
            if (node.revoked) revert GrantIsRevoked(cursor);
            if (block.timestamp >= node.expiry) revert GrantExpired(cursor, node.expiry);

            uint256 wouldSpend = node.spentValue + value;
            if (wouldSpend > node.maxTotalValue) revert TotalValueExceeded(cursor, wouldSpend, node.maxTotalValue);
            if (node.usedCalls >= node.maxCalls) revert CallBudgetExceeded(cursor, node.maxCalls);

            node.spentValue = wouldSpend;
            unchecked {
                node.usedCalls = node.usedCalls + 1;
            }

            cursor = node.parent;
        }
    }

    /// @inheritdoc IAgentPermissions
    function canSignFor(address account, address signer) external view returns (bool) {
        bytes32 grantId = activeGrant[account][signer];
        if (grantId == bytes32(0)) return false;
        if (!_grants[grantId].canSign) return false;
        return isLive(grantId);
    }

    // --------------------------------------------------------------------------------------
    // Revocation
    // --------------------------------------------------------------------------------------

    /// @notice Revokes a grant. Descendants die with it, because `consume` walks the chain.
    /// @dev Callable by the token holder, the grant's own delegate, or the parent's delegate.
    function revoke(bytes32 grantId) external {
        Grant storage g = _grants[grantId];
        if (!g.exists) revert UnknownGrant(grantId);

        bool authorised = msg.sender == g.delegate || msg.sender == _tokenHolder(g.tokenId);
        if (!authorised && g.parent != bytes32(0)) {
            authorised = msg.sender == _grants[g.parent].delegate;
        }
        if (!authorised) revert NotAuthorizedToRevoke(grantId, msg.sender);

        if (!g.revoked) {
            g.revoked = true;
            emit GrantRevoked(grantId, msg.sender);
        }
        if (activeGrant[g.account][g.delegate] == grantId) {
            delete activeGrant[g.account][g.delegate];
        }
    }

    /// @dev A burned token has no holder; `ownerOf` reverting must not brick revocation.
    function _tokenHolder(uint256 tokenId) private view returns (address) {
        try AGENT_NFT.ownerOf(tokenId) returns (address holder) {
            return holder;
        } catch {
            return address(0);
        }
    }

    // --------------------------------------------------------------------------------------
    // Views
    // --------------------------------------------------------------------------------------

    /// @notice True when the grant and its whole ancestor chain are unrevoked, in window and
    ///         pinned to the agent's current epoch.
    function isLive(bytes32 grantId) public view returns (bool) {
        Grant storage g = _grants[grantId];
        if (!g.exists || g.revoked) return false;
        if (block.timestamp < g.notBefore || block.timestamp >= g.expiry) return false;
        if (AGENT_NFT.agentEpoch(g.tokenId) != g.agentEpoch) return false;

        bytes32 cursor = g.parent;
        uint256 remaining = MAX_DELEGATION_DEPTH;
        while (cursor != bytes32(0)) {
            if (remaining == 0) return false;
            unchecked {
                --remaining;
            }
            Grant storage node = _grants[cursor];
            if (!node.exists || node.revoked || block.timestamp >= node.expiry) return false;
            cursor = node.parent;
        }
        return true;
    }

    function getGrant(bytes32 grantId) external view returns (Grant memory) {
        return _grants[grantId];
    }

    function isTargetAllowed(bytes32 grantId, address target, bytes4 selector) external view returns (bool) {
        return _allowedLeaf[grantId][CanonicalMerkle.leaf(target, selector)];
    }

    /// @notice Canonical leaf for a (target, selector) pair. Off-chain builders must use this.
    function leafOf(address target, bytes4 selector) external pure returns (bytes32) {
        return CanonicalMerkle.leaf(target, selector);
    }

    /// @notice The EIP-712 digest of `p`, which is both what the authority signs and the grant id.
    function grantIdOf(PermissionSet calldata p) external view returns (bytes32) {
        return _hashTypedDataV4(_hashPermissionSet(p));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Split in two halves purely to keep the stack shallow without `via_ir`. Every field is a
    ///      static 32-byte word, so the concatenation is identical to a single `abi.encode`.
    function _hashPermissionSet(PermissionSet calldata p) private pure returns (bytes32) {
        bytes memory head = abi.encode(
            PERMISSION_SET_TYPEHASH, p.account, p.tokenId, p.accountSalt, p.delegate, p.parent, p.notBefore, p.expiry
        );
        bytes memory tail =
            abi.encode(p.agentEpoch, p.maxValuePerCall, p.maxTotalValue, p.maxCalls, p.canSign, p.targetsRoot, p.nonce);
        return keccak256(bytes.concat(head, tail));
    }
}
