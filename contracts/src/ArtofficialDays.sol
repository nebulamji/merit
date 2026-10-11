// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title The Book, Today
/// @notice One page a day, forever, in the manner of Nouns: each day the Book is auctioned as a 1/1.
///         Settling a day (anyone can) mints the page to the winner and starts the next day's auction.
///         Proceeds are split by this contract: the people who inscribed marks during that day (equal
///         per mark, Merkle claim), the platform, and the treasury. Merit is never sold; the page is.
contract ArtofficialDays is ERC721, ERC2981, Ownable, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    uint16 public contributorsBps = 5_000;
    uint16 public platformBps = 1_000;

    uint256 public reservePrice;
    uint16 public minIncrementBps = 500;     // each bid at least 5% above the last
    uint40 public duration = 1 days;
    uint40 public timeBuffer = 5 minutes;    // a bid in the last minutes extends the auction

    struct Auction { uint256 id; uint256 amount; uint40 start; uint40 end; address bidder; bool settled; }
    struct Page { bytes32 contributors; uint32 totalShares; bytes32 bookState; uint256 pool; }

    Auction public auction;
    mapping(uint256 => Page) public pages;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public owed;

    address public bookSigner;
    address public platform;
    address public treasury;
    string public baseURI;

    event AuctionCreated(uint256 indexed id, uint256 start, uint256 end);
    event Bid(uint256 indexed id, address indexed bidder, uint256 amount, bool extended);
    event Settled(uint256 indexed id, address winner, uint256 amount, bytes32 bookState);
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);

    error AuctionOver();
    error AuctionNotOver();
    error WrongAuction();
    error BidTooLow();
    error BadSignature();
    error AlreadyClaimed();
    error BadProof();
    error NothingOwed();
    error TransferFailed();

    constructor(address owner_, address platform_, address treasury_, address bookSigner_, uint256 reserve_, string memory baseURI_)
        ERC721("The Book, Today", "DAY")
        Ownable(owner_)
    {
        platform = platform_; treasury = treasury_; bookSigner = bookSigner_; reservePrice = reserve_; baseURI = baseURI_;
        _setDefaultRoyalty(treasury_, 500);
        _create(1);
    }

    function _create(uint256 id) internal {
        uint40 s = uint40(block.timestamp);
        auction = Auction(id, 0, s, s + duration, address(0), false);
        emit AuctionCreated(id, s, s + duration);
    }

    function bid(uint256 id) external payable nonReentrant {
        Auction memory a = auction;
        if (a.id != id) revert WrongAuction();
        if (block.timestamp >= a.end) revert AuctionOver();
        if (msg.value < reservePrice || msg.value < a.amount + (a.amount * minIncrementBps) / BPS || (a.amount > 0 && msg.value == a.amount)) revert BidTooLow();
        address last = a.bidder; uint256 lastAmount = a.amount;
        auction.amount = msg.value;
        auction.bidder = msg.sender;
        bool extended = a.end - block.timestamp < timeBuffer;
        if (extended) auction.end = uint40(block.timestamp + timeBuffer);
        if (last != address(0)) _refund(last, lastAmount);
        emit Bid(id, msg.sender, msg.value, extended);
    }

    function settlementDigest(uint256 id, bytes32 contributors, uint32 totalShares, bytes32 bookState) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, contributors, totalShares, bookState));
    }

    /// @notice Anyone may settle once the day is over, with the Book's signed list of that day's contributors.
    function settle(bytes32 contributors, uint32 totalShares, bytes32 bookState, bytes calldata sig) external nonReentrant {
        Auction memory a = auction;
        if (a.settled) revert WrongAuction();
        if (block.timestamp < a.end) revert AuctionNotOver();
        bytes32 d = MessageHashUtils.toEthSignedMessageHash(settlementDigest(a.id, contributors, totalShares, bookState));
        if (ECDSA.recover(d, sig) != bookSigner) revert BadSignature();
        auction.settled = true;
        pages[a.id] = Page(contributors, totalShares, bookState, 0);
        if (a.bidder != address(0)) {
            _mint(a.bidder, a.id);
            uint256 toContributors = totalShares > 0 ? (a.amount * contributorsBps) / BPS : 0;
            uint256 toPlatform = (a.amount * platformBps) / BPS;
            pages[a.id].pool = toContributors;
            owed[platform] += toPlatform;
            owed[treasury] += a.amount - toContributors - toPlatform;
        }
        emit Settled(a.id, a.bidder, a.amount, bookState);
        _create(a.id + 1);
    }

    function claim(uint256 id, address account, uint32 shares, bytes32[] calldata proof) external nonReentrant {
        Page storage p = pages[id];
        if (claimed[id][account]) revert AlreadyClaimed();
        if (!MerkleProof.verify(proof, p.contributors, keccak256(bytes.concat(keccak256(abi.encode(account, shares)))))) revert BadProof();
        claimed[id][account] = true;
        uint256 amount = (p.pool * shares) / p.totalShares;
        _send(account, amount);
        emit Claimed(id, account, amount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        _send(msg.sender, amount);
    }

    /// Outbid refunds are pushed with limited gas; if the bidder can't receive, they withdraw it instead.
    function _refund(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount, gas: 30_000}("");
        if (!ok) owed[to] += amount;
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(baseURI, Strings.toString(id), ".json");
    }

    function setAuction(uint256 reserve_, uint16 minIncrementBps_, uint40 duration_, uint40 timeBuffer_) external onlyOwner {
        reservePrice = reserve_; minIncrementBps = minIncrementBps_; duration = duration_; timeBuffer = timeBuffer_;
    }
    function setSplit(uint16 c, uint16 p) external onlyOwner { require(uint256(c) + p <= BPS); contributorsBps = c; platformBps = p; }
    function setAddresses(address platform_, address treasury_, address bookSigner_) external onlyOwner { platform = platform_; treasury = treasury_; bookSigner = bookSigner_; }
    function setBaseURI(string calldata b) external onlyOwner { baseURI = b; }
    function setRoyalty(address r, uint96 bps) external onlyOwner { _setDefaultRoyalty(r, bps); }

    function supportsInterface(bytes4 i) public view override(ERC721, ERC2981) returns (bool) { return super.supportsInterface(i); }
}
