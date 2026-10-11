// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ArtofficialDays} from "../src/ArtofficialDays.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract Rejecter { receive() external payable { revert(); } function bid(ArtofficialDays d, uint256 id) external payable { d.bid{value: msg.value}(id); } }

contract DaysTest is Test {
    ArtofficialDays d; uint256 sk = 0xB00C; address platform = address(0x91A7); address treasury = address(0x7EA5);
    address alice = address(0xA1); address bob = address(0xB0B); address carol = address(0xCA201);
    function setUp() public {
        d = new ArtofficialDays(address(this), platform, treasury, vm.addr(sk), 0.001 ether, "https://merit.artofficial.computer/api/day/");
        vm.deal(alice, 10 ether); vm.deal(bob, 10 ether);
    }
    function sig(uint256 id, bytes32 root, uint32 shares, bytes32 state) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sk, MessageHashUtils.toEthSignedMessageHash(d.settlementDigest(id, root, shares, state)));
        return abi.encodePacked(r, s, v);
    }
    function leaf(address a, uint32 s) internal pure returns (bytes32) { return keccak256(bytes.concat(keccak256(abi.encode(a, s)))); }

    function test_auction_outbid_refund_settle_split_claim_next_day() public {
        vm.prank(alice); vm.expectRevert(ArtofficialDays.BidTooLow.selector); d.bid{value: 0.0005 ether}(1);
        vm.prank(alice); d.bid{value: 1 ether}(1);
        vm.prank(bob); vm.expectRevert(ArtofficialDays.BidTooLow.selector); d.bid{value: 1.04 ether}(1); // < +5%
        vm.prank(bob); d.bid{value: 1.05 ether}(1);
        assertEq(alice.balance, 10 ether); // refunded
        bytes memory early = sig(1, 0, 0, 0);
        vm.expectRevert(ArtofficialDays.AuctionNotOver.selector); d.settle(bytes32(0), 0, 0, early);
        // one contributor (carol) with one mark that day: root is the single leaf
        bytes32 root = leaf(carol, 1);
        vm.warp(block.timestamp + 1 days + 1);
        bytes memory wrong = sig(1, root, 2, bytes32("s")); bytes memory right = sig(1, root, 1, bytes32("s"));
        vm.expectRevert(ArtofficialDays.BadSignature.selector); d.settle(root, 1, bytes32("s"), wrong);
        d.settle(root, 1, bytes32("s"), right);
        assertEq(d.ownerOf(1), bob);
        assertEq(d.owed(platform), 0.105 ether);
        assertEq(d.owed(treasury), 0.42 ether);
        d.claim(1, carol, 1, new bytes32[](0));
        assertEq(carol.balance, 0.525 ether);
        vm.expectRevert(ArtofficialDays.AlreadyClaimed.selector); d.claim(1, carol, 1, new bytes32[](0));
        (uint256 id,,,,,) = d.auction();
        assertEq(id, 2);
        vm.prank(alice); vm.expectRevert(ArtofficialDays.WrongAuction.selector); d.bid{value: 1 ether}(1);
    }

    function test_no_bids_mints_nothing_and_moves_on() public {
        vm.warp(block.timestamp + 1 days);
        d.settle(bytes32(0), 0, bytes32("s"), sig(1, 0, 0, bytes32("s")));
        vm.expectRevert(); d.ownerOf(1);
        (uint256 id,,,,,) = d.auction(); assertEq(id, 2);
    }

    function test_late_bid_extends_and_unrefundable_bidder_can_withdraw() public {
        Rejecter rj = new Rejecter(); vm.deal(address(rj), 0); vm.deal(address(this), 5 ether);
        rj.bid{value: 1 ether}(d, 1);
        (,,, uint40 endBefore,,) = d.auction();
        vm.warp(endBefore - 60);
        vm.prank(bob); d.bid{value: 2 ether}(1);
        (,,, uint40 endAfter,,) = d.auction();
        assertEq(endAfter, uint40(block.timestamp + 5 minutes));
        assertEq(d.owed(address(rj)), 1 ether); // refund parked, not lost
    }

    function test_no_contributors_sends_half_to_treasury() public {
        vm.prank(alice); d.bid{value: 1 ether}(1);
        vm.warp(block.timestamp + 1 days);
        d.settle(bytes32(0), 0, bytes32("s"), sig(1, 0, 0, bytes32("s")));
        assertEq(d.owed(treasury), 0.9 ether);
        assertEq(d.owed(platform), 0.1 ether);
    }
}
