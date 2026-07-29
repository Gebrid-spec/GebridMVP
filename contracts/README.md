# contracts/

Foundry project for the GEBRID enforcement core. Solidity 0.8.24, EVM target `shanghai`
(ADR-0001).

```
src/core/         AgentNFT, ERC6551Registry, AgentTBA, AgentPermissions, RiskEngine
src/interfaces/   ERC-6551 interfaces (kept in-tree so the account layout is auditable in one place)
src/libraries/    CanonicalMerkle — domain-separated, canonical permission-set commitments
test/             Unit + adversarial tests; test/invariant/ holds the stateful invariants
script/           DeployCore.s.sol — Base Sepolia and mainnet, keys from env only
```

## Running

```bash
forge build          # `deny = "warnings"`: any warning fails the build
forge test           # fuzz properties run 10,000 cases each
FOUNDRY_PROFILE=lite forge test   # 256 fuzz runs — local iteration only, never a gate run
```

## Test-harness notes

Two Foundry behaviours cost real debugging time here and are worth knowing before adding tests:

1. **An external call in argument position consumes a pending `vm.prank`, and satisfies a pending
   `vm.expectRevert`.** `vm.prank(x); vm.expectRevert(abi.encodeWithSelector(E.selector, c.role()))`
   does not do what it looks like. Hoist every contract read into a local first.
2. **`vm.setEnv` writes the real process environment and is never rolled back.** `setUp` state is
   snapshotted, but environment variables are not, so a test that changes one must restore it —
   see `test/DeployCore.t.sol`.

## Deploying

See `DEPLOYMENTS.md` at the repository root for the procedure and the open items that gate a
mainnet deployment. Secrets: `.env.example` here, names registered in `SECRETS-REGISTRY.md`.
