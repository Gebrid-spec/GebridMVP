// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {AgentNFT} from "../src/core/AgentNFT.sol";
import {AgentPermissions} from "../src/core/AgentPermissions.sol";
import {AgentTBA} from "../src/core/AgentTBA.sol";
import {DeployCore} from "../script/DeployCore.s.sol";

/// @notice Exercises the deploy script itself. A deploy script that is never run in CI is a
///         script that breaks silently between the last test and the mainnet deployment.
contract DeployCoreTest is Test {
    DeployCore internal script;
    address internal admin;
    uint256 internal adminKey;

    function setUp() public {
        (admin, adminKey) = makeAddrAndKey("deployAdmin");
        script = new DeployCore();
        vm.setEnv("GEBRID_ADMIN", vm.toString(admin));
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(adminKey));
    }

    function test_ScriptDeploysAWiredStack() public {
        DeployCore.Deployment memory d = script.run();

        assertTrue(d.agentNft != address(0));
        assertTrue(d.registry != address(0));
        assertTrue(d.riskEngine != address(0));
        assertTrue(d.permissions != address(0));
        assertTrue(d.accountImplementation != address(0));

        // `_verifyWiring` already asserted the wiring inside the script; re-check the one that
        // closes the constructor cycle, since it is the only mutable step in the whole deployment.
        assertEq(AgentPermissions(d.permissions).accountImplementation(), d.accountImplementation);
        assertEq(address(AgentTBA(payable(d.accountImplementation)).PERMISSIONS()), d.permissions);
        assertTrue(AgentNFT(d.agentNft).hasRole(0x00, admin), "admin holds DEFAULT_ADMIN_ROLE");
    }

    /// @dev `vm.setEnv` writes the real process environment and is not rolled back between tests
    ///      (only EVM state is snapshotted after `setUp`). This test therefore restores the
    ///      variable itself, or every test that runs after it would see the mismatched key.
    function test_RevertWhen_DeployerIsNotTheDeclaredAdmin() public {
        (, uint256 otherKey) = makeAddrAndKey("someoneElse");
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(otherKey));

        vm.expectRevert(bytes("DEPLOYER_PRIVATE_KEY must correspond to GEBRID_ADMIN"));
        script.run();

        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(adminKey));
    }

    /// @dev The write-once binding is the deployment's single point of failure; prove it cannot be
    ///      re-pointed after the fact.
    function test_AccountImplementationCannotBeRebound() public {
        DeployCore.Deployment memory d = script.run();

        vm.prank(admin);
        vm.expectRevert(AgentPermissions.ImplementationAlreadySet.selector);
        AgentPermissions(d.permissions).setAccountImplementation(address(0xBEEF));
    }
}
