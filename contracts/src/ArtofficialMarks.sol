// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title artofficial Marks — own your inscription
/// @notice A contributor may put their own mark from the Book into their own wallet. It is soulbound
///         (ERC-5192): it can never be transferred or sold, because merit you can buy isn't merit.
///         The token id is the mark's number in the Book. The Book signs which wallet the mark's author chose.
contract ArtofficialMarks is ERC721, Ownable {
    address public bookSigner;
    address public platform;
    uint256 public fee;
    string public baseURI;

    event Locked(uint256 tokenId); // ERC-5192

    error BadSignature();
    error WrongPayment();
    error Soulbound();
    error TransferFailed();

    constructor(address owner_, address platform_, address bookSigner_, uint256 fee_, string memory baseURI_)
        ERC721("artofficial Marks", "MARK")
        Ownable(owner_)
    {
        platform = platform_;
        bookSigner = bookSigner_;
        fee = fee_;
        baseURI = baseURI_;
    }

    function claimDigest(uint256 seq, address to) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), seq, to));
    }

    function mint(uint256 seq, address to, bytes calldata sig) external payable {
        if (msg.value != fee) revert WrongPayment();
        if (ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(claimDigest(seq, to)), sig) != bookSigner) revert BadSignature();
        _mint(to, seq);
        emit Locked(seq);
        if (msg.value > 0) {
            (bool ok,) = payable(platform).call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// ERC-5192: every mark is locked.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    /// Only minting and the holder burning their own mark are allowed; no transfers, ever.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        if (from != address(0) && to == address(0) && auth != from) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }

    function burn(uint256 tokenId) external { _update(address(0), tokenId, msg.sender); }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseURI, Strings.toString(tokenId), ".json");
    }

    function supportsInterface(bytes4 i) public view override returns (bool) {
        return i == 0xb45a3c0e || super.supportsInterface(i);
    }

    function setFee(uint256 f) external onlyOwner { fee = f; }
    function setAddresses(address platform_, address bookSigner_) external onlyOwner { platform = platform_; bookSigner = bookSigner_; }
    function setBaseURI(string calldata b) external onlyOwner { baseURI = b; }
}
