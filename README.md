# GEBRID

Agent Security & Continuity Control Plane. Identity, provable permission narrowing, and
contract-level risk enforcement for autonomous agents.

**Status:** Phase 0.1, queue 0.1, **step 1 complete** — the enforcement core. Nothing is deployed.
See `ROADMAP-PHASES-0-3.md` for the tracker and `docs/MASTER-PROMPT.md` for the normative plan.

## Layout

| Path | Contents |
| --- | --- |
| `contracts/` | Foundry project. Solidity 0.8.24, the enforcement core, tests and deploy scripts. |
| `sdk/` | TypeScript client. Not started — phase 0.4 exit criterion. |
| `api/` | Screening / scoring API. Not started — phases 0.3, 1.1. |
| `ui/` | Web front end. Currently the original React scaffold, unmodified. |
| `docs/` | Master prompt, self-audit gate and reports, ADRs. |

Repository-level records: `DEPLOYMENTS.md`, `SECRETS-REGISTRY.md`, `ROADMAP-PHASES-0-3.md`.

## The enforcement core

Five contracts, in dependency order:

| Contract | Role |
| --- | --- |
| `AgentNFT` | Root agent identity. ERC-721 + ERC-4906 + ERC-2981, plus the continuity **epoch** that makes revocation O(1). |
| `ERC6551Registry` | Test and fallback registry. Deployments bind the **canonical** ERC-6551 singleton (ADR-0002). |
| `AgentTBA` | The agent's account. ERC-6551 execution with permission and risk checks on the path; ERC-1271 signing. |
| `AgentPermissions` | EIP-712 permission grants with on-chain **subset proofs** — delegation can only narrow. |
| `RiskEngine` | Composite on-chain scoring, contract-level BLOCK, anti-downgrade TADE, NORMAL / RESTRICTED / CRISIS modes. |

Three properties are worth knowing before reading the code:

- **Narrowing is proved, not declared.** A child grant enumerates its permissions and every one is
  checked against the parent's stored set; budgets are charged against every ancestor, so siblings
  cannot multiply a parent's allowance.
- **A BLOCK cannot be walked back.** Inside its validity window an attestation cannot be downgraded,
  and it cannot be weakened by re-attesting with a shorter window. There is no admin override —
  liveness comes from BLOCK being time-bounded instead.
- **Selling the agent revokes everything.** Grants pin the NFT's epoch, which advances on transfer,
  burn, and an explicit holder-triggered bump. No loop, nothing to run out of gas.
- **The permission registry has no admin.** `AgentPermissions` has no owner and no role once
  deployed; its single write-once binding is consumed during deployment (ADR-0004).

Licensing: source is `UNLICENSED` and `LICENSE` reserves all rights — a deliberate holding position
while the patent track is open. See `LICENSE` for why not BUSL-1.1 yet.

## Build and test

Foundry, with `solc` pinned to 0.8.24:

```bash
cd contracts
forge build          # warnings are build failures
forge test           # 127 tests; fuzz properties run 10,000 cases each
FOUNDRY_PROFILE=lite forge test    # fast loop for local iteration only
```

Current state: clean build, **0 warnings**, **127/127 tests passing**, 11 fuzz properties at 10,000
runs each, 3 invariants over 32,768 calls.

## Audit trail

- `docs/SELF-AUDIT-GATE-v2.md` — the checklist. **Reconstructed**; the authoritative
  `GEBRID_SOLIDITY_SELF_AUDIT` v2 was not in the repository (blocker B1).
- `docs/self-audit/` — one report per file, with findings, adversarial scenarios and known
  limitations.
- `docs/adr/` — decisions with consequences: compiler and EVM target (0001), registry choice
  (0002, reversed after review), attestation and block recording (0003), admin model (0004).

Security properties are demonstrated by executing the attack, not by describing it (invariant
I-P2). Every adversarial claim in the reports names the test that proves it.
