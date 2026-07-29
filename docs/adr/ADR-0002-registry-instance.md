# ADR-0002 — Own ERC-6551 registry instance rather than the canonical singleton

**Status:** Accepted, revisit before mainnet · **Date:** 2026-07-28 · **Phase:** 0.1, queue 0.1, step 1

## Context

ERC-6551 has a canonical registry deployed at `0x000000006551c19487814612e58FE06813775758` on many
chains. The master prompt's queue lists "ERC-6551 AccountRegistry" as part of the GEBRID contract
stack, which is ambiguous between deploying one and pointing at the canonical one.

CREATE2 mixes the deployer address into the derived address. So the same
`(implementation, salt, chainId, tokenContract, tokenId)` tuple resolves to a **different** account
address depending on which registry created it. This is not a detail that can be papered over
later: agent account addresses are identity, and they are baked into every permission grant.

## Decision

Deploy `contracts/src/core/ERC6551Registry.sol` as a GEBRID-owned instance, with account runtime
bytecode **byte-identical** to the layout fixed by the ERC.

The bytecode identity is the part that matters for the ecosystem: any 6551-aware wallet, indexer or
marketplace that reads an account's footer gets the correct `(chainId, tokenContract, tokenId)`,
because the footer layout is the ERC's. This is pinned by
`test_DeployedBytecodeMatchesERC6551Layout`, which compares the deployed runtime byte-for-byte and
asserts a length of exactly 173 bytes, and by `testFuzz_FooterRoundTrip` over 10,000 random tuples.

What is *not* shared is address derivation. An address computed against the canonical singleton
will not match one computed against this registry.

## Why not the singleton

1. **`AgentPermissions` re-derives account addresses** from `(registry, implementation, salt,
   AgentNFT, tokenId)` to reject impostor accounts (finding F-PERM-2). That check needs a registry
   address it can hold as an immutable and reason about. Using the singleton is compatible with
   this — it would simply be the immutable's value — so this is a reason to keep the derivation
   check, not by itself a reason to self-deploy.
2. **Deployment independence.** Phase 2 puts the core on Linea and BNB. Relying on the singleton
   being present, at the same address, with the same bytecode, on every future target chain adds a
   per-chain precondition to the deployment runbook. Self-deploying removes it.
3. **Phase 0 has no counterfactual-address dependency on third-party tooling.** Nothing in queue
   0.1 needs an address that an external 6551 explorer predicted independently.

## Consequences and the cost of switching

- GEBRID agent accounts will not appear in third-party 6551 explorers that only index the canonical
  registry. They are still readable — the accounts self-describe correctly — but they will not be
  discovered by registry-event indexing.
- Switching to the singleton later is **not** a migration: it changes every agent account address,
  which invalidates every issued permission grant and orphans any assets already held. It is only
  cheap before the first mainnet mint.

**Therefore this is flagged as an owner decision before the Base mainnet deployment**, not after.
The change itself is small (pass the singleton's address to `AgentPermissions` and skip deploying
our registry); the cost of deferring the decision past first mint is not.

## Alternatives considered

- **Deploy our registry deterministically so it lands on the canonical address.** Not possible: the
  canonical address is the product of a specific deployment whose bytecode is the reference
  registry's, and reproducing it means deploying the reference registry, i.e. option "use the
  singleton" with extra steps.
- **Support both, selected per deployment.** Rejected for phase 0: two derivation paths in
  `AgentPermissions` doubles the surface of the impostor-account check for no present benefit.
  Trivial to add later, since the registry is already an immutable constructor argument.
