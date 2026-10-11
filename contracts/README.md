# artofficial contracts (Base)

- `ArtofficialPortfolio` (ERC-1155 + ERC-2981): the Book at each milestone. Opened permissionlessly with the Book's signature; every sale split by the contract — 50% contributors in that state (equal per mark, Merkle claim after the window), 10% platform, 40% treasury; 5% resale royalty. No custody: contributors claim, platform/treasury withdraw.
- `ArtofficialMarks` (ERC-721 + ERC-5192): own your inscription. Soulbound — no transfer, no approval; the holder may burn. Minted to the wallet the mark's author bound with their Merit key, for a small fee.

`forge test` covers the split, claims, forged openings, windows, soulbound rules, and a cross-check that the Book's TypeScript signer, digests and Merkle proofs verify in Solidity.
