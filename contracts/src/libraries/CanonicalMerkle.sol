// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title CanonicalMerkle
/// @notice Canonical, domain-separated commitment over a permission target set (invariant I-P4).
/// @dev Three properties this library exists to guarantee:
///
///      1. Leaf/node domain separation. Leaves are hashed under prefix 0x00, internal nodes under
///         prefix 0x01. Without this, a 64-byte preimage of an internal node could be presented as
///         a leaf and a permission set could be extended with an entry nobody signed.
///      2. Canonical encoding. `root` accepts only a strictly increasing leaf array, so a given
///         target set has exactly one valid root. Duplicates and reorderings are rejected rather
///         than silently producing a different (or identical) root.
///      3. Fixed-width leaf preimages. `address` (20 bytes) and `bytes4` (4 bytes) are both fixed
///         width, so `encodePacked` here is unambiguous.
library CanonicalMerkle {
    /// @dev Version-tagged leaf domain. Chain id and contract address are bound separately by the
    ///      EIP-712 domain of whoever signs the resulting root, so they are deliberately not
    ///      repeated here: the tag exists to separate leaves from nodes and from other hash uses.
    bytes32 internal constant LEAF_DOMAIN = keccak256("GEBRID.PermissionLeaf.v1");

    bytes1 private constant LEAF_PREFIX = 0x00;
    bytes1 private constant NODE_PREFIX = 0x01;

    error EmptyLeafSet();
    error UnsortedLeaves(uint256 index);

    /// @notice Canonical leaf for an authorised (target, selector) pair.
    function leaf(address target, bytes4 selector) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(LEAF_PREFIX, LEAF_DOMAIN, target, selector));
    }

    /// @notice Canonical root over a strictly increasing leaf array.
    /// @dev Copies the input before reducing it, so the caller's array is left untouched.
    function root(bytes32[] calldata leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) revert EmptyLeafSet();

        bytes32[] memory level = new bytes32[](n);
        level[0] = leaves[0];
        for (uint256 i = 1; i < n; ++i) {
            if (leaves[i] <= leaves[i - 1]) revert UnsortedLeaves(i);
            level[i] = leaves[i];
        }

        while (n > 1) {
            uint256 width = 0;
            for (uint256 i = 0; i < n; i += 2) {
                // An odd trailing node is promoted unchanged. Safe here because the node prefix
                // makes a promoted leaf non-forgeable as an internal node.
                level[width++] = (i + 1 < n) ? _node(level[i], level[i + 1]) : level[i];
            }
            n = width;
        }
        return level[0];
    }

    /// @notice Verifies that `target` is committed to by `expectedRoot` under `proof`.
    function verify(bytes32 expectedRoot, bytes32 target, bytes32[] memory proof) internal pure returns (bool) {
        bytes32 computed = target;
        uint256 length = proof.length;
        for (uint256 i = 0; i < length; ++i) {
            computed = _node(computed, proof[i]);
        }
        return computed == expectedRoot;
    }

    function _node(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(NODE_PREFIX, a, b)) : keccak256(abi.encodePacked(NODE_PREFIX, b, a));
    }
}
