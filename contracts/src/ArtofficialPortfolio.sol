// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title artofficial Portfolios
/// @notice Each Portfolio is the Book at a milestone (every N marks). Anyone may open one with the
///         Book's signature; anyone may collect it during its window. Every payment is split by this
///         contract, with no custodian: contributors in that state (equal share per mark, only those
///         who set a payout address), the platform, and the treasury. Merit itself is never sold here.
contract ArtofficialPortfolio is ERC1155, ERC2981, Ownable, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    uint16 public contributorsBps = 5_000;
    uint16 public platformBps = 1_000; // the rest goes to the treasury

    /// Each edition collected raises the next price by this much (basis points), like a rising floor.
    uint16 public stepBps = 100; // 1% per edition
    uint256 public constant MAX_PER_TX = 50;

    struct Portfolio {
        uint128 price;          // wei for the first edition
        uint64 start;
        uint64 end;
        bytes32 contributors;   // Merkle root of (account, shares)
        uint32 totalShares;     // marks with a payout address
        bytes32 bookState;      // the Book's chain head at this milestone
        uint256 pool;           // contributors' share collected so far
        bool opened;
        uint32 sold;            // editions collected so far
        uint128 next;           // price of the next edition
    }

    address public bookSigner;
    address public platform;
    address public treasury;
    string public baseURI;

    mapping(uint256 => Portfolio) public portfolios;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public owed;

    event Opened(uint256 indexed id, bytes32 bookState, uint128 price, uint64 start, uint64 end, uint32 totalShares);
    event Collected(uint256 indexed id, address indexed collector, uint256 amount, uint256 paid);
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error BadSignature();
    error NotOpen();
    error WrongPayment();
    error WindowNotClosed();
    error AlreadyClaimed();
    error BadProof();
    error NothingOwed();
    error TransferFailed();
    error BadSplit();

    constructor(address owner_, address platform_, address treasury_, address bookSigner_, string memory baseURI_)
        ERC1155("")
        Ownable(owner_)
    {
        platform = platform_;
        treasury = treasury_;
        bookSigner = bookSigner_;
        baseURI = baseURI_;
        _setDefaultRoyalty(treasury_, 500); // 5% on resales
    }

    function openingDigest(uint256 id, uint128 price, uint64 start, uint64 end, bytes32 contributors, uint32 totalShares, bytes32 bookState)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), id, price, start, end, contributors, totalShares, bookState));
    }

    /// @notice Open a Portfolio with the Book's signature. Permissionless: the first collector usually does it.
    function open(uint256 id, uint128 price, uint64 start, uint64 end, bytes32 contributors, uint32 totalShares, bytes32 bookState, bytes calldata sig) public {
        if (portfolios[id].opened) return;
        bytes32 d = MessageHashUtils.toEthSignedMessageHash(openingDigest(id, price, start, end, contributors, totalShares, bookState));
        if (ECDSA.recover(d, sig) != bookSigner) revert BadSignature();
        portfolios[id] = Portfolio(price, start, end, contributors, totalShares, bookState, 0, true, 0, price);
        emit Opened(id, bookState, price, start, end, totalShares);
    }

    /// Price of the next `amount` editions: each one costs stepBps more than the one before.
    function quote(uint256 id, uint256 amount) public view returns (uint256 total) {
        (total,) = _quote(portfolios[id].next, amount);
    }

    function _quote(uint256 price, uint256 amount) internal view returns (uint256 total, uint256 nextPrice) {
        for (uint256 k = 0; k < amount; k++) { total += price; price = (price * (BPS + stepBps)) / BPS; }
        nextPrice = price;
    }

    function collect(uint256 id, uint256 amount) public payable {
        Portfolio storage p = portfolios[id];
        if (!p.opened || block.timestamp < p.start || block.timestamp > p.end || amount == 0 || amount > MAX_PER_TX) revert NotOpen();
        (uint256 total, uint256 nextPrice) = _quote(p.next, amount);
        if (msg.value != total) revert WrongPayment();
        p.sold += uint32(amount);
        p.next = uint128(nextPrice);
        uint256 toContributors = p.totalShares > 0 ? (msg.value * contributorsBps) / BPS : 0;
        uint256 toPlatform = (msg.value * platformBps) / BPS;
        p.pool += toContributors;
        owed[platform] += toPlatform;
        owed[treasury] += msg.value - toContributors - toPlatform;
        _mint(msg.sender, id, amount, "");
        emit Collected(id, msg.sender, amount, msg.value);
    }

    function openAndCollect(uint256 id, uint128 price, uint64 start, uint64 end, bytes32 contributors, uint32 totalShares, bytes32 bookState, bytes calldata sig, uint256 amount)
        external payable
    {
        open(id, price, start, end, contributors, totalShares, bookState, sig);
        collect(id, amount);
    }

    /// @notice After the window closes, a contributor (or anyone on their behalf) claims their share; funds go to the account.
    function claim(uint256 id, address account, uint32 shares, bytes32[] calldata proof) external nonReentrant {
        Portfolio storage p = portfolios[id];
        if (!p.opened || block.timestamp <= p.end) revert WindowNotClosed();
        if (claimed[id][account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, shares))));
        if (!MerkleProof.verify(proof, p.contributors, leaf)) revert BadProof();
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
        emit Withdrawn(msg.sender, amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(baseURI, Strings.toString(id), ".json");
    }

    // --- owner settings (the split itself is visible on-chain) ---
    function setSplit(uint16 contributorsBps_, uint16 platformBps_) external onlyOwner {
        if (uint256(contributorsBps_) + platformBps_ > BPS) revert BadSplit();
        contributorsBps = contributorsBps_;
        platformBps = platformBps_;
    }
    function setAddresses(address platform_, address treasury_, address bookSigner_) external onlyOwner {
        platform = platform_; treasury = treasury_; bookSigner = bookSigner_;
    }
    function setBaseURI(string calldata b) external onlyOwner { baseURI = b; }
    function setStep(uint16 bps) external onlyOwner { stepBps = bps; }
    function setRoyalty(address receiver, uint96 bps) external onlyOwner { _setDefaultRoyalty(receiver, bps); }

    function supportsInterface(bytes4 i) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(i);
    }
}
