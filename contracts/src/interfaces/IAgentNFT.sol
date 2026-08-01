// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IAgentNFT
/// @notice The slice of AgentNFT that the enforcement core depends on.
/// @dev `agentEpoch` is the continuity counter. It advances on mint, on every transfer, on burn
///      and on an explicit owner-triggered bump. Every downstream authorisation artefact
///      (permission grant, and later session key) pins the epoch it was minted under, so a
///      transfer or burn invalidates the whole authorisation set without an unbounded loop.
interface IAgentNFT is IERC721 {
    /// @notice Monotonically increasing continuity counter for `tokenId`. 0 means never minted.
    function agentEpoch(uint256 tokenId) external view returns (uint64);
}
