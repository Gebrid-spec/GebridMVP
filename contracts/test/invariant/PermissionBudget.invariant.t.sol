// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {AgentPermissions} from "../../src/core/AgentPermissions.sol";
import {AgentTBA} from "../../src/core/AgentTBA.sol";
import {GebridTestBase} from "../utils/GebridTestBase.sol";
import {CallTarget} from "../utils/Mocks.sol";

/// @notice Drives random execution attempts from a delegation tree of arbitrary shape.
contract BudgetHandler is Test {
    AgentTBA private immutable AGENT;
    CallTarget private immutable TARGET;
    address[] private actors;

    uint256 public totalMoved;
    uint256 public acceptedCalls;
    uint256 public rejectedCalls;

    constructor(AgentTBA agent, CallTarget target, address[] memory actors_) {
        AGENT = agent;
        TARGET = target;
        actors = actors_;
    }

    function execute(uint256 actorSeed, uint256 value) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(value, 0, 2 ether);

        vm.prank(actor);
        try AGENT.execute(address(TARGET), amount, abi.encodeCall(CallTarget.ping, ()), 0) {
            totalMoved += amount;
            acceptedCalls++;
        } catch {
            rejectedCalls++;
        }
    }
}

/// @notice The containment invariant, stated over the whole delegation tree rather than a single
///         hand-written sequence: no matter how the tree is exercised, the money that leaves the
///         agent is bounded by the root grant, and the on-chain accounting matches the money.
contract PermissionBudgetInvariantTest is StdInvariant, GebridTestBase {
    CallTarget internal callTarget;
    AgentTBA internal agent;
    BudgetHandler internal handler;

    uint256 internal tokenId;
    address payable internal account;
    bytes32 internal rootGrantId;

    uint256 internal constant ROOT_BUDGET = 3 ether;

    function setUp() public override {
        super.setUp();

        callTarget = new CallTarget();
        (tokenId, account) = _mintAgent(holder);
        agent = AgentTBA(account);
        vm.deal(account, 1_000 ether);

        bytes32[] memory leaves = _leaves(address(callTarget), CallTarget.ping.selector);

        // Root grant: the whole tree is bounded by this.
        AgentPermissions.PermissionSet memory root = _basePermissionSet(account, tokenId, delegate);
        root.maxValuePerCall = 2 ether;
        root.maxTotalValue = ROOT_BUDGET;
        root.maxCalls = 50;
        rootGrantId = _issueGrant(root, leaves, holderKey);

        // Two children, each optimistically declaring the full root budget for itself.
        (address childA,) = makeAddrAndKey("invChildA");
        (address childB,) = makeAddrAndKey("invChildB");

        AgentPermissions.PermissionSet memory a = _basePermissionSet(account, tokenId, childA);
        a.parent = rootGrantId;
        a.maxValuePerCall = 2 ether;
        a.maxTotalValue = ROOT_BUDGET;
        a.maxCalls = 50;
        a.canSign = false;
        a.expiry = uint64(block.timestamp + 12 hours);
        _issueGrant(a, leaves, delegateKey);

        AgentPermissions.PermissionSet memory b = _basePermissionSet(account, tokenId, childB);
        b.parent = rootGrantId;
        b.maxValuePerCall = 2 ether;
        b.maxTotalValue = ROOT_BUDGET;
        b.maxCalls = 50;
        b.canSign = false;
        b.expiry = uint64(block.timestamp + 12 hours);
        _issueGrant(b, leaves, delegateKey);

        address[] memory actors = new address[](4);
        actors[0] = delegate;
        actors[1] = childA;
        actors[2] = childB;
        actors[3] = attacker; // holds nothing, should never succeed

        handler = new BudgetHandler(agent, callTarget, actors);
        targetContract(address(handler));
    }

    /// @dev I-P3 stated as money: delegation can only narrow, so the tree cannot outspend its root.
    function invariant_TreeNeverOutspendsTheRootGrant() public view {
        assertLe(handler.totalMoved(), ROOT_BUDGET, "delegation tree exceeded the root budget");
        assertLe(perms.getGrant(rootGrantId).spentValue, ROOT_BUDGET, "root grant over-charged");
    }

    /// @dev Accounting must equal reality: the root grant's recorded spend is exactly the ether
    ///      that left the agent.
    function invariant_AccountingMatchesTheMoney() public view {
        assertEq(perms.getGrant(rootGrantId).spentValue, address(callTarget).balance, "spend accounting drifted");
        assertEq(handler.totalMoved(), address(callTarget).balance, "handler and chain disagree");
    }

    /// @dev The call budget is charged on the root for every descendant call, never skipped.
    function invariant_RootCallBudgetCoversEveryCall() public view {
        assertEq(perms.getGrant(rootGrantId).usedCalls, handler.acceptedCalls(), "root call count drifted");
    }
}
