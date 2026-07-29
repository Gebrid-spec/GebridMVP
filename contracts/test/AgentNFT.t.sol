// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {AgentNFT} from "../src/core/AgentNFT.sol";
import {Vm} from "forge-std/Test.sol";
import {GebridTestBase} from "./utils/GebridTestBase.sol";
import {ReentrantMinter} from "./utils/Mocks.sol";

contract AgentNFTTest is GebridTestBase {
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event AgentEpochAdvanced(uint256 indexed tokenId, uint64 epoch, address indexed holder);

    // --------------------------------------------------------------------------------------
    // Standards conformance
    // --------------------------------------------------------------------------------------

    function test_SupportsRequiredInterfaces() public view {
        assertTrue(nft.supportsInterface(type(IERC165).interfaceId), "IERC165");
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId), "IERC721");
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId), "IERC2981");
        assertTrue(nft.supportsInterface(type(IAccessControl).interfaceId), "IAccessControl");
        assertTrue(nft.supportsInterface(0x49064906), "IERC4906");
        assertFalse(nft.supportsInterface(0xdeadbeef), "unknown id");
    }

    /// @dev Guards the reason 0x49064906 is hardcoded: ERC-4906 declares only events, and events
    ///      do not contribute to a Solidity interface id, so the computed value is zero. If this
    ///      ever stops being true the hardcoded constant should be revisited.
    function test_ERC4906ComputedIdIsZero_HardcodeIsRequired() public pure {
        assertEq(type(IERC4906Events).interfaceId, bytes4(0));
    }

    function test_RoyaltyIsPaidPerERC2981() public {
        vm.startPrank(admin);
        nft.setDefaultRoyalty(admin, 500); // 5%
        uint256 tokenId = nft.mint(holder);
        vm.stopPrank();

        (address receiver, uint256 amount) = nft.royaltyInfo(tokenId, 10 ether);
        assertEq(receiver, admin);
        assertEq(amount, 0.5 ether);
    }

    function test_RevertWhen_RoyaltyExceedsHardCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgentNFT.RoyaltyTooHigh.selector, uint96(1001), uint96(1000)));
        nft.setDefaultRoyalty(admin, 1001);
    }

    function test_TokenRoyaltyOverridesDefault_AndIsClearedOnBurn() public {
        vm.startPrank(admin);
        nft.setDefaultRoyalty(admin, 500);
        uint256 tokenId = nft.mint(holder);
        nft.setTokenRoyalty(tokenId, attacker, 100);
        vm.stopPrank();

        (address receiver,) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, attacker);

        vm.prank(holder);
        nft.burn(tokenId);

        (address afterBurn, uint256 amount) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(afterBurn, admin, "falls back to default");
        assertEq(amount, 0.05 ether);
    }

    // --------------------------------------------------------------------------------------
    // Metadata (ERC-4906)
    // --------------------------------------------------------------------------------------

    function test_SetTokenURIEmitsMetadataUpdate() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        vm.expectEmit(true, true, true, true, address(nft));
        emit MetadataUpdate(tokenId);
        vm.prank(admin);
        nft.setTokenURI(tokenId, "ipfs://agent-1");

        assertEq(nft.tokenURI(tokenId), "ipfs://agent-1");
    }

    function test_SetBaseURIEmitsBatchMetadataUpdate() public {
        vm.startPrank(admin);
        nft.mint(holder);
        nft.mint(holder);

        vm.expectEmit(true, true, true, true, address(nft));
        emit BatchMetadataUpdate(1, 2);
        nft.setBaseURI("https://meta.gebrid.io/");
        vm.stopPrank();

        assertEq(nft.tokenURI(1), "https://meta.gebrid.io/1");
    }

    function test_SetBaseURIBeforeAnyMint_DoesNotEmitDegenerateRange() public {
        // A naive implementation emits BatchMetadataUpdate(1, 0) here, which indexers read as an
        // inverted range.
        vm.recordLogs();
        vm.prank(admin);
        nft.setBaseURI("https://meta.gebrid.io/");

        // `getRecordedLogs` drains the buffer, so it must be read exactly once.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 batchTopic = keccak256("BatchMetadataUpdate(uint256,uint256)");
        for (uint256 i = 0; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != batchTopic, "no batch event expected");
        }
    }

    function test_RevertWhen_NonMetadataRoleSetsURI() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        // Read the role before pranking: an external call between `prank` and the call under test
        // consumes the prank.
        bytes32 role = nft.METADATA_ROLE();

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role)
        );
        nft.setTokenURI(tokenId, "ipfs://hijacked");
    }

    // --------------------------------------------------------------------------------------
    // Continuity epoch
    // --------------------------------------------------------------------------------------

    function test_EpochAdvancesOnMintTransferAndBurn() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);
        assertEq(nft.agentEpoch(tokenId), 1, "mint");

        vm.prank(holder);
        nft.transferFrom(holder, attacker, tokenId);
        assertEq(nft.agentEpoch(tokenId), 2, "transfer");

        vm.prank(attacker);
        nft.burn(tokenId);
        assertEq(nft.agentEpoch(tokenId), 3, "burn");
    }

    function test_HolderCanAdvanceEpochAsKillSwitch() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        vm.expectEmit(true, true, true, true, address(nft));
        emit AgentEpochAdvanced(tokenId, 2, holder);
        vm.prank(holder);
        nft.advanceEpoch(tokenId);

        assertEq(nft.agentEpoch(tokenId), 2);
    }

    function test_RevertWhen_StrangerAdvancesEpoch() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, attacker, tokenId));
        nft.advanceEpoch(tokenId);
    }

    function test_UnmintedTokenHasZeroEpoch() public view {
        assertEq(nft.agentEpoch(999), 0);
    }

    // --------------------------------------------------------------------------------------
    // Adversarial
    // --------------------------------------------------------------------------------------

    /// @dev The receiver callback in `_safeMint` fires after the id counter has advanced, so a
    ///      re-entering minter gets a fresh id rather than a duplicate.
    function test_Adversarial_ReentrantMintCannotDuplicateTokenId() public {
        ReentrantMinter minter = new ReentrantMinter(address(nft));
        vm.startPrank(admin);
        nft.grantRole(nft.MINTER_ROLE(), address(minter));
        minter.arm();
        uint256 outerId = nft.mint(address(minter));
        vm.stopPrank();

        // The outer call reserves id 1 before the receiver hook runs, so the re-entrant mint is
        // handed id 2. Two distinct tokens exist and neither id was issued twice.
        assertEq(outerId, 1, "outer mint keeps the id it reserved");
        assertEq(nft.ownerOf(1), address(minter));
        assertEq(nft.ownerOf(2), address(minter));
        assertEq(nft.totalMinted(), 2);
        assertEq(nft.balanceOf(address(minter)), 2, "no id collision");
    }

    function test_Adversarial_BurnedTokenHasNoOwner() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);
        vm.prank(holder);
        nft.burn(tokenId);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, tokenId));
        nft.ownerOf(tokenId);
    }

    // --------------------------------------------------------------------------------------
    // Fuzz
    // --------------------------------------------------------------------------------------

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_RoyaltyNeverExceedsCap(uint96 feeNumerator, uint256 salePrice) public {
        feeNumerator = uint96(bound(feeNumerator, 0, nft.MAX_ROYALTY_BPS()));
        salePrice = bound(salePrice, 0, 1e30);

        vm.startPrank(admin);
        nft.setDefaultRoyalty(admin, feeNumerator);
        uint256 tokenId = nft.mint(holder);
        vm.stopPrank();

        (, uint256 amount) = nft.royaltyInfo(tokenId, salePrice);
        assertLe(amount * 10_000, salePrice * uint256(nft.MAX_ROYALTY_BPS()), "royalty above hard cap");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_EpochIsStrictlyMonotonicUnderTransfers(address[8] memory recipients) public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        address current = holder;
        uint64 previousEpoch = nft.agentEpoch(tokenId);

        for (uint256 i = 0; i < recipients.length; ++i) {
            address next = recipients[i];
            if (next == address(0) || next.code.length != 0 || next == current) continue;

            vm.prank(current);
            nft.transferFrom(current, next, tokenId);

            uint64 epoch = nft.agentEpoch(tokenId);
            assertGt(epoch, previousEpoch, "epoch must strictly increase on transfer");
            previousEpoch = epoch;
            current = next;
        }
    }
}

/// @dev Local re-declaration used only to demonstrate that an events-only interface has a zero
///      interface id. Mirrors OpenZeppelin's IERC4906 event set without its ERC-721 base.
interface IERC4906Events {
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
}
