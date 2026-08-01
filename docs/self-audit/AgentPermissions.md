# Self-audit — `contracts/src/core/AgentPermissions.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Claim families: XI, and the on-chain expression of invariant **I-P3** (permissions may only narrow;
subset-proof, not declaration).
Tests: `contracts/test/AgentPermissions.t.sol` — 34 tests, 2 fuzz properties at 10,000 runs each;
plus `contracts/test/invariant/PermissionBudget.invariant.t.sol` — 3 invariants over 32,768 calls.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1–A6 build | PASS | Zero warnings; `via_ir` off (ADR-0001). |
| B1 authority on mutators | PASS | `grant` requires the authority's signature; `consume` requires `msg.sender` to be the agent account; `revoke` requires holder, delegate, or parent delegate. |
| B2 no authority inflation | PASS | Section D below. |
| B4 setters cannot retroactively widen | PASS | `setAccountImplementation` is write-once; no setter touches an issued grant. |
| B5 privileged roles | PASS (by construction) | **None.** The one write-once binding is restricted to the immutable `DEPLOYER` and is consumed during deployment; there is no owner and no role afterwards. ADR-0004. |
| C1 EIP-712 domain | PASS | name, version, `chainId`, `verifyingContract` via OZ `EIP712`. |
| C2 fork safety | PASS | OZ recomputes the separator when `chainId` changes — `test_Adversarial_SignatureDoesNotReplayAcrossChains` asserts the separator actually moves. |
| C3 every enforced field is signed | PASS | All 14 struct fields are in `PERMISSION_SET_TYPEHASH`; `testFuzz_MutatingASignedFieldInvalidatesTheSignature` (10,000 runs) mutates each in turn. |
| C4 malleability | PASS | `test_Adversarial_MalleableSignatureIsRejected` flips `s` to `n-s` and `v` to its counterpart. |
| C5 replay guard | PASS | Per-authority nonce **and** grant-id uniqueness — `test_Adversarial_ReplayOfTheSameSignedGrantIsRejected`, `test_Adversarial_NonceCannotBeReusedByADifferentGrant`. |
| C6 cross-contract replay | PASS | `test_Adversarial_SignatureDoesNotReplayAcrossDeployments`. |
| C7 cross-chain replay | PASS | `test_Adversarial_SignatureDoesNotReplayAcrossChains`, `test_Adversarial_SignatureAloneIsChainBound`. |
| C8 unambiguous preimages | PASS | `_hashPermissionSet` uses `abi.encode` throughout; the only `encodePacked` is in `CanonicalMerkle` over fixed-width types (`address` + `bytes4`). |
| C9 leaf ≠ node | PASS | Leaf prefix `0x00`, node prefix `0x01` — `test_LeafAndNodeHashingAreDomainSeparated`. |
| C10 canonical commitment | PASS | `root()` demands strictly increasing leaves; duplicates and reorderings revert — `test_Adversarial_UnsortedLeavesAreRejected`, `test_Adversarial_DuplicateLeavesAreRejected`. |
| C11 ERC-1271 authority | PASS | `SignatureChecker` — `test_ERC1271ContractAuthorityIsAccepted`. |
| D1–D7 narrowing | PASS | Section D below. |
| F1 CEI | PASS | `consume` writes all budget state before returning to `AgentTBA`, which calls out afterwards. |
| F4 no unbounded loop | PASS | Ancestor walk bounded by `MAX_DELEGATION_DEPTH + 1`; leaf loop bounded by `MAX_TARGETS = 32`. |
| F6 arithmetic | PASS | `unchecked` only on a decrement already guarded by a zero test and on `usedCalls + 1` already guarded by `>= maxCalls`. |
| H4 write-once wiring | ACCEPTED | DEV-02 — see below, now narrowed to the deployer. |

## D. Narrowing: how it is *proved* rather than declared

This is the file's reason to exist, so the mechanism is worth stating precisely.

**D2/D3 — the target set is subset-checked element by element.** A child grant is registered with
its full leaf array spelled out. `_resolveAuthority` walks that array and requires every leaf to
already be present in the parent's stored leaf mapping. Merkle roots cannot be compared for
subset-ness, so the root is kept for what it is good at — being the canonical thing the authority
signs — while enforcement uses a structure that cannot be widened. A child naming a target its
parent never held is rejected: `test_Adversarial_ChildCannotAddATargetTheParentNeverHeld`.

**D4 — budgets are charged up the entire chain.** This is the finding that most changed the
design. If a child spent only its own allowance, a parent holding 5 ETH could mint two children of
5 ETH each and the pair would move 10 ETH — delegation would *widen* rights while appearing to
narrow them, because each individual grant looks properly bounded. `_chargeChain` walks from the
consuming grant to the root and charges value and call count against every ancestor. Proved twice:

- `AgentTBA.t.sol::test_Adversarial_SiblingDelegatesShareTheParentBudget` — child A drains the
  parent's budget, child B is then refused even though its own grant still shows headroom;
- `PermissionBudget.invariant.t.sol::invariant_TreeNeverOutspendsTheRootGrant` — over 32,768
  randomised calls across a three-node tree plus an unauthorised actor, the ether that leaves the
  agent never exceeds the root grant, and `invariant_AccountingMatchesTheMoney` asserts the
  recorded spend equals the actual balance moved.

Note what `test_Adversarial_SiblingChildrenCannotEachHoldTheFullParentBudget` shows: two full-size
children *can* be issued while the parent has spent nothing. That is deliberate. Containment is
enforced at spend time, not issue time, because issue-time reservation would make a parent's
budget unusable by the parent itself. The comment in that test points at the spend-time proof so
the pair is not mistaken for a gap.

**D5 — depth bounded at both ends.** `MAX_DELEGATION_DEPTH = 4`, enforced when issuing
(`test_Adversarial_DelegationDepthIsCapped`) and again when spending, so a malformed chain cannot
turn the ancestor walk into unbounded gas.

**D6 — revocation cascades.** `consume` and `isLive` walk the ancestor chain and check `revoked`
on each, so revoking a parent kills its whole subtree without touching the descendants:
`test_RevokingParentKillsChild`.

**D7 — transfer kills everything, in O(1).** Grants pin `agentEpoch`. `AgentNFT` advances it on
mint, transfer, burn and explicit bump. No loop, no migration step, nothing to run out of gas:
`test_TransferOfTheAgentKillsEveryGrant`, `test_BurnKillsEveryGrant`,
`test_HolderKillSwitchAdvancesEpochAndKillsGrants`.

## Findings from this audit, and what changed

**F-PERM-1 — a child could out-spend its parent through siblings.** Described above (D4). The fix
was `_chargeChain`; without it the whole narrowing claim would have been decorative.

**F-PERM-2 — the account address must be re-derived, not trusted.** The first version read
`IERC6551Account(account).token()` and believed it. Any contract can implement `token()` and claim
to belong to agent #5. The contract now re-derives the address from the registry, the pinned
implementation and `accountSalt`, and rejects anything else:
`test_Adversarial_FakeAccountIsRejected`. Note this is defence in depth rather than load-bearing —
a fake account could only ever consume grants issued to itself, and issuing those still needs the
real holder's signature — but the check is cheap and removes a whole class of reasoning.

**F-PERM-3 — `accountSalt` had to enter the signed payload.** Once the address is re-derived, the
salt is an input to that derivation, so it must be signed or an attacker could re-point the
derivation. It is field 3 of the type hash.

**F-PERM-4 — one live grant per (account, delegate).** Re-issuing now supersedes and revokes the
previous grant rather than accumulating alongside it. Two live grants for the same delegate would
mean two budgets and an ambiguous resolution at spend time:
`test_ReissuingSupersedesThePreviousGrant`.

**F-PERM-5 — self-redelegation blocked.** A delegate issuing a child to itself would collide on
the `activeGrant[account][delegate]` slot and let the supersede rule silently revoke its own
parent. Rejected with `SelfRedelegation`.

**F-PERM-6 — grant lifetime capped.** `MAX_GRANT_LIFETIME = 365 days` bounds the blast radius of a
leaked delegate key: `test_RevertWhen_GrantLifetimeExceedsCap`.

**F-PERM-7 — stack-too-deep, resolved without `via_ir`.** `_hashPermissionSet` splits the
`abi.encode` in two halves and concatenates. Every field is a static 32-byte word, so the result is
bit-identical to a single `abi.encode` — this is a compilation workaround, not an encoding change.
Likewise `_emitGrantIssued` exists only to assemble nine event arguments in a shallow frame.

## Revision — 2026-08-01

**`Ownable2Step` removed entirely.** The owner of this contract had exactly one power,
`setAccountImplementation`, which the deployment consumes immediately; after that it could do
nothing. A live, transferable privileged role with no remaining function is not neutral — it is an
access-control surface that can only ever be a liability, and every future reader has to work out
for themselves that it is inert. It is replaced by an immutable `DEPLOYER` recorded at construction,
which is the only address that may close the binding, and only once.

The consequence is worth stating plainly, because it is the strongest claim available about this
file: **the contract that governs every permission grant in the system has no privileged role at all
once deployed.** ADR-0004.

## Adversarial tests

| Class | Scenario | Test |
| --- | --- | --- |
| Replay | Identical signed grant submitted twice | `test_Adversarial_ReplayOfTheSameSignedGrantIsRejected` |
| Replay | Different grant reusing a spent nonce | `test_Adversarial_NonceCannotBeReusedByADifferentGrant` |
| Replay | Same signature on another chain | `test_Adversarial_SignatureDoesNotReplayAcrossChains`, `test_Adversarial_SignatureAloneIsChainBound` |
| Replay | Same signature on a second deployment | `test_Adversarial_SignatureDoesNotReplayAcrossDeployments` |
| Signer substitution | Signature from a non-holder | `test_Adversarial_SignatureFromNonHolderIsRejected` |
| Signer substitution | Valid signature, mutated payload | `test_Adversarial_SignatureIsBoundToEverySignedField`, `testFuzz_MutatingASignedFieldInvalidatesTheSignature` |
| Signer substitution | Malleable `(r, n-s, v')` | `test_Adversarial_MalleableSignatureIsRejected` |
| Signer substitution | Impostor account claiming a token | `test_Adversarial_FakeAccountIsRejected` |
| Privilege expansion | Child widens value-per-call | `test_Adversarial_ChildCannotWidenValuePerCall` |
| Privilege expansion | Child outlives parent | `test_Adversarial_ChildCannotOutliveParent` |
| Privilege expansion | Child adds an unheld target | `test_Adversarial_ChildCannotAddATargetTheParentNeverHeld` |
| Privilege expansion | Non-signing parent mints a signing child | `test_Adversarial_NonSigningParentCannotMintASigningChild` |
| Privilege expansion | Siblings multiply the parent budget | `AgentTBA.t.sol::test_Adversarial_SiblingDelegatesShareTheParentBudget` + invariants |
| Privilege expansion | Unbounded delegation depth | `test_Adversarial_DelegationDepthIsCapped` |
| Encoding | Unsorted / duplicate leaves | `test_Adversarial_UnsortedLeavesAreRejected`, `test_Adversarial_DuplicateLeavesAreRejected` |
| Encoding | Leaf set that does not reproduce the signed root | `test_Adversarial_LeafSetMustReproduceTheSignedRoot` |
| Revocation | Stranger revokes | `test_RevertWhen_StrangerRevokes` |
| Wiring | Non-deployer binds the account implementation | `test_Adversarial_OnlyDeployerCanBindTheAccountImplementation` |

## Known limitations

- **`MAX_TARGETS = 32` per grant.** Larger permission sets need multiple grants. Raising it means
  re-costing the registration loop.
- **The merkle root is a commitment, not a runtime proof surface.** Enforcement reads the stored
  leaf mapping. `CanonicalMerkle.verify` exists for off-chain and future use but is not on the
  enforcement path today.
- **Nonces are per authority, not per agent.** A holder managing several agents draws from one
  nonce space. Intentional (it matches how a signer thinks about its own outbound signatures) but
  worth knowing when building the SDK.
- **DEV-02:** `accountImplementation` is set once after deployment because AgentTBA and
  AgentPermissions reference each other in their constructors. Restricted to the immutable
  `DEPLOYER`, reverts on a second call, asserted by the deploy script and by
  `test_AccountImplementationCannotBeRebound` and
  `test_Adversarial_OnlyDeployerCanBindTheAccountImplementation`. Before it is set, the contract
  falls back to checking `token()` directly.
