// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ArtofficialPortfolio} from "../src/ArtofficialPortfolio.sol";
import {ArtofficialMarks} from "../src/ArtofficialMarks.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract ArtofficialTest is Test {
    ArtofficialPortfolio pf; ArtofficialMarks mk;
    uint256 signerKey = 0xB00C; address signer;
    address owner = address(0xA11CE); address platform = address(0x91A7); address treasury = address(0x7EA5);
    address alice = address(0xA1); address bob = address(0xB0B); address collector = address(0xC011);

    function setUp() public {
        signer = vm.addr(signerKey);
        pf = new ArtofficialPortfolio(owner, platform, treasury, signer, "https://merit.artofficial.computer/api/portfolio/");
        mk = new ArtofficialMarks(owner, platform, signer, 0.0005 ether, "https://merit.artofficial.computer/api/mark-token/");
        vm.deal(collector, 100 ether);
    }

    function sign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }
    // two-leaf tree: alice 2 shares, bob 1 share (OZ double-hash leaves, sorted pairs)
    function leaf(address a, uint32 s) internal pure returns (bytes32) { return keccak256(bytes.concat(keccak256(abi.encode(a, s)))); }
    function root() internal view returns (bytes32) { bytes32 a = leaf(alice, 2); bytes32 b = leaf(bob, 1); return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a)); }

    function openOne() internal returns (uint64 end) {
        end = uint64(block.timestamp + 1 days);
        bytes memory sig = sign(pf.openingDigest(1, 0.01 ether, uint64(block.timestamp), end, root(), 3, bytes32("state")));
        vm.prank(collector);
        pf.openAndCollect{value: 0.030301 ether}(1, 0.01 ether, uint64(block.timestamp), end, root(), 3, bytes32("state"), sig, 3);
    }

    function test_split_and_claims() public {
        uint64 end = openOne();
        assertEq(pf.balanceOf(collector, 1), 3);
        // rising price: 0.01 + 0.0101 + 0.010201 = 0.030301
        assertEq(pf.owed(platform), 0.0030301 ether);   // 10%
        assertEq(pf.owed(treasury), 0.01212040 ether);  // 40%
        (,,,,,, uint256 pool,,,) = pf.portfolios(1);
        assertEq(pool, 0.01515050 ether);               // 50%
        assertEq(pf.quote(1, 1), 0.01030301 ether);     // next edition is 1% dearer
        bytes32[] memory pa = new bytes32[](1); pa[0] = leaf(bob, 1);
        vm.expectRevert(ArtofficialPortfolio.WindowNotClosed.selector);
        pf.claim(1, alice, 2, pa);
        vm.warp(end + 1);
        pf.claim(1, alice, 2, pa);
        assertEq(alice.balance, 10100333333333333); // pool 15150500000000000 * 2/3
        vm.expectRevert(ArtofficialPortfolio.AlreadyClaimed.selector);
        pf.claim(1, alice, 2, pa);
        bytes32[] memory pb = new bytes32[](1); pb[0] = leaf(alice, 2);
        vm.expectRevert(ArtofficialPortfolio.BadProof.selector);
        pf.claim(1, bob, 5, pb);                    // inflated shares rejected
        pf.claim(1, bob, 1, pb);
        assertEq(bob.balance, 5050166666666666);   // pool * 1/3
        vm.prank(platform); pf.withdraw(); assertEq(platform.balance, 0.0030301 ether);
        vm.prank(treasury); pf.withdraw(); assertEq(treasury.balance, 0.0121204 ether);
        assertLe(address(pf).balance, 2);                 // at most rounding dust
    }

    function test_rejects_forged_opening_wrong_payment_and_late_collect() public {
        uint64 end = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, MessageHashUtils.toEthSignedMessageHash(pf.openingDigest(2, 1, 0, end, root(), 3, 0)));
        vm.expectRevert(ArtofficialPortfolio.BadSignature.selector);
        pf.open(2, 1, 0, end, root(), 3, 0, abi.encodePacked(r, s, v));
        openOne();
        vm.prank(collector); vm.expectRevert(ArtofficialPortfolio.WrongPayment.selector);
        pf.collect{value: 0.01 ether}(1, 1);              // old price no longer accepted
        uint256 q = pf.quote(1, 1);
        vm.prank(collector); pf.collect{value: q}(1, 1);
        assertGt(pf.quote(1, 1), q);
        uint256 q51 = pf.quote(1, 51);
        vm.prank(collector); vm.expectRevert(ArtofficialPortfolio.NotOpen.selector);
        pf.collect{value: q51}(1, 51);                    // per-transaction cap
        vm.warp(end + 2);
        vm.prank(collector); vm.expectRevert(ArtofficialPortfolio.NotOpen.selector);
        pf.collect{value: 1 ether}(1, 1);
    }

    function test_no_contributors_means_treasury_gets_their_half() public {
        uint64 end = uint64(block.timestamp + 1 days);
        bytes memory sig = sign(pf.openingDigest(3, 1 ether, uint64(block.timestamp), end, bytes32(0), 0, 0));
        vm.prank(collector);
        pf.openAndCollect{value: 1 ether}(3, 1 ether, uint64(block.timestamp), end, bytes32(0), 0, 0, sig, 1);
        assertEq(pf.owed(treasury), 0.9 ether);
        assertEq(pf.owed(platform), 0.1 ether);
    }

    function test_royalty_and_uri() public view {
        (address rec, uint256 amt) = pf.royaltyInfo(1, 1 ether);
        assertEq(rec, treasury); assertEq(amt, 0.05 ether);
        assertEq(pf.uri(7), "https://merit.artofficial.computer/api/portfolio/7.json");
    }

    function test_marks_soulbound_with_fee() public {
        bytes memory sig = sign(mk.claimDigest(5, alice));
        vm.deal(alice, 1 ether);
        vm.prank(alice); vm.expectRevert(ArtofficialMarks.WrongPayment.selector);
        mk.mint{value: 0}(5, alice, sig);
        vm.prank(alice); mk.mint{value: 0.0005 ether}(5, alice, sig);
        assertEq(mk.ownerOf(5), alice);
        assertEq(platform.balance, 0.0005 ether);
        assertTrue(mk.locked(5));
        assertTrue(mk.supportsInterface(0xb45a3c0e));
        vm.prank(alice); vm.expectRevert(ArtofficialMarks.Soulbound.selector);
        mk.transferFrom(alice, bob, 5);
        vm.prank(alice); vm.expectRevert(ArtofficialMarks.Soulbound.selector);
        mk.approve(bob, 5);
        // a signature for alice cannot mint to bob
        vm.deal(bob, 1 ether);
        vm.prank(bob); vm.expectRevert(ArtofficialMarks.BadSignature.selector);
        mk.mint{value: 0.0005 ether}(5, bob, sig);
        vm.prank(bob); vm.expectRevert(ArtofficialMarks.Soulbound.selector);
        mk.burn(5);
        vm.prank(alice); mk.burn(5);
        vm.expectRevert();
        mk.ownerOf(5);
    }
}
