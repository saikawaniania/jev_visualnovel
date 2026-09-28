// 中継（relay/local_server.py）：ビューアを配信し、同じオリジンの /v1/systemone を TypeSafe へ中継する。
// 本物の TypeSafe の代わりに、ここで立てる偽の上流サーバーへ中継させて確かめる。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require(join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright')); } })();
const RELAY = fileURLToPath(new URL('../relay/local_server.py', import.meta.url));

// 偽の TypeSafe：届いたヘッダーと本文を記録し、各質問の先頭の選択肢を返す
const upstreamLog = [];
const upstream = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    upstreamLog.push({ path: req.url, auth: req.headers.authorization, body });
    if (body.state === 'FAIL') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); return; }
    const answers = {};
    for (const [k, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') answers[k] = { type: 'noul', noul: 0.7 };
      else if (q.type === 'score') answers[k] = { type: 'score', score: 1, confidence: 0.8, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } };
      else { const keys = Object.keys(q.criteria); answers[k] = { type: 'choice', choice: keys[0], confidence: 0.9, probabilities: Object.fromEntries(keys.map((x, i) => [x, i ? 0.1 / (keys.length - 1) : 0.9])) }; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 10, output_tokens: 0 } }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));

const port = 18000 + Math.floor(Math.random() * 1000);
const relay = spawn('python3', [RELAY, '--port', String(port), '--host', '127.0.0.1'], {
  env: { ...process.env, TYPESAFE_API_KEY: 'relay-secret-key', TYPESAFE_BASE_URL: `http://127.0.0.1:${upstream.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let relayOut = '';
relay.stdout.on('data', (d) => { relayOut += d; });
relay.stderr.on('data', (d) => { relayOut += d; });
for (let i = 0; i < 50 && !relayOut.includes('中継先'); i++) await new Promise((r) => setTimeout(r, 100));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const browserReqs = [];
page.on('request', (r) => { if (r.method() === 'POST') browserReqs.push({ url: r.url(), auth: r.headers().authorization }); });

try {
  console.log('起動');
  check(relayOut.includes(`http://localhost:${port}/`), '起動時にURLを表示');
  await page.goto(`http://127.0.0.1:${port}/`);
  check(await page.isVisible('#drop-zone'), '中継サーバーがビューアを配信');

  console.log('設定：中継サーバー（URL・キーは空のまま）');
  await page.click('#home-footer button');
  await page.selectOption('#settings [data-key="route"]', 'relay');
  check((await page.textContent('#endpoint-hint')).includes('/v1/systemone'), '空欄なら同じサーバーの /v1/systemone');
  await page.click('#conn-test');
  await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
  const res = await page.textContent('#conn-result');
  check(res.startsWith('接続できました'), `接続テスト成功 (${res})`);
  const up = upstreamLog.at(-1);
  check(up && up.path === '/v1/systemone' && up.auth === 'Bearer relay-secret-key', 'キーは中継が付けて TypeSafe の /v1/systemone へ');
  check(browserReqs.at(-1).url === `http://127.0.0.1:${port}/v1/systemone` && !browserReqs.at(-1).auth, 'ブラウザはキーを持たず、同じオリジンへ送るだけ（CORS なし）');
  check(JSON.stringify(Object.keys(up.body)) === JSON.stringify(['model', 'state', 'questions']) && up.body.model === 'jev-1.13', '中継するのは model・state・questions だけ');

  console.log('読書中の判定が中継を通る');
  await page.click('#settings header button');
  upstreamLog.length = 0;
  await page.click('#sample-list li:first-child button');
  await page.waitForTimeout(2000);
  const scene = upstreamLog.find((x) => x.body.questions && x.body.questions.location);
  check(!!scene && typeof scene.body.state.current === 'string', `場面判定が届く (${upstreamLog.length} 件)`);
  const bg = await page.evaluate(() => [...document.querySelectorAll('#stage .bg')].find((b) => b.style.zIndex === '2')?.dataset.loc);
  check(bg === 'washitsu', `応答どおりに合成 (${bg})`);

  console.log('上流のエラーはそのまま返す');
  const status = await page.evaluate(async () => (await fetch('/v1/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'FAIL', questions: {} }) })).status);
  check(status === 401, `401 を返す (${status})`);
  const other = await page.evaluate(async () => (await fetch('/other', { method: 'POST', body: '{}' })).status);
  check(other === 404, `/v1/systemone 以外の POST は受けない (${other})`);

  check(errors.length === 0, `コンソールエラーなし ${errors.join(' / ')}`);
} finally {
  await browser.close();
  relay.kill();
  upstream.close();
}
done();
