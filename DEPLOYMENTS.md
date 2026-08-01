# DEPLOYMENTS

Registry of every GEBRID deployment: network → address → version → commit → audit reference
(master prompt §2.3).

**Nothing has been deployed yet.** This session produced the phase 0.1 queue-0.1 step-1 contracts
and their deploy script; no broadcast has been made to any network. Rows are added only after a
transaction is confirmed and the source is verified.

## Base Sepolia (chainId 84532)

| Contract | Address | Version | Commit | Verified | Audit ref |
| --- | --- | --- | --- | --- | --- |
| AgentNFT | _not deployed_ | — | — | — | — |
| ERC6551Registry | _not deployed_ | — | — | — | — |
| RiskEngine | _not deployed_ | — | — | — | — |
| AgentPermissions | _not deployed_ | — | — | — | — |
| AgentTBA (implementation) | _not deployed_ | — | — | — | — |

## Base mainnet (chainId 8453)

Blocked on the Base Sepolia deployment and on the external audit (§0.2).

## Reference addresses

| Item | Value | Source |
| --- | --- | --- |
| ERC-4337 EntryPoint v0.7 | **TO BE FIXED** — required by master prompt §0.1 with a cited source. | Not yet needed: `validateUserOp` is step 2 of queue 0.1 and is not in this codebase. Must be recorded here before step 2 begins. |
| ERC-6551 canonical registry | `0x000000006551c19487814612e58FE06813775758` | ERC-6551. **This is what the deployment binds** — ADR-0002. Its presence and conformance are re-proved by `DeployCore` at every deployment; they were never verified from the build environment, where Base RPC is blocked by egress policy. |

## Required role split before mainnet use

The constructors bootstrap every role to the deploying admin. That is acceptable on testnet and is
**not** acceptable on mainnet. Split as follows (ADR-0004):

| Contract | Role | Holder | Why that placement is safe |
| --- | --- | --- | --- |
| AgentNFT, RiskEngine | `DEFAULT_ADMIN_ROLE` | Safe multisig | Only role that can grant the others. Handover is begin/accept with a 3-day delay and cannot be granted directly. |
| AgentNFT | `MINTER_ROLE` | ops key or multisig | Can mint new agents; cannot touch existing ones. |
| AgentNFT | `METADATA_ROLE` | ops key | Metadata only. |
| AgentNFT | `ROYALTY_ROLE` | multisig | Capped at 10% by an unchangeable constant. |
| RiskEngine | `CONFIG_ROLE` | Safe **behind a timelock** | Retunes weights and thresholds (DEV-03). |
| RiskEngine | `GUARDIAN_ROLE` | hot service key | Can only **escalate** the mode; de-escalation needs the admin role plus a cooldown. |
| RiskEngine | `ATTESTER_ROLE` | scoring service key | Can only **raise** severities; the contract derives the verdict and a stored attestation can never be weakened. |

The two hot keys are safe to hold hot precisely because the enforcement design is asymmetric: their
compromise produces a denial of service, not a theft.

`AgentPermissions` has no role to split — it has no privileged role at all after deployment.

## Open items before any mainnet deployment

1. **Verify the canonical ERC-6551 registry on the target chain.** `DeployCore` proves conformance
   at deployment time and aborts on failure, so this cannot be got wrong silently — but confirm it
   is present on Base Sepolia and Base mainnet before scheduling the run, or the deployment simply
   stops. `cast code 0x000000006551c19487814612e58FE06813775758 --rpc-url base_sepolia`.
   The registry choice changes every agent account address, so it is only cheap to revisit *before*
   the first mainnet mint.
2. **`GEBRID_ADMIN` must be a multisig**, and the roles must be split per the table above.
3. **`CONFIG_ROLE` behind a timelock** (DEV-03).
4. **Licence decision.** Source is `UNLICENSED` and `LICENSE` states all rights reserved — a holding
   position that grants nothing and is reversible. Counsel to choose the final licence once the
   patent position is settled; note that BUSL-1.1's conventional Change Licence (Apache-2.0)
   contains an express patent grant.
5. **External audit (§0.2).** No mainnet deployment before findings ≥ Medium are closed.

## Deployment procedure

```bash
cd contracts
cp .env.example .env      # fill in; .env is gitignored

# Confirm the canonical ERC-6551 registry is present on the target chain first.
cast code 0x000000006551c19487814612e58FE06813775758 --rpc-url base_sepolia

# Preferred: keystore or hardware wallet
forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url base_sepolia \
  --account gebrid-deployer --sender $GEBRID_ADMIN \
  --broadcast --verify -vvvv
```

The script binds the canonical registry by default and aborts if it is absent or does not derive
account addresses per spec. `GEBRID_DEPLOY_OWN_REGISTRY=true` falls back to our own instance; any
such deployment is reported and must be recorded as **non-canonical** in the table above.

The script deploys the five contracts, closes the one post-deployment wiring step
(`AgentPermissions.setAccountImplementation`), and asserts the whole wiring before returning. It is
covered by `contracts/test/DeployCore.t.sol` so it cannot rot between sessions.

After a successful broadcast: fill in the table above with address, version, commit hash and the
Basescan verification link, in the same change.
