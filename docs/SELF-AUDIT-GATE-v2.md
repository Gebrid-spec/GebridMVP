# GEBRID Solidity Self-Audit Gate v2

> **STATUS: RECONSTRUCTED — pending the authoritative text.**
>
> `GEBRID_SOLIDITY_SELF_AUDIT` v2 is the top-precedence document in the master prompt's
> hierarchy, above the patent map, above ACL v0.4.2 and above the master prompt itself. It was
> **not present in this repository** when the phase 0.1 step 1 work was done, and it was not
> supplied with the task.
>
> Rather than skip the gate, the checklist below was reconstructed from the invariants and test
> requirements stated in `MASTER-PROMPT.md` §0 and §0.1, and every file in the enforcement core
> was audited against it. **When the authoritative v2 text is added to the repository, this file
> must be replaced by it and every per-file report in `docs/self-audit/` must be re-run against
> the real checklist.** Findings from this reconstruction are not a substitute for that.

---

## How the gate is applied

Each contract gets a report in `docs/self-audit/<Contract>.md` with one row per check and one of:

| Verdict | Meaning |
| --- | --- |
| `PASS` | The property holds and a test proves it. The test is named. |
| `PASS (by construction)` | The property holds because the code cannot express the violation. Argued, not merely asserted. |
| `N/A` | The check does not apply to this file. A reason is given. |
| `ACCEPTED` | A deviation that is deliberate. Rationale and compensating control are given. |
| `OPEN` | Not closed. Blocks the gate. |

Invariant I-P2 governs the whole gate: *security properties are demonstrated by executing the
attack, not by reasoning about it.* A `PASS` on any check in section C or D that is not backed by
a named adversarial test is not a `PASS`.

---

## A. Build and toolchain

| # | Check |
| --- | --- |
| A1 | Compiler version pinned exactly (no `^`, no floating pragma) in both source and config. |
| A2 | Compiles with **zero warnings**. Warnings are build failures in CI, not advisories. |
| A3 | EVM target pinned and justified for every chain the artifact will be deployed to. |
| A4 | Optimizer settings pinned; `via_ir` state explicit and justified. |
| A5 | Dependencies pinned to tags/commits, not branches. |
| A6 | No unused imports, dead code, or unreachable branches. |
| A7 | The **toolchain** is pinned as tightly as the compiler. `deny = "warnings"` makes the linter part of the build contract, so a floating toolchain means a new release can fail an unchanged repository — or, worse, silently stop reporting something. CI and the local instructions name the same version. |

## B. Access control and authority

| # | Check |
| --- | --- |
| B1 | Every state-mutating external function has an explicit authority check or a documented reason it is permissionless. |
| B2 | No function grants an authority that its caller does not already hold. |
| B3 | Admin/owner powers enumerated; each one's blast radius stated. |
| B4 | Privileged setters cannot retroactively invalidate already-issued authorisations in the holder's favour. |
| B5 | Role/ownership transfer is two-step or documented as intentionally one-step. |
| B6 | Emergency powers (pause, kill, revoke) reachable by the party whose funds are at risk, not only by the protocol. |

## C. Signatures, encoding and replay (I-P4)

| # | Check |
| --- | --- |
| C1 | EIP-712 domain includes name, version, `chainId` and `verifyingContract`. |
| C2 | Domain separator recomputed on `chainId` change (fork safety). |
| C3 | Every signed field is in the type hash; no field is enforced but unsigned. |
| C4 | Signature malleability rejected (`s` in the lower half only; no `v` flexibility). |
| C5 | Per-authority replay guard; a consumed authorisation cannot be consumed twice. |
| C6 | Cross-contract replay blocked: same payload on a second deployment must fail. |
| C7 | Cross-chain replay blocked: same payload on another chain must fail. |
| C8 | Hash preimages are unambiguous: no `encodePacked` over two adjacent dynamic types. |
| C9 | Leaf and internal-node hashing are domain-separated (`leaf ≠ node`). |
| C10 | Commitments are canonical: one input set has exactly one valid commitment. |
| C11 | ERC-1271 accepted wherever ECDSA is, so contract authorities are first-class. |
| C12 | ERC-1271 verification returns the failure magic value rather than reverting on malformed input. |

## D. Permission narrowing (I-P3)

| # | Check |
| --- | --- |
| D1 | A delegated authorisation can never exceed its parent on any axis. |
| D2 | Narrowing is **proved on-chain**, not declared by the issuer. |
| D3 | Set-valued permissions (targets, selectors) are subset-checked element by element. |
| D4 | Budgets are charged against every ancestor, so siblings cannot multiply a parent's allowance. |
| D5 | Delegation depth is bounded, and the bound is enforced at both issue and spend time. |
| D6 | Revoking an authorisation revokes everything derived from it. |
| D7 | Transfer or burn of the root identity invalidates every derived authorisation, in O(1). |

## E. Risk enforcement and anti-downgrade (TADE)

| # | Check |
| --- | --- |
| E1 | A BLOCK verdict cannot be replaced by a lesser verdict inside its validity window. |
| E2 | A BLOCK cannot be weakened by re-attesting at the same verdict with an earlier expiry. |
| E3 | No privileged role can lift a BLOCK early. If one exists, it is a documented `ACCEPTED` deviation. |
| E4 | BLOCK is bounded in time, so a rogue attester cannot permanently disable an agent. |
| E5 | The verdict is derived on-chain from evidence, not asserted by the attester. |
| E6 | Mandatory risk vectors cannot be disabled by configuration. |
| E7 | Escalation is cheap and immediate; de-escalation is privileged and delayed. |
| E8 | Enforcement applies to the root authority too; there is no owner bypass. |
| E9 | An attestation for one subject cannot be reused for another (agent vs intent, agent A vs agent B). |
| E10 | A blocked action leaves a durable, non-revertible on-chain record carrying the value at risk (needed for I-P5 metrics). |

## F. Execution safety

| # | Check |
| --- | --- |
| F1 | Checks-effects-interactions on every path that moves value or spends a budget. |
| F2 | Re-entrancy analysed explicitly: either guarded, or argued safe **and** proved by a re-entrant attacker test. |
| F3 | Return data from external calls bubbled faithfully, not swallowed. |
| F4 | No unbounded loop over externally-growable data. |
| F5 | Low-level calls check success; no silent failure. |
| F6 | Arithmetic overflow/underflow: default checked, `unchecked` blocks individually justified. |
| F7 | Casts that can truncate are justified in a comment at the cast site. |
| F8 | Cross-chain execution disabled where account identity is chain-scoped. |
| F9 | Every decision derived from `block.timestamp` gates a window no shorter than one minute, and the floor is enforced on-chain rather than by convention, so proposer/sequencer drift cannot move it. |

## G. Standards conformance

| # | Check |
| --- | --- |
| G1 | Declared interface ids match the ERC's fixed values, asserted by test. |
| G2 | `supportsInterface` answers for every interface actually implemented. |
| G3 | Deviations from a standard are documented and deliberate. |
| G4 | Events required by the standard are emitted at the required moments. |

## H. Operational

| # | Check |
| --- | --- |
| H1 | No secret, key or endpoint in the repository (I-P6). |
| H2 | Deploy script is itself tested. |
| H3 | Post-deployment wiring is asserted, not assumed. |
| H4 | Any mutable-after-deploy wiring is write-once or timelocked, and its window is documented. |
| H5 | Deployment record (`DEPLOYMENTS.md`) has address, version, commit, and audit reference. |

---

## Deviations register

Deviations recorded as `ACCEPTED` in any per-file report must also appear here.

| ID | File | Check | Deviation | Compensating control |
| --- | --- | --- | --- | --- |
| DEV-01 | all | A2 | `forge lint` emits `asm-keccak256` notes suggesting inline-assembly hashing. Not acted on. | Notes, not warnings; the gate fails on warnings. Readable hashing is worth more than the gas at this stage, and hand-written keccak assembly is a classic source of preimage bugs. |
| DEV-02 | `AgentPermissions` | H4 | `accountImplementation` is settable once after deployment rather than being a constructor immutable. | Unavoidable constructor cycle (AgentTBA needs AgentPermissions, AgentPermissions needs AgentTBA). Restricted to the immutable `DEPLOYER`, reverts on a second call, asserted by `DeployCore` and by `test_AccountImplementationCannotBeRebound` / `test_Adversarial_OnlyDeployerCanBindTheAccountImplementation`. Until it is set, the contract falls back to a `token()` check. There is no other privileged role on the contract. |
| DEV-03 | `RiskEngine` | B3 | `CONFIG_ROLE` can retune weights and thresholds, changing which severity vectors produce a BLOCK. | Cannot retroactively downgrade a stored attestation (E1/E2 still hold), cannot disable a mandatory vector (E6), and every change emits an event. `DEPLOYMENTS.md` requires the role behind a timelock before mainnet. |
| DEV-05 | `AgentPermissions`, `RiskEngine` | F9 / A2 | The `block-timestamp` lint (added in forge 1.7.1) is excluded in `foundry.toml` rather than suppressed at 13 individual sites. | Every one of those comparisons gates a window of minutes to days — attestation validity 5 min .. 7 days, de-escalation cooldown 6 h, grant windows up to 365 days, admin handover 3 days. Second-level drift cannot move any of them. `HARD_MIN_VALIDITY = 1 minutes` enforces the floor on-chain, and gate check F9 keeps the property under review rather than delegating it to a linter. |
| DEV-04 | `DeployCore` | H3 | The canonical ERC-6551 registry is bound without its bytecode having been verified from the build environment (Base RPC is blocked by egress policy). | Conformance is proved behaviourally at deployment time — a probe address is re-derived from the ERC's creation code and compared with the registry's own `account()` view, and a mismatch aborts. See ADR-0002 and `docs/self-audit/ERC6551Bytecode.md`. |
