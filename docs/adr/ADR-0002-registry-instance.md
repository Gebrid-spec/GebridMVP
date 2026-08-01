# ADR-0002 — Bind the canonical ERC-6551 registry

**Status:** Accepted (supersedes the original decision in this ADR) · **Date:** 2026-08-01
**Phase:** 0.1, queue 0.1, step 1

> **Revision note.** The first version of this ADR chose a GEBRID-owned registry instance. That
> decision has been **reversed** by the owner after review. The reasoning that led to it is kept
> below, including where it was weak, because the reversal is more useful with the original
> argument visible than without it.

## Context

ERC-6551 has a canonical registry at `0x000000006551c19487814612e58FE06813775758`, deployed at the
same address on every chain that has it.

CREATE2 mixes the deployer address into the derived address. The same
`(implementation, salt, chainId, tokenContract, tokenId)` tuple therefore resolves to a **different**
account address depending on which registry created it. This is not a detail that can be corrected
later: agent account addresses are identity, and they are baked into every permission grant.

## Decision

**Bind the canonical singleton.** `DeployCore` defaults to it. Our own `ERC6551Registry` stays in
the tree for local and CI testing, and as an explicit fallback
(`GEBRID_DEPLOY_OWN_REGISTRY=true`) for any chain that genuinely lacks the singleton.

### The address is not taken on trust

The deployment does not assume the singleton is present, or that whatever sits at that address
behaves correctly. `DeployCore._requireConformingRegistry` re-derives a probe account address from
the ERC's own creation code (`ERC6551Bytecode.computeAccount`) and compares it with what the
registry's `account()` view returns. A mismatch aborts the deployment.

A hardcoded code hash was considered and rejected: such a constant can only be validated by looking
it up on-chain, which the deployment cannot do for itself, so it would encode an assumption rather
than check one. The behavioural check verifies the property that actually matters — that accounts
produced by this registry sit where every other 6551 tool computes them.

Covered by `test_DefaultsToTheCanonicalRegistry`, `test_RevertWhen_CanonicalRegistryIsAbsent`, and
`test_Adversarial_NonConformingRegistryAtCanonicalAddressAborts`, which etches a look-alike
answering `account(...)` with a plausible but wrong address.

## Why the original decision was wrong

The first version argued for a private registry on three grounds. Two do not hold up.

1. **"The singleton adds a per-chain precondition."** Weaker than it was presented. The singleton is
   deployed at the same address on Base, Linea and BNB — the three networks in the phase 2 plan —
   so it *helps* the cross-chain consistency requirement of §2.3 rather than complicating it. And
   the precondition it does add is now a checked, fail-loud one rather than an assumption.

2. **"`AgentPermissions` needs a registry address it can hold as an immutable."** True, and equally
   satisfied by the singleton's address. This was a reason to keep the impostor-account derivation
   check, not a reason to self-deploy.

3. **"Phase 0 has no counterfactual-address dependency on third-party tooling."** Accurate but
   short-sighted: it optimises for phase 0 at the cost of phases 1–3.

What outweighs all of them: the entire negotiating position of phases 1–3 is *"GEBRID is already
inside the ecosystem."* Agents invisible to every 6551 explorer, wallet and indexer undercut that
argument directly, and the cost is paid at exactly the moment the argument is being made.

## Consequences

- GEBRID agent accounts are discoverable by any 6551-aware tooling, including through
  registry-event indexing.
- The deployment depends on a contract we do not control. Acceptable: it is non-upgradeable, has no
  admin, holds no funds, and is the most widely used implementation of the standard. Conformance is
  re-proved at every deployment rather than assumed once.
- On a chain without the singleton, the deployment stops rather than silently producing
  non-discoverable agents. Overriding requires an explicit flag, and the resulting deployment is
  reported and recorded as non-canonical.
- **This remains cheap to change only until the first mainnet mint.** After that, switching
  registries changes every agent account address, invalidating every issued grant and orphaning any
  assets held.

## Alternatives considered

- **Deploy our registry deterministically onto the canonical address.** Not possible: that address
  is the product of a specific deployment of the reference registry's bytecode. Reproducing it means
  deploying the reference registry, which is this decision with extra steps.
- **Support both, selected per deployment.** This is what shipped, but with the canonical one as the
  default rather than as an equal option. The fallback exists for chains that lack the singleton,
  not as a standing choice.
