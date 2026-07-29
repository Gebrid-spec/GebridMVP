// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {AgentPermissions} from "../src/core/AgentPermissions.sol";
import {AgentTBA} from "../src/core/AgentTBA.sol";
import {RiskEngine} from "../src/core/RiskEngine.sol";
import {IERC6551Executable} from "../src/interfaces/IERC6551Account.sol";
import {GebridTestBase} from "./utils/GebridTestBase.sol";
import {CallTarget, ReentrantTarget} from "./utils/Mocks.sol";

/// @dev Harness note: contract reads are hoisted before any `prank` / `expectRevert`.
contract AgentTBATest is GebridTestBase {
    CallTarget internal callTarget;
    uint256 internal tokenId;
    address payable internal account;
    AgentTBA internal agent;

    bytes4 internal constant PING = CallTarget.ping.selector;
    bytes4 internal constant PONG = CallTarget.pong.selector;

    function setUp() public virtual override {
        super.setUp();
        callTarget = new CallTarget();
        (tokenId, account) = _mintAgent(holder);
        agent = AgentTBA(account);
        vm.deal(account, 100 ether);
    }

    function _pingData() internal pure returns (bytes memory) {
        return abi.encodeCall(CallTarget.ping, ());
    }

    function _grantToDelegate(uint256 maxValuePerCall, uint256 maxTotalValue, uint32 maxCalls)
        internal
        returns (bytes32)
    {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.maxValuePerCall = maxValuePerCall;
        p.maxTotalValue = maxTotalValue;
        p.maxCalls = maxCalls;
        return _issueGrant(p, _leaves(address(callTarget), PING), holderKey);
    }

    // --------------------------------------------------------------------------------------
    // Execution authority
    // --------------------------------------------------------------------------------------

    function test_TokenHolderCanExecute() public {
        vm.prank(holder);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);

        assertEq(callTarget.counter(), 1);
        assertEq(address(callTarget).balance, 1 ether);
        assertEq(agent.state(), 1, "ERC-6551 state must advance");
    }

    function test_DelegateWithGrantCanExecute() public {
        _grantToDelegate(1 ether, 5 ether, 10);

        vm.prank(delegate);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);
        assertEq(callTarget.counter(), 1);
    }

    function test_RevertWhen_StrangerExecutes() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NoActiveGrant.selector, account, attacker));
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    function test_RevertWhen_OperationIsNotCall() public {
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(AgentTBA.UnsupportedOperation.selector, uint8(1)));
        agent.execute(address(callTarget), 0, _pingData(), 1);
    }

    /// @dev A burned agent has no root authority, so nobody — holder or delegate — can execute.
    function test_Adversarial_BurnedAgentCannotExecute() public {
        _grantToDelegate(1 ether, 5 ether, 10);

        vm.prank(holder);
        nft.burn(tokenId);

        assertEq(agent.owner(), address(0), "owner must resolve to zero, not revert");

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(AgentTBA.Unauthorized.selector, delegate));
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    /// @dev The account address is chain-scoped. Reading it on another chain must not execute.
    function test_Adversarial_CrossChainExecutionIsDisabled() public {
        uint256 originalChain = block.chainid;
        vm.chainId(originalChain + 1);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTBA.CrossChainExecutionDisabled.selector, originalChain, originalChain + 1)
        );
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    function test_RevertBubblesFromTarget() public {
        callTarget.setShouldRevert(true);
        vm.prank(holder);
        vm.expectRevert(bytes("CallTarget: forced revert"));
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    // --------------------------------------------------------------------------------------
    // Permission enforcement on the execution path
    // --------------------------------------------------------------------------------------

    function test_Adversarial_DelegateCannotCallAnUnauthorisedSelector() public {
        _grantToDelegate(1 ether, 5 ether, 10); // PING only

        bytes memory pongData = abi.encodeCall(CallTarget.pong, (1));
        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.TargetNotPermitted.selector, address(callTarget), PONG));
        agent.execute(address(callTarget), 0, pongData, 0);
    }

    function test_Adversarial_DelegateCannotCallAnUnauthorisedTarget() public {
        _grantToDelegate(1 ether, 5 ether, 10);
        CallTarget other = new CallTarget();

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.TargetNotPermitted.selector, address(other), PING));
        agent.execute(address(other), 0, _pingData(), 0);
    }

    function test_Adversarial_PerCallValueCapIsEnforced() public {
        _grantToDelegate(1 ether, 5 ether, 10);

        vm.prank(delegate);
        vm.expectRevert(
            abi.encodeWithSelector(AgentPermissions.PerCallValueExceeded.selector, uint256(2 ether), uint256(1 ether))
        );
        agent.execute(address(callTarget), 2 ether, _pingData(), 0);
    }

    function test_Adversarial_TotalValueBudgetIsEnforced() public {
        bytes32 grantId = _grantToDelegate(1 ether, 2 ether, 10);

        vm.startPrank(delegate);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPermissions.TotalValueExceeded.selector, grantId, uint256(3 ether), uint256(2 ether)
            )
        );
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);
        vm.stopPrank();
    }

    function test_Adversarial_CallBudgetIsEnforced() public {
        bytes32 grantId = _grantToDelegate(1 ether, 100 ether, 2);

        vm.startPrank(delegate);
        agent.execute(address(callTarget), 0, _pingData(), 0);
        agent.execute(address(callTarget), 0, _pingData(), 0);

        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.CallBudgetExceeded.selector, grantId, uint32(2)));
        agent.execute(address(callTarget), 0, _pingData(), 0);
        vm.stopPrank();
    }

    /// @dev The containment property that makes delegation genuinely narrowing: two children of
    ///      one parent draw from the *same* parent budget, so together they can never move more
    ///      than the parent alone was allowed to.
    function test_Adversarial_SiblingDelegatesShareTheParentBudget() public {
        bytes32 parentId = _grantToDelegate(1 ether, 2 ether, 10);
        bytes32[] memory leaves = _leaves(address(callTarget), PING);

        (address childA, uint256 childAKey) = makeAddrAndKey("childA");
        (address childB,) = makeAddrAndKey("childB");

        AgentPermissions.PermissionSet memory a = _basePermissionSet(account, tokenId, childA);
        a.parent = parentId;
        a.maxValuePerCall = 1 ether;
        a.maxTotalValue = 2 ether;
        a.maxCalls = 5;
        a.canSign = false;
        a.expiry = uint64(block.timestamp + 12 hours);
        _issueGrant(a, leaves, delegateKey);

        AgentPermissions.PermissionSet memory b = _basePermissionSet(account, tokenId, childB);
        b.parent = parentId;
        b.maxValuePerCall = 1 ether;
        b.maxTotalValue = 2 ether;
        b.maxCalls = 5;
        b.canSign = false;
        b.expiry = uint64(block.timestamp + 12 hours);
        _issueGrant(b, leaves, delegateKey);

        // Child A drains the parent's 2 ether.
        vm.startPrank(childA);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);
        vm.stopPrank();

        // Child B still shows 2 ether of its own budget, but the parent has nothing left.
        assertEq(perms.getGrant(parentId).spentValue, 2 ether, "parent charged for the child's spend");

        vm.prank(childB);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPermissions.TotalValueExceeded.selector, parentId, uint256(3 ether), uint256(2 ether)
            )
        );
        agent.execute(address(callTarget), 1 ether, _pingData(), 0);

        childAKey; // silence unused-variable analysis without weakening the scenario
    }

    function test_Adversarial_RevokedGrantStopsExecution() public {
        bytes32 grantId = _grantToDelegate(1 ether, 5 ether, 10);

        vm.prank(holder);
        perms.revoke(grantId);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NoActiveGrant.selector, account, delegate));
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    function test_Adversarial_TransferOfAgentStopsDelegateExecution() public {
        bytes32 grantId = _grantToDelegate(1 ether, 5 ether, 10);

        vm.prank(holder);
        nft.transferFrom(holder, attacker, tokenId);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.EpochInvalidated.selector, grantId, 1, 2));
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    // --------------------------------------------------------------------------------------
    // Risk enforcement on the execution path
    // --------------------------------------------------------------------------------------

    /// @dev The block is not waivable by the root authority. A control plane the owner can
    ///      override is not a control plane.
    function test_Adversarial_BlockAppliesToTheTokenHolderToo() public {
        bytes memory data = _pingData();
        bytes32 subject = risk.intentSubject(account, address(callTarget), 1 ether, PING, keccak256(data));
        uint64 blocking = _blockingSeverities();

        vm.prank(admin);
        risk.submitAttestation(subject, blocking, 1 ether, 1 hours);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                RiskEngine.IntentBlocked.selector, subject, uint16(7500), uint64(block.timestamp + 1 hours)
            )
        );
        agent.execute(address(callTarget), 1 ether, data, 0);
    }

    function test_AgentLevelBlockStopsEverything() public {
        bytes32 subject = risk.agentSubject(account);
        uint64 blocking = _blockingSeverities();

        vm.prank(admin);
        risk.submitAttestation(subject, blocking, 10 ether, 1 hours);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(RiskEngine.AgentBlocked.selector, account, uint64(block.timestamp + 1 hours))
        );
        agent.execute(address(callTarget), 0, _pingData(), 0);
    }

    function test_BlockLapsesWhenTheWindowExpires() public {
        bytes32 subject = risk.agentSubject(account);
        uint64 blocking = _blockingSeverities();

        vm.prank(admin);
        risk.submitAttestation(subject, blocking, 10 ether, 1 hours);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(holder);
        agent.execute(address(callTarget), 0, _pingData(), 0);
        assertEq(callTarget.counter(), 1);
    }

    // --------------------------------------------------------------------------------------
    // Re-entrancy
    // --------------------------------------------------------------------------------------

    /// @dev A malicious target re-enters `execute`. It comes back as *itself*, an address with no
    ///      grant, so the enforcement path rejects it. Budgets were already charged before the
    ///      outbound call, so even a re-entry that were authorised could not double-spend.
    function test_Adversarial_ReentrantTargetCannotEscapeEnforcement() public {
        ReentrantTarget evil = new ReentrantTarget(IERC6551Executable(account), address(callTarget));

        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.maxValuePerCall = 1 ether;
        p.maxTotalValue = 2 ether;
        p.maxCalls = 5;
        _issueGrant(p, _leaves(address(evil), PING), holderKey);

        vm.prank(delegate);
        agent.execute(address(evil), 1 ether, _pingData(), 0);

        assertEq(evil.attempts(), 1, "outer call ran");
        assertFalse(evil.innerSucceeded(), "re-entrant execute must be rejected");
        assertEq(callTarget.counter(), 0, "inner target must never have been called");

        // Exactly one call was charged, not two.
        assertEq(perms.getGrant(perms.activeGrant(account, delegate)).usedCalls, 1);
        assertEq(perms.getGrant(perms.activeGrant(account, delegate)).spentValue, 1 ether);
    }

    // --------------------------------------------------------------------------------------
    // ERC-1271
    // --------------------------------------------------------------------------------------

    function test_HolderSignatureSatisfiesERC1271() public view {
        bytes32 hash = keccak256("gebrid");
        bytes memory signature = _sign(holderKey, hash);
        assertEq(agent.isValidSignature(hash, signature), IERC1271.isValidSignature.selector);
    }

    function test_SigningDelegateSatisfiesERC1271() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.canSign = true;
        _issueGrant(p, _leaves(address(callTarget), PING), holderKey);

        bytes32 hash = keccak256("gebrid");
        assertEq(agent.isValidSignature(hash, _sign(delegateKey, hash)), IERC1271.isValidSignature.selector);
        assertEq(agent.isValidSigner(delegate, ""), bytes4(0x523e3260));
    }

    function test_Adversarial_NonSigningDelegateFailsERC1271() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.canSign = false;
        _issueGrant(p, _leaves(address(callTarget), PING), holderKey);

        bytes32 hash = keccak256("gebrid");
        assertEq(agent.isValidSignature(hash, _sign(delegateKey, hash)), bytes4(0xffffffff));
        assertEq(agent.isValidSigner(delegate, ""), bytes4(0));
    }

    function test_Adversarial_StrangerSignatureFailsERC1271() public view {
        bytes32 hash = keccak256("gebrid");
        assertEq(agent.isValidSignature(hash, _sign(attackerKey, hash)), bytes4(0xffffffff));
    }

    /// @dev A malformed signature must return the failure magic value, not revert. Callers of
    ///      ERC-1271 are not required to handle a revert.
    function test_Adversarial_MalformedSignatureReturnsFailureNotRevert() public view {
        bytes32 hash = keccak256("gebrid");
        assertEq(agent.isValidSignature(hash, hex"00"), bytes4(0xffffffff));
        assertEq(agent.isValidSignature(hash, ""), bytes4(0xffffffff));
    }

    function test_Adversarial_SignatureRightsDieWithTheAgentTransfer() public {
        AgentPermissions.PermissionSet memory p = _basePermissionSet(account, tokenId, delegate);
        p.canSign = true;
        _issueGrant(p, _leaves(address(callTarget), PING), holderKey);

        bytes32 hash = keccak256("gebrid");
        assertEq(agent.isValidSignature(hash, _sign(delegateKey, hash)), IERC1271.isValidSignature.selector);

        vm.prank(holder);
        nft.transferFrom(holder, attacker, tokenId);

        assertEq(agent.isValidSignature(hash, _sign(delegateKey, hash)), bytes4(0xffffffff));
    }

    // --------------------------------------------------------------------------------------
    // Fuzz
    // --------------------------------------------------------------------------------------

    /// @dev Whatever sequence of calls a delegate makes, the total value it moves can never exceed
    ///      the budget its grant was issued with.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_DelegateNeverExceedsItsTotalBudget(uint256[6] memory values, uint256 budget) public {
        budget = bound(budget, 0, 20 ether);
        _grantToDelegate(2 ether, budget, 100);

        uint256 moved;
        for (uint256 i = 0; i < values.length; ++i) {
            uint256 value = bound(values[i], 0, 3 ether);
            vm.prank(delegate);
            try agent.execute(address(callTarget), value, _pingData(), 0) {
                moved += value;
            } catch {
                // Rejected calls move nothing.
            }
        }

        assertLe(moved, budget, "delegate moved more than its total budget");
        assertEq(address(callTarget).balance, moved, "accounting must match the money");
    }

    /// @dev `state()` must advance on exactly the successful executions, per ERC-6551.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_StateTracksSuccessfulExecutions(uint8 attempts, uint8 revertAt) public {
        uint256 rounds = bound(attempts, 1, 8);
        uint256 failAt = bound(revertAt, 0, rounds);

        uint256 succeeded;
        for (uint256 i = 0; i < rounds; ++i) {
            callTarget.setShouldRevert(i == failAt);
            vm.prank(holder);
            try agent.execute(address(callTarget), 0, _pingData(), 0) {
                succeeded++;
            } catch {}
        }

        assertEq(agent.state(), succeeded, "state must count exactly the successful executions");
    }
}
