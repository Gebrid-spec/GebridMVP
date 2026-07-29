// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Burnable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IAgentNFT} from "../interfaces/IAgentNFT.sol";

/// @title AgentNFT
/// @notice Root identity for a GEBRID agent: ERC-721 + ERC-4906 (metadata updates) +
///         ERC-2981 (royalties), plus the continuity epoch the enforcement core is built on.
/// @dev Ownership of a token is the root authority over the matching ERC-6551 account. Because
///      that authority is transferable, every derived authorisation has to die when the token
///      moves. `agentEpoch` is how: it advances on mint, on every transfer, on burn, and on an
///      explicit owner bump, and grants pin the epoch they were issued under. Invalidation is
///      therefore O(1) and cannot be skipped by an unbounded-loop gas failure.
contract AgentNFT is ERC721, ERC721Burnable, ERC2981, AccessControl, IERC4906, IAgentNFT {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("GEBRID.AgentNFT.MINTER_ROLE");
    bytes32 public constant METADATA_ROLE = keccak256("GEBRID.AgentNFT.METADATA_ROLE");
    bytes32 public constant ROYALTY_ROLE = keccak256("GEBRID.AgentNFT.ROYALTY_ROLE");

    /// @dev ERC-4906 declares only events, so `type(IERC4906).interfaceId` computes to 0x00000000
    ///      (events do not contribute to an interface id). The value below is the one fixed by the
    ///      ERC itself and is what wallets and indexers actually probe for.
    bytes4 private constant _INTERFACE_ID_ERC4906 = 0x49064906;

    /// @notice Hard ceiling on royalties, in basis points. Not admin-adjustable.
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    uint256 private _nextTokenId = 1;
    string private _baseUri;

    mapping(uint256 tokenId => uint64 epoch) private _agentEpoch;
    mapping(uint256 tokenId => string uri) private _tokenUris;

    /// @notice Emitted whenever the continuity epoch of an agent advances.
    /// @param holder The token holder after the change; `address(0)` on burn.
    event AgentEpochAdvanced(uint256 indexed tokenId, uint64 epoch, address indexed holder);

    event BaseURIUpdated(string baseURI);

    error RoyaltyTooHigh(uint96 requestedBps, uint96 maxBps);
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, address admin) ERC721(name_, symbol_) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(METADATA_ROLE, admin);
        _grantRole(ROYALTY_ROLE, admin);
    }

    // --------------------------------------------------------------------------------------
    // Minting
    // --------------------------------------------------------------------------------------

    /// @notice Mints the next agent identity to `to`.
    function mint(address to) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        unchecked {
            _nextTokenId = tokenId + 1;
        }
        // Counter is advanced before the ERC-721 receiver callback, so a re-entering minter
        // cannot be handed the same id twice.
        _safeMint(to, tokenId);
    }

    /// @notice Number of agent identities ever minted (ids are never reused after a burn).
    function totalMinted() external view returns (uint256) {
        unchecked {
            return _nextTokenId - 1;
        }
    }

    // --------------------------------------------------------------------------------------
    // Continuity epoch
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function agentEpoch(uint256 tokenId) external view returns (uint64) {
        return _agentEpoch[tokenId];
    }

    /// @notice Emergency kill switch: invalidates every grant and session artefact issued under
    ///         the current epoch, without transferring or burning the token.
    /// @dev Deliberately callable by the token holder rather than by a protocol admin. Revocation
    ///      must not depend on GEBRID being reachable or willing.
    function advanceEpoch(uint256 tokenId) external {
        address holder = _requireOwned(tokenId);
        if (msg.sender != holder && !isApprovedForAll(holder, msg.sender) && getApproved(tokenId) != msg.sender) {
            revert ERC721InsufficientApproval(msg.sender, tokenId);
        }
        _advanceEpoch(tokenId, holder);
    }

    function _advanceEpoch(uint256 tokenId, address holder) private {
        uint64 next;
        unchecked {
            // uint64 cannot realistically wrap: one increment per transfer.
            next = _agentEpoch[tokenId] + 1;
        }
        _agentEpoch[tokenId] = next;
        emit AgentEpochAdvanced(tokenId, next, holder);
    }

    /// @dev Single choke point for mint, transfer and burn in OpenZeppelin v5.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address previousOwner)
    {
        previousOwner = super._update(to, tokenId, auth);
        _advanceEpoch(tokenId, to);
        if (to == address(0)) {
            // Burn: drop metadata and per-token royalty so a re-mint of the id cannot inherit them.
            // (Ids are not reused today, but the invariant should not depend on that.)
            delete _tokenUris[tokenId];
            _resetTokenRoyalty(tokenId);
        }
    }

    // --------------------------------------------------------------------------------------
    // Metadata (ERC-4906)
    // --------------------------------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override(ERC721) returns (string memory) {
        _requireOwned(tokenId);
        string memory perToken = _tokenUris[tokenId];
        if (bytes(perToken).length != 0) return perToken;
        return bytes(_baseUri).length == 0 ? "" : string.concat(_baseUri, tokenId.toString());
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external onlyRole(METADATA_ROLE) {
        _requireOwned(tokenId);
        _tokenUris[tokenId] = uri;
        emit MetadataUpdate(tokenId);
    }

    function setBaseURI(string calldata baseURI) external onlyRole(METADATA_ROLE) {
        _baseUri = baseURI;
        emit BaseURIUpdated(baseURI);
        uint256 minted = _nextTokenId;
        if (minted > 1) {
            unchecked {
                emit BatchMetadataUpdate(1, minted - 1);
            }
        }
    }

    // --------------------------------------------------------------------------------------
    // Royalties (ERC-2981)
    // --------------------------------------------------------------------------------------

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyRole(ROYALTY_ROLE) {
        if (feeNumerator > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(feeNumerator, MAX_ROYALTY_BPS);
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function deleteDefaultRoyalty() external onlyRole(ROYALTY_ROLE) {
        _deleteDefaultRoyalty();
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyRole(ROYALTY_ROLE) {
        if (feeNumerator > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(feeNumerator, MAX_ROYALTY_BPS);
        _requireOwned(tokenId);
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    // --------------------------------------------------------------------------------------
    // Introspection
    // --------------------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981, AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == _INTERFACE_ID_ERC4906 || super.supportsInterface(interfaceId);
    }
}
