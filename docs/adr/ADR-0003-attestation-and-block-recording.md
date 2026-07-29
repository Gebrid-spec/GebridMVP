# ADR-0003 — Role-gated attestations, and why blocks are recorded at attestation time

**Status:** Accepted · **Date:** 2026-07-28 · **Phase:** 0.1, queue 0.1, step 1

## Context

Two questions had to be answered before `RiskEngine` could be written:

1. How does risk evidence get on-chain — signed attestations relayed by anyone, or direct
   submission by a role-holder?
2. Where does the durable record of a *prevented* loss come from? Master prompt §0.3 requires a
   verifiable "prevented $X" metric where every figure is clickable through to a transaction hash.

## Decision 1 — attestations are role-gated, submitted directly

`submitAttestation` requires `ATTESTER_ROLE` and records `msg.sender` as the attester.

Rejected alternative: EIP-712-signed attestations that any relayer can submit. That is the more
flexible design and will probably be needed eventually for gasless submission, but it introduces a
whole replay surface — an attestation domain, a nonce space, expiry-vs-nonce interaction, and the
cross-provider reuse question the master prompt calls out in §0.1 — for a capability phase 0 does
not need. Role-gating removes that surface entirely: there is no attestation signature to replay.

Cross-subject reuse is still handled, because it is a property of the subject derivation rather
than of the transport. Subjects are `keccak256(abi.encode(TAG, chainId, address(this), ...))` with
distinct tags for agent-level and intent-level subjects, so an attestation for agent A cannot cover
agent B, an intent attestation cannot double as an agent-level one, and nothing replays across
chains or deployments. Proved by `test_Adversarial_AttestationDoesNotLeakAcrossSubjects` and
`test_SubjectsAreChainSeparated`.

If signed attestations are added later, the C-series checks in the self-audit gate must be re-run
for the new path; this ADR should be superseded rather than amended.

## Decision 2 — the verdict is derived on-chain, not asserted by the attester

An attestation carries eight per-vector severities. The contract computes the weighted composite
score and derives CLEAR / WARN / BLOCK itself, and a mandatory vector at maximum severity forces
BLOCK regardless of the weighting.

This bounds what a compromised attester can do: it can inflate risk, but it cannot submit a
drainer's severities and have the result come out "clear".
`test_MandatoryVectorForcesBlockRegardlessOfWeights` demonstrates this by zeroing every weight
except an irrelevant vector — the sanctions hit scores zero and still blocks.

## Decision 3 — blocks are recorded when the attestation is stored, not when execution is refused

This is the consequential one.

`RiskEngine.enforceIntent` is a `view` that reverts. That is the right shape for enforcement — a
blocked intent must not execute, and a view cannot be tricked into mutating state. But it means
**any event emitted on the blocked path is rolled back with the transaction**. A naive design that
emits `Blocked(agent, target, value)` inside `enforceIntent` produces a metric that can never be
indexed, because the event never lands in a block. The failure is silent at development time and
only surfaces when someone tries to build `stats.gebrid.io`.

So the durable record is `RiskBlocked(subject, attester, valueAtRisk, score, severities)`, emitted
by `submitAttestation` at the moment a BLOCK verdict is stored. That transaction succeeds, so the
event persists and is clickable through to a tx hash as §0.3 requires.

**Consequence for the indexer (phase 0.3):** aggregate `RiskBlocked` events, not failed
executions. `valueAtRisk` is supplied by the attester and is the figure the metric reports.

**Consequence for honesty (invariant I-P5):** `RiskBlocked` records that a block was *placed* and
what value was at risk, which is not the same as proving an attack was attempted and stopped. Any
public figure derived from it must be labelled accordingly and must not be presented as "losses
prevented" without stating the methodology. This is a reporting obligation, and it is recorded here
so it is not discovered at dashboard-writing time.

## Decision 4 — no early-unblock function

There is no way to clear or shorten a live BLOCK. An `unblock` for false positives is a downgrade
route with extra steps: whoever holds it can lift any block, which is exactly the capability the
anti-downgrade rule exists to deny.

The liveness counterweight is that BLOCK is time-bounded. `maxValidity` is configurable but
hard-capped by the constant `HARD_MAX_VALIDITY = 7 days`, so the worst a compromised attester can
inflict on one agent is a bounded denial of service rather than a permanent brick
(`test_ValidityCannotExceedHardMax`).

Operationally this means a false-positive BLOCK is waited out, not waived. That is a real cost and
it is the intended trade.
