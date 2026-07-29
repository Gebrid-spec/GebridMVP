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
| ERC-6551 canonical registry | `0x000000006551c19487814612e58FE06813775758` | ERC-6551. **Not used** — see ADR-0002. |

## Open items before any mainnet deployment

1. **ADR-0002 decision.** Own registry instance vs. the canonical singleton. This changes every
   agent account address and is therefore only cheap *before* the first mainnet mint. Owner
   decision.
2. **`GEBRID_ADMIN` must be a multisig.** `AgentNFT` and `RiskEngine` use OpenZeppelin
   `AccessControl`, whose `DEFAULT_ADMIN_ROLE` transfer is single-step. An EOA admin is acceptable
   on testnet and is not acceptable on mainnet.
3. **`CONFIG_ROLE` behind a timelock.** It can retune RiskEngine weights and thresholds
   (deviation DEV-03). It cannot downgrade a stored attestation or disable a mandatory vector, but
   it does change which future severities produce a BLOCK.
4. **SPDX licence confirmation.** All source is currently `BUSL-1.1`. There is no `LICENSE` file in
   the repository. Owner to confirm before publication and Basescan verification.
5. **External audit (§0.2).** No mainnet deployment before findings ≥ Medium are closed.

## Deployment procedure

```bash
cd contracts
cp .env.example .env      # fill in; .env is gitignored

# Preferred: keystore or hardware wallet
forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url base_sepolia \
  --account gebrid-deployer --sender $GEBRID_ADMIN \
  --broadcast --verify -vvvv
```

The script deploys the five contracts, closes the one post-deployment wiring step
(`AgentPermissions.setAccountImplementation`), and asserts the whole wiring before returning. It is
covered by `contracts/test/DeployCore.t.sol` so it cannot rot between sessions.

After a successful broadcast: fill in the table above with address, version, commit hash and the
Basescan verification link, in the same change.
