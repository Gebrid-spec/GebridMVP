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

## Toolchain

Pinned, and it has to be. `deny = "warnings"` makes `forge lint` part of the build contract, and
the lint rule set changes between forge releases — 1.7.1 added `block-timestamp` and turned an
unchanged repository red. Use the same version CI uses:

```bash
foundryup --install v1.7.1          # must match FOUNDRY_VERSION in .github/workflows/contracts.yml
```

solc 0.8.24 is pinned in `foundry.toml` and fetched automatically.

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
   snapshotted, but environment variables are not — and forge runs tests within a contract
   concurrently, so restoring the variable at the end of a test does not fix it either. Vary
   configuration through an explicit struct instead; see `test/DeployCore.t.sol`.

## Deploying

See `DEPLOYMENTS.md` at the repository root for the procedure and the open items that gate a
mainnet deployment. Secrets: `.env.example` here, names registered in `SECRETS-REGISTRY.md`.
