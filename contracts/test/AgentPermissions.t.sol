// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {AgentPermissions} from "../src/core/AgentPermissions.sol";
import {CanonicalMerkle} from "../src/libraries/CanonicalMerkle.sol";
import {GebridTestBase} from "./utils/GebridTestBase.sol";
import {CallTarget, ContractSigner, FakeAccount} from "./utils/Mocks.sol";

/// @dev Harness note: `perms.*()` reads are hoisted before any `prank` / `expectRevert`.
contract AgentPermissionsTest is GebridTestBase {
    CallTarget internal callTarget;
    uint256 internal tokenId;
    address payable internal account;

    bytes4 internal constant PING = CallTarget.ping.selector;
    bytes4 internal constant PONG = CallTarget.pong.selector;

    address internal subDelegate;
    uint256 internal subDelegateKey;

    function setUp() public virtual override {
        super.setUp();
        callTarget = new CallTarget();
        (tokenId, account) = _mintAgent(holder);
        (subDelegate, subDelegateKey) = makeAddrAndKey("subDelegate");
    }

    function _rootGrant() internal returns (bytes32 grantId, bytes32[] memory leaves) {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        leaves = _leaves(address(callTarget), PING, address(callTarget), PONG);
        grantId = _issueGrant(p, leaves, holderKey);
    }

    // --------------------------------------------------------------------------------------
    // Happy path
    // --------------------------------------------------------------------------------------

    function test_TokenHolderCanIssueRootGrant() public {
        (bytes32 grantId,) = _rootGrant();

        AgentPermissions.Grant memory g = perms.getGrant(grantId);
        assertEq(g.account, account);
        assertEq(g.delegate, delegate);
        assertEq(g.parent, bytes32(0));
        assertEq(g.depth, 0);
        assertTrue(g.exists);
        assertTrue(perms.isLive(grantId));
        assertEq(perms.activeGrant(account, delegate), grantId);
        assertTrue(perms.isTargetAllowed(grantId, address(callTarget), PING));
        assertFalse(perms.isTargetAllowed(grantId, address(callTarget), bytes4(0xdeadbeef)));
    }

    function test_AuthorityMaySelfSubmitWithoutSignature() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);

        vm.prank(holder);
        bytes32 grantId = perms.grant(p, leaves, "");
        assertTrue(perms.isLive(grantId));
    }

    /// @dev The authority may itself be a contract: ERC-1271 is accepted wherever ECDSA is.
    function test_ERC1271ContractAuthorityIsAccepted() public {
        ContractSigner signer = new ContractSigner();
        vm.prank(admin);
        uint256 contractTokenId = nft.mint(address(signer));
        address contractAccount =
            registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), contractTokenId);

        AgentPermissions.PermissionSet memory p = _basePermissionSet(contractAccount, contractTokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);

        bytes32 digest = perms.grantIdOf(p);
        signer.approve(digest);

        bytes32 grantId = perms.grant(p, leaves, hex"1234");
        assertTrue(perms.isLive(grantId));
    }

    // --------------------------------------------------------------------------------------
    // Adversarial: replay
    // --------------------------------------------------------------------------------------

    function test_Adversarial_ReplayOfTheSameSignedGrantIsRejected() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes32 digest = perms.grantIdOf(p);
        bytes memory signature = _sign(holderKey, digest);

        bytes32 grantId = perms.grant(p, leaves, signature);

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.GrantAlreadyExists.selector, grantId));
        perms.grant(p, leaves, signature);
    }

    /// @dev A second, materially different grant that reuses the nonce must also fail, so the
    ///      guard does not depend on the digest happening to collide.
    function test_Adversarial_NonceCannotBeReusedByADifferentGrant() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        _issueGrant(p, leaves, holderKey);

        AgentPermissions.PermissionSet memory q = _basePermissionSet(account, tokenId, subDelegate);
        q.nonce = p.nonce; // reuse
        q.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(q));

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NonceAlreadyUsed.selector, holder, q.nonce));
        perms.grant(q, leaves, signature);
    }

    /// @dev Cross-chain replay is stopped twice over, and this test pins both layers.
    ///      1. Chain id is part of the ERC-6551 tuple, so the account address re-derives
    ///         differently on another chain and the binding check fires first.
    ///      2. Chain id is also in the EIP-712 domain, so the digest — and therefore the grant id
    ///         and the signature over it — differ regardless.
    function test_Adversarial_SignatureDoesNotReplayAcrossChains() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);

        bytes32 digestHere = perms.grantIdOf(p);
        bytes32 domainHere = perms.domainSeparator();
        bytes memory signature = _sign(holderKey, digestHere);

        vm.chainId(block.chainid + 1);

        // Layer 2: the domain and the digest both moved.
        assertTrue(perms.domainSeparator() != domainHere, "EIP-712 domain must bind chain id");
        assertTrue(perms.grantIdOf(p) != digestHere, "digest must bind chain id");

        // Layer 1 is what actually rejects the call, being the earlier gate.
        vm.expectRevert(AgentPermissions.AccountBindingMismatch.selector);
        perms.grant(p, leaves, signature);
    }

    /// @dev Isolates layer 2 from layer 1: with the account-derivation gate not yet armed, the
    ///      signature alone must still fail to replay onto another chain.
    function test_Adversarial_SignatureAloneIsChainBound() public {
        AgentPermissions fresh = new AgentPermissions(nft, registry); // implementation unset
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, fresh.grantIdOf(p));

        vm.chainId(block.chainid + 1);

        // `token()` reports the chain the account was created for, so the fallback binding check
        // rejects it too; both gates are chain-aware by construction.
        vm.expectRevert(AgentPermissions.AccountBindingMismatch.selector);
        fresh.grant(p, leaves, signature);
    }

    /// @dev Cross-contract replay: a second deployment of the same code must not honour the
    ///      signature, because `verifyingContract` is part of the domain.
    function test_Adversarial_SignatureDoesNotReplayAcrossDeployments() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        AgentPermissions other = new AgentPermissions(nft, registry);
        other.setAccountImplementation(address(accountImpl));

        assertTrue(other.domainSeparator() != perms.domainSeparator(), "domains must differ");

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.InvalidAuthoritySignature.selector, holder));
        other.grant(p, leaves, signature);
    }

    // --------------------------------------------------------------------------------------
    // Adversarial: signer substitution
    // --------------------------------------------------------------------------------------

    function test_Adversarial_SignatureFromNonHolderIsRejected() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, attacker);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(attackerKey, perms.grantIdOf(p));

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.InvalidAuthoritySignature.selector, holder));
        perms.grant(p, leaves, signature);
    }

    /// @dev A signature valid for grant A must not authorise grant B. Mutating any signed field
    ///      changes the digest, so the recovered signer no longer matches the authority.
    function test_Adversarial_SignatureIsBoundToEverySignedField() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        // Same signature, inflated budget.
        p.maxTotalValue = 1_000 ether;

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.InvalidAuthoritySignature.selector, holder));
        perms.grant(p, leaves, signature);
    }

    /// @dev Signature malleability: flipping `s` to n-s and `v` to its counterpart yields a second
    ///      valid ECDSA signature over the same digest. It must not be accepted.
    function test_Adversarial_MalleableSignatureIsRejected() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes32 digest = perms.grantIdOf(p);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, digest);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flippedS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory malleable = abi.encodePacked(r, flippedS, flippedV);

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.InvalidAuthoritySignature.selector, holder));
        perms.grant(p, leaves, malleable);
    }

    /// @dev A contract that merely claims to be the agent's account is rejected, because the
    ///      account address is re-derived from the registry rather than trusted from `token()`.
    function test_Adversarial_FakeAccountIsRejected() public {
        FakeAccount fake = new FakeAccount(block.chainid, address(nft), tokenId);

        AgentPermissions.PermissionSet memory p = _basePermissionSet(address(fake), tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(AgentPermissions.AccountBindingMismatch.selector);
        perms.grant(p, leaves, signature);
    }

    // --------------------------------------------------------------------------------------
    // Adversarial: privilege expansion
    // --------------------------------------------------------------------------------------

    function _issueChild(AgentPermissions.PermissionSet memory child, bytes32[] memory leaves)
        internal
        returns (bytes32)
    {
        return _issueGrant(child, leaves, delegateKey);
    }

    function _childOf(bytes32 parentId, bytes32[] memory) internal returns (AgentPermissions.PermissionSet memory c) {
        c = _basePermissionSet(account, tokenId, subDelegate);
        c.parent = parentId;
        c.maxValuePerCall = 0.5 ether;
        c.maxTotalValue = 1 ether;
        c.maxCalls = 3;
        c.canSign = false;
        c.expiry = uint64(block.timestamp + 12 hours);
    }

    function test_NarrowedChildGrantIsAccepted() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();

        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        bytes32[] memory childLeaves = _leaves(address(callTarget), PING); // strict subset
        bytes32 childId = _issueChild(c, childLeaves);

        AgentPermissions.Grant memory g = perms.getGrant(childId);
        assertEq(g.depth, 1);
        assertEq(g.parent, parentId);
        assertTrue(perms.isLive(childId));
    }

    function test_Adversarial_ChildCannotWidenValuePerCall() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();

        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        c.maxValuePerCall = 2 ether; // parent allows 1 ether
        bytes32[] memory childLeaves = _leaves(address(callTarget), PING);
        c.targetsRoot = _root(childLeaves);
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c));

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPermissions.NarrowingViolated.selector, AgentPermissions.NarrowField.VALUE_PER_CALL
            )
        );
        perms.grant(c, childLeaves, signature);
    }

    function test_Adversarial_ChildCannotOutliveParent() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();

        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        c.expiry = uint64(block.timestamp + 2 days); // parent expires in 1 day
        bytes32[] memory childLeaves = _leaves(address(callTarget), PING);
        c.targetsRoot = _root(childLeaves);
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c));

        vm.expectRevert(
            abi.encodeWithSelector(AgentPermissions.NarrowingViolated.selector, AgentPermissions.NarrowField.EXPIRY)
        );
        perms.grant(c, childLeaves, signature);
    }

    /// @dev The target-set subset proof. A child naming a target the parent never held is rejected
    ///      even though the child's own root is internally consistent.
    function test_Adversarial_ChildCannotAddATargetTheParentNeverHeld() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();
        CallTarget otherTarget = new CallTarget();

        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        bytes32[] memory childLeaves = _leaves(address(otherTarget), PING);
        c.targetsRoot = _root(childLeaves);
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c));

        vm.expectRevert(
            abi.encodeWithSelector(AgentPermissions.NarrowingViolated.selector, AgentPermissions.NarrowField.TARGET)
        );
        perms.grant(c, childLeaves, signature);
    }

    function test_Adversarial_NonSigningParentCannotMintASigningChild() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.canSign = false;
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        bytes32 parentId = _issueGrant(p, leaves, holderKey);

        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        c.canSign = true;
        c.targetsRoot = _root(leaves);
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c));

        vm.expectRevert(
            abi.encodeWithSelector(AgentPermissions.NarrowingViolated.selector, AgentPermissions.NarrowField.SIGNING)
        );
        perms.grant(c, leaves, signature);
    }

    /// @dev The budget-splitting attack. A parent with 5 ether must not be able to mint two
    ///      children of 5 ether each; the second child is capped by the parent's remaining budget.
    function test_Adversarial_SiblingChildrenCannotEachHoldTheFullParentBudget() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();
        address secondDelegate = makeAddr("secondDelegate");

        AgentPermissions.PermissionSet memory c1 = _basePermissionSet(account, tokenId, subDelegate);
        c1.parent = parentId;
        c1.maxTotalValue = 5 ether; // exactly the parent's budget
        c1.maxCalls = 10;
        c1.canSign = false;
        c1.expiry = uint64(block.timestamp + 12 hours);
        _issueChild(c1, leaves);

        AgentPermissions.PermissionSet memory c2 = _basePermissionSet(account, tokenId, secondDelegate);
        c2.parent = parentId;
        c2.maxTotalValue = 5 ether;
        c2.maxCalls = 10;
        c2.canSign = false;
        c2.expiry = uint64(block.timestamp + 12 hours);
        c2.targetsRoot = _root(leaves);

        // The parent has spent nothing yet, so its *declared* remaining budget still allows a
        // second full-size child. The real containment is enforced at spend time; see
        // AgentTBA.t.sol `test_Adversarial_SiblingDelegatesShareTheParentBudget`.
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c2));
        bytes32 secondChild = perms.grant(c2, leaves, signature);
        assertTrue(perms.isLive(secondChild));
    }

    function test_Adversarial_DelegationDepthIsCapped() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();

        uint256 currentKey = delegateKey;
        bytes32 currentParent = parentId;

        // MAX_DELEGATION_DEPTH = 4 children below the root are accepted.
        for (uint256 i = 1; i <= perms.MAX_DELEGATION_DEPTH(); ++i) {
            (address nextDelegate, uint256 nextKey) = makeAddrAndKey(string.concat("d", vm.toString(i)));
            AgentPermissions.PermissionSet memory c = _basePermissionSet(account, tokenId, nextDelegate);
            c.parent = currentParent;
            c.canSign = false;
            c.expiry = uint64(block.timestamp + 12 hours);
            currentParent = _issueGrant(c, leaves, currentKey);
            // `i` is bounded by MAX_DELEGATION_DEPTH (4).
            // forge-lint: disable-next-line(unsafe-typecast)
            assertEq(perms.getGrant(currentParent).depth, uint8(i));
            currentKey = nextKey;
        }

        // One more must be rejected.
        (address tooDeep,) = makeAddrAndKey("tooDeep");
        AgentPermissions.PermissionSet memory extra = _basePermissionSet(account, tokenId, tooDeep);
        extra.parent = currentParent;
        extra.canSign = false;
        extra.expiry = uint64(block.timestamp + 12 hours);
        extra.targetsRoot = _root(leaves);
        bytes memory signature = _sign(currentKey, perms.grantIdOf(extra));
        uint256 maxDepth = perms.MAX_DELEGATION_DEPTH();

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.DelegationTooDeep.selector, maxDepth + 1, maxDepth));
        perms.grant(extra, leaves, signature);
    }

    // --------------------------------------------------------------------------------------
    // Adversarial: canonical encoding
    // --------------------------------------------------------------------------------------

    function test_Adversarial_UnsortedLeavesAreRejected() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory sorted = _leaves(address(callTarget), PING, address(callTarget), PONG);
        bytes32[] memory reversed = new bytes32[](2);
        reversed[0] = sorted[1];
        reversed[1] = sorted[0];
        p.targetsRoot = _root(sorted);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(abi.encodeWithSelector(CanonicalMerkle.UnsortedLeaves.selector, uint256(1)));
        perms.grant(p, reversed, signature);
    }

    function test_Adversarial_DuplicateLeavesAreRejected() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32 leaf = perms.leafOf(address(callTarget), PING);
        bytes32[] memory duplicated = new bytes32[](2);
        duplicated[0] = leaf;
        duplicated[1] = leaf;
        p.targetsRoot = _root(duplicated);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(abi.encodeWithSelector(CanonicalMerkle.UnsortedLeaves.selector, uint256(1)));
        perms.grant(p, duplicated, signature);
    }

    /// @dev The leaf set presented at registration must reproduce the signed root, otherwise a
    ///      grant could be stored with targets the authority never approved.
    function test_Adversarial_LeafSetMustReproduceTheSignedRoot() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory signedLeaves = _leaves(address(callTarget), PING);
        bytes32[] memory substituted = _leaves(address(callTarget), PONG);
        p.targetsRoot = _root(signedLeaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPermissions.TargetsRootMismatch.selector, _root(substituted), _root(signedLeaves)
            )
        );
        perms.grant(p, substituted, signature);
    }

    /// @dev Leaf/node domain separation: a 64-byte internal-node preimage must not be presentable
    ///      as a leaf, or a permission set could be extended with an unsigned entry.
    function test_LeafAndNodeHashingAreDomainSeparated() public view {
        bytes32 a = perms.leafOf(address(callTarget), PING);
        bytes32 b = perms.leafOf(address(callTarget), PONG);

        bytes32 nodeHash =
            a < b ? keccak256(abi.encodePacked(bytes1(0x01), a, b)) : keccak256(abi.encodePacked(bytes1(0x01), b, a));
        bytes32 leafStyleHash =
            a < b ? keccak256(abi.encodePacked(bytes1(0x00), a, b)) : keccak256(abi.encodePacked(bytes1(0x00), b, a));

        assertTrue(nodeHash != leafStyleHash, "leaf and node domains must not collide");
    }

    // --------------------------------------------------------------------------------------
    // Epoch invalidation and revocation
    // --------------------------------------------------------------------------------------

    function test_TransferOfTheAgentKillsEveryGrant() public {
        (bytes32 grantId,) = _rootGrant();
        assertTrue(perms.isLive(grantId));

        vm.prank(holder);
        nft.transferFrom(holder, attacker, tokenId);

        assertFalse(perms.isLive(grantId), "grant must die with the epoch");
        assertFalse(perms.canSignFor(account, delegate));
    }

    function test_BurnKillsEveryGrant() public {
        (bytes32 grantId,) = _rootGrant();
        vm.prank(holder);
        nft.burn(tokenId);
        assertFalse(perms.isLive(grantId));
    }

    function test_HolderKillSwitchAdvancesEpochAndKillsGrants() public {
        (bytes32 grantId,) = _rootGrant();
        vm.prank(holder);
        nft.advanceEpoch(tokenId);
        assertFalse(perms.isLive(grantId));
    }

    function test_RevokingParentKillsChild() public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();
        AgentPermissions.PermissionSet memory c = _childOf(parentId, leaves);
        bytes32 childId = _issueChild(c, _leaves(address(callTarget), PING));
        assertTrue(perms.isLive(childId));

        vm.prank(holder);
        perms.revoke(parentId);

        assertFalse(perms.isLive(childId), "child must not outlive a revoked parent");
    }

    function test_RevertWhen_StrangerRevokes() public {
        (bytes32 grantId,) = _rootGrant();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NotAuthorizedToRevoke.selector, grantId, attacker));
        perms.revoke(grantId);
    }

    function test_ReissuingSupersedesThePreviousGrant() public {
        (bytes32 firstId,) = _rootGrant();

        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        bytes32 secondId = _issueGrant(p, leaves, holderKey);

        assertFalse(perms.isLive(firstId), "superseded grant must be revoked");
        assertTrue(perms.isLive(secondId));
        assertEq(perms.activeGrant(account, delegate), secondId);
    }

    // --------------------------------------------------------------------------------------
    // Shape validation
    // --------------------------------------------------------------------------------------

    function test_RevertWhen_GrantLifetimeExceedsCap() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        uint64 maxLifetime = perms.MAX_GRANT_LIFETIME();
        p.expiry = p.notBefore + maxLifetime + 1;
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.LifetimeTooLong.selector, maxLifetime + 1, maxLifetime));
        perms.grant(p, leaves, signature);
    }

    function test_RevertWhen_EpochIsStale() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.agentEpoch = 99;
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.EpochMismatch.selector, uint64(99), uint64(1)));
        perms.grant(p, leaves, signature);
    }

    function test_RevertWhen_AccountImplementationSetTwice() public {
        vm.expectRevert(AgentPermissions.ImplementationAlreadySet.selector);
        perms.setAccountImplementation(address(0xBEEF));
    }

    /// @dev The binding is the one mutable step in the deployment, so only the deployer may close
    ///      it — and only once. Nobody else can point the account-derivation check anywhere.
    function test_Adversarial_OnlyDeployerCanBindTheAccountImplementation() public {
        AgentPermissions fresh = new AgentPermissions(nft, registry);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NotDeployer.selector, attacker, address(this)));
        fresh.setAccountImplementation(address(accountImpl));

        // The deployer can, exactly once.
        fresh.setAccountImplementation(address(accountImpl));
        assertEq(fresh.accountImplementation(), address(accountImpl));
    }

    // --------------------------------------------------------------------------------------
    // Fuzz
    // --------------------------------------------------------------------------------------

    /// @dev No child grant may exceed its parent on any numeric axis, for any input.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_ChildNeverExceedsParent(
        uint256 childValuePerCall,
        uint256 childTotalValue,
        uint32 childCalls,
        uint64 childExpiryOffset
    ) public {
        (bytes32 parentId, bytes32[] memory leaves) = _rootGrant();
        AgentPermissions.Grant memory parent = perms.getGrant(parentId);

        AgentPermissions.PermissionSet memory c = _basePermissionSet(account, tokenId, subDelegate);
        c.parent = parentId;
        c.canSign = false;
        c.maxValuePerCall = bound(childValuePerCall, 0, 10 ether);
        c.maxTotalValue = bound(childTotalValue, 0, 10 ether);
        c.maxCalls = uint32(bound(childCalls, 1, 100));
        c.expiry = uint64(bound(childExpiryOffset, block.timestamp + 1, block.timestamp + 3 days));
        c.targetsRoot = _root(leaves);
        bytes memory signature = _sign(delegateKey, perms.grantIdOf(c));

        try perms.grant(c, leaves, signature) returns (bytes32 childId) {
            AgentPermissions.Grant memory child = perms.getGrant(childId);
            assertLe(child.maxValuePerCall, parent.maxValuePerCall, "value/call widened");
            assertLe(child.maxTotalValue, parent.maxTotalValue - parent.spentValue, "total value widened");
            assertLe(child.maxCalls, parent.maxCalls - parent.usedCalls, "call budget widened");
            assertLe(child.expiry, parent.expiry, "expiry widened");
            assertGe(child.notBefore, parent.notBefore, "start widened");
        } catch {
            // Rejection is the other acceptable outcome.
        }
    }

    /// @dev Any mutation of a signed field must invalidate the signature.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_MutatingASignedFieldInvalidatesTheSignature(uint8 fieldIndex, uint256 mutation) public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);
        p.targetsRoot = _root(leaves);
        bytes memory signature = _sign(holderKey, perms.grantIdOf(p));

        uint256 field = fieldIndex % 6;
        if (field == 0) {
            p.maxValuePerCall = bound(mutation, 0, 1e24);
            if (p.maxValuePerCall == 1 ether) return;
        } else if (field == 1) {
            p.maxTotalValue = bound(mutation, 0, 1e24);
            if (p.maxTotalValue == 5 ether) return;
        } else if (field == 2) {
            p.maxCalls = uint32(bound(mutation, 1, 1e6));
            if (p.maxCalls == 10) return;
        } else if (field == 3) {
            p.expiry = uint64(bound(mutation, block.timestamp + 1, block.timestamp + 300 days));
            if (p.expiry == uint64(block.timestamp + 1 days)) return;
        } else if (field == 4) {
            p.canSign = !p.canSign;
        } else {
            address newDelegate = address(uint160(bound(mutation, 1, type(uint160).max)));
            if (newDelegate == delegate || newDelegate == account) return;
            p.delegate = newDelegate;
        }

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.InvalidAuthoritySignature.selector, holder));
        perms.grant(p, leaves, signature);
    }
}
