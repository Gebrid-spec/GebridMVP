# ROADMAP — Phases 0–3

Tracker for every exit checkbox in `docs/MASTER-PROMPT.md`. Updated by each working block.

**Last updated:** 2026-08-01 — phase 0.1, queue 0.1, **step 1 complete** (enforcement core),
plus the three owner decisions of 2026-08-01 applied (ADR-0002 reversed, ADR-0004 added, licence held
at `UNLICENSED`).

---

## Phase 0 — entry ticket

### 0.1 Contract stack

#### Step 1 — enforcement core (families IV, V, XI) ✅ COMPLETE

| Item | Status |
| --- | --- |
| AgentNFT (ERC-721 + 4906 + 2981) | ✅ `contracts/src/core/AgentNFT.sol` |
| ERC-6551 AccountRegistry | ✅ `contracts/src/core/ERC6551Registry.sol` |
| AgentTBA | ✅ `contracts/src/core/AgentTBA.sol` |
| AgentPermissions (EIP-712 + ERC-1271) | ✅ `contracts/src/core/AgentPermissions.sol` |
| RiskEngine (composite scoring, contract-level BLOCK, anti-downgrade TADE, NORMAL/RESTRICTED/CRISIS) | ✅ `contracts/src/core/RiskEngine.sol` |
| solc 0.8.24, zero errors and warnings | ✅ `deny = "warnings"`, verified to actually fail the build. Toolchain pinned to forge v1.7.1 so the lint set cannot drift (gate check A7) |
| Foundry tests + adversarial scenarios | ✅ 127 tests: replay, downgrade, privilege expansion, signer substitution, re-entrancy, cross-chain, cross-provider reuse, non-conforming registry |
| Foundry invariants | ✅ 3 invariants over 32,768 calls |
| Fuzz ≥ 10k runs on money/rights functions | ✅ 11 fuzz properties at 10,000 runs each |
| Base Sepolia deploy scripts, keys from env | ✅ `contracts/script/DeployCore.s.sol`, itself tested; binds the canonical ERC-6551 registry and proves its conformance before use |
| Per-file self-audit report against gate v2 | ⚠️ Done against a **reconstructed** gate — see blocker B1 |
| Basescan verification | ⬜ Not deployed yet |

#### Step 2 — 4337 foundation (families I–III) ⬜ NOT STARTED

| Item | Status |
| --- | --- |
| ADR: staked entity / associated storage / own bundler (EIP-7562) | ⬜ Required before code |
| EntryPoint v0.7 address fixed in `DEPLOYMENTS.md` with source | ⬜ |
| `AgentTBA.validateUserOp` with attestation phase | ⬜ |
| SessionKeyManager (rotation, scope, auto-revoke on transfer/burn) | ⬜ |
| SwarmPaymaster (per-agent + aggregate budgets, peak tracking, suspension) | ⬜ |

#### Step 3 — ACL modules v1 ⬜ NOT STARTED · #### Step 4 — ACPAdapter (ERC-8183) ⬜ NOT STARTED

### 0.2 External audit ⬜ · 0.3 "prevented $X" metric ⬜

Design decision already taken and recorded: the metric aggregates `RiskEngine.RiskBlocked` events,
not failed executions, because the enforcement path reverts and would roll any event back
(ADR-0003). Honesty obligation under I-P5 is noted in the same ADR.

### 0.4 Phase 0 exit criteria

- [ ] Core + 4337 foundation on Base mainnet, verified
- [ ] External audit published, ≥ Medium closed
- [ ] `stats.gebrid.io` with verifiable metric and tx links
- [ ] Exhibit for the non-provisional: addresses, tx hashes, commits
- [ ] SDK-α: TypeScript client + ≤ 15-minute quickstart

## Phase 1 — MetaMask Snap ⬜ · Phase 2 — ecosystem hooks ⬜ · Phase 3 — formal BD ⬜

Not started. Exit criteria unchanged from `docs/MASTER-PROMPT.md`.

---

## Blockers

| ID | Blocker | Impact | Needs |
| --- | --- | --- | --- |
| **B1** | `GEBRID_SOLIDITY_SELF_AUDIT` v2 is not in the repository. It is the top-precedence document in the master prompt's hierarchy. | Step 1's self-audit was run against a checklist reconstructed from the master prompt's invariants (`docs/SELF-AUDIT-GATE-v2.md`). Findings are real, but the gate is not the authoritative one. | Owner to supply the v2 text. All five per-file reports must then be re-run. |
| **B2** | `GEBRID_Contracts_vs_FILED_Patent_v8.md` is not in the repository. | Claim-family mapping in the self-audit reports is inferred from the master prompt's queue (families IV, V, XI for step 1), not verified against the filed claims. Invariant I-P1 requires deployed code to confirm filed claims. | Owner to supply the patent map before mainnet. |
| **B3** | `AGENT_CONTINUITY_LAYER` v0.4.2 is not in the repository. | Blocks step 3 only. | Owner to supply before ACL work. |
| ~~B4~~ | ~~ADR-0002: own 6551 registry vs. canonical singleton.~~ | **CLOSED 2026-08-01.** Owner chose the canonical singleton; ADR-0002 rewritten, `DeployCore` binds and verifies it. | — |
| ~~B5~~ | ~~SPDX licence `BUSL-1.1` with no `LICENSE` file.~~ | **CLOSED 2026-08-01** as a blocker: source is now `UNLICENSED` with a `LICENSE` file stating all rights reserved. The *final* licence choice remains open for counsel — tracked in `DEPLOYMENTS.md`, not blocking. | — |
| **B6** | Repository is public while the patent track is open. ACL (XVI) is not filed, and the claim status of families VIII–XII cannot be checked here (see B2). | No ACL code exists in this repository, so no ACL disclosure has occurred. The enforcement core (IV, V, XI) is published. Whether that is safe depends on the filing status, which B2 blocks verifying. | Owner decision; counsel. Owner has elected to stay public for now. |

## Risks

| Risk | Note |
| --- | --- |
| `GEBRID_ADMIN` as an EOA | Mitigated in code (ADR-0004): admin cannot be granted directly and handover is begin/accept with a delay. Still must be a multisig on mainnet, with roles split — table in `DEPLOYMENTS.md`. |
| Attester compromise | Bounded: a rogue attester can inflate risk but not clear it, and BLOCK is capped at 7 days. Cannot be waived early, by design (ADR-0003). |
| No `validateUserOp` yet | Until step 2, AgentTBA is **not** a 4337 account and must not be described as one in any material (I-P1). |
