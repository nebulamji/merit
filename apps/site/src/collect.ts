// /collect and /deploy: everything a wallet does with artofficial, in the visitor's own wallet.
import { createWalletClient, createPublicClient, custom, http, formatEther, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
// @ts-ignore generated at build from contracts/out
import { PORTFOLIO_ABI, MARKS_ABI, PORTFOLIO_BYTECODE, MARKS_BYTECODE } from './contracts.gen';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pub = createPublicClient({ chain: base, transport: http() });
let account: Address | null = null;
let chain: any = null;

function say(msg: string, bad = false) { const n = $('#note'); n.textContent = msg; n.dataset.state = bad ? 'bad' : 'ok'; }
const eth = () => (window as any).ethereum;

async function connect(): Promise<ReturnType<typeof createWalletClient>> {
  if (!eth()) throw new Error('No wallet found in this browser. Install a wallet such as Coinbase Wallet or MetaMask.');
  const w = createWalletClient({ chain: base, transport: custom(eth()) });
  [account] = await w.requestAddresses();
  try { await w.switchChain({ id: base.id }); } catch { await w.addChain({ chain: base }); await w.switchChain({ id: base.id }); }
  $('#who').textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  return w;
}
async function wallet() { const w = await connect(); return w; }
async function waitFor(hash: Hex) { say('Waiting for Base to confirm…'); return pub.waitForTransactionReceipt({ hash }); }
const fail = (e: any) => say(e?.shortMessage ?? e?.message ?? String(e), true);

async function renderCollect() {
  chain = await fetch('/api/chain').then((r) => r.json());
  const c = chain.config;
  $('#summary').textContent = `The Book has ${chain.marks} ${chain.marks === 1 ? 'mark' : 'marks'}. A Portfolio opens every ${c.every} marks; the next one opens at mark ${chain.next_at}.`;
  $('#split').textContent = `Each Portfolio sells for ${formatEther(BigInt(c.price_wei))} ETH for ${c.hours} hours after it first opens. Every sale is split by the contract: ${c.split.contributors * 100}% to the people whose marks are in it (equal per mark, for those who set a wallet), ${c.split.platform * 100}% platform, ${c.split.treasury * 100}% treasury. Resales: ${c.split.royalty * 100}%.`;
  const live = !!c.portfolio;
  $('#not-live').hidden = live;
  const list = $('#portfolios'); list.innerHTML = '';
  for (let n = 1; n <= chain.available; n++) {
    const p = await fetch(`/api/portfolio/${n}`).then((r) => r.json());
    const now = Date.now() / 1000; const open = now >= p.start && now <= p.end;
    const card = document.createElement('div'); card.className = 'pcard';
    card.innerHTML = `<img src="/api/portfolio/${n}.svg" alt="Portfolio ${n}" loading="lazy"><div><b>Portfolio No. ${n}</b><div class="small">${p.marks} marks · ${p.contributors} contributors paid · ${open ? `open, closes ${new Date(p.end * 1000).toLocaleString()}` : now < p.start ? 'not open yet' : 'closed'}</div>
      <div class="row">${open && live ? '<input type="number" min="1" value="1" class="amt"> <button class="collect">Collect</button>' : ''}${!open && live && now > p.end ? '<button class="claim">Claim my share</button>' : ''}</div></div>`;
    card.querySelector<HTMLButtonElement>('.collect')?.addEventListener('click', async () => {
      try {
        const w = await wallet(); const amt = BigInt((card.querySelector('.amt') as HTMLInputElement).value || '1');
        const o = await fetch(`/api/portfolio/${n}/opening`).then((r) => r.json());
        if (!o.sig) throw new Error(o.reason ?? 'not available');
        const hash = await w.writeContract({ account: account!, chain: base, address: o.contract, abi: PORTFOLIO_ABI, functionName: 'openAndCollect',
          args: [BigInt(o.id), BigInt(o.price), BigInt(o.start), BigInt(o.end), o.contributors, o.total_shares, o.book_state, o.sig, amt], value: BigInt(o.price) * amt });
        await waitFor(hash); say(`Collected Portfolio No. ${n}.`);
      } catch (e) { fail(e); }
    });
    card.querySelector<HTMLButtonElement>('.claim')?.addEventListener('click', async () => {
      try {
        const w = await wallet();
        const c2 = await fetch(`/api/portfolio/${n}/claim?address=${account}`).then((r) => r.json());
        if (!c2.proof) throw new Error(c2.reason);
        const hash = await w.writeContract({ account: account!, chain: base, address: chain.config.portfolio, abi: PORTFOLIO_ABI, functionName: 'claim', args: [BigInt(n), c2.account, c2.shares, c2.proof] });
        await waitFor(hash); say(`Claimed your share of Portfolio No. ${n}.`);
      } catch (e) { fail(e); }
    });
    list.append(card);
  }
  if (!chain.available) list.innerHTML = '<p class="small">No Portfolio yet. The first opens when the Book reaches its first milestone.</p>';
}

async function ownMark() {
  try {
    const w = await wallet(); const seq = Number(($('#seq') as HTMLInputElement).value);
    const c = await fetch(`/api/mark-token/${seq}/claim?to=${account}`).then((r) => r.json());
    if (!c.sig) throw new Error(c.reason);
    const hash = await w.writeContract({ account: account!, chain: base, address: c.contract, abi: MARKS_ABI, functionName: 'mint', args: [BigInt(seq), c.to, c.sig], value: BigInt(c.fee) });
    await waitFor(hash); say(`Mark No. ${seq} is in your wallet. It can never be sold or transferred.`);
  } catch (e) { fail(e); }
}

async function withdraw() {
  try {
    const w = await wallet();
    const owed = await pub.readContract({ address: chain.config.portfolio, abi: PORTFOLIO_ABI, functionName: 'owed', args: [account!] }) as bigint;
    if (!owed) return say('Nothing owed to this wallet.');
    const hash = await w.writeContract({ account: account!, chain: base, address: chain.config.portfolio, abi: PORTFOLIO_ABI, functionName: 'withdraw', args: [] });
    await waitFor(hash); say(`Withdrew ${formatEther(owed)} ETH.`);
  } catch (e) { fail(e); }
}

async function deploy() {
  try {
    const w = await wallet();
    const cfg = (await fetch('/api/chain').then((r) => r.json())).config;
    if (!cfg.book_signer) throw new Error('The Book signer is not configured.');
    say('Deploying Portfolios (confirm in your wallet)…');
    const h1 = await w.deployContract({ account: account!, chain: base, abi: PORTFOLIO_ABI, bytecode: PORTFOLIO_BYTECODE,
      args: [account!, account!, account!, cfg.book_signer, 'https://merit.artofficial.computer/api/portfolio/'] });
    const r1 = await waitFor(h1);
    say('Deploying Marks (confirm in your wallet)…');
    const h2 = await w.deployContract({ account: account!, chain: base, abi: MARKS_ABI, bytecode: MARKS_BYTECODE,
      args: [account!, account!, cfg.book_signer, BigInt(cfg.mark_fee_wei), 'https://merit.artofficial.computer/api/mark-token/'] });
    const r2 = await waitFor(h2);
    $('#deployed').textContent = `Portfolios: ${r1.contractAddress}\nMarks: ${r2.contractAddress}`;
    say('Deployed. Your wallet owns both contracts and receives the platform and treasury shares. Send these two addresses to Claude to switch the Book on.');
  } catch (e) { fail(e); }
}

document.querySelector('#connect')?.addEventListener('click', () => connect().catch(fail));
document.querySelector('#own')?.addEventListener('click', ownMark);
document.querySelector('#withdraw')?.addEventListener('click', withdraw);
document.querySelector('#deploy')?.addEventListener('click', deploy);
if (document.querySelector('#portfolios')) renderCollect().catch(fail);
