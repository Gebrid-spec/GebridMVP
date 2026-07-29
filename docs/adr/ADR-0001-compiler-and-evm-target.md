# ADR-0001 — Compiler pin, EVM target, and `via_ir`

**Status:** Accepted · **Date:** 2026-07-28 · **Phase:** 0.1, queue 0.1, step 1

## Context

The master prompt fixes Solidity ^0.8.24 and Foundry, and requires compilation "without errors and
warnings". Phase 2 additionally targets Linea and BNB Chain with the same core contracts, so the
artifact's EVM assumptions have to hold on more than Base.

## Decisions

**1. `solc` pinned to exactly 0.8.24.** Not `^0.8.24`. A floating pragma means the bytecode that
gets audited is not necessarily the bytecode that gets deployed. Pinned in both the source pragma
and `foundry.toml`.

**2. `evm_version = "shanghai"`, not `cancun`.** Base has supported Cancun since Ecotone, so
`cancun` would work today on the phase 0 target. It is rejected anyway: under `cancun`, solc 0.8.24
emits `MCOPY` for memory copies, and `MCOPY` is not available on every chain in the phase 2 list.
Compiling for `shanghai` keeps `PUSH0` (supported on Base, Linea and BNB) while keeping `MCOPY` out
of the bytecode, so the *same* artifact can be deployed across all three networks without a
recompile — which matters because §2.3 requires cross-chain consistency and `DEPLOYMENTS.md`
records one version per address.

Consequence: no transient storage (`TSTORE`/`TLOAD`). Nothing in the core needs it — see the
re-entrancy analysis in `docs/self-audit/AgentTBA.md`, which resolves re-entrancy by ordering and
identity rather than by a transient-storage guard.

**3. `via_ir = false`.** The IR pipeline is slower and produces bytecode that is harder to review
against the source, which matters for an external audit. Two `stack too deep` errors were hit and
resolved in source instead:

- `AgentPermissions._hashPermissionSet` splits its `abi.encode` into two halves and concatenates.
  Every field is a static 32-byte word, so the result is bit-identical to a single `abi.encode` —
  a compilation workaround, not an encoding change.
- `AgentPermissions._emitGrantIssued` exists purely to assemble nine event arguments in a shallow
  frame.

Both are commented at the site. If a future contract cannot be expressed without `via_ir`, that is
a decision to revisit here, not to make silently in `foundry.toml`.

**4. `optimizer = true`, `runs = 200`.** Standard. These contracts are called far more often than
they are deployed, but AgentTBA is deployed once and proxied, so a high `runs` value would buy
little. Pinned because it changes bytecode and therefore verification.

**5. Warnings are build failures.** `deny = "warnings"` in `foundry.toml`. This covers both solc
warnings and `forge lint`. Verified to actually fail the build, not merely be configured: a
deliberate unused-parameter warning was introduced and confirmed to break `forge build` before the
real code was written.

`forge lint` *notes* (as opposed to warnings) do not fail the build. Four `asm-keccak256` notes are
outstanding, suggesting inline-assembly hashing for gas. Not acted on: readable hashing is worth
more than the gas at this stage, and hand-written keccak assembly is a well-known source of
preimage bugs in exactly the code where a preimage bug is most expensive. Recorded as DEV-01 in the
gate's deviations register.

## Consequences

- Any chain added later must support `PUSH0`, or the core needs a `paris` rebuild and a separate
  `DEPLOYMENTS.md` version row.
- Upgrading `solc` is a deliberate act requiring a re-audit, not a lockfile refresh.
