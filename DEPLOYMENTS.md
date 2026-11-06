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

### ERC-4337 EntryPoint

Required by master prompt §0.1 to be fixed here with a source. **The version is an open owner
decision (ADR-0005, O-1)** — the master prompt names v0.7, which is now two releases behind.

| Version | Address | Status |
| --- | --- | --- |
| v0.7 (tag `v0.7.0`) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Named by the master prompt. Superseded as Latest; not marked deprecated by upstream. |
| v0.8 (tag `v0.8.0`) | `0x4337084d9e255ff0702461cf8895ce9e3b5ff108` | — |
| v0.9 (tag `v0.9.0`) | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | **Latest** upstream. Release notes: ABI-compatible with v0.8 and v0.7, "does not require changes in Accounts and Paymasters". SenderCreator `0x0A630a99Df908A81115A3022927Be82f9299987e`. |

**Source:** `github.com/eth-infinitism/account-abstraction/releases`, section "Release v0.7",
subheading "EntryPoint 0.7 address" (release commit `7af70c8993a6f42973f520ae0752386a5032abe7`).
The v0.8 address is corroborated by the repository README ("Entrypoint Deployment"); the v0.7 and
v0.9 addresses come from the releases page only.

**Not yet verified, and must be before any deployment:**

- **Presence on Base.** Neither source states that the chosen EntryPoint is deployed on Base
  mainnet (8453) or Base Sepolia (84532), nor that it is a deterministic single-address deployment
  across chains. The README describes a per-network `hardhat deploy`, which is not a CREATE2
  guarantee. Verify with `cast code <entrypoint> --rpc-url base_sepolia` before scheduling a run.
  This could not be checked from the build environment: Base RPC is blocked by the egress policy.
- **Address checksum.** Copied verbatim from the source page; re-derive the EIP-55 checksum before
  putting it in a deploy script.
- **On-chain time-range enforcement** (ADR-0005, O-3). Read it off the EntryPoint source of the
  chosen version; the ERC-4337 text describes the `validAfter`/`validUntil` check as bundler-side.

### ERC-6551

| Item | Value | Source |
| --- | --- | --- |
| Canonical registry | `0x000000006551c19487814612e58FE06813775758` | ERC-6551. **This is what the deployment binds** — ADR-0002. Presence and conformance are re-proved by `DeployCore` at every deployment; they were never verified from the build environment, where Base RPC is blocked by egress policy. |


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
