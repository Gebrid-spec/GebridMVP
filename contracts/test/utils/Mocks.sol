// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC6551Executable} from "../../src/interfaces/IERC6551Account.sol";

/// @notice Records the last call it received and can be told to revert with a chosen reason.
contract CallTarget {
    uint256 public counter;
    uint256 public lastValue;
    bytes public lastData;
    bool public shouldRevert;
    string public revertReason = "CallTarget: forced revert";

    function ping() external payable returns (uint256) {
        if (shouldRevert) revert(revertReason);
        lastValue = msg.value;
        lastData = msg.data;
        return ++counter;
    }

    function pong(uint256 arg) external payable returns (uint256) {
        if (shouldRevert) revert(revertReason);
        lastValue = msg.value;
        lastData = msg.data;
        return counter += arg;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    receive() external payable {
        lastValue = msg.value;
    }
}

/// @notice Calls back into the agent account from inside the outbound call, to prove the
///         enforcement path is not bypassable by re-entering it.
contract ReentrantTarget {
    IERC6551Executable public immutable ACCOUNT;
    address public immutable INNER_TARGET;
    uint256 public attempts;
    bool public innerSucceeded;
    bytes public innerRevertData;

    constructor(IERC6551Executable account, address innerTarget) {
        ACCOUNT = account;
        INNER_TARGET = innerTarget;
    }

    function ping() external payable {
        attempts++;
        (bool ok, bytes memory ret) = address(ACCOUNT)
            .call(
                abi.encodeCall(
                    IERC6551Executable.execute, (INNER_TARGET, 1 wei, abi.encodeWithSignature("ping()"), uint8(0))
                )
            );
        innerSucceeded = ok;
        innerRevertData = ret;
    }

    receive() external payable {}
}

/// @notice ERC-1271 signer whose verdict is controlled by the test. Also an ERC-721 receiver, so
///         it can hold an AgentNFT and act as the root authority.
contract ContractSigner is IERC1271 {
    mapping(bytes32 hash => bool) public approved;

    function approve(bytes32 hash) external {
        approved[hash] = true;
    }

    function isValidSignature(bytes32 hash, bytes memory) public view returns (bytes4) {
        return approved[hash] ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @notice An account-shaped contract that lies about which token owns it. Used to prove
///         AgentPermissions re-derives the account address instead of trusting `token()`.
contract FakeAccount {
    uint256 private immutable CHAIN_ID;
    address private immutable TOKEN_CONTRACT;
    uint256 private immutable TOKEN_ID;

    constructor(uint256 chainId_, address tokenContract_, uint256 tokenId_) {
        CHAIN_ID = chainId_;
        TOKEN_CONTRACT = tokenContract_;
        TOKEN_ID = tokenId_;
    }

    function token() external view returns (uint256, address, uint256) {
        return (CHAIN_ID, TOKEN_CONTRACT, TOKEN_ID);
    }

    receive() external payable {}
}

/// @notice ERC-721 receiver that re-enters the minter, used to check id allocation.
contract ReentrantMinter {
    address public immutable NFT;
    bool private _armed;

    constructor(address nft) {
        NFT = nft;
    }

    function arm() external {
        _armed = true;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (_armed) {
            _armed = false;
            (bool ok,) = NFT.call(abi.encodeWithSignature("mint(address)", address(this)));
            ok; // outcome is asserted by the test through token ownership, not here
        }
        return this.onERC721Received.selector;
    }
}

/// @notice A contract that answers `account(...)` but derives addresses incorrectly. Stands in for
///         a wrong address, a proxy, or a look-alike registry sitting where the canonical ERC-6551
///         singleton is expected.
contract NonConformingRegistry {
    function account(address, bytes32, uint256, address, uint256) external view returns (address) {
        return address(this); // plausible-looking, and wrong
    }

    function createAccount(address, bytes32, uint256, address, uint256) external view returns (address) {
        return address(this);
    }
}
