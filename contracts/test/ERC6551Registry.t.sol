// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {AgentTBA} from "../src/core/AgentTBA.sol";
import {IERC6551Account, IERC6551Executable} from "../src/interfaces/IERC6551Account.sol";
import {GebridTestBase} from "./utils/GebridTestBase.sol";

contract ERC6551RegistryTest is GebridTestBase {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    // --------------------------------------------------------------------------------------
    // Interface ids fixed by the ERC
    // --------------------------------------------------------------------------------------

    /// @dev If these drift, wallets stop recognising the account. Asserting them here checks our
    ///      local interface declarations against the values the ERC fixes.
    function test_InterfaceIdsMatchERC6551() public pure {
        assertEq(type(IERC6551Account).interfaceId, bytes4(0x6faff5f1), "IERC6551Account");
        assertEq(type(IERC6551Executable).interfaceId, bytes4(0x51945447), "IERC6551Executable");
    }

    // --------------------------------------------------------------------------------------
    // Address derivation
    // --------------------------------------------------------------------------------------

    function test_AccountMatchesCreateAccount() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        address predicted = registry.account(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        address created = registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);

        assertEq(created, predicted, "counterfactual address must match the deployed one");
        assertGt(created.code.length, 0);
    }

    function test_CreateAccountIsIdempotent() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        address first = registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        address second = registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        assertEq(first, second);
    }

    function test_SaltSeparatesAccounts() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);

        address a = registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        address b =
            registry.createAccount(address(accountImpl), bytes32(uint256(1)), block.chainid, address(nft), tokenId);
        assertTrue(a != b, "different salts must yield different accounts");
    }

    function test_CreateAccountEmitsSpecEvent() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);
        address predicted = registry.account(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ERC6551AccountCreated(predicted, address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        registry.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
    }

    // --------------------------------------------------------------------------------------
    // Byte-level layout
    // --------------------------------------------------------------------------------------

    /// @dev The single most consequential detail in this contract. `tokenContract` must occupy a
    ///      full 32-byte word in the footer. Packing it as a bare 20-byte address shifts `tokenId`
    ///      by 12 bytes and every account then misreports which token owns it.
    function test_DeployedBytecodeMatchesERC6551Layout() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(holder);
        address account =
            registry.createAccount(address(accountImpl), bytes32(uint256(7)), block.chainid, address(nft), tokenId);

        bytes memory code = account.code;
        assertEq(code.length, 173, "45-byte proxy + 128-byte footer");

        bytes memory expected = abi.encodePacked(
            hex"363d3d373d3d3d363d73",
            address(accountImpl),
            hex"5af43d82803e903d91602b57fd5bf3",
            bytes32(uint256(7)),
            block.chainid,
            uint256(uint160(address(nft))),
            tokenId
        );
        assertEq(code, expected, "runtime bytecode must match the ERC-6551 layout exactly");
    }

    function test_AccountReadsItsOwnFooter() public {
        (uint256 tokenId, address payable account) = _mintAgent(holder);

        (uint256 chainId, address tokenContract, uint256 readTokenId) = AgentTBA(account).token();
        assertEq(chainId, block.chainid);
        assertEq(tokenContract, address(nft));
        assertEq(readTokenId, tokenId);
        assertEq(AgentTBA(account).owner(), holder);
    }

    // --------------------------------------------------------------------------------------
    // Fuzz
    // --------------------------------------------------------------------------------------

    /// @dev Round-trips the footer for arbitrary tuples. Any packing mistake in `_creationCode`
    ///      shows up as a mismatch between what went in and what the account reports back.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_FooterRoundTrip(bytes32 salt, address tokenContract, uint256 tokenId) public {
        address account = registry.createAccount(address(accountImpl), salt, block.chainid, tokenContract, tokenId);

        (uint256 outChainId, address outTokenContract, uint256 outTokenId) = AgentTBA(payable(account)).token();
        assertEq(outChainId, block.chainid, "chainId");
        assertEq(outTokenContract, tokenContract, "tokenContract");
        assertEq(outTokenId, tokenId, "tokenId");
    }

    /// @dev Distinct tuples must never collide onto one account, or two agents would share funds.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_DistinctTuplesGiveDistinctAccounts(
        bytes32 saltA,
        uint256 tokenIdA,
        bytes32 saltB,
        uint256 tokenIdB
    ) public view {
        vm.assume(saltA != saltB || tokenIdA != tokenIdB);

        address a = registry.account(address(accountImpl), saltA, block.chainid, address(nft), tokenIdA);
        address b = registry.account(address(accountImpl), saltB, block.chainid, address(nft), tokenIdB);
        assertTrue(a != b, "distinct tuples collided");
    }

    /// @dev A different implementation must yield a different account, otherwise swapping the
    ///      enforcement stack would silently take over existing agents.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_ImplementationIsPartOfIdentity(address implA, address implB, uint256 tokenId) public view {
        vm.assume(implA != implB);

        address a = registry.account(implA, bytes32(0), block.chainid, address(nft), tokenId);
        address b = registry.account(implB, bytes32(0), block.chainid, address(nft), tokenId);
        assertTrue(a != b, "implementation is not bound into the account address");
    }
}
