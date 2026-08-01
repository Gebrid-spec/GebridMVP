# Self-audit — `contracts/src/libraries/ERC6551Bytecode.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Claim families: IV, V (agent account identity).
Tests: exercised through `contracts/test/ERC6551Registry.t.sol` (byte-level and fuzz) and
`contracts/test/DeployCore.t.sol` (registry conformance).

## Why this library exists

Extracted from `ERC6551Registry` when ADR-0002 was reversed in favour of the canonical singleton.
Once GEBRID binds a registry it did not deploy, the ERC-6551 address derivation has to be available
*independently of that registry*, so the deployment can check the registry rather than trust it.

`DeployCore._requireConformingRegistry` computes a probe account address with
`computeAccount(registry, ...)` and compares it against what the registry's own `account()` view
returns. Disagreement aborts the deployment.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1–A6 build | PASS | Zero warnings. |
| C8 unambiguous preimages | PASS | Every `encodePacked` operand is fixed-width: `bytes` literals, `address` (20), `bytes32`, `uint256`. |
| C10 canonical derivation | PASS | One tuple, one address — `testFuzz_DistinctTuplesGiveDistinctAccounts`, `testFuzz_FooterRoundTrip` (10,000 runs each). |
| F4 no unbounded loop | PASS (by construction) | No loops. |
| F6 arithmetic | PASS | No arithmetic beyond a cast. |
| G3 spec fidelity | PASS | `test_DeployedBytecodeMatchesERC6551Layout` compares a real deployed account byte-for-byte and asserts a length of exactly 173. |

## The one thing that matters here

`tokenContract` must occupy a full 32-byte word in the account footer. Writing

```solidity
abi.encodePacked(..., salt, chainId, tokenContract, tokenId)   // WRONG
```

packs it as a bare 20-byte `address`, shifting `tokenId` twelve bytes left. Every account then
misreports which token owns it: `AgentTBA.token()` reads garbage, `owner()` resolves to the wrong
holder or to zero, and the whole authority model silently detaches from the NFT. The library uses
`uint256(uint160(tokenContract))`, pinned by the byte-level test and by a 10,000-run fuzz round-trip
so a packing error cannot hide behind a convenient test vector.

`runtimeCode` and `creationCode` differ only by the 10-byte constructor prefix. Both are kept
because the byte-level test asserts against the *runtime* while address derivation hashes the
*creation* code; deriving one from the other by slicing would be the kind of cleverness that breaks
silently.

## Adversarial tests

| Scenario | Test | Result |
| --- | --- | --- |
| A look-alike registry answering `account(...)` with a plausible but wrong address | `DeployCore.t.sol::test_Adversarial_NonConformingRegistryAtCanonicalAddressAborts` | Deployment aborts. |
| No registry at the configured address | `DeployCore.t.sol::test_RevertWhen_CanonicalRegistryIsAbsent` | Deployment aborts. |
| Footer misparse for arbitrary tuples | `ERC6551Registry.t.sol::testFuzz_FooterRoundTrip` (10,000 runs) | Exact round-trip. |

## Known limitations

- **The conformance check proves address derivation, not deployment behaviour.** A registry could
  derive addresses correctly and still fail to deploy, or deploy different code. Checking that
  would require an actual `createAccount` during the deployment, leaving a stray account behind. The
  address derivation is the property that agent identity depends on, so that is what is checked;
  a wrong-code registry would fail on first real use rather than silently mis-assign identity.
- **No on-chain verification of the singleton was possible from the build environment.** Base RPC
  endpoints are blocked by the egress policy, so the canonical registry's code was never fetched
  here. This is the reason the check is behavioural and runs at deployment time instead of being a
  hardcoded code hash.
