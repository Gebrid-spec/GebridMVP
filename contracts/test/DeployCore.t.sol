// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {AgentNFT} from "../src/core/AgentNFT.sol";
import {AgentPermissions} from "../src/core/AgentPermissions.sol";
import {AgentTBA} from "../src/core/AgentTBA.sol";
import {ERC6551Registry} from "../src/core/ERC6551Registry.sol";
import {RiskEngine} from "../src/core/RiskEngine.sol";
import {DeployCore} from "../script/DeployCore.s.sol";
import {NonConformingRegistry} from "./utils/Mocks.sol";

/// @notice Exercises the deploy script itself. A deploy script that is never run in CI is a script
///         that breaks silently between the last test and the mainnet deployment.
///
/// @dev Harness note: these tests drive `deployWithConfig`, never the env-reading `run()`.
///      `vm.setEnv` writes the real process environment and is not rolled back between tests — only
///      EVM state is snapshotted after `setUp` — and forge runs tests within a contract
///      concurrently, so a suite that varies configuration through environment variables races with
///      itself. Restoring the variable at the end of a test does not fix it.
contract DeployCoreTest is Test {
    DeployCore internal script;
    address internal admin = makeAddr("deployAdmin");

    address internal constant CANONICAL = 0x000000006551c19487814612e58FE06813775758;

    function setUp() public {
        script = new DeployCore();
    }

    function _config() internal view returns (DeployCore.Config memory config) {
        config.admin = admin;
        config.nftName = "GEBRID Agent";
        config.nftSymbol = "GAGENT";
        config.adminTransferDelay = 3 days;
        config.deployOwnRegistry = true; // no singleton exists on a bare test EVM
        config.registryOverride = address(0);
    }

    /// @dev Places a real, conforming ERC-6551 registry at the canonical address, the way a live
    ///      chain has one.
    function _etchCanonicalRegistry() private {
        ERC6551Registry conforming = new ERC6551Registry();
        vm.etch(CANONICAL, address(conforming).code);
    }

    // --------------------------------------------------------------------------------------
    // Wiring
    // --------------------------------------------------------------------------------------

    function test_ScriptDeploysAWiredStack() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());

        assertTrue(d.agentNft != address(0));
        assertTrue(d.registry != address(0));
        assertTrue(d.riskEngine != address(0));
        assertTrue(d.permissions != address(0));
        assertTrue(d.accountImplementation != address(0));

        // `_verifyWiring` already asserted the wiring inside the script; re-check the one mutable
        // step in the whole deployment, plus the admin bindings.
        assertEq(AgentPermissions(d.permissions).accountImplementation(), d.accountImplementation);
        assertEq(address(AgentTBA(payable(d.accountImplementation)).PERMISSIONS()), d.permissions);
        assertEq(AgentNFT(d.agentNft).defaultAdmin(), admin);
        assertEq(RiskEngine(d.riskEngine).defaultAdmin(), admin);
        // AgentPermissions has no owner: its only privilege was the write-once binding,
        // which the deployment has already consumed.
        assertEq(AgentPermissions(d.permissions).DEPLOYER(), address(script));
    }

    /// @dev The write-once binding is the deployment's single point of failure. Even the deployer,
    ///      the only address allowed to close it, cannot re-point it afterwards.
    function test_AccountImplementationCannotBeRebound() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());

        vm.prank(address(script));
        vm.expectRevert(AgentPermissions.ImplementationAlreadySet.selector);
        AgentPermissions(d.permissions).setAccountImplementation(address(0xBEEF));

        // And the admin, who has no role on this contract at all, cannot either.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgentPermissions.NotDeployer.selector, admin, address(script)));
        AgentPermissions(d.permissions).setAccountImplementation(address(0xBEEF));
    }

    /// @dev The guard that stops a mismatched signing key from failing half-way through a
    ///      broadcast. Tested directly rather than through the environment.
    function test_RevertWhen_DeployerKeyIsNotTheDeclaredAdmin() public {
        (address other, uint256 otherKey) = makeAddrAndKey("someoneElse");
        assertTrue(other != admin);

        vm.expectRevert(bytes("DEPLOYER_PRIVATE_KEY must correspond to GEBRID_ADMIN"));
        script.requireDeployerMatchesAdmin(otherKey, admin);
    }

    function test_DeployerKeyMatchingAdminIsAccepted() public {
        (address matching, uint256 matchingKey) = makeAddrAndKey("matchingAdmin");
        script.requireDeployerMatchesAdmin(matchingKey, matching);
        // A zero key means the keystore / hardware path, which forge checks via --sender.
        script.requireDeployerMatchesAdmin(0, admin);
    }

    // --------------------------------------------------------------------------------------
    // Registry selection (ADR-0002)
    // --------------------------------------------------------------------------------------

    /// @dev The default path: bind the canonical singleton so agent accounts are discoverable by
    ///      third-party 6551 tooling.
    function test_DefaultsToTheCanonicalRegistry() public {
        _etchCanonicalRegistry();

        DeployCore.Config memory config = _config();
        config.deployOwnRegistry = false;

        DeployCore.Deployment memory d = script.deployWithConfig(config);

        assertEq(d.registry, CANONICAL, "must bind the canonical singleton");
        assertTrue(d.registryIsCanonical);
        assertEq(address(AgentPermissions(d.permissions).REGISTRY()), CANONICAL);
    }

    /// @dev A chain without the singleton must fail loudly rather than silently bind an address
    ///      with no code behind it.
    function test_RevertWhen_CanonicalRegistryIsAbsent() public {
        DeployCore.Config memory config = _config();
        config.deployOwnRegistry = false;

        vm.expectRevert(
            bytes(
                "No ERC-6551 registry at the configured address on this chain. "
                "Set GEBRID_ERC6551_REGISTRY, or GEBRID_DEPLOY_OWN_REGISTRY=true to deploy one."
            )
        );
        script.deployWithConfig(config);
    }

    /// @dev The check that replaces trusting a hardcoded code hash. A contract that answers
    ///      `account(...)` but derives addresses differently — a look-alike, a proxy, or simply the
    ///      wrong address — must abort the deployment. Without this, every agent account would sit
    ///      where no other 6551 tool computes it, and it would only be noticed after minting.
    function test_Adversarial_NonConformingRegistryAtCanonicalAddressAborts() public {
        NonConformingRegistry impostor = new NonConformingRegistry();
        vm.etch(CANONICAL, address(impostor).code);

        DeployCore.Config memory config = _config();
        config.deployOwnRegistry = false;

        vm.expectRevert(bytes("Registry does not derive ERC-6551 account addresses per spec; refusing to bind it."));
        script.deployWithConfig(config);
    }

    /// @dev An explicitly supplied registry is checked just as hard as the canonical one, and is
    ///      not reported as canonical.
    function test_RegistryOverrideIsCheckedAndMarkedNonCanonical() public {
        ERC6551Registry supplied = new ERC6551Registry();

        DeployCore.Config memory config = _config();
        config.deployOwnRegistry = false;
        config.registryOverride = address(supplied);

        DeployCore.Deployment memory d = script.deployWithConfig(config);
        assertEq(d.registry, address(supplied));
        assertFalse(d.registryIsCanonical, "an override is never the canonical singleton");
    }

    /// @dev The escape hatch for chains genuinely lacking the singleton. It works, and it flags
    ///      itself so the deployment record cannot quietly claim otherwise.
    function test_OwnRegistryFallbackIsMarkedNonCanonical() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());

        assertTrue(d.registry != CANONICAL);
        assertFalse(d.registryIsCanonical, "fallback must not be reported as canonical");
    }

    // --------------------------------------------------------------------------------------
    // Admin handover
    // --------------------------------------------------------------------------------------

    /// @dev DEFAULT_ADMIN_ROLE cannot be granted directly at all, on either contract. A stolen
    ///      admin key cannot quietly add a second admin.
    function test_AdminRoleCannotBeGrantedDirectly() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());

        vm.prank(admin);
        vm.expectRevert(); // AccessControlEnforcedDefaultAdminRules
        AgentNFT(d.agentNft).grantRole(0x00, address(0xBEEF));

        vm.prank(admin);
        vm.expectRevert();
        RiskEngine(d.riskEngine).grantRole(0x00, address(0xBEEF));
    }

    function test_AdminHandoverRequiresTheDelayAndAcceptance() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());
        AgentNFT nft = AgentNFT(d.agentNft);
        address newAdmin = makeAddr("newAdmin");

        vm.prank(admin);
        nft.beginDefaultAdminTransfer(newAdmin);

        // Too early: the handover is visible on-chain but not yet effective.
        vm.prank(newAdmin);
        vm.expectRevert();
        nft.acceptDefaultAdminTransfer();
        assertEq(nft.defaultAdmin(), admin, "admin must not have moved");

        vm.warp(block.timestamp + d.adminTransferDelay + 1);
        vm.prank(newAdmin);
        nft.acceptDefaultAdminTransfer();
        assertEq(nft.defaultAdmin(), newAdmin);
    }

    /// @dev A pending handover can be cancelled inside the delay window, which is the point of
    ///      having the window at all.
    function test_PendingAdminHandoverCanBeCancelled() public {
        DeployCore.Deployment memory d = script.deployWithConfig(_config());
        AgentNFT nft = AgentNFT(d.agentNft);
        address attacker = makeAddr("adminThief");

        vm.startPrank(admin);
        nft.beginDefaultAdminTransfer(attacker);
        nft.cancelDefaultAdminTransfer();
        vm.stopPrank();

        vm.warp(block.timestamp + d.adminTransferDelay + 1);
        vm.prank(attacker);
        vm.expectRevert();
        nft.acceptDefaultAdminTransfer();

        assertEq(nft.defaultAdmin(), admin);
    }
}
