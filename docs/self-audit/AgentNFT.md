# Self-audit — `contracts/src/core/AgentNFT.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED — see the banner in that file).
Claim families: IV, V, XI (root agent identity).
Tests: `contracts/test/AgentNFT.t.sol` — 17 tests, 2 fuzz properties at 10,000 runs each.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1 pinned compiler | PASS | `pragma solidity 0.8.24;`, `solc_version = "0.8.24"` in `foundry.toml`. |
| A2 zero warnings | PASS | `forge build` with `deny = "warnings"`. |
| A3 EVM target | PASS | `shanghai`, ADR-0001. |
| A5 pinned deps | PASS | OpenZeppelin v5.1.0 as a tagged submodule. |
| A6 no dead code | PASS | Clean lint. |
| B1 authority on mutators | PASS | `mint` MINTER_ROLE, metadata METADATA_ROLE, royalties ROYALTY_ROLE, `burn` owner/approved, `advanceEpoch` holder/approved. |
| B3 admin blast radius | PASS | Enumerated below. |
| B5 two-step admin transfer | PASS | `AccessControlDefaultAdminRules`; ADR-0004. `test_AdminHandoverRequiresTheDelayAndAcceptance`, `test_PendingAdminHandoverCanBeCancelled`. |
| B6 holder-reachable emergency power | PASS | `advanceEpoch` is callable by the **token holder**, not by a protocol admin — `test_HolderCanAdvanceEpochAsKillSwitch`. Revocation must not depend on GEBRID being reachable or willing. |
| D7 O(1) invalidation on transfer/burn | PASS | `_update` advances the epoch on every mint, transfer and burn — `test_EpochAdvancesOnMintTransferAndBurn`, and downstream in `AgentPermissions.t.sol::test_TransferOfTheAgentKillsEveryGrant`. |
| F6 arithmetic | PASS | Two `unchecked` blocks: the epoch increment (one per transfer; `uint64` cannot realistically wrap) and the token-id counter. Both commented. |
| G1 interface ids | PASS | `test_SupportsRequiredInterfaces`. |
| G2 `supportsInterface` | PASS | 721, 2981, 165, AccessControl, 4906. |
| G4 standard events | PASS | `MetadataUpdate` / `BatchMetadataUpdate` — `test_SetTokenURIEmitsMetadataUpdate`, `test_SetBaseURIEmitsBatchMetadataUpdate`. |
| C\* signatures | N/A | This contract verifies no signatures. |
| E\* risk | N/A | No risk logic here. |

## Findings from this audit, and what changed

**F-NFT-1 — `type(IERC4906).interfaceId` is `0x00000000`, not `0x49064906`.**
The natural implementation is `interfaceId == type(IERC4906).interfaceId`. That is silently wrong:
Solidity computes an interface id as the XOR of its **function** selectors, and ERC-4906 declares
only events. The computed value is zero, so the contract would have advertised support for
interface id `0x00000000` and answered *false* to the id every wallet and indexer actually probes
for. Fixed by hardcoding `0x49064906` with a comment, and pinned by
`test_ERC4906ComputedIdIsZero_HardcodeIsRequired`, which asserts the computed id really is zero so
the reason for the hardcode is visible if anyone revisits it.

**F-NFT-2 — `BatchMetadataUpdate(1, 0)` before the first mint.**
`setBaseURI` emitted `BatchMetadataUpdate(1, _nextTokenId - 1)`. With no tokens minted that is
`(1, 0)` — an inverted range that indexers read as either "everything" or garbage. Fixed by
emitting only when at least one token exists; `test_SetBaseURIBeforeAnyMint_DoesNotEmitDegenerateRange`.

**F-NFT-3 — burned token ids could inherit stale metadata and royalties.**
Ids are not reused today, but the invariant should not rest on that. `_update` now clears the
per-token URI and resets the per-token royalty on burn —
`test_TokenRoyaltyOverridesDefault_AndIsClearedOnBurn`.

**F-NFT-4 — royalty ceiling.** ERC-2981 itself only bounds royalties by the fee denominator
(100%). A hard `MAX_ROYALTY_BPS = 1000` (10%) constant, not adjustable by any role, was added;
`testFuzz_RoyaltyNeverExceedsCap` at 10,000 runs.

## Adversarial tests

| Scenario | Test | Result |
| --- | --- | --- |
| Re-entrant minter tries to obtain a duplicate token id | `test_Adversarial_ReentrantMintCannotDuplicateTokenId` | Rejected — the id counter advances before `_safeMint`'s receiver hook, so the re-entrant mint gets a fresh id. Two distinct tokens, no collision. |
| Non-role account writes metadata | `test_RevertWhen_NonMetadataRoleSetsURI` | Rejected. |
| Stranger tries the epoch kill switch | `test_RevertWhen_StrangerAdvancesEpoch` | Rejected. |
| Burned token still has an owner | `test_Adversarial_BurnedTokenHasNoOwner` | `ownerOf` reverts, as ERC-721 requires. |
| Epoch monotonicity under arbitrary transfer chains | `testFuzz_EpochIsStrictlyMonotonicUnderTransfers` (10,000 runs) | Strictly increasing. |

## Admin blast radius (B3)

| Role | Can do | Cannot do |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Grant/revoke the other roles; begin a delayed handover of itself. | Move, burn or freeze a token it does not hold; grant `DEFAULT_ADMIN_ROLE` directly; advance an agent's epoch. |
| `MINTER_ROLE` | Mint new agents. | Affect existing agents. |
| `METADATA_ROLE` | Set base URI and per-token URI. | Affect ownership, epochs, or permissions. |
| `ROYALTY_ROLE` | Set royalties up to 10%. | Exceed `MAX_ROYALTY_BPS`. |

No role can advance an agent's epoch, revoke its permissions, or move it. The kill switch belongs
to the holder alone.

## Revision — 2026-08-01

`AccessControl` replaced with `AccessControlDefaultAdminRules` (ADR-0004). The earlier version of
this report listed single-step admin transfer as a known limitation to be handled operationally by
using a multisig. That was too weak: `DEFAULT_ADMIN_ROLE` can now not be granted directly at all,
and a handover is begin/accept with an enforced delay, leaving the attempt visible on-chain long
enough to cancel. The multisig requirement still stands in `DEPLOYMENTS.md`; it is now a second
layer rather than the only one.

The constructor gained `adminTransferDelay`. The contract also now exposes `owner()` via `IERC5313`,
returning the default admin — incidental, and read by marketplaces for collection ownership.

## Known limitations

- Losing the admin key with no pending transfer makes the role unrecoverable. That is the trade for
  removing single-step transfer, and it is why the holder-side kill switch (`advanceEpoch`)
  deliberately depends on no admin at all.
- `mint` has no supply cap. Deliberate — agent identities are not a scarce collectible.
