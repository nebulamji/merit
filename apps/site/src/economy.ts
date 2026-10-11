// The art economy, server side: wallet bindings, Portfolio windows (frozen when they open), the Book's
// signatures for the contracts, and token metadata. Everything here is automatic; nobody curates.
import { canonicalJSON } from '@merit/spec';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { ethSign, leafOf, merkle, portfolioDigest, markDigest, addressOf } from './eth';
import { bookSVG, type MarkLike } from './art';

export interface EconomyEnv {
  CHAIN_ID?: string; PORTFOLIO_ADDRESS?: string; MARKS_ADDRESS?: string;
  PORTFOLIO_EVERY?: string; PORTFOLIO_PRICE_WEI?: string; PORTFOLIO_HOURS?: string; MARK_FEE_WEI?: string;
  BOOK_SIGNER_KEY?: string;
}

export const config = (env: EconomyEnv) => ({
  chain_id: Number(env.CHAIN_ID ?? 8453),
  portfolio: env.PORTFOLIO_ADDRESS || null,
  marks: env.MARKS_ADDRESS || null,
  every: Number(env.PORTFOLIO_EVERY ?? 100),
  price_wei: env.PORTFOLIO_PRICE_WEI ?? '2000000000000000',
  hours: Number(env.PORTFOLIO_HOURS ?? 24),
  mark_fee_wei: env.MARK_FEE_WEI ?? '200000000000000',
  book_signer: env.BOOK_SIGNER_KEY ? addressOf(env.BOOK_SIGNER_KEY) : null,
  split: { contributors: 0.5, platform: 0.1, treasury: 0.4, royalty: 0.05 },
});

export interface WalletBinding { schema: 'merit-wallet/0.1'; public_key: string; address: string; created_utc: string; signature: string }

/** A contributor's Merit key signs which wallet receives their share and may own their marks. */
export function verifyWallet(b: WalletBinding): string | null {
  if (b?.schema !== 'merit-wallet/0.1') return 'unknown format';
  if (!/^0x[0-9a-fA-F]{40}$/.test(b.address)) return 'not an Ethereum address';
  const { signature, ...body } = b;
  try { if (!ed25519.verify(hexToBytes(signature), utf8ToBytes(canonicalJSON(body)), hexToBytes(b.public_key))) return 'signature does not verify'; }
  catch { return 'malformed'; }
  return null;
}

export interface Snapshot { n: number; marks: number; start: number; end: number; root: string; total_shares: number; book_state: string; price_wei: string; contributors: Record<string, number> }

/** Freeze a Portfolio: marks 1..n*every, one share per mark whose author set a wallet. */
export function snapshot(n: number, marks: { seq: number; public_key: string; chain: string }[], wallets: Map<string, string>, cfg: ReturnType<typeof config>, nowSec: number): Snapshot {
  const upto = marks.filter((m) => m.seq <= n * cfg.every);
  const contributors: Record<string, number> = {};
  for (const m of upto) { const a = wallets.get(m.public_key); if (a) contributors[a.toLowerCase()] = (contributors[a.toLowerCase()] ?? 0) + 1; }
  const entries = Object.entries(contributors);
  const t = merkle(entries.map(([a, s]) => leafOf(a, s)));
  return { n, marks: upto.length, start: nowSec, end: nowSec + cfg.hours * 3600, root: t.root, total_shares: entries.reduce((x, [, s]) => x + s, 0), book_state: '0x' + upto[upto.length - 1].chain, price_wei: cfg.price_wei, contributors };
}

export function opening(s: Snapshot, env: EconomyEnv) {
  const cfg = config(env);
  if (!cfg.portfolio || !env.BOOK_SIGNER_KEY) return null;
  const d = portfolioDigest(cfg.chain_id, cfg.portfolio, s.n, BigInt(s.price_wei), s.start, s.end, s.root, s.total_shares, s.book_state);
  return { id: s.n, price: s.price_wei, start: s.start, end: s.end, contributors: s.root, total_shares: s.total_shares, book_state: s.book_state, sig: ethSign(d, env.BOOK_SIGNER_KEY), contract: cfg.portfolio, chain_id: cfg.chain_id };
}

export function claimProof(s: Snapshot, address: string) {
  const entries = Object.entries(s.contributors);
  const i = entries.findIndex(([a]) => a === address.toLowerCase());
  if (i < 0) return null;
  const t = merkle(entries.map(([a, sh]) => leafOf(a, sh)));
  return { id: s.n, account: entries[i][0], shares: entries[i][1], proof: t.proof(i) };
}

export function markClaim(seq: number, to: string, env: EconomyEnv) {
  const cfg = config(env);
  if (!cfg.marks || !env.BOOK_SIGNER_KEY) return null;
  return { seq, to, fee: cfg.mark_fee_wei, contract: cfg.marks, chain_id: cfg.chain_id, sig: ethSign(markDigest(cfg.chain_id, cfg.marks, seq, to), env.BOOK_SIGNER_KEY) };
}

const SITE = 'https://merit.artofficial.computer';
export function portfolioMeta(s: Snapshot) {
  return {
    name: `artofficial Portfolio No. ${s.n}`,
    description: `The Book at mark ${s.marks}: every certified act of work so far, drawn from how it was made, in order. Half of every sale went to the people whose marks are in it.`,
    image: `${SITE}/api/portfolio/${s.n}.svg`,
    external_url: `${SITE}/collect`,
    attributes: [{ trait_type: 'Marks', value: s.marks }, { trait_type: 'Contributors paid', value: Object.keys(s.contributors).length }, { trait_type: 'Book state', value: s.book_state }],
  };
}
export const markMeta = (seq: number, id: string) => ({
  name: `artofficial Mark No. ${seq}`,
  description: 'One certified act of work, inscribed in the Book and owned by its author. Soulbound: merit you can buy isn\'t merit.',
  image: `${SITE}/api/mark-token/${seq}.svg`, external_url: `${SITE}/api/mark/${seq}`, attributes: [{ trait_type: 'Certificate', value: id }],
});

export const portfolioSVG = (marks: MarkLike[], head: string, genesis: string, n: number) => bookSVG(marks, head, genesis, { title: `artofficial Portfolio No. ${n}` });
export const markSVG = (m: MarkLike, genesis: string) => bookSVG([{ ...m, by_seq: -1 }], m.id.replace(/^merit_/, '').padEnd(64, '0'), genesis, { size: 600, title: `artofficial Mark` });
export { bytesToHex };
