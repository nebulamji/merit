// /collect and /deploy: everything a wallet does with artofficial, in the visitor's own wallet.
import { createWalletClient, createPublicClient, custom, http, formatEther, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
// @ts-ignore generated at build from contracts/out
import { PORTFOLIO_ABI, MARKS_ABI, PORTFOLIO_BYTECODE, MARKS_BYTECODE, DAYS_ABI, DAYS_BYTECODE } from './contracts.gen';
import { parseEther } from 'viem';

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
  $('#split').textContent = `Each Portfolio opens at ${formatEther(BigInt(c.price_wei))} ETH for ${c.hours} hours, and every edition collected raises the next price by ${c.step_bps / 100}%. Every sale is split by the contract: ${c.split.contributors * 100}% to the people whose marks are in it (equal per mark, for those who set a wallet), ${c.split.platform * 100}% platform, ${c.split.treasury * 100}% treasury. Resales: ${c.split.royalty * 100}%.`;
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
        const value = await priceFor(o, amt);
        const hash = await w.writeContract({ account: account!, chain: base, address: o.contract, abi: PORTFOLIO_ABI, functionName: 'openAndCollect',
          args: [BigInt(o.id), BigInt(o.price), BigInt(o.start), BigInt(o.end), o.contributors, o.total_shares, o.book_state, o.sig, amt], value });
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

/** Each edition costs a little more than the last; ask the contract (or compute it for a Portfolio not yet opened). */
async function priceFor(o: any, amt: bigint): Promise<bigint> {
  const p = await pub.readContract({ address: o.contract, abi: PORTFOLIO_ABI, functionName: 'portfolios', args: [BigInt(o.id)] }) as unknown as any[];
  if (p[7]) return await pub.readContract({ address: o.contract, abi: PORTFOLIO_ABI, functionName: 'quote', args: [BigInt(o.id), amt] }) as bigint;
  const step = BigInt(await pub.readContract({ address: o.contract, abi: PORTFOLIO_ABI, functionName: 'stepBps' }) as number);
  let price = BigInt(o.price), total = 0n;
  for (let k = 0n; k < amt; k++) { total += price; price = (price * (10000n + step)) / 10000n; }
  return total;
}

// ---------------- The Book, Today ----------------
async function renderToday() {
  const days = chain.config.days as Address | null;
  const el = $('#today'); if (!el) return;
  ($('#today-img') as HTMLImageElement).src = `/api/today.svg?t=${Date.now()}`;
  if (!days) { $('#today-status').textContent = 'The daily auction is not switched on yet.'; for (const s of ['#bid-row', '#settle-row', '#claim-row']) $(s).hidden = true; return; }
  const a = await pub.readContract({ address: days, abi: DAYS_ABI, functionName: 'auction' }) as unknown as any[];
  const [id, amount, , end, bidder, settled] = a as [bigint, bigint, number, number, Address, boolean];
  const reserve = await pub.readContract({ address: days, abi: DAYS_ABI, functionName: 'reservePrice' }) as bigint;
  const now = Date.now() / 1000;
  const minNext = amount === 0n ? reserve : amount + (amount * 500n) / 10000n;
  $('#today-title').textContent = `Day ${id}`;
  $('#today-status').textContent = now < Number(end)
    ? `Current bid ${formatEther(amount)} ETH${bidder !== '0x0000000000000000000000000000000000000000' ? ` by ${bidder.slice(0, 6)}…` : ' (no bids yet)'} · ends ${new Date(Number(end) * 1000).toLocaleString()} · next bid at least ${formatEther(minNext)} ETH`
    : settled ? 'Settled.' : `Day ${id} has ended. Anyone can settle it, which mints it to the winner and starts tomorrow's auction.`;
  ($('#bid-amount') as HTMLInputElement).placeholder = formatEther(minNext);
  $('#bid-row').hidden = now >= Number(end);
  $('#settle-row').hidden = now < Number(end) || settled;
  $('#bid').onclick = async () => {
    try {
      const w = await wallet(); const v = parseEther(($('#bid-amount') as HTMLInputElement).value || formatEther(minNext));
      const hash = await w.writeContract({ account: account!, chain: base, address: days, abi: DAYS_ABI, functionName: 'bid', args: [id], value: v });
      await waitFor(hash); say(`You are the high bidder on Day ${id}.`); renderToday();
    } catch (e) { fail(e); }
  };
  $('#settle').onclick = async () => {
    try {
      const w = await wallet();
      const s = await fetch(`/api/day/${id}/settlement`).then((r) => r.json());
      if (!s.sig) throw new Error(s.reason);
      const hash = await w.writeContract({ account: account!, chain: base, address: days, abi: DAYS_ABI, functionName: 'settle', args: [s.contributors, s.total_shares, s.book_state, s.sig] });
      await waitFor(hash); say(`Day ${id} settled; Day ${Number(id) + 1} has begun.`); renderToday();
    } catch (e) { fail(e); }
  };
  $('#claim-days').onclick = async () => {
    try {
      const w = await wallet(); const list = await fetch('/api/days').then((r) => r.json()); let n = 0;
      for (const d of list) {
        const c = await fetch(`/api/day/${d.id}/claim?address=${account}`).then((r) => r.json());
        if (!c.proof) continue;
        if (await pub.readContract({ address: days, abi: DAYS_ABI, functionName: 'claimed', args: [BigInt(d.id), c.account] })) continue;
        const hash = await w.writeContract({ account: account!, chain: base, address: days, abi: DAYS_ABI, functionName: 'claim', args: [BigInt(d.id), c.account, c.shares, c.proof] });
        await waitFor(hash); n++;
      }
      say(n ? `Claimed your share of ${n} ${n === 1 ? 'day' : 'days'}.` : 'Nothing to claim for this wallet.');
    } catch (e) { fail(e); }
  };
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
    let total = 0n;
    for (const [address, abi] of [[chain.config.portfolio, PORTFOLIO_ABI], [chain.config.days, DAYS_ABI]] as const) {
      if (!address) continue;
      const owed = await pub.readContract({ address, abi, functionName: 'owed', args: [account!] }) as bigint;
      if (!owed) continue;
      await waitFor(await w.writeContract({ account: account!, chain: base, address, abi, functionName: 'withdraw', args: [] }));
      total += owed;
    }
    say(total ? `Withdrew ${formatEther(total)} ETH.` : 'Nothing owed to this wallet.');
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
    say('Deploying The Book, Today (confirm in your wallet; the first daily auction starts immediately)…');
    const h3 = await w.deployContract({ account: account!, chain: base, abi: DAYS_ABI, bytecode: DAYS_BYTECODE,
      args: [account!, account!, account!, cfg.book_signer, BigInt(cfg.day_reserve_wei), 'https://merit.artofficial.computer/api/day/'] });
    const r3 = await waitFor(h3);
    $('#deployed').textContent = `PORTFOLIO_ADDRESS=${r1.contractAddress}\nMARKS_ADDRESS=${r2.contractAddress}\nDAYS_ADDRESS=${r3.contractAddress}`;
    say('Deployed. Your wallet owns all three contracts and receives the platform and treasury shares. Send these three lines to Claude to switch the Book on.');
  } catch (e) { fail(e); }
}

document.querySelector('#connect')?.addEventListener('click', () => connect().catch(fail));
document.querySelector('#own')?.addEventListener('click', ownMark);
document.querySelector('#withdraw')?.addEventListener('click', withdraw);
document.querySelector('#deploy')?.addEventListener('click', deploy);
if (document.querySelector('#portfolios')) renderCollect().then(renderToday).catch(fail);
