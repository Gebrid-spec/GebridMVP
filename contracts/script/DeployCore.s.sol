// SPDX-License-Identifier: UNLICENSED
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
import {ERC6551Bytecode} from "../src/libraries/ERC6551Bytecode.sol";

/// @title DeployCore
/// @notice Deploys the phase 0.1.1 enforcement core and closes the one post-deployment wiring step.
///
/// @dev Secrets come from the environment only; nothing sensitive is committed (invariant I-P6).
///      Two signing modes:
///        - hardware / keystore (preferred):  forge script ... --account gebrid-deployer --sender 0x...
///        - raw key (testnet only):           DEPLOYER_PRIVATE_KEY=0x... forge script ...
///
///      Base Sepolia:
///        forge script script/DeployCore.s.sol:DeployCore \
///          --rpc-url base_sepolia --broadcast --verify -vvvv
///
///      **Registry selection (ADR-0002).** By default the canonical ERC-6551 singleton is used, so
///      GEBRID agent accounts are visible to every 6551-aware wallet, indexer and explorer. That
///      address is not taken on trust: `_requireConformingRegistry` re-derives a probe account from
///      the ERC's own creation code and compares it with what the registry reports. A non-conforming
///      or absent registry aborts the deployment instead of silently producing agents nobody else
///      can read. `GEBRID_DEPLOY_OWN_REGISTRY=true` falls back to our own instance for chains (or
///      anvil) that have no singleton.
///
///      **Structure.** `run()` is the env-driven entry point. All the actual deployment logic lives
///      behind `deployWithConfig`, which takes an explicit `Config` and reads no environment at all.
///      Tests drive that one: `vm.setEnv` writes the real process environment and is never rolled
///      back between tests, so a suite that varies configuration through env variables races with
///      itself.
contract DeployCore is Script {
    /// @notice Canonical ERC-6551 registry, per the ERC. Same address on every chain that has it.
    /// @dev Never assumed to be present or conforming — proved at run time.
    address public constant CANONICAL_ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    /// @dev Default delay on a DEFAULT_ADMIN_ROLE handover. Overridable via env for testnets.
    uint48 public constant DEFAULT_ADMIN_TRANSFER_DELAY = 3 days;

    struct Config {
        address admin;
        string nftName;
        string nftSymbol;
        uint48 adminTransferDelay;
        /// @dev Deploy our own registry instead of binding an existing one.
        bool deployOwnRegistry;
        /// @dev Registry to bind when `deployOwnRegistry` is false. Zero means the canonical one.
        address registryOverride;
    }

    struct Deployment {
        address agentNft;
        address registry;
        bool registryIsCanonical;
        address riskEngine;
        address permissions;
        address accountImplementation;
        address admin;
        uint48 adminTransferDelay;
    }

    // --------------------------------------------------------------------------------------
    // Entry points
    // --------------------------------------------------------------------------------------

    /// @notice Env-driven entry point used by `forge script`.
    function run() external returns (Deployment memory deployment) {
        Config memory config = _configFromEnv();

        uint256 privateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        requireDeployerMatchesAdmin(privateKey, config.admin);
        if (privateKey != 0) {
            vm.startBroadcast(privateKey);
        } else {
            // Uses --account / --ledger / --sender supplied on the command line.
            vm.startBroadcast();
        }

        deployment = _deploy(config);

        vm.stopBroadcast();

        _verifyWiring(deployment);
        _report(deployment);
    }

    /// @notice Deployment with explicit configuration and no environment access.
    /// @dev The entry point tests use. Does not broadcast; callers that need a broadcast should use
    ///      `run()` or wrap this in their own `startBroadcast`.
    function deployWithConfig(Config memory config) public returns (Deployment memory deployment) {
        deployment = _deploy(config);
        _verifyWiring(deployment);
    }

    /// @notice Reverts unless `privateKey` belongs to `expectedAdmin`.
    /// @dev A mismatched key would deploy the whole stack under the wrong address and hand admin
    ///      to someone else. Checked up front rather than discovered afterwards.
    ///      Exposed as a function so it is testable without mutating process-global environment.
    function requireDeployerMatchesAdmin(uint256 privateKey, address expectedAdmin) public pure {
        if (privateKey == 0) return; // keystore / hardware path; --sender is checked by forge
        require(vm.addr(privateKey) == expectedAdmin, "DEPLOYER_PRIVATE_KEY must correspond to GEBRID_ADMIN");
    }

    // --------------------------------------------------------------------------------------
    // Deployment
    // --------------------------------------------------------------------------------------

    function _configFromEnv() private view returns (Config memory config) {
        config.admin = vm.envAddress("GEBRID_ADMIN");
        require(config.admin != address(0), "GEBRID_ADMIN must be set");

        config.nftName = vm.envOr("GEBRID_NFT_NAME", string("GEBRID Agent"));
        config.nftSymbol = vm.envOr("GEBRID_NFT_SYMBOL", string("GAGENT"));
        config.adminTransferDelay =
            uint48(vm.envOr("GEBRID_ADMIN_TRANSFER_DELAY", uint256(DEFAULT_ADMIN_TRANSFER_DELAY)));
        config.deployOwnRegistry = vm.envOr("GEBRID_DEPLOY_OWN_REGISTRY", false);
        config.registryOverride = vm.envOr("GEBRID_ERC6551_REGISTRY", address(0));
    }

    function _deploy(Config memory config) private returns (Deployment memory deployment) {
        require(config.admin != address(0), "admin must be set");

        (address registry, bool isCanonical) = _selectRegistry(config);

        AgentNFT agentNft = new AgentNFT(config.nftName, config.nftSymbol, config.admin, config.adminTransferDelay);
        RiskEngine riskEngine = new RiskEngine(config.admin, config.adminTransferDelay);
        AgentPermissions permissions = new AgentPermissions(IAgentNFT(address(agentNft)), IERC6551Registry(registry));
        AgentTBA accountImplementation =
            new AgentTBA(IAgentPermissions(address(permissions)), IRiskEngine(address(riskEngine)));

        // Closes the constructor cycle. Reverts on a second call, so the binding is permanent.
        permissions.setAccountImplementation(address(accountImplementation));

        deployment = Deployment({
            agentNft: address(agentNft),
            registry: registry,
            registryIsCanonical: isCanonical,
            riskEngine: address(riskEngine),
            permissions: address(permissions),
            accountImplementation: address(accountImplementation),
            admin: config.admin,
            adminTransferDelay: config.adminTransferDelay
        });
    }

    // --------------------------------------------------------------------------------------
    // Registry selection
    // --------------------------------------------------------------------------------------

    /// @dev Returns the registry to bind, having proved it behaves as ERC-6551 requires.
    function _selectRegistry(Config memory config) private returns (address registry, bool isCanonical) {
        if (config.deployOwnRegistry) {
            registry = address(new ERC6551Registry());
            _requireConformingRegistry(registry);
            return (registry, false);
        }

        registry = config.registryOverride == address(0) ? CANONICAL_ERC6551_REGISTRY : config.registryOverride;
        require(
            registry.code.length != 0,
            "No ERC-6551 registry at the configured address on this chain. "
            "Set GEBRID_ERC6551_REGISTRY, or GEBRID_DEPLOY_OWN_REGISTRY=true to deploy one."
        );
        _requireConformingRegistry(registry);
        return (registry, registry == CANONICAL_ERC6551_REGISTRY);
    }

    /// @dev Proves the registry derives account addresses exactly as the ERC specifies, by
    ///      re-deriving a probe address independently and comparing. A pure view check: it deploys
    ///      nothing and costs no gas beyond the call.
    ///
    ///      Deliberately not a hardcoded code hash for the canonical singleton. Such a constant can
    ///      only be validated by looking it up on-chain, which the deployment cannot do for itself.
    ///      A behavioural check verifies the property that actually matters: that the accounts this
    ///      registry produces sit where every other 6551 tool computes them.
    function _requireConformingRegistry(address registry) private view {
        address probeImplementation = address(uint160(uint256(keccak256("GEBRID.registry.probe.impl"))));
        address probeToken = address(uint160(uint256(keccak256("GEBRID.registry.probe.token"))));
        bytes32 probeSalt = keccak256("GEBRID.registry.probe.salt");
        uint256 probeTokenId = 6551;

        address expected = ERC6551Bytecode.computeAccount(
            registry, probeImplementation, probeSalt, block.chainid, probeToken, probeTokenId
        );
        address reported =
            IERC6551Registry(registry).account(probeImplementation, probeSalt, block.chainid, probeToken, probeTokenId);

        require(
            expected == reported, "Registry does not derive ERC-6551 account addresses per spec; refusing to bind it."
        );
    }

    // --------------------------------------------------------------------------------------
    // Verification and reporting
    // --------------------------------------------------------------------------------------

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
        require(AgentNFT(d.agentNft).defaultAdmin() == d.admin, "nft: wrong default admin");
        require(RiskEngine(d.riskEngine).defaultAdmin() == d.admin, "risk: wrong default admin");
        // AgentPermissions has no owner by design: its only privilege was the write-once
        // binding above, which this deployment has just consumed.
        require(AgentPermissions(d.permissions).DEPLOYER() == address(this), "permissions: unexpected deployer");
    }

    function _report(Deployment memory d) private pure {
        console2.log("--- GEBRID enforcement core ---");
        console2.log("admin                ", d.admin);
        console2.log("admin xfer delay (s) ", d.adminTransferDelay);
        console2.log("ERC6551Registry      ", d.registry);
        console2.log("  canonical singleton", d.registryIsCanonical);
        console2.log("AgentNFT             ", d.agentNft);
        console2.log("RiskEngine           ", d.riskEngine);
        console2.log("AgentPermissions     ", d.permissions);
        console2.log("AgentTBA (impl)      ", d.accountImplementation);
        console2.log("");
        if (!d.registryIsCanonical) {
            console2.log("WARNING: not the canonical ERC-6551 registry. Agent accounts will not be");
            console2.log("discoverable by third-party 6551 indexers. See ADR-0002.");
            console2.log("");
        }
        console2.log("Next: split roles per DEPLOYMENTS.md, then record addresses + commit hash there.");
    }
}
