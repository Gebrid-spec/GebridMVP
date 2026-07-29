# SECRETS REGISTRY

Per invariant **I-P6**: keys and secrets never enter the repository. This file records the **names**
of the values the project needs and where they live. It must never contain a value.

Template with the same names: `contracts/.env.example`. `.env` files are gitignored.

## Deployment

| Name | Purpose | Where it lives | Notes |
| --- | --- | --- | --- |
| `GEBRID_ADMIN` | Address receiving `DEFAULT_ADMIN_ROLE` on AgentNFT and RiskEngine, and ownership of AgentPermissions. | Not secret — an address. Recorded in `DEPLOYMENTS.md`. | **Must be a multisig for mainnet.** See the open item in `DEPLOYMENTS.md`. |
| `DEPLOYER_PRIVATE_KEY` | Raw signing key. | Local `.env`, **testnet only**. | Preferred path is to leave this unset and use `--account` (keystore) or `--ledger`. `DeployCore` asserts the key corresponds to `GEBRID_ADMIN` before broadcasting. |

## RPC and services

| Name | Purpose | Where it lives |
| --- | --- | --- |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC endpoint (may embed a provider key). | Local `.env` / CI secret store. |
| `BASE_RPC_URL` | Base mainnet RPC endpoint. | Local `.env` / CI secret store. |
| `ETHERSCAN_API_KEY` | Source verification on Basescan. | Local `.env` / CI secret store. |

## Not yet used

Reserved for later steps, listed so the registry stays ahead of the code rather than behind it.

| Name | Introduced by |
| --- | --- |
| `LINEA_RPC_URL`, `BNB_RPC_URL` | Phase 2.1 / 2.2 deployments. |
| `GEBRID_ATTESTER_KEY` | Off-chain scoring service holding `ATTESTER_ROLE` (phase 0.3). |
| `GEBRID_API_*` | Screening API (phase 1.1 / 2.2). |

## Rules

1. No value in this repository — not in code, tests, fixtures, scripts, CI config, or docs.
2. Mainnet deploy keys: hardware wallet or KMS only. Never a raw key in an environment variable.
3. A key that has ever been in a shell history, a CI log, or a chat message is burned. Rotate it.
4. Adding a new secret means adding a row here **and** to `contracts/.env.example` in the same
   change.
