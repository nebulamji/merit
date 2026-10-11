// Build: render the paper, fix Mark 0 to the paper's hash, bundle worker + browser code.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../../', import.meta.url).pathname;
const site = new URL('./', import.meta.url).pathname;
const paperMd = readFileSync(root + 'docs/WHITEPAPER.md', 'utf8');
const genesis = createHash('sha256').update(paperMd).digest('hex');
mkdirSync(site + 'public', { recursive: true }); mkdirSync(site + 'dist', { recursive: true });
const html = execFileSync('npx', ['-y', 'marked@14.1.4', '--gfm'], { input: paperMd }).toString();
writeFileSync(site + 'public/paper.html', readFileSync(site + 'src/paper.html', 'utf8').replace('<!--PAPER-->', html).replace('<!--GENESIS-->', genesis));
copyFileSync(site + 'src/index.html', site + 'public/index.html');
copyFileSync(site + 'src/style.css', site + 'public/style.css');
writeFileSync(site + 'public/paper.md', paperMd);
const esb = (args) => execFileSync('npx', ['-y', 'esbuild@0.24.0', ...args, `--tsconfig=${root}tsconfig.json`, '--bundle', '--log-level=warning'], { stdio: 'inherit' });
esb([site + 'src/worker.ts', '--format=esm', '--platform=neutral', '--external:cloudflare:workers', `--define:GENESIS="${genesis}"`, `--outfile=${site}dist/worker.js`]);
esb([site + 'src/app.ts', '--format=esm', '--platform=browser', '--minify', `--outfile=${site}public/app.js`]);
console.log('genesis', genesis);
