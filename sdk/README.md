# sdk/

TypeScript client for the GEBRID control plane.

**Not started.** This is a phase 0.4 exit criterion: create an agent, set permissions, run an
intent through the RiskEngine, read an attestation, with a quickstart of 15 minutes or less.

Three things in the contracts need matching helpers here, and each is easy to get wrong by hand:

- **Canonical permission leaves.** Use `AgentPermissions.leafOf(target, selector)` and build the
  root exactly as `CanonicalMerkle.root` does — strictly increasing leaves, `0x00` prefix for
  leaves and `0x01` for internal nodes. See `docs/self-audit/CanonicalMerkle.md`.
- **EIP-712 grant signing.** The 14-field `PermissionSet` type hash, with the domain
  `("GEBRID.AgentPermissions", "1", chainId, verifyingContract)`. `grantIdOf(p)` returns the exact
  digest to sign.
- **Severity packing.** Eight `uint8` severities (0..100), vector `i` at byte `i` of a `uint64`.
