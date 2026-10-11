// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// The Book's TypeScript signer, digests and Merkle tree must agree with the contracts' Solidity.
contract CrossCheckTest is Test {
    function test_typescript_artifacts_verify_in_solidity() public view {
        string memory j = vm.readFile("test/fixture.json");
        address signer = vm.parseJsonAddress(j, ".signer");
        bytes32 root = vm.parseJsonBytes32(j, ".root");
        address c = address(0xf0);
        bytes32 d = keccak256(abi.encode(uint256(8453), c, uint256(9), uint128(1e16), uint64(100), uint64(200), root, uint32(7), bytes32(0xabababababababababababababababababababababababababababababababab)));
        assertEq(d, vm.parseJsonBytes32(j, ".portfolioDigest"));
        assertEq(ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(d), vm.parseJsonBytes(j, ".portfolioSig")), signer);
        address a0 = vm.parseJsonAddress(j, ".accounts[0]");
        bytes32 m = keccak256(abi.encode(uint256(8453), c, uint256(5), a0));
        assertEq(m, vm.parseJsonBytes32(j, ".markDigest"));
        assertEq(ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(m), vm.parseJsonBytes(j, ".markSig")), signer);
        for (uint256 i = 0; i < 3; i++) {
            address acct = vm.parseJsonAddress(j, string.concat(".accounts[", vm.toString(i), "]"));
            uint32 shares = uint32(vm.parseJsonUint(j, string.concat(".shares[", vm.toString(i), "]")));
            bytes32[] memory proof = vm.parseJsonBytes32Array(j, string.concat(".proofs[", vm.toString(i), "]"));
            assertTrue(MerkleProof.verify(proof, root, keccak256(bytes.concat(keccak256(abi.encode(acct, shares))))));
            assertFalse(MerkleProof.verify(proof, root, keccak256(bytes.concat(keccak256(abi.encode(acct, shares + 1))))));
        }
    }
}
