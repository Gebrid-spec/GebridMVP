# Self-audit — `contracts/src/core/AgentTBA.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Claim families: IV, V, XI. **Not** families I–III: `validateUserOp` and the EIP-7562 attestation
phase are step 2 of queue 0.1 and are deliberately absent here (see "Scope" below).
Tests: `contracts/test/AgentTBA.t.sol` — 27 tests, 2 fuzz properties at 10,000 runs each.

## Scope

This is the ERC-6551 execution layer with permission and risk enforcement on the path. Per the
task, `SessionKeyManager`, `SwarmPaymaster`, `ACPAdapter` and ERC-4337 `validateUserOp` are **out
of scope for this step**. The seam for step 2 is clean: `validateUserOp` will reuse
`_isAuthorizedSigner` and the same `PERMISSIONS.consume` / `RISK_ENGINE.enforceIntent` pair, so
adding it does not require reopening the authority model. No 4337 stubs were left behind — a
half-built `validateUserOp` would be worse than none, because it would look deployable.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1–A6 build | PASS | Zero warnings. |
| B1 authority on mutators | PASS | `execute` requires the token holder or a live grant. |
| B4 no retroactive widening | PASS (by construction) | `PERMISSIONS` and `RISK_ENGINE` are `immutable`. Changing them means a new implementation, which changes every account address (`ERC6551Registry.md`, F-REG-3). |
| C11 ERC-1271 for contract owners | PASS | `SignatureChecker` on the owner branch — a Safe or 4337 account works as holder. |
| C12 ERC-1271 returns rather than reverts | PASS | `ECDSA.tryRecover` on the delegate branch — `test_Adversarial_MalformedSignatureReturnsFailureNotRevert`. |
| E8 no owner bypass of BLOCK | PASS | `test_Adversarial_BlockAppliesToTheTokenHolderToo`. |
| F1 CEI | PASS | Budgets charged and `_state` advanced before the outbound call. |
| F2 re-entrancy | PASS | Argued **and** executed — see below. |
| F3 return data bubbled | PASS | `test_RevertBubblesFromTarget`. |
| F5 low-level call checked | PASS | `success` checked; revert data re-thrown verbatim. |
| F8 cross-chain execution disabled | PASS | `test_Adversarial_CrossChainExecutionIsDisabled`. |
| G1 interface ids | PASS | `ERC6551Registry.t.sol::test_InterfaceIdsMatchERC6551`. |
| G2 `supportsInterface` | PASS | 165, 6551 account, 6551 executable, 1271, 721 receiver, 1155 receiver. |
| G3 documented deviation | ACCEPTED | Only `operation == 0` (CALL) is supported; DELEGATECALL and CREATE are refused, not silently ignored — `test_RevertWhen_OperationIsNotCall`. A token bound account that can DELEGATECALL can rewrite its own storage and escape every guarantee in this file. |

## F2 — re-entrancy, argued and executed

There is deliberately **no** re-entrancy guard. Agent workflows legitimately nest, and a blanket
guard would break composition. Safety comes from two properties instead:

1. **Ordering.** `PERMISSIONS.consume` writes budget state, and `_state` is advanced, *before*
   `to.call`. A re-entering callee is metered exactly like any other caller.
2. **Identity.** A re-entering target comes back as *itself* — an address with no grant — not as
   the original caller. `msg.sender` on the inner call is the malicious contract.

Per invariant I-P2 this is not left as an argument. `ReentrantTarget` (in `test/utils/Mocks.sol`)
calls back into `execute` from inside the outbound call;
`test_Adversarial_ReentrantTargetCannotEscapeEnforcement` asserts the outer call ran, the inner
call was rejected, the inner target was never reached, and exactly **one** call and one ether were
charged rather than two.

## Findings from this audit, and what changed

**F-TBA-1 — `owner()` must not revert on a burned agent.**
The direct implementation is `IERC721(tokenContract).ownerOf(tokenId)`, which reverts once the
token is burned. That propagates into `isValidSignature`, and ERC-1271 callers are not required to
handle a reverting verifier — a burned agent would have caused reverts in integrators rather than
a clean "not valid". `owner()` now returns `address(0)` via `try/catch` for a burned token and for
a wrong-chain read. `execute` treats `address(0)` as "nobody is authorised", so a burned agent is
frozen for holder and delegates alike: `test_Adversarial_BurnedAgentCannotExecute`.

**F-TBA-2 — the risk check must not be skipped for the token holder.**
The tempting shape is "owner is trusted, gate only delegates". That makes the whole control plane
waivable by whoever holds the NFT — including whoever just stole it. `RISK_ENGINE.enforceIntent`
runs on every path, after authority resolution:
`test_Adversarial_BlockAppliesToTheTokenHolderToo`, `test_AgentLevelBlockStopsEverything`. The
liveness cost is bounded by BLOCK being time-limited: `test_BlockLapsesWhenTheWindowExpires`.

**F-TBA-3 — check order is authority, then risk.**
Risk state is queried only after the caller has proved authority, so an unauthorised party cannot
use `execute` to probe which intents are attested. Cheapest rejection also comes first.

**F-TBA-4 — no initializer.** Immutables live in the implementation's runtime code and are read
correctly through `delegatecall`, so the account needs no initialisation. That removes the
initialisation-front-running surface and the "uninitialised account" state entirely. The cost is
that rewiring the enforcement stack requires a new implementation and therefore new account
addresses — which is the correct cost, since it means nobody can rewire an *existing* agent.

**F-TBA-5 — empty calldata has selector `0x00000000`.** A plain ether transfer is authorised by a
`(target, 0x00000000)` leaf, not by any 4-byte selector. Documented so permission builders do not
assume a bare transfer is unconstrained.

## Adversarial tests

| Class | Scenario | Test |
| --- | --- | --- |
| Re-entrancy | Target re-enters `execute` mid-call | `test_Adversarial_ReentrantTargetCannotEscapeEnforcement` |
| Authority | Stranger executes | `test_RevertWhen_StrangerExecutes` |
| Authority | Burned agent, holder and delegate | `test_Adversarial_BurnedAgentCannotExecute` |
| Authority | Agent sold; old delegate keeps executing | `test_Adversarial_TransferOfAgentStopsDelegateExecution` |
| Authority | Revoked grant still used | `test_Adversarial_RevokedGrantStopsExecution` |
| Privilege expansion | Unauthorised selector / target | `test_Adversarial_DelegateCannotCallAnUnauthorisedSelector`, `..._UnauthorisedTarget` |
| Privilege expansion | Per-call and total value caps | `test_Adversarial_PerCallValueCapIsEnforced`, `..._TotalValueBudgetIsEnforced` |
| Privilege expansion | Call-count budget | `test_Adversarial_CallBudgetIsEnforced` |
| Privilege expansion | Siblings multiply the parent budget | `test_Adversarial_SiblingDelegatesShareTheParentBudget` |
| Privilege expansion | Arbitrary call sequences vs. budget | `testFuzz_DelegateNeverExceedsItsTotalBudget` (10,000 runs) |
| Risk bypass | Holder overrides a BLOCK | `test_Adversarial_BlockAppliesToTheTokenHolderToo` |
| Signer substitution | Stranger / non-signing delegate satisfies ERC-1271 | `test_Adversarial_StrangerSignatureFailsERC1271`, `..._NonSigningDelegateFailsERC1271` |
| Signer substitution | Signing rights survive an agent sale | `test_Adversarial_SignatureRightsDieWithTheAgentTransfer` |
| Malformed input | Garbage / empty ERC-1271 signature | `test_Adversarial_MalformedSignatureReturnsFailureNotRevert` |
| Chain scoping | Execute on the wrong chain | `test_Adversarial_CrossChainExecutionIsDisabled` |
| Standards | `state()` counts exactly successful executions | `testFuzz_StateTracksSuccessfulExecutions` (10,000 runs) |

## Known limitations

- **No `validateUserOp`.** Out of scope for this step (see Scope). Until it exists, this account is
  not a 4337 smart account and must not be described as one — invariant I-P1 requires the deployed
  code to match the claims it is presented against.
- **No batch execution.** ERC-6551 does not require it. A batch entry point would need its own
  per-item permission and risk accounting; deferring it avoids a half-metered path.
- **ETH held by the account is spendable up to the grant's budget**, and grants are denominated in
  native value only. ERC-20 movement is constrained by `(target, selector)` but not by amount —
  amount-level ERC-20 limits belong with the 7715 caveat work in phase 2, and are not claimed here.
