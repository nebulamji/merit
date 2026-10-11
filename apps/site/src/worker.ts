import { attestationId, sha256Hex, type MeritAttestation } from '@merit/spec';
import { verifySignature, bodyOf } from '@merit/attest';
import { shapeOf } from './shape';
import { blockMerkleRoot } from '../../../packages/verify/src/ots';
import { RULES, FOUNDER, workFloor, anchorClaim, recognitionClaim } from './qualify';
import type { Recognition } from '@merit/attest';

import { DurableObject } from 'cloudflare:workers';

interface Env { BOOK: DurableObjectNamespace<Book>; ASSETS: Fetcher; FOUNDER?: string }

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
CREATE TABLE IF NOT EXISTS blocks (height INTEGER PRIMARY KEY, root TEXT NOT NULL);`;
const COLUMNS = ['recognizer TEXT', 'by_seq INTEGER', 'anchor_height INTEGER', 'ots TEXT', 'recognition TEXT'];

/**
 * The Book: one Durable Object, one writer. Every inscription is appended in a single-threaded
 * sequence, so the order and the chain can never race. Rows are only ever appended.
 */
export class Book extends DurableObject {
  sql: SqlStorage;
  founder: string;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.founder = env.FOUNDER || FOUNDER;
    this.sql.exec(SCHEMA_SQL);
    for (const c of COLUMNS) { try { this.sql.exec(`ALTER TABLE inscriptions ADD COLUMN ${c}`); } catch { /* exists */ } }
  }
  list() {
    const marks = this.sql.exec('SELECT seq, id, substr(public_key,1,12) AS key, created_utc, inscribed_utc, chain, shape, by_seq, anchor_height FROM inscriptions ORDER BY seq').toArray()
      .map((x: any) => ({ ...x, shape: JSON.parse(x.shape) }));
    return { genesis: GENESIS, founder: this.founder, rules: RULES, head: marks.length ? (marks[marks.length - 1] as any).chain : GENESIS, marks };
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

  async inscribe(cert: MeritAttestation, otsB64: string, rec: Recognition | undefined, ipBucket: string) {
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

    const rc = recognitionClaim(cert, rec, this.founder);
    if (rc) return { ok: false, status: 422, reason: `needs ${rc}` };
    let bySeq = 0;
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

    const last = this.sql.exec('SELECT seq, chain FROM inscriptions ORDER BY seq DESC LIMIT 1').toArray()[0] as any;
    const prev = last?.chain ?? GENESIS;
    const seq = (last?.seq ?? 0) + 1;
    const chain = sha256Hex(prev + cert.id);
    this.sql.exec('INSERT INTO inscriptions (seq, id, public_key, created_utc, inscribed_utc, chain, shape, certificate, recognizer, by_seq, anchor_height, ots, recognition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      seq, cert.id, cert.author.public_key, cert.created_utc, new Date().toISOString(), chain, JSON.stringify(shapeOf(cert)), JSON.stringify(cert),
      rec?.recognizer ?? null, bySeq, height, otsB64, rec ? JSON.stringify(rec) : null);
    return { ok: true, seq, chain, prev, by_seq: bySeq, anchor_height: height };
  }
}

const book = (env: Env) => env.BOOK.get(env.BOOK.idFromName('the-book'));

async function inscribe(req: Request, env: Env) {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 64_000) return json({ ok: false, reason: 'too large' }, 413);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'not JSON' }, 400); }
  if (body?.consent !== true) return json({ ok: false, reason: 'consent required' }, 400);
  const cert = body.certificate as MeritAttestation;
  const v = check(cert);
  if (!v.ok) return json(v, 422);
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const r: any = await book(env).inscribe(cert, body.ots, body.recognition, sha256Hex(`${ip}|${new Date().toISOString().slice(0, 13)}`));
  const { status, ...rest } = r;
  return json(rest, status ?? 200);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/book' && req.method === 'GET') return json(await book(env).list());
    if (url.pathname === '/api/inscribe' && req.method === 'POST') return inscribe(req, env);
    const m = url.pathname.match(/^\/api\/mark\/(\d+)$/);
    if (m) {
      const r = await book(env).mark(Number(m[1]));
      return r ? json(r) : json({ ok: false }, 404);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, reason: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
