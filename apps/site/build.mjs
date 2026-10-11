// Build: render the paper, fix Mark 0 to the paper's hash, bundle worker + browser code.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../../', import.meta.url).pathname;
const site = new URL('./', import.meta.url).pathname;
const paperMd = readFileSync(root + 'docs/WHITEPAPER.md', 'utf8');
// Mark 0 is frozen: the paper as it stood when the Book began (anchors/genesis.md). Later drafts never change it.
const genesisMd = readFileSync(root + 'anchors/genesis.md', 'utf8');
const genesis = createHash('sha256').update(genesisMd).digest('hex');
mkdirSync(site + 'public', { recursive: true }); mkdirSync(site + 'dist', { recursive: true });
const html = execFileSync('npx', ['-y', 'marked@14.1.4', '--gfm'], { input: paperMd }).toString();
writeFileSync(site + 'public/paper.html', readFileSync(site + 'src/paper.html', 'utf8').replace('<!--PAPER-->', html).replace('<!--GENESIS-->', genesis));
copyFileSync(site + 'src/index.html', site + 'public/index.html');
copyFileSync(site + 'src/collect.html', site + 'public/collect.html');
copyFileSync(site + 'src/deploy.html', site + 'public/deploy.html');
const art = (name) => JSON.parse(readFileSync(root + `contracts/out/${name}.sol/${name}.json`, 'utf8'));
const P = art('ArtofficialPortfolio'), M = art('ArtofficialMarks'), D = art('ArtofficialDays');
writeFileSync(site + 'src/contracts.gen.ts', `// generated from contracts/out by build.mjs\nexport const PORTFOLIO_ABI = ${JSON.stringify(P.abi)} as const;\nexport const MARKS_ABI = ${JSON.stringify(M.abi)} as const;\nexport const PORTFOLIO_BYTECODE = '${P.bytecode.object}' as const;\nexport const MARKS_BYTECODE = '${M.bytecode.object}' as const;\nexport const DAYS_ABI = ${JSON.stringify(D.abi)} as const;\nexport const DAYS_BYTECODE = '${D.bytecode.object}' as const;\n`);
copyFileSync(site + 'src/style.css', site + 'public/style.css');
writeFileSync(site + 'public/paper.md', paperMd);
writeFileSync(site + 'public/genesis.md', genesisMd);
const esb = (args) => execFileSync(root + 'node_modules/.bin/esbuild', [...args, `--tsconfig=${root}tsconfig.json`, '--bundle', '--log-level=warning'], { stdio: 'inherit' });
esb([site + 'src/worker.ts', '--format=esm', '--platform=neutral', '--external:cloudflare:workers', `--define:GENESIS="${genesis}"`, `--outfile=${site}dist/worker.js`]);
esb([site + 'src/app.ts', '--format=esm', '--platform=browser', '--minify', `--outfile=${site}public/app.js`]);
esb([site + 'src/collect.ts', '--format=esm', '--platform=browser', '--minify', `--outfile=${site}public/collect.js`]);
console.log('genesis', genesis);
