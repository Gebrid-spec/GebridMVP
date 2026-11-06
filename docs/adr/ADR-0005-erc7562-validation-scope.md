# ADR-0005 — ERC-7562 compliance: where each enforcement check is allowed to live

**Status:** Proposed — requires owner decision before step 2 code
**Date:** 2026-11-06 · **Phase:** 0.1, queue 0.1, step 2 (4337 foundation, families I–III)

Required by `docs/MASTER-PROMPT.md` §0.1.2, which makes this ADR a precondition for writing
`validateUserOp`: *"решить и задокументировать: staked entity / associated storage / собственный
bundler — ADR обязателен"*.

## The finding

**The enforcement core built in step 1 cannot be called from `validateUserOp` as it stands.** Not
"needs adapting" — a UserOperation whose account validation reaches `AgentPermissions` or
`RiskEngine` today is dropped from the mempool by any conforming bundler, on two independent
grounds. This is the decision this ADR exists to make, and it determines the shape of step 2.

Source: ERC-7562 *Account Abstraction Validation Scope Rules*, read from
`ethereum/ERCs@master:ERCS/erc-7562.md`. **Status: Review** — the text can still change, and that
is itself a risk recorded below.

### Ground 1 — `block.timestamp` is a banned opcode

ERC-7562 **OP-011** bans `TIMESTAMP` (0x42) and `NUMBER` (0x43) in every validation frame. There is
no staked-entity exception; the spec's own rationale gives a block-height check as the motivating
example.

Every enforcement path in the step 1 core reads `block.timestamp`: grant windows
(`notBefore`/`expiry`), parent-chain liveness, attestation validity, the mode de-escalation
cooldown. That is the 13 call sites the forge 1.7.1 linter flagged — assessed as harmless for
*direct* `execute` calls (DEV-05), and fatal for a validation frame.

### Ground 2 — none of the state is "associated storage"

ERC-7562 **Definition 6**: a slot is associated with address `A` if the slot value is `A`, or was
calculated as `keccak(A||x)+n` with `n` in 0..128. **STO-010/021/022** allow an account's validation
to touch its own storage and slots associated with it — and nothing else.

Checked against what the core actually stores:

| State | Slot derivation | Associated with | Readable in the account's frame |
| --- | --- | --- | --- |
| `RiskEngine._attestations[subject]` | `subject = keccak(TAG, chainId, engine, account, …)`, then `keccak(subject‖p)` | the subject hash | **No** |
| `AgentPermissions._grants[grantId]` | `grantId` is an EIP-712 digest | the digest | **No** |
| `AgentPermissions.activeGrant[account][delegate]` | `keccak(delegate ‖ keccak(account ‖ p))` | the **delegate** | **No** |
| `AgentPermissions._allowedLeaf[grantId][leaf]` | `keccak(leaf ‖ …)` | the leaf | **No** |

The account address is hashed *into* the key before the mapping hash in every case, so the
resulting slot is associated with the composite, not with the account. The design that makes the
permission model canonical and replay-proof — domain-separated composite keys — is precisely what
makes it unreadable during validation.

**Staking does not fix this.** ERC-7562 Definition 3 scopes an "entity" to a contract *explicitly
specified by the UserOperation*: sender, factory, paymaster, aggregator. `AgentPermissions` and
`RiskEngine` are none of those, so staking them buys nothing. The master prompt's "staked entity"
option does not apply to them at all — a conclusion worth stating plainly, because it removes one
of the three options the brief offered.

## The two mechanisms that resolve it

### Mechanism A — return the time range instead of reading the clock

ERC-4337 already solves the time problem, and solves it better than a timestamp check would.
`validateUserOp` returns a packed `uint256 validationData` of
`authorizer ‖ validUntil ‖ validAfter`, with each timestamp 6 bytes; `validUntil = 0` means
infinite. Per the spec: *"Either `sender` or `paymaster` may return a time-range
(`validAfter`/`validUntil`). The `UserOperation` MUST be valid at the current time to be considered
valid, defined as `validAfter<=block.timestamp`."*

So a grant's window is **expressed, not evaluated**:

```
validAfter = max(grant.notBefore, agentBlockedUntil)
validUntil = grant.expiry
```

No `TIMESTAMP` opcode in our frame. Ground 1 dissolves.

Two things this buys beyond compliance: the bundler drops an operation that would expire before the
next block, and the range is re-checked at inclusion rather than at simulation — a stricter
property than the current `execute` path has.

### Mechanism B — an associated-storage mirror for agent-level blocks

A plain `mapping(address account => uint64 blockedUntil)` has slot `keccak(account ‖ p)`, which
matches Definition 6 exactly. So `RiskEngine` can expose an agent-level block in a form the
account's own validation frame is permitted to read — and combined with Mechanism A, the block
becomes a time range rather than a comparison:

```
validAfter = max(grant.notBefore, riskEngine.blockedUntil(account))
```

An agent under a live BLOCK produces a UserOperation that is not valid until the block expires.
Enforced by the bundler, outside the banned-opcode scope, with no clock read on our side.

This mirror is **derived state, written when the BLOCK attestation is stored**. It must not become
a second source of truth: the attestation remains authoritative, anti-downgrade still governs
writes, and the mirror is monotone in the same direction (it may only move later, never earlier,
within a window). That constraint has to be tested as hard as TADE itself.

### What neither mechanism reaches: intent-level blocks

An intent-level attestation is keyed by `keccak(TAG, chainId, engine, account, target, value,
selector, dataHash)`. That is inherently not associated with the account — it cannot be, because
its whole purpose is to be specific to one intent. No mirror helps: there is one slot per *intent*,
not per account.

Exactly one frame in ERC-7562 may read it. **STO-033** grants a *staked paymaster* "read-only access
to any storage in a non-entity contract." A staked `SwarmPaymaster` — already in scope as family
III — is therefore the only place an intent-level BLOCK can be enforced before execution.

## Decision

A three-way split, by what each frame is permitted to see:

| Check | Frame | Rule relied on |
| --- | --- | --- |
| Permission: target, selector, value caps, budgets | account `validateUserOp` | STO-010 / STO-021, on restructured associated storage |
| Grant window, agent-level BLOCK | returned `validAfter`/`validUntil` | ERC-4337 validationData; no opcode |
| Intent-level BLOCK | staked `SwarmPaymaster.validatePaymasterUserOp` | STO-033 |
| Everything, unchanged | direct `AgentTBA.execute` | no restrictions in the execution phase (Definition 2) |

**No own bundler.** This is the option the brief offered and it is rejected — on commercial grounds,
not technical ones. The entire negotiating position of phases 1–3 is that GEBRID works inside
MetaMask and the existing 4337 infrastructure. A control plane that only functions behind a
GEBRID-operated bundler is not inside anything; it is a parallel stack, and it would have to be
disclosed as such in every BD conversation. The compliance work is cheaper than that sentence.

**No staked `AgentPermissions`/`RiskEngine`.** Not a judgement call — Definition 3 makes it
impossible, as shown above.

## What this costs, stated plainly

**A UserOperation not sponsored by `SwarmPaymaster` gets permission enforcement and agent-level
block enforcement, but no intent-level risk enforcement before execution.** The intent check then
happens in the execution phase, where it reverts — after gas has been paid.

This is a real gap and it must not be described as anything else in audit materials or BD decks.
Three things bound it:

1. Agent-level BLOCK *is* enforced in validation, via the mirror. An agent assessed as compromised
   is stopped before gas, regardless of sponsorship.
2. The direct `execute` path is unaffected and remains fully enforced.
3. GEBRID agents are expected to be sponsored by `SwarmPaymaster` in the normal configuration; the
   gap applies to the unsponsored path.

It cannot be closed inside ERC-7562 as written. Closing it would require either the own-bundler
option rejected above, or an EntryPoint-level change.

## Consequences for step 2

1. `AgentPermissions` needs a **validation-readable projection**: per-(account, delegate) state in
   slots associated with the *account*. The authoritative structures stay as they are — the
   projection is additional, derived, and must be proved to agree with the authority it mirrors.
   That agreement is an invariant test, not a comment.
2. `RiskEngine` gains `blockedUntil(address account)` backed by an associated-storage mapping,
   written on BLOCK, monotone within a window, and covered by the same adversarial tests as TADE.
3. `AgentTBA.validateUserOp` reads only the projection and returns a time range. It must contain no
   `TIMESTAMP`, no `NUMBER`, no `BALANCE`, no `CALL` with value, and no call to an address without
   code (OP-011, OP-041, OP-061, OP-080).
4. `SwarmPaymaster` must be staked (`MIN_UNSTAKE_DELAY` 86400 s; `MIN_STAKE_VALUE` per chain,
   recommended ≈ $1000 equivalent) and carries the intent-level check.
5. **Rule conformance has to be tested, not asserted** (invariant I-P2). A unit test cannot catch a
   banned opcode. Step 2 needs a validation-tracing check in CI — the same thing a bundler does —
   or the compliance claim is a comment in a file.
6. `SessionKeyManager` is now constrained by this ADR rather than independent of it: session-key
   state read during validation must itself live in account-associated storage. This is why the ADR
   had to come first.

## Open items the owner must settle

**O-1 — EntryPoint version.** The master prompt fixes v0.7. As of this ADR, v0.7 is **two releases
behind**: `eth-infinitism/account-abstraction` lists v0.9.0 as Latest, and its release notes state
v0.9 is *"ABI-compatible with v0.8 and v0.7, and does not require changes in Accounts and
Paymasters."* Building against v0.7 in late 2026 risks targeting an EntryPoint that bundler
infrastructure has moved past. Addresses and citations are in `DEPLOYMENTS.md`. Changing this later
is cheap for the code and not cheap for a published deployment record. Owner decision.

**O-2 — ERC-7562 is status `Review`.** The rules this ADR is built on can change before Final. The
exposure is bounded: Mechanisms A and B both reduce what we do during validation, so a tightening
of the rules is unlikely to break them, while a loosening would only widen the options.

**O-3 — on-chain time-range enforcement is unverified.** The ERC-4337 text explicitly describes the
`validAfter`/`validUntil` check as bundler-side during simulation. Whether the EntryPoint contract
of the pinned version *also* reverts on an expired range on-chain is not stated there and was not
verified — Base RPC is blocked by this environment's egress policy. **This must be read off the
EntryPoint source of the chosen version before step 2 code is written**, because if enforcement is
bundler-side only, a malicious bundler could include an out-of-range operation, and the agent-level
block in Mechanism B would need an execution-phase backstop as well.

## Alternatives considered

- **Own bundler.** Rejected; see above.
- **Put everything in the execution phase.** Simplest, and gives up the main thing 4337 offers: an
  operation that cannot be included at all, rather than one that is included and reverts. It would
  also mean the agent pays gas to be told no, which is a poor property for a control plane whose
  pitch is loss prevention.
- **Restructure all authoritative state onto account-associated keys.** Would make the account frame
  self-sufficient, and would destroy the canonical-commitment property: grant ids are EIP-712
  digests precisely so a grant is identified by what was signed. Re-keying them by account would
  reintroduce the replay surface step 1 closed. Rejected — the projection is additive for this
  reason.
