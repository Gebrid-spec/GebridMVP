# ADR-0004 — Admin model: two-step handover, split roles, and no owner where none is needed

**Status:** Accepted · **Date:** 2026-08-01 · **Phase:** 0.1, queue 0.1, step 1

## Context

The first revision of the enforcement core gave `AgentNFT` and `RiskEngine` OpenZeppelin
`AccessControl`, whose `DEFAULT_ADMIN_ROLE` transfer is single-step and can be granted to a second
address at any time, and gave `AgentPermissions` an `Ownable2Step` owner. Review flagged that the
admin address must be a multisig on mainnet. That is true and is recorded in `DEPLOYMENTS.md`, but
it is an operational control, and treating it as the whole answer leaves the contract-level surface
untouched.

## Decision

### 1. `AccessControlDefaultAdminRules` on both role-bearing contracts

`AgentNFT` and `RiskEngine` now use `AccessControlDefaultAdminRules`. Three properties follow:

- `DEFAULT_ADMIN_ROLE` **cannot be granted directly**, so a stolen admin key cannot quietly add a
  second admin and persist (`test_AdminRoleCannotBeGrantedDirectly`).
- Handover is begin/accept with an enforced delay (`GEBRID_ADMIN_TRANSFER_DELAY`, default 3 days),
  so an unauthorised transfer is visible on-chain long enough to be noticed
  (`test_AdminHandoverRequiresTheDelayAndAcceptance`).
- A pending handover can be cancelled inside the window, which is the point of having a window at
  all (`test_PendingAdminHandoverCanBeCancelled`).

The delay is a constructor argument so testnets can use a short one without changing code.

### 2. Roles split by what a compromise of each key would cost

The role split already in the code becomes an explicit deployment requirement rather than an
accident of the constructor bootstrapping everything to one address:

| Role | Holder | Why that placement is safe |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Safe multisig | Only role that can grant the others. |
| `CONFIG_ROLE` | Safe, behind a timelock | Retunes weights and thresholds (DEV-03). |
| `GUARDIAN_ROLE` | hot service key | Can only **escalate** the mode; de-escalation needs the admin role plus a cooldown. |
| `ATTESTER_ROLE` | scoring service key | Can only **raise** severities; the contract derives the verdict, and anti-downgrade means an attestation can never be weakened. |

The point worth stating plainly: because the enforcement design is asymmetric — escalation cheap,
de-escalation expensive — a compromise of either hot key produces a denial of service, not a theft.
That is what makes it acceptable to hold them hot at all, and it is why the split matters more than
the multisig alone.

The constructor grants all four to the deploying admin as a bootstrap. `DEPLOYMENTS.md` requires
them to be split before mainnet use.

### 3. `AgentPermissions` has no owner at all

`AgentPermissions` previously carried `Ownable2Step`. Its owner had exactly one power:
`setAccountImplementation`, a write-once binding that the deployment consumes immediately. After
deployment the owner could do nothing.

A live, transferable privileged role with no remaining function is not neutral — it is an
access-control surface that can only ever be a liability, and every future reader has to work out
that it is inert. It has been removed. The contract records an immutable `DEPLOYER` set in the
constructor; only that address may close the binding, and only once
(`test_Adversarial_OnlyDeployerCanBindTheAccountImplementation`,
`test_AccountImplementationCannotBeRebound`).

So the enforcement contract that governs every permission grant in the system has **no privileged
role whatsoever** once deployed. That is the strongest statement available about it, and it costs
nothing.

## Consequences

- Admin handover is slower by design. Losing the admin key without a pending transfer means the
  role is unrecoverable — the standard trade for removing single-step transfer, and the reason the
  holder-side kill switch (`AgentNFT.advanceEpoch`) deliberately does not depend on any admin.
- `AgentNFT` and `RiskEngine` constructors gained a delay parameter; `AgentPermissions` lost its
  owner parameter.
- `AgentNFT` now exposes `owner()` via `IERC5313` (it returns the default admin), which marketplaces
  read for collection ownership. Incidental, and useful.
- The deploy script asserts `defaultAdmin()` on both contracts and `DEPLOYER` on
  `AgentPermissions`, so a misconfigured deployment fails loudly instead of being discovered later.
