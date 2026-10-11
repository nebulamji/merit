import { attestationId, sha256Hex, type MeritAttestation } from '@merit/spec';
import { verifySignature, bodyOf } from '@merit/attest';
import { shapeOf } from './shape';
import { blockMerkleRoot } from '../../../packages/verify/src/ots';
import { RULES, FOUNDER, EARN, workFloor, anchorClaim, recognitionClaim, earnedClaim, type Proved } from './qualify';
import type { Recognition } from '@merit/attest';
import { readAuction } from './eth';
import { daySnapshot, settlement, dayClaim, dayMeta, type DaySnapshot } from './economy';
import { config, verifyWallet, snapshot, opening, claimProof, markClaim, portfolioMeta, markMeta, portfolioSVG, markSVG, type EconomyEnv, type Snapshot, type WalletBinding } from './economy';

import { DurableObject } from 'cloudflare:workers';

interface Env extends EconomyEnv { ADMIN_TOKEN?: string; BOOK: DurableObjectNamespace<Book>; ASSETS: Fetcher; FOUNDER?: string }

/** Mark 0 is the paper itself: the sha256 of the whitepaper as published here. Set at build. */
declare const GENESIS: string;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function check(c: any): { ok: boolean; reason?: string } {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'not a certificate' };
  if (c.schema !== 'merit-attestation/0.1') return { ok: false, reason: 'unknown schema' };
  try {
    if (c.id !== attestationId(bodyOf(c))) return { ok: false, reason: 'id does not match content' };
    if (!verifySignature(c)) return { ok: false, reason: 'signature does not verify' };
  } catch { return { ok: false, reason: 'malformed certificate' }; }
  return { ok: true };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inscriptions (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, public_key TEXT, created_utc TEXT NOT NULL,
  inscribed_utc TEXT NOT NULL, chain TEXT NOT NULL, shape TEXT NOT NULL, certificate TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (height INTEGER PRIMARY KEY, root TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallets (public_key TEXT PRIMARY KEY, address TEXT NOT NULL, binding TEXT NOT NULL, set_utc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolios (n INTEGER PRIMARY KEY, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS days (id INTEGER PRIMARY KEY, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notify (email TEXT PRIMARY KEY, topics TEXT NOT NULL, created_utc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, certificate TEXT NOT NULL, ots TEXT NOT NULL, shape TEXT NOT NULL, requested_utc TEXT NOT NULL);`;
const REQUEST_DAYS = 30;
const MAX_OPEN_REQUESTS = 500;
const COLUMNS = ['recognizer TEXT', 'by_seq INTEGER', 'anchor_height INTEGER', 'ots TEXT', 'recognition TEXT'];

/**
 * The Book: one Durable Object, one writer. Every inscription is appended in a single-threaded
 * sequence, so the order and the chain can never race. Rows are only ever appended.
 */
export class Book extends DurableObject {
  sql: SqlStorage;
  founder: string;
  env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.founder = env.FOUNDER || FOUNDER;
    this.sql.exec(SCHEMA_SQL);
    for (const c of COLUMNS) { try { this.sql.exec(`ALTER TABLE inscriptions ADD COLUMN ${c}`); } catch { /* exists */ } }
  }
  list() {
    const marks = this.sql.exec('SELECT seq, id, substr(public_key,1,12) AS key, created_utc, inscribed_utc, chain, shape, by_seq, anchor_height FROM inscriptions ORDER BY seq').toArray()
      .map((x: any) => ({ ...x, shape: JSON.parse(x.shape) }));
    return { genesis: GENESIS, founder: this.founder, rules: { ...RULES, earn: EARN }, head: marks.length ? (marks[marks.length - 1] as any).chain : GENESIS, marks };
  }
  mark(seq: number) {
    const r = this.sql.exec('SELECT seq, chain, certificate, by_seq, anchor_height, ots, recognition FROM inscriptions WHERE seq = ?', seq).toArray()[0] as any;
    return r ? { seq: r.seq, chain: r.chain, recognized_by_mark: r.by_seq, anchor_height: r.anchor_height, certificate: JSON.parse(r.certificate), ots_base64: r.ots, recognition: r.recognition ? JSON.parse(r.recognition) : null } : null;
  }
  async blockRoot(height: number): Promise<string> {
    const hit = this.sql.exec('SELECT root FROM blocks WHERE height = ?', height).toArray()[0] as any;
    if (hit) return hit.root;
    const root = await blockMerkleRoot(height);
    this.sql.exec('INSERT OR IGNORE INTO blocks (height, root) VALUES (?, ?)', height, root);
    return root;
  }

  // ---------------- the art economy ----------------
  setWallet(b: WalletBinding) {
    const bad = verifyWallet(b);
    if (bad) return { ok: false, status: 422, reason: bad };
    if (!this.sql.exec('SELECT 1 FROM inscriptions WHERE public_key = ?', b.public_key).toArray().length) return { ok: false, status: 422, reason: 'that key has no mark in the Book yet' };
    this.sql.exec('INSERT INTO wallets (public_key, address, binding, set_utc) VALUES (?,?,?,?) ON CONFLICT(public_key) DO UPDATE SET address = excluded.address, binding = excluded.binding, set_utc = excluded.set_utc',
      b.public_key, b.address.toLowerCase(), JSON.stringify(b), new Date().toISOString());
    return { ok: true, address: b.address.toLowerCase() };
  }
  wallet(publicKey: string): string | null {
    return (this.sql.exec('SELECT address FROM wallets WHERE public_key = ?', publicKey).toArray()[0] as any)?.address ?? null;
  }
  /** Portfolio n exists once the Book reaches n*every marks; its contributor list freezes the first time anyone opens it. */
  portfolio(n: number): Snapshot | { error: string } {
    const cfg = config(this.env);
    const have = (this.sql.exec('SELECT snapshot FROM portfolios WHERE n = ?', n).toArray()[0] as any)?.snapshot;
    if (have) return JSON.parse(have);
    const count = (this.sql.exec('SELECT COUNT(*) AS c FROM inscriptions').one() as any).c as number;
    if (!Number.isInteger(n) || n < 1 || count < n * cfg.every) return { error: `Portfolio ${n} opens at ${n * cfg.every} marks (the Book has ${count})` };
    const marks = this.sql.exec('SELECT seq, public_key, chain FROM inscriptions WHERE seq <= ? ORDER BY seq', n * cfg.every).toArray() as any[];
    const wallets = new Map((this.sql.exec('SELECT public_key, address FROM wallets').toArray() as any[]).map((w) => [w.public_key, w.address] as const));
    const s = snapshot(n, marks, wallets, cfg, Math.floor(Date.now() / 1000));
    this.sql.exec('INSERT INTO portfolios (n, snapshot) VALUES (?, ?)', n, JSON.stringify(s));
    return s;
  }
  portfolios() {
    const cfg = config(this.env);
    const count = (this.sql.exec('SELECT COUNT(*) AS c FROM inscriptions').one() as any).c as number;
    const opened = (this.sql.exec('SELECT snapshot FROM portfolios ORDER BY n').toArray() as any[]).map((r) => JSON.parse(r.snapshot) as Snapshot)
      .map((s) => ({ n: s.n, marks: s.marks, start: s.start, end: s.end, contributors: Object.keys(s.contributors).length, total_shares: s.total_shares, price_wei: s.price_wei }));
    return { config: cfg, marks: count, available: Math.floor(count / cfg.every), next_at: (Math.floor(count / cfg.every) + 1) * cfg.every, opened };
  }
  /** Email list: only people who asked, only about Merit. Never shown publicly. */
  notify(email: string, topics: string[], ipBucket: string) {
    const n = (this.sql.exec('INSERT INTO rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n', 'notify|' + ipBucket).one() as any).n;
    if (n > 5) return { ok: false, status: 429, reason: 'slow down' };
    this.sql.exec('INSERT INTO notify (email, topics, created_utc) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET topics = excluded.topics', email, JSON.stringify(topics), new Date().toISOString());
    return { ok: true };
  }
  unnotify(email: string) { this.sql.exec('DELETE FROM notify WHERE email = ?', email); return { ok: true }; }
  notifyExport() { return this.sql.exec('SELECT email, topics, created_utc FROM notify ORDER BY created_utc').toArray(); }

  /** Freeze day `id` once its auction has ended on chain: the marks since the previous day. */
  async day(id: number, verifyChain: boolean): Promise<DaySnapshot | { error: string }> {
    const have = (this.sql.exec('SELECT snapshot FROM days WHERE id = ?', id).toArray()[0] as any)?.snapshot;
    if (have) return JSON.parse(have);
    if (!verifyChain) return { error: `day ${id} has not been settled yet` };
    const cfg = config(this.env);
    const lastId = (this.sql.exec('SELECT MAX(id) AS m FROM days').one() as any).m ?? 0;
    if (id !== lastId + 1) return { error: `day ${lastId + 1} must be settled first` };
    {
      if (!cfg.days) return { error: 'the daily auction is not deployed yet' };
      const a = await readAuction(cfg.rpc, cfg.days);
      if (a.id !== id) return { error: `the current auction is day ${a.id}` };
      if (a.chainTime < a.end) return { error: `day ${id} is still open` };
    }
    const prev = lastId ? (JSON.parse((this.sql.exec('SELECT snapshot FROM days WHERE id = ?', lastId).one() as any).snapshot) as DaySnapshot).to_seq : 0;
    const marks = this.sql.exec('SELECT seq, public_key, chain FROM inscriptions ORDER BY seq').toArray() as any[];
    const wallets = new Map((this.sql.exec('SELECT public_key, address FROM wallets').toArray() as any[]).map((w) => [w.public_key, w.address] as const));
    const s = daySnapshot(id, prev, marks, wallets, GENESIS, Math.floor(Date.now() / 1000));
    this.sql.exec('INSERT INTO days (id, snapshot) VALUES (?, ?)', id, JSON.stringify(s));
    return s;
  }
  daysList() {
    return (this.sql.exec('SELECT snapshot FROM days ORDER BY id').toArray() as any[]).map((r) => { const s = JSON.parse(r.snapshot) as DaySnapshot; return { id: s.id, marks: s.to_seq - s.from_seq, contributors: Object.keys(s.contributors).length }; });
  }

  marksUpTo(n: number) {
    return (this.sql.exec('SELECT seq, id, shape, by_seq, chain FROM inscriptions WHERE seq <= ? ORDER BY seq', n).toArray() as any[]).map((m) => ({ ...m, shape: JSON.parse(m.shape) }));
  }
  markAuthor(seq: number) {
    return this.sql.exec('SELECT public_key, id FROM inscriptions WHERE seq = ?', seq).toArray()[0] as any;
  }

  /**
   * Ask for recognition: real work, anchored in Bitcoin, waiting for someone in the Book to recognize it.
   * The same checks as inscription run now, so a recognizer only ever sees work that already qualified.
   */
  async request(cert: MeritAttestation, otsB64: string, ipBucket: string) {
    if (this.sql.exec('SELECT 1 FROM inscriptions WHERE id = ?', cert.id).toArray().length) return { ok: false, status: 409, reason: 'already in the Book' };
    if (this.sql.exec('SELECT 1 FROM requests WHERE id = ?', cert.id).toArray().length) return { ok: true, already: true };
    const n = (this.sql.exec('INSERT INTO rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n', ipBucket).one() as any).n;
    if (n > 12) return { ok: false, status: 429, reason: 'slow down; try again within the hour' };
    const floor = workFloor(cert);
    if (floor) return { ok: false, status: 422, reason: `needs ${floor}` };
    let ots: Uint8Array;
    try { ots = Uint8Array.from(atob(otsB64 ?? ''), (ch) => ch.charCodeAt(0)); } catch { return { ok: false, status: 422, reason: 'needs its anchor proof (.ots)' }; }
    const claims = anchorClaim(cert, ots);
    if (typeof claims === 'string') return { ok: false, status: 422, reason: claims };
    let confirmed = false;
    for (const c of claims) { try { if ((await this.blockRoot(c.height)) === c.root) { confirmed = true; break; } } catch { /* next */ } }
    if (!confirmed) return { ok: false, status: 422, reason: 'the Bitcoin anchor could not be confirmed against the block' };
    this.expire();
    const open = (this.sql.exec('SELECT COUNT(*) AS c FROM requests').one() as any).c;
    if (open >= MAX_OPEN_REQUESTS) return { ok: false, status: 429, reason: 'the waiting list is full; try again later' };
    this.sql.exec('INSERT INTO requests (id, certificate, ots, shape, requested_utc) VALUES (?,?,?,?,?)', cert.id, JSON.stringify(cert), otsB64, JSON.stringify(shapeOf(cert)), new Date().toISOString());
    return { ok: true };
  }

  expire() {
    this.sql.exec('DELETE FROM requests WHERE requested_utc < ?', new Date(Date.now() - REQUEST_DAYS * 86400_000).toISOString());
  }

  requests(): { id: string; key: string; requested_utc: string; shape: Record<string, number> }[] {
    this.expire();
    return this.sql.exec('SELECT id, shape, requested_utc, substr(json_extract(certificate, "$.author.public_key"),1,12) AS key FROM requests ORDER BY requested_utc').toArray()
      .map((r: any) => ({ ...r, shape: JSON.parse(r.shape) }));
  }

  /** A recognition for a waiting request: inscribe it with the stored certificate and proof, then clear the request. */
  async recognizeRequest(rec: Recognition) {
    const r = this.sql.exec('SELECT certificate, ots FROM requests WHERE id = ?', rec?.certificate_id ?? '').toArray()[0] as any;
    if (!r) return { ok: false, status: 404, reason: 'no such request (it may already be in the Book)' };
    const out: any = await this.inscribe(JSON.parse(r.certificate), r.ots, rec, `recognize|${rec.recognizer}|${new Date().toISOString().slice(0, 13)}`);
    if (out.ok) this.sql.exec('DELETE FROM requests WHERE id = ?', rec.certificate_id);
    return out;
  }

  async inscribe(cert: MeritAttestation, otsB64: string, rec: Recognition | undefined, ipBucket: string, history: Proved[] = []) {
    const dup = this.sql.exec('SELECT seq, chain FROM inscriptions WHERE id = ?', cert.id).toArray()[0] as any;
    if (dup) return { ok: true, seq: dup.seq, chain: dup.chain, already: true };
    const n = (this.sql.exec('INSERT INTO rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n', ipBucket).one() as any).n;
    if (n > 12) return { ok: false, status: 429, reason: 'slow down; try again within the hour' };

    const floor = workFloor(cert);
    if (floor) return { ok: false, status: 422, reason: `needs ${floor}` };

    if (!otsB64) return { ok: false, status: 422, reason: 'needs its anchor proof (.ots)' };
    let ots: Uint8Array;
    try { ots = Uint8Array.from(atob(otsB64 ?? ''), (ch) => ch.charCodeAt(0)); } catch { return { ok: false, status: 422, reason: 'needs its anchor proof (.ots)' }; }
    const claims = anchorClaim(cert, ots);
    if (typeof claims === 'string') return { ok: false, status: 422, reason: claims };
    let height: number | null = null;
    for (const c of claims) { try { if ((await this.blockRoot(c.height)) === c.root) { height = c.height; break; } } catch { /* explorer down */ } }
    if (height === null) return { ok: false, status: 422, reason: 'the Bitcoin anchor could not be confirmed against the block' };

    let bySeq: number | null = 0;
    if (cert.author.public_key !== this.founder && !rec) {
      // Earned by time: no recognizer, so the history must carry the cost.
      const e = earnedClaim(cert, claims, history);
      if (typeof e === 'string') return { ok: false, status: 422, reason: `needs ${e}` };
      const heights: number[] = [height];
      for (const cl of e.claims.slice(1)) {
        let h: number | null = null;
        for (const c of cl) { try { if ((await this.blockRoot(c.height)) === c.root) { h = c.height; break; } } catch { /* next */ } }
        if (h === null) return { ok: false, status: 422, reason: 'an earlier certificate’s Bitcoin anchor could not be confirmed' };
        heights.push(h);
      }
      const span = Math.max(...heights) - Math.min(...heights);
      if (span < EARN.span_blocks) return { ok: false, status: 422, reason: `your anchors span ${span} blocks (about ${Math.round(span / 144)} days); earning entry takes about 7 days (${EARN.span_blocks} blocks), or a recognition` };
      const today = new Date().toISOString().slice(0, 10);
      const earned = (this.sql.exec("SELECT COUNT(*) AS c FROM inscriptions WHERE by_seq = -1 AND substr(inscribed_utc,1,10) = ?", today).one() as any).c;
      if (earned >= EARN.per_day) return { ok: false, status: 429, reason: 'today’s entries by time are full; try again tomorrow (UTC), or ask for a recognition' };
      bySeq = -1;
    } else {
      const rc = recognitionClaim(cert, rec, this.founder);
      if (rc) return { ok: false, status: 422, reason: rc };
      if (cert.author.public_key !== this.founder) {
        const recognizer = rec!.recognizer;
        if (recognizer !== this.founder) {
          const first = this.sql.exec('SELECT MIN(seq) AS s FROM inscriptions WHERE public_key = ?', recognizer).one() as any;
          if (!first?.s) return { ok: false, status: 422, reason: 'the recognizer is not in the Book yet' };
          bySeq = first.s;
        }
        const since = new Date(Date.now() - 30 * 86400_000).toISOString();
        const used = (this.sql.exec('SELECT COUNT(*) AS c FROM inscriptions WHERE recognizer = ? AND inscribed_utc > ?', recognizer, since).one() as any).c;
        const cap = recognizer === this.founder ? RULES.founder_recognitions_per_30_days : RULES.recognitions_per_30_days;
        if (used >= cap) return { ok: false, status: 429, reason: `that recognizer has used all ${cap} recognitions for the last 30 days` };
      }
    }

    const last = this.sql.exec('SELECT seq, chain FROM inscriptions ORDER BY seq DESC LIMIT 1').toArray()[0] as any;
    const prev = last?.chain ?? GENESIS;
    const seq = (last?.seq ?? 0) + 1;
    const chain = sha256Hex(prev + cert.id);
    this.sql.exec('INSERT INTO inscriptions (seq, id, public_key, created_utc, inscribed_utc, chain, shape, certificate, recognizer, by_seq, anchor_height, ots, recognition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      seq, cert.id, cert.author.public_key, cert.created_utc, new Date().toISOString(), chain, JSON.stringify(shapeOf(cert)), JSON.stringify(cert),
      rec?.recognizer ?? null, bySeq, height, otsB64, rec ? JSON.stringify(rec) : null);
    this.sql.exec('DELETE FROM requests WHERE id = ?', cert.id);
    return { ok: true, seq, chain, prev, by_seq: bySeq, anchor_height: height };
  }
}

const book = (env: Env) => env.BOOK.get(env.BOOK.idFromName('the-book'));

async function inscribe(req: Request, env: Env) {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 256_000) return json({ ok: false, reason: 'too large' }, 413);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
  if (body?.consent !== true) return json({ ok: false, reason: 'consent required' }, 400);
  const cert = body.certificate as MeritAttestation;
  const v = check(cert);
  if (!v.ok) return json(v, 422);
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    let history: Proved[] = [];
  try {
    history = (Array.isArray(body.history) ? body.history : []).slice(0, 5)
      .map((h: any) => ({ certificate: h.certificate, ots: Uint8Array.from(atob(h.ots ?? ''), (ch) => ch.charCodeAt(0)) }));
  } catch { return json({ ok: false, reason: 'history proofs are not base64' }, 400); }
  const r: any = await book(env).inscribe(cert, body.ots, body.recognition, sha256Hex(`${ip}|${new Date().toISOString().slice(0, 13)}`), history);
  const { status, ...rest } = r;
  return json(rest, status ?? 200);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/book' && req.method === 'GET') return json(await book(env).list());
    if (url.pathname === '/api/inscribe' && req.method === 'POST') return inscribe(req, env);
    if (url.pathname === '/api/chain') return json((await (book(env) as any).portfolios()));
    if (url.pathname === '/api/wallet' && req.method === 'POST') {
      let body: any; try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
      const out: any = await (book(env) as any).setWallet(body?.binding); const { status, ...rest } = out; return json(rest, status ?? 200);
    }
    let pm = url.pathname.match(/^\/api\/portfolio\/(\d+)(\.json|\.svg|\/opening|\/claim)?$/);
    if (pm) {
      const n = Number(pm[1]); const s: any = await (book(env) as any).portfolio(n);
      if (s.error) return json({ ok: false, reason: s.error }, 404);
      if (pm[2] === '.json') return json(portfolioMeta(s));
      if (pm[2] === '.svg') {
        const marks = await (book(env) as any).marksUpTo(s.marks);
        return new Response(portfolioSVG(marks, marks[marks.length - 1].chain, GENESIS, n), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      }
      if (pm[2] === '/opening') { const o = opening(s, env); return o ? json(o) : json({ ok: false, reason: 'contracts not deployed yet' }, 503); }
      if (pm[2] === '/claim') { const c = claimProof(s, url.searchParams.get('address') ?? ''); return c ? json(c) : json({ ok: false, reason: 'that address has no share in this Portfolio' }, 404); }
      const { contributors, ...pub } = s; return json({ ...pub, contributors: Object.keys(contributors).length });
    }
    if (url.pathname === '/api/notify' && req.method === 'POST') {
      let body: any; try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
      if (body?.website) return json({ ok: true }); // honeypot: bots fill hidden fields
      const email = String(body?.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email)) return json({ ok: false, reason: 'that does not look like an email address' }, 422);
      if (body?.consent !== true) return json({ ok: false, reason: 'consent required' }, 400);
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const out: any = await (book(env) as any).notify(email, ['release', 'portfolio-1'], sha256Hex(`${ip}|${new Date().toISOString().slice(0, 13)}`));
      const { status, ...rest } = out; return json(rest, status ?? 200);
    }
    if (url.pathname === '/api/unsubscribe' && req.method === 'POST') {
      let body: any; try { body = await req.json(); } catch { return json({ ok: false }, 400); }
      return json(await (book(env) as any).unnotify(String(body?.email ?? '').trim().toLowerCase()));
    }
    if (url.pathname === '/api/notify/export') {
      const auth = req.headers.get('authorization') ?? '';
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false }, 404);
      return json(await (book(env) as any).notifyExport());
    }
    if (url.pathname === '/api/days') return json(await (book(env) as any).daysList());
    if (url.pathname === '/api/today.svg') {
      const b: any = await (book(env) as any).list();
      return new Response(portfolioSVG(b.marks, b.head, GENESIS, 0), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
    }
    pm = url.pathname.match(/^\/api\/day\/(\d+)(\.json|\.svg|\/settlement|\/claim)$/);
    if (pm) {
      const id = Number(pm[1]);
      const s: any = await (book(env) as any).day(id, pm[2] === '/settlement');
      if (s.error) return json({ ok: false, reason: s.error }, 409);
      if (pm[2] === '.json') return json(dayMeta(s));
      if (pm[2] === '.svg') {
        const marks = await (book(env) as any).marksUpTo(s.to_seq);
        return new Response(portfolioSVG(marks, marks.length ? marks[marks.length - 1].chain : GENESIS, GENESIS, id), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      }
      if (pm[2] === '/settlement') { const o = settlement(s, env); return o ? json(o) : json({ ok: false, reason: 'not deployed' }, 503); }
      const c = dayClaim(s, url.searchParams.get('address') ?? ''); return c ? json(c) : json({ ok: false, reason: 'that address has no share of this day' }, 404);
    }
    pm = url.pathname.match(/^\/api\/mark-token\/(\d+)(\.json|\.svg|\/claim)$/);
    if (pm) {
      const seq = Number(pm[1]); const a: any = await (book(env) as any).markAuthor(seq);
      if (!a) return json({ ok: false, reason: 'no such mark' }, 404);
      if (pm[2] === '.json') return json(markMeta(seq, a.id));
      if (pm[2] === '.svg') { const [m] = (await (book(env) as any).marksUpTo(seq)).slice(-1); return new Response(markSVG(m, GENESIS), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } }); }
      const to = (url.searchParams.get('to') ?? '').toLowerCase();
      const w = await (book(env) as any).wallet(a.public_key);
      if (!w || w !== to) return json({ ok: false, reason: 'the mark\'s author has not bound this wallet (set it in the Merit app)' }, 403);
      const c = markClaim(seq, to, env); return c ? json(c) : json({ ok: false, reason: 'contracts not deployed yet' }, 503);
    }
    if (url.pathname === '/api/requests' && req.method === 'GET') return json(await book(env).requests());
    if (url.pathname === '/api/request' && req.method === 'POST') {
      let body: any; try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
      if (body?.consent !== true) return json({ ok: false, reason: 'consent required' }, 400);
      const v = check(body.certificate); if (!v.ok) return json(v, 422);
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const out: any = await (book(env) as any).request(body.certificate, body.ots, sha256Hex(`${ip}|${new Date().toISOString().slice(0, 13)}`));
      const { status, ...rest } = out;
      return json(rest, status ?? 200);
    }
    if (url.pathname === '/api/recognize' && req.method === 'POST') {
      let body: any; try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
      const out: any = await (book(env) as any).recognizeRequest(body?.recognition);
      const { status, ...rest } = out;
      return json(rest, status ?? 200);
    }
    const m = url.pathname.match(/^\/api\/mark\/(\d+)$/);
    if (m) {
      const r = await book(env).mark(Number(m[1]));
      return r ? json(r) : json({ ok: false }, 404);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, reason: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
