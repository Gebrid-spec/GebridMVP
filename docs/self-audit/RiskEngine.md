# Self-audit — `contracts/src/core/RiskEngine.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Claim family: XI (composite scoring, contract-level BLOCK, anti-downgrade TADE).
Tests: `contracts/test/RiskEngine.t.sol` — 23 tests, 2 fuzz properties at 10,000 runs each; plus
the enforcement-path tests in `contracts/test/AgentTBA.t.sol`.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1–A6 build | PASS | Zero warnings. Two truncating casts carry justification comments at the cast site (F7). |
| B1 authority | PASS | `submitAttestation` ATTESTER_ROLE; mode escalation GUARDIAN_ROLE; de-escalation DEFAULT_ADMIN_ROLE + cooldown; tuning CONFIG_ROLE. |
| B3 blast radius | ACCEPTED | DEV-03 — see below. Roles split per ADR-0004. |
| B5 two-step admin transfer | PASS | `AccessControlDefaultAdminRules`; `test_AdminRoleCannotBeGrantedDirectly`. |
| C8 unambiguous preimages | PASS | Subjects use `abi.encode`, never `encodePacked`. |
| E1 no verdict downgrade in window | PASS | `test_Adversarial_BlockCannotBeDowngradedToClear`, `test_Adversarial_BlockCannotBeDowngradedToWarn`. |
| E2 no window shortening | PASS | `test_Adversarial_BlockWindowCannotBeShortened`. |
| E3 no admin override | PASS (by construction) | There is no function that clears or shortens a live attestation. Not "restricted" — absent. |
| E4 BLOCK is time-bounded | PASS | `HARD_MAX_VALIDITY = 7 days` is a constant ceiling on the admin-configurable bound: `test_ValidityCannotExceedHardMax`. |
| E5 verdict derived on-chain | PASS | `test_MandatoryVectorForcesBlockRegardlessOfWeights`, `testFuzz_ScoreAndVerdictAreConsistent`. |
| E6 mandatory vectors non-disableable | PASS (by construction) | `addMandatoryVector` only ORs bits in; no clearing function exists — `test_MandatoryVectorsCanOnlyBeAdded`. |
| E7 asymmetric mode control | PASS | `test_EscalationIsImmediate_DeEscalationIsDelayed`. |
| E8 no owner bypass | PASS | `AgentTBA.t.sol::test_Adversarial_BlockAppliesToTheTokenHolderToo`. |
| E9 subject separation | PASS | `test_Adversarial_AttestationDoesNotLeakAcrossSubjects`, `test_SubjectsAreChainSeparated`. |
| E10 durable block record | PASS | `test_BlockEmitsDurableMetricEvent`. |
| F4 no unbounded loop | PASS | Fixed 8-iteration vector loop. |
| F7 truncating casts justified | PASS | Byte extraction and the `uint16` score, each with a comment proving the bound. |

## The two design decisions that carry this file

**1. The verdict is computed here, not asserted by the attester.**
An attestation carries eight per-vector severities (0–100). The contract multiplies them by
on-chain weights, normalises to basis points, and derives CLEAR / WARN / BLOCK itself. A
compromised attester can therefore *inflate* risk but cannot report a drainer's severities and
label the result "clear". `test_MandatoryVectorForcesBlockRegardlessOfWeights` makes the point
sharply: it zeroes every weight except one irrelevant vector, so a maxed-out sanctions hit scores
zero — and the contract still returns BLOCK, because a mandatory vector at full severity blocks
regardless of the weighting.

**2. Blocks are recorded at attestation time, because the enforcement path reverts.**
This is the finding that shaped the contract's shape. `enforceIntent` is a `view` that reverts.
Any event emitted on the blocked path would be rolled back with the transaction and could never
back a public "prevented $X" figure — the metric required by master prompt §0.3 would have been
unimplementable, and the mistake would only have surfaced when someone tried to index it. So the
durable record is `RiskBlocked`, emitted when the BLOCK attestation is *stored*, carrying
`valueAtRisk`. `test_BlockEmitsDurableMetricEvent` pins it. Indexers should aggregate
`RiskBlocked`, not attempt to observe reverted executions.

## Findings from this audit, and what changed

**F-RISK-1 — window shortening is a downgrade.**
The obvious anti-downgrade rule is "a BLOCK cannot be replaced by CLEAR or WARN in its validity
window". Implementing only that leaves the block trivially defeatable: re-attest at the *same*
BLOCK verdict with `validitySeconds = minValidity`, and the block that was meant to hold for
twelve hours now expires in five minutes. The severity ordering is respected the whole time. The
rule was extended: within the window, a re-attestation must be `verdict >= current`, **and** if the
verdict is equal, `expiresAt >= current.expiresAt`. `test_Adversarial_BlockWindowCannotBeShortened`
executes exactly this attack and then confirms the original block is still standing;
`test_BlockWindowCanBeExtended` confirms extension is still allowed.

**F-RISK-2 — no admin escape hatch, and the liveness cost is paid elsewhere.**
An `unblock` function for false positives is the natural next request, and it is a downgrade route
with extra steps: whoever holds it can lift any block. There is no such function. The liveness
counterweight is that BLOCK is time-bounded — `maxValidity` is admin-configurable but hard-capped
at `HARD_MAX_VALIDITY = 7 days`, so the worst a rogue attester can do to one agent is a bounded
denial of service, not a permanent brick. Recorded here so the trade-off is visible to an external
auditor rather than discovered.

**F-RISK-3 — anti-downgrade applied at the mode level too.**
Escalating NORMAL → RESTRICTED → CRISIS is immediate and available to any guardian. De-escalating
requires `DEFAULT_ADMIN_ROLE` *and* a cooldown since the last change. Without the cooldown, an
attacker who obtained the admin key could flip out of CRISIS the moment a guardian flipped into
it. `test_EscalationIsImmediate_DeEscalationIsDelayed`.

**F-RISK-4 — the fuzz test was testing almost nothing.**
`testFuzz_BlockSurvivesArbitraryResubmission` originally took a raw `uint64` severity word and
returned early if any byte exceeded 100. A random `uint64` has all eight bytes ≤ 100 with
probability `(101/256)^8` — about 6 runs in 10,000. Median gas of 831 gave it away. Both risk fuzz
tests now build well-formed severity words from `uint8[8]` input; median gas is ~138,000, i.e.
every run exercises the real path. Worth recording because a green fuzz test that never reaches
the code under test is worse than no test.

**F-RISK-5 — verdict enum ordering is load-bearing.**
`NONE < CLEAR < WARN < BLOCK` is what lets the anti-downgrade rule be written as a comparison.
Reordering the enum would silently invert it. Noted in the source.

**F-RISK-6 — score bound proof.** `weighted ≤ MAX_SEVERITY (100) × SCORE_SCALE (10,000)` =
1,000,000, so `weighted / 100 ≤ 10,000`, which fits `uint16`. The weight sum is forced to
`SCORE_SCALE` by both the constructor and `setWeights`, so the bound cannot be broken by
configuration: `test_RevertWhen_WeightsDoNotSumToScale`.

## Adversarial tests

| Class | Scenario | Test |
| --- | --- | --- |
| TADE downgrade | BLOCK → CLEAR in window | `test_Adversarial_BlockCannotBeDowngradedToClear` |
| TADE downgrade | BLOCK → WARN in window | `test_Adversarial_BlockCannotBeDowngradedToWarn` |
| TADE downgrade | BLOCK → BLOCK with an earlier expiry | `test_Adversarial_BlockWindowCannotBeShortened` |
| TADE downgrade | Arbitrary re-attestation sequences while a BLOCK is live | `testFuzz_BlockSurvivesArbitraryResubmission` (10,000 runs) |
| Attestation reuse | Agent-level attestation reused as intent-level, or across agents | `test_Adversarial_AttestationDoesNotLeakAcrossSubjects` |
| Attestation reuse | Same tuple on another chain | `test_SubjectsAreChainSeparated` |
| Rogue attester | Report severities, claim a lenient verdict | `test_MandatoryVectorForcesBlockRegardlessOfWeights` |
| Rogue attester | Submit without the role | `test_RevertWhen_NonAttesterSubmits` |
| Owner bypass | Token holder executes a blocked intent | `AgentTBA.t.sol::test_Adversarial_BlockAppliesToTheTokenHolderToo` |
| Mode | Non-guardian escalates | `test_RevertWhen_NonGuardianEscalates` |
| Mode | Premature de-escalation | `test_EscalationIsImmediate_DeEscalationIsDelayed` |
| Denylist | Denylisted target with a live CLEAR attestation | `test_DenylistBlocksRegardlessOfAttestation` |

## Revision — 2026-08-01

`AccessControl` replaced with `AccessControlDefaultAdminRules` (ADR-0004): `DEFAULT_ADMIN_ROLE`
cannot be granted directly, and a handover is begin/accept with a delay. Constructor gained
`adminTransferDelay`.

More consequential than the mechanism is what it makes explicit about the role split. Because the
enforcement design is asymmetric — GUARDIAN can only *escalate* the mode, ATTESTER can only *raise*
severities, and no role can weaken a stored attestation — a compromise of either of those two keys
produces a denial of service, not a theft. That is what makes it acceptable to hold them as hot
service keys, and it is why the split matters at least as much as the multisig. `DEPLOYMENTS.md`
now requires the split before mainnet use rather than leaving all four roles on the deploying
address.

## Known limitations

- **Attestations are role-gated, not signature-gated.** Attesters submit directly, so there is no
  attestation-signature replay surface at all. If off-chain-signed attestations are needed later
  (gasless submission), that adds an EIP-712 domain and a nonce space, and the C-series checks
  would need re-running.
- **`checkIntent` uses `try this.enforceIntent(...)`.** A self-`staticcall` — correct and read-only,
  but slightly more gas than a duplicated internal path. Chosen so the non-reverting SDK view can
  never disagree with the enforcing one.
- **DEV-03:** `CONFIG_ROLE` can retune weights and thresholds, changing which severity vectors
  produce a BLOCK going forward. It cannot retroactively downgrade a stored attestation, cannot
  disable a mandatory vector, and every change emits an event. On mainnet this role should sit
  behind a timelock; recorded as a deployment requirement in `DEPLOYMENTS.md`.
- **Attester quality is out of scope for the contract.** The engine bounds what a compromised
  attester can do; it does not judge whether the severities are true. That is the off-chain
  scoring service, phase 0.3.
