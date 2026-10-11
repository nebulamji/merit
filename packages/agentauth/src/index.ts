/**
 * Web Bot Auth (draft-meunier-web-bot-auth-architecture) on top of HTTP Message Signatures (RFC 9421),
 * with Ed25519 keys (RFC 8037). This is the signing standard that Cloudflare's signed agents, Visa's
 * Trusted Agent Protocol and Mastercard Agent Pay build on. Merit agent keys are Ed25519, so a
 * Merit-delegated agent can sign requests that those verifiers accept, and also present its
 * principal binding (the Merit delegation) in a separate header.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, utf8ToBytes, bytesToHex } from '@noble/hashes/utils';
import { canonicalJSON } from '@merit/spec';

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface OkpJwk { kty: 'OKP'; crv: 'Ed25519'; x: string; kid?: string; use?: 'sig'; nbf?: number; exp?: number }

export function jwkFromPublicKey(publicKeyHex: string): OkpJwk {
  return { kty: 'OKP', crv: 'Ed25519', x: b64url(hexToBytes(publicKeyHex)) };
}

/** RFC 7638 / RFC 8037 A.3 JWK SHA-256 thumbprint: the keyid Web Bot Auth requires. */
export function jwkThumbprint(publicKeyHex: string): string {
  const { crv, kty, x } = jwkFromPublicKey(publicKeyHex);
  return b64url(sha256(utf8ToBytes(JSON.stringify({ crv, kty, x }))));
}

export interface SignParams {
  authority: string;            // host[:port] of the request
  privateKey: string;           // agent Ed25519 key (hex)
  created: number;              // unix seconds
  expires: number;              // unix seconds (draft recommends <= 24h)
  nonce?: string;
  /** directory URL that serves the agent's keys at /.well-known/http-message-signatures-directory */
  signatureAgent?: string;
  /** dictionary member name for Signature-Agent (sf-dictionary form); default "agent1" */
  agentKey?: string;
  label?: string;               // signature label, default "sig1"
  /**
   * How the Signature-Agent member value enters the signature base. RFC 9421 §2.1.2 says the serialized
   * member value (quoted sf-string). The draft-05 A.2.2 vector prints that form, but its published
   * signature only verifies over the bare URL. 'reference' (default) matches the published signature;
   * 'rfc9421' follows the RFC text. Verifiers here accept either.
   */
  agentValueForm?: 'reference' | 'rfc9421';
}

function paramsString(components: string, keyid: string, p: SignParams): string {
  let s = `(${components});created=${p.created};keyid="${keyid}";alg="ed25519";expires=${p.expires}`;
  if (p.nonce) s += `;nonce="${p.nonce}"`;
  return s + `;tag="web-bot-auth"`;
}

/** RFC 9421 §2.5 signature base. */
export function signatureBase(p: SignParams, keyid: string): { base: string; params: string } {
  const agentKey = p.agentKey ?? 'agent1';
  const lines = [`"@authority": ${p.authority}`];
  let components = '"@authority"';
  if (p.signatureAgent) {
    const v = p.agentValueForm === 'rfc9421' ? `"${p.signatureAgent}"` : p.signatureAgent;
    lines.push(`"signature-agent";key="${agentKey}": ${v}`);
    components += ` "signature-agent";key="${agentKey}"`;
  }
  const params = paramsString(components, keyid, p);
  lines.push(`"@signature-params": ${params}`);
  return { base: lines.join('\n'), params };
}

/** Headers to attach to an outgoing request. */
export function signRequest(p: SignParams): Record<string, string> {
  const label = p.label ?? 'sig1';
  const pub = bytesToHex(ed25519.getPublicKey(hexToBytes(p.privateKey)));
  const keyid = jwkThumbprint(pub);
  const { base, params } = signatureBase(p, keyid);
  const sig = ed25519.sign(utf8ToBytes(base), hexToBytes(p.privateKey));
  const h: Record<string, string> = {
    'Signature-Input': `${label}=${params}`,
    'Signature': `${label}=:${b64(sig)}:`,
  };
  if (p.signatureAgent) h['Signature-Agent'] = `${p.agentKey ?? 'agent1'}="${p.signatureAgent}"`;
  return h;
}

/** Verify a Web Bot Auth signature for a request to `authority`, given the agent's public key. */
export function verifyRequest(headers: Record<string, string>, authority: string, publicKeyHex: string, nowSec = Math.floor(Date.now() / 1000)): { ok: boolean; reason?: string } {
  const input = headers['Signature-Input'] ?? headers['signature-input'];
  const signature = headers['Signature'] ?? headers['signature'];
  if (!input || !signature) return { ok: false, reason: 'missing signature headers' };
  const m = input.match(/^([A-Za-z0-9_-]+)=\((.*?)\)(.*)$/);
  if (!m) return { ok: false, reason: 'unparseable Signature-Input' };
  const [, label, components, rest] = m;
  const param = (k: string) => rest.match(new RegExp(`;${k}=("([^"]*)"|(\\d+))`))?.slice(2).find((x) => x !== undefined);
  if (param('tag') !== 'web-bot-auth') return { ok: false, reason: 'tag is not web-bot-auth' };
  if (param('alg') && param('alg') !== 'ed25519') return { ok: false, reason: 'unsupported alg' };
  if (param('keyid') !== jwkThumbprint(publicKeyHex)) return { ok: false, reason: 'keyid does not match key' };
  const expires = Number(param('expires'));
  if (expires && nowSec > expires) return { ok: false, reason: 'expired' };
  const sigM = signature.match(new RegExp(`${label}=:([^:]+):`));
  if (!sigM) return { ok: false, reason: 'signature label mismatch' };
  const agentM = components.match(/"signature-agent";key="([^"]+)"/);
  let agentVal: string | undefined;
  if (agentM) {
    const sa = headers['Signature-Agent'] ?? headers['signature-agent'] ?? '';
    agentVal = sa.match(new RegExp(`${agentM[1]}="([^"]+)"`))?.[1];
    if (!agentVal) return { ok: false, reason: 'signature-agent missing' };
  }
  const forms = agentM ? [agentVal!, `"${agentVal}"`] : [''];
  const ok = forms.some((v) => {
    const lines = [`"@authority": ${authority}`];
    if (agentM) lines.push(`"signature-agent";key="${agentM[1]}": ${v}`);
    lines.push(`"@signature-params": (${components})${rest}`);
    return ed25519.verify(fromB64(sigM[1]), utf8ToBytes(lines.join('\n')), hexToBytes(publicKeyHex));
  });
  return ok ? { ok } : { ok, reason: 'bad signature' };
}

/** The key directory an agent serves at /.well-known/http-message-signatures-directory. */
export function directory(publicKeys: string[]): { keys: OkpJwk[] } {
  return { keys: publicKeys.map((k) => ({ ...jwkFromPublicKey(k), kid: jwkThumbprint(k), use: 'sig' as const })) };
}

/** Merit extension: carry the principal's delegation alongside the Web Bot Auth signature. */
export function meritDelegationHeader(delegation: object): Record<string, string> {
  return { 'Merit-Delegation': b64url(utf8ToBytes(canonicalJSON(delegation))) };
}
export function readMeritDelegation(headers: Record<string, string>): unknown | null {
  const v = headers['Merit-Delegation'] ?? headers['merit-delegation'];
  if (!v) return null;
  try { return JSON.parse(new TextDecoder().decode(fromB64url(v))); } catch { return null; }
}
