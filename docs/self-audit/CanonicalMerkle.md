# Self-audit — `contracts/src/libraries/CanonicalMerkle.sol`

Gate: `docs/SELF-AUDIT-GATE-v2.md` (RECONSTRUCTED).
Invariant: **I-P4** (canonical encoding + domain separation; `leaf ≠ node`).
Tests: exercised through `contracts/test/AgentPermissions.t.sol`.

## Verdicts

| Check | Verdict | Evidence |
| --- | --- | --- |
| C8 unambiguous preimages | PASS | The only `encodePacked` operands are fixed-width: `bytes1`, `bytes32`, `address` (20), `bytes4` (4). No two adjacent dynamic types, so no two distinct inputs share a preimage. |
| C9 leaf ≠ node | PASS | Leaves hashed under `0x00`, internal nodes under `0x01` — `test_LeafAndNodeHashingAreDomainSeparated`. |
| C10 canonical commitment | PASS | `root()` requires strictly increasing leaves; duplicates and reorderings revert — `test_Adversarial_UnsortedLeavesAreRejected`, `test_Adversarial_DuplicateLeavesAreRejected`. |
| F4 no unbounded loop | PASS | Reduction is `O(n)` with `n ≤ MAX_TARGETS = 32`, bounded by the caller. |
| F6 arithmetic | PASS | No `unchecked`. |

## Why the prefixes exist

Without leaf/node domain separation, a 64-byte preimage of an internal node can be presented as a
leaf. Concretely: an attacker who can choose leaf values can offer `keccak(a‖b)` — a value that is
really an internal node — as though it were an authorised `(target, selector)` entry, and a
verifier that hashes leaves and nodes the same way cannot tell the difference. In this codebase
that would mean a permission set containing an entry nobody signed. The `0x00` / `0x01` prefixes
make the two preimage spaces disjoint.

The odd-node promotion in `root()` (a trailing unpaired node is carried up unchanged) is safe for
the same reason: a promoted *leaf* still cannot be reinterpreted as a node, because it was hashed
under a different prefix.

## Findings from this audit, and what changed

**F-MERK-1 — canonical means "one input set, one root".**
The first version accepted any leaf order. Two different orderings of the same set then produce
two different roots, and a duplicated leaf produces a third — so "the root the authority signed"
stops identifying a unique permission set, and a signature over one root could be argued to cover a
different set. `root()` now rejects anything that is not strictly increasing, which enforces both
ordering and de-duplication in a single comparison.

**F-MERK-2 — `root()` must not clobber the caller's array.**
The in-place reduction overwrote the input. In `AgentPermissions.grant` the same leaf array is
needed *after* the root is computed, to store the leaves and to run the subset check against the
parent — a clobbered array would have written the wrong (partially reduced) values into the grant's
leaf mapping. `root()` now copies into a fresh memory array first. This one is easy to miss because
the immediate symptom is silently wrong permissions rather than a revert.

**F-MERK-3 — leaf domain tag scope.**
`LEAF_DOMAIN = keccak256("GEBRID.PermissionLeaf.v1")` is a version tag only. Chain id and
verifying contract are bound by the EIP-712 domain of whoever signs the root, so repeating them in
every leaf would be redundant gas. Recorded because it looks like a missing separation until you
follow it through to the signature.

## Known limitations

- **Not compatible with OpenZeppelin `MerkleProof`.** The prefixes are deliberate and make the
  trees incompatible with generic tooling. Off-chain builders must use `AgentPermissions.leafOf`
  and mirror `root()`; the test suite's `_root` helper is a reference implementation, written
  independently of the library so the tests do not simply ask the code under test for the answer.
- **`verify()` is unused on the enforcement path today.** Enforcement reads the stored leaf mapping
  (see `AgentPermissions.md`, D2/D3). `verify` is retained for off-chain proofs and for a future
  variant that carries proofs rather than enumerating leaves.
