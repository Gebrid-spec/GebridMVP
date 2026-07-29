// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {AgentNFT} from "../src/core/AgentNFT.sol";
import {AgentPermissions} from "../src/core/AgentPermissions.sol";
import {AgentTBA} from "../src/core/AgentTBA.sol";
import {ERC6551Registry} from "../src/core/ERC6551Registry.sol";
import {RiskEngine} from "../src/core/RiskEngine.sol";
import {IAgentNFT} from "../src/interfaces/IAgentNFT.sol";
import {IAgentPermissions} from "../src/interfaces/IAgentPermissions.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";

/// @title DeployCore
/// @notice Deploys the phase 0.1.1 enforcement core (AgentNFT, ERC6551Registry, RiskEngine,
///         AgentPermissions, AgentTBA) and closes the one post-deployment wiring step.
///
/// @dev Secrets come from the environment only; nothing sensitive is committed (invariant I-P6).
///      Two signing modes are supported:
///        - hardware / keystore (preferred):  forge script ... --account gebrid-deployer --sender 0x...
///        - raw key (testnet only):           DEPLOYER_PRIVATE_KEY=0x... forge script ...
///
///      Base Sepolia:
///        forge script script/DeployCore.s.sol:DeployCore \
///          --rpc-url base_sepolia --broadcast --verify -vvvv
///
///      Deployment order is forced by one dependency cycle: AgentTBA takes AgentPermissions as a
///      constructor immutable, and AgentPermissions needs AgentTBA's address to re-derive account
///      addresses. AgentPermissions is deployed first and its write-once setter closes the loop.
contract DeployCore is Script {
    struct Deployment {
        address agentNft;
        address registry;
        address riskEngine;
        address permissions;
        address accountImplementation;
        address admin;
    }

    function run() external returns (Deployment memory deployment) {
        address admin = vm.envAddress("GEBRID_ADMIN");
        string memory nftName = vm.envOr("GEBRID_NFT_NAME", string("GEBRID Agent"));
        string memory nftSymbol = vm.envOr("GEBRID_NFT_SYMBOL", string("GAGENT"));

        require(admin != address(0), "GEBRID_ADMIN must be set");

        _startBroadcast();

        AgentNFT agentNft = new AgentNFT(nftName, nftSymbol, admin);
        ERC6551Registry registry = new ERC6551Registry();
        RiskEngine riskEngine = new RiskEngine(admin);
        AgentPermissions permissions =
            new AgentPermissions(IAgentNFT(address(agentNft)), IERC6551Registry(address(registry)), admin);
        AgentTBA accountImplementation =
            new AgentTBA(IAgentPermissions(address(permissions)), IRiskEngine(address(riskEngine)));

        // Closes the constructor cycle. Reverts on a second call, so the binding is permanent.
        permissions.setAccountImplementation(address(accountImplementation));

        vm.stopBroadcast();

        deployment = Deployment({
            agentNft: address(agentNft),
            registry: address(registry),
            riskEngine: address(riskEngine),
            permissions: address(permissions),
            accountImplementation: address(accountImplementation),
            admin: admin
        });

        _verifyWiring(deployment);
        _report(deployment);
    }

    /// @dev The deployer holds admin only if GEBRID_ADMIN says so. `setAccountImplementation` is
    ///      `onlyOwner`, and the owner is GEBRID_ADMIN, so the broadcasting key must be that
    ///      address. Checked here rather than discovered as a revert mid-broadcast.
    function _startBroadcast() private {
        uint256 privateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (privateKey != 0) {
            require(
                vm.addr(privateKey) == vm.envAddress("GEBRID_ADMIN"),
                "DEPLOYER_PRIVATE_KEY must correspond to GEBRID_ADMIN"
            );
            vm.startBroadcast(privateKey);
        } else {
            // Uses --account / --ledger / --sender supplied on the command line.
            vm.startBroadcast();
        }
    }

    /// @dev Post-deployment assertions. A deployment that does not satisfy these is not usable and
    ///      should fail loudly rather than be discovered later on-chain.
    function _verifyWiring(Deployment memory d) private view {
        require(
            AgentPermissions(d.permissions).accountImplementation() == d.accountImplementation,
            "account implementation not bound"
        );
        require(address(AgentPermissions(d.permissions).AGENT_NFT()) == d.agentNft, "permissions: wrong AgentNFT");
        require(address(AgentPermissions(d.permissions).REGISTRY()) == d.registry, "permissions: wrong registry");
        require(
            address(AgentTBA(payable(d.accountImplementation)).PERMISSIONS()) == d.permissions,
            "account: wrong permissions"
        );
        require(
            address(AgentTBA(payable(d.accountImplementation)).RISK_ENGINE()) == d.riskEngine,
            "account: wrong risk engine"
        );
        require(AgentNFT(d.agentNft).hasRole(0x00, d.admin), "nft: admin role missing");
        require(RiskEngine(d.riskEngine).hasRole(0x00, d.admin), "risk: admin role missing");
        require(AgentPermissions(d.permissions).owner() == d.admin, "permissions: wrong owner");
    }

    function _report(Deployment memory d) private view {
        console2.log("--- GEBRID enforcement core ---");
        console2.log("chainId              ", block.chainid);
        console2.log("admin                ", d.admin);
        console2.log("AgentNFT             ", d.agentNft);
        console2.log("ERC6551Registry      ", d.registry);
        console2.log("RiskEngine           ", d.riskEngine);
        console2.log("AgentPermissions     ", d.permissions);
        console2.log("AgentTBA (impl)      ", d.accountImplementation);
        console2.log("");
        console2.log("Record these in DEPLOYMENTS.md together with the commit hash.");
    }
}
