// 動作確認用の最小ハーネス：静的サーバーを立ててヘッドレス Chromium で index.html を開く。
// 実行：node viewer/tests/<name>.test.mjs （グローバルの playwright を使う）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* fall through */ }
  const globalRoot = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
  return require(join(globalRoot, 'playwright'));
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

export async function startServer() {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (!path || path === '.' || path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch (_) {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

export async function openApp({ viewport = { width: 1000, height: 800 } } = {}) {
  const { chromium } = loadPlaywright();
  const { server, url } = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // 「Failed to load resource」はネットワークの記録（中継のない場所で /v1/relay-status が 404 になる等）なので数えない。
  // スクリプトのエラーは pageerror と他の console.error で拾う
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  return {
    page, url, errors, ROOT,
    async close() { await browser.close(); server.close(); },
  };
}

let failures = 0;
export function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
}
export function done() {
  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}
