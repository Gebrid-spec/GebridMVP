# Self-audit — `contracts/src/core/ERC6551Registry.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Claim families: IV, V (agent account identity).
Tests: `contracts/test/ERC6551Registry.t.sol` — 10 tests, 3 fuzz properties at 10,000 runs each.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| A1–A6 build | PASS | Same toolchain as the rest of the core. |
| B1 authority | PASS (by construction) | `createAccount` is permissionless **by the ERC**. It confers nothing: the account it deploys derives all authority from the token, and deploying someone's account for them is a courtesy, not a capability. |
| C10 canonical commitment | PASS | The account address is `CREATE2(registry, salt, keccak(creationCode))`; one tuple, one address. `test_AccountMatchesCreateAccount`, `testFuzz_DistinctTuplesGiveDistinctAccounts`. |
| F4 no unbounded loop | PASS (by construction) | No loops. |
| F5 low-level call checked | PASS | `create2` result checked against `address(0)`; reverts `AccountCreationFailed`. |
| G1 interface ids | PASS | `test_InterfaceIdsMatchERC6551` asserts `IERC6551Account == 0x6faff5f1` and `IERC6551Executable == 0x51945447` against the values fixed by the ERC. |
| G3 documented deviation | ACCEPTED | Own registry instance, not the canonical singleton — ADR-0002. |
| G4 standard events | PASS | `ERC6551AccountCreated` with the ERC's exact signature — `test_CreateAccountEmitsSpecEvent`. |
| H2 deploy script tested | PASS | `test/DeployCore.t.sol`. |

## Findings from this audit, and what changed

**F-REG-1 — `tokenContract` must occupy a full 32-byte word in the account footer.**
This is the one detail in this contract that is worth the whole file. The ERC-6551 account footer
is four 32-byte words: `salt | chainId | tokenContract | tokenId`. Writing the creation code as

```solidity
abi.encodePacked(..., salt, chainId, tokenContract, tokenId)   // WRONG
```

packs `tokenContract` as a bare 20-byte `address`, which shifts `tokenId` twelve bytes left. Every
account then misreports which token owns it — `AgentTBA.token()` reads garbage, `owner()` resolves
to the wrong holder or reverts, and the entire authority model silently detaches from the NFT. The
code uses `uint256(uint160(tokenContract))`, and this is pinned three ways:

- `test_DeployedBytecodeMatchesERC6551Layout` compares the deployed runtime byte-for-byte against
  the layout spelled out in the test, and asserts the total length is exactly 173 bytes;
- `test_AccountReadsItsOwnFooter` round-trips through a real account;
- `testFuzz_FooterRoundTrip` (10,000 runs) round-trips arbitrary `(salt, tokenContract, tokenId)`
  tuples, so a packing error cannot hide behind a convenient test vector.

**F-REG-2 — idempotency must not be an error.**
The ERC requires `createAccount` to return the existing address rather than revert when called
twice. Verified by `test_CreateAccountIsIdempotent`. A reverting registry would break any
integrator that calls `createAccount` defensively before use.

**F-REG-3 — implementation address is part of account identity.**
`testFuzz_ImplementationIsPartOfIdentity` proves a different implementation yields a different
account. This is what makes AgentTBA's immutable enforcement wiring safe: you cannot swap the
permission or risk engine behind an existing agent, because doing so would change the agent's
address.

## Adversarial tests

| Scenario | Test | Result |
| --- | --- | --- |
| Two distinct `(salt, tokenId)` tuples collide onto one account | `testFuzz_DistinctTuplesGiveDistinctAccounts` (10,000 runs) | No collision. |
| Swapping the implementation to take over an existing agent | `testFuzz_ImplementationIsPartOfIdentity` (10,000 runs) | Different address; takeover impossible. |
| Same token, different salt | `test_SaltSeparatesAccounts` | Distinct accounts. |
| Footer misparse for arbitrary inputs | `testFuzz_FooterRoundTrip` (10,000 runs) | Exact round-trip. |

## Known limitations

- **`implementation` is not checked for code.** The ERC does not require it, and adding the check
  would diverge from the reference behaviour. A caller that passes a codeless implementation gets
  an account whose calls all fail — self-inflicted, and it grants nothing to anyone.
- **Not the canonical singleton.** Accounts created here have different addresses from the same
  tuple created through `0x000000006551c19487814612e58FE06813775758`, because CREATE2 mixes in the
  deployer. The account *bytecode* is byte-identical, so 6551-aware tooling reads them correctly.
  Rationale and the cost of switching are in ADR-0002. This is an owner decision before mainnet.
