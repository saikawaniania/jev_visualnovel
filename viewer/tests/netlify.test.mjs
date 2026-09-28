// Netlify の中継関数（netlify/functions/systemone.mjs）
// 本物の TypeSafe の代わりに偽の上流サーバーを立て、関数を直接呼ぶ単体確認と、
// ビューアの /v1/systemone をこの関数につないだ通しの確認をする。
import { createServer } from 'node:http';
import { openApp, check, done } from './harness.mjs';

const upstreamLog = [];
let strictModels = false; // true：本物と同じく jev-1.13 を知らないモデルとして断る
const MODELS = { models: [{ name: 'jev-latest', description: 'Latest Jev', release_date: '2026-09-01' }, { name: 'jev-2026-09-01', description: 'Pinned', release_date: '2026-09-01' }] };
const upstream = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    upstreamLog.push({ path: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MODELS));
    return;
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    upstreamLog.push({ auth: req.headers.authorization, body });
    if (strictModels && !MODELS.models.some((m) => m.name === body.model)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error_type: 'api_usage_error', message: `Unknown model: ${body.model}` }));
      return;
    }
    if (body.state === 'UPSTREAM401') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"invalid api key"}}'); return; }
    const answers = {};
    for (const [k, q] of Object.entries(body.questions || {})) {
      if (q.type === 'noul') answers[k] = { type: 'noul', noul: 0.7 };
      else if (q.type === 'score') answers[k] = { type: 'score', score: 1, confidence: 0.8, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } };
      else { const keys = Object.keys(q.criteria); answers[k] = { type: 'choice', choice: keys[0], confidence: 0.9, probabilities: Object.fromEntries(keys.map((x, i) => [x, i ? 0.1 / (keys.length - 1) : 0.9])) }; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: body.model, answers }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));

const fn = await import('../../netlify/functions/systemone.mjs');
const call = (init = {}) => fn.default(new Request('https://site.example/v1/systemone', { method: 'POST', ...init }));
const body = JSON.stringify({ model: 'jev-1.13', state: '汽車が着いた', questions: { era: { type: 'choice', criteria: { '近代日本': null, '現代日本': null } } }, extra: 'drop me' });

console.log('関数の単体確認');
check(JSON.stringify(fn.config.path) === '["/v1/systemone","/v1/models"]', 'パスは /v1/systemone と /v1/models');
delete process.env.TYPESAFE_API_KEY; delete process.env.RELAY_PASSPHRASE;
let r = await call({ body, headers: { 'X-Relay-Passphrase': 'x' } });
check(r.status === 500 && (await r.json()).error.includes('not configured'), '環境変数が未設定なら 500 で案内');

process.env.TYPESAFE_API_KEY = 'netlify-secret-key';
process.env.RELAY_PASSPHRASE = 'hanabi-2026';
process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
r = await fn.default(new Request('https://site.example/v1/systemone', { method: 'GET' }));
check(r.status === 405, 'POST 以外は 405');
r = await call({ body });
check(r.status === 403, '合言葉なしは 403');
r = await call({ body, headers: { 'X-Relay-Passphrase': 'hanabi-2025' } });
check(r.status === 403 && upstreamLog.length === 0, '合言葉違いは 403（上流には送らない）');
r = await call({ body: '{oops', headers: { 'X-Relay-Passphrase': 'hanabi-2026' } });
check(r.status === 400, '壊れた JSON は 400');
r = await call({ body, headers: { 'X-Relay-Passphrase': 'hanabi-2026' } });
const j = await r.json();
check(r.status === 200 && j.answers.era.choice === '近代日本', '正しい合言葉なら中継して答えを返す');
const up = upstreamLog.at(-1);
check(up.auth === 'Bearer netlify-secret-key', 'キーは関数が付ける');
check(JSON.stringify(Object.keys(up.body)) === '["model","state","questions"]', '送るのは model・state・questions だけ');
r = await call({ body: JSON.stringify({ state: 'UPSTREAM401', questions: {} }), headers: { 'X-Relay-Passphrase': 'hanabi-2026' } });
check(r.status === 401, '上流のエラー（401）はそのまま返す');
const get = (headers = {}) => fn.default(new Request('https://site.example/v1/models', { method: 'GET', headers }));
r = await get();
check(r.status === 403, 'モデル一覧も合言葉なしは 403');
r = await get({ 'X-Relay-Passphrase': 'hanabi-2026' });
const ml = await r.json();
check(r.status === 200 && ml.models.length === 2 && upstreamLog.at(-1).auth === 'Bearer netlify-secret-key', 'モデル一覧を中継（キーは関数が付ける）');
r = await fn.default(new Request('https://site.example/v1/models', { method: 'POST', body: '{}', headers: { 'X-Relay-Passphrase': 'hanabi-2026' } }));
check(r.status === 405, 'モデル一覧は GET のみ');

console.log('ビューアから通しで確認');
const app = await openApp({ viewport: { width: 400, height: 820 } });
const { page } = app;
const browserHeaders = [];
// Netlify 上と同じく、ページと同じオリジンの /v1/systemone をこの関数が受ける
await page.route(/\/v1\/(systemone|models)$/, async (route) => {
  const req = route.request();
  browserHeaders.push(req.headers());
  const res = await fn.default(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'GET' ? undefined : req.postData() }));
  await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});

await page.click('#home-footer button');
// 以前 TypeSafe 直接で入れたキーが残っていても、中継には送らないこと
await page.selectOption('#settings [data-key="route"]', 'typesafe');
await page.fill('#settings [data-key="apiKey"]', 'ts-key-in-browser');
await page.dispatchEvent('#settings [data-key="apiKey"]', 'change');
await page.selectOption('#settings [data-key="route"]', 'relay');
check(await page.isVisible('#settings [data-key="relayPass"]') && !(await page.isVisible('#settings [data-key="apiKey"]')), '中継では合言葉欄を出し、APIキー欄は隠す');

await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
let msg = await page.textContent('#conn-result');
check(msg.includes('合言葉が違います'), `合言葉なしを案内 (${msg})`);

await page.fill('#settings [data-key="relayPass"]', 'hanabi-2026');
await page.dispatchEvent('#settings [data-key="relayPass"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
msg = await page.textContent('#conn-result');
check(msg.startsWith('接続できました'), `接続テスト成功 (${msg})`);
const h = browserHeaders.at(-1);
check(h['x-relay-passphrase'] === 'hanabi-2026' && !h.authorization, 'ブラウザは合言葉だけを送り、APIキーは送らない');

await page.click('#settings header button');
upstreamLog.length = 0;
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(2000);
const scene = upstreamLog.find((x) => x.body.questions && x.body.questions.location);
check(!!scene, `読書中の場面判定が関数を通って届く (${upstreamLog.length} 件)`);
const bg = await page.evaluate(() => [...document.querySelectorAll('#stage .bg')].find((b) => b.style.zIndex === '2')?.dataset.loc);
check(bg === 'washitsu', `応答どおりに合成 (${bg})`);

// 本物の TypeSafe と同じく jev-1.13 を断る → 一覧から選び直す
strictModels = true;
await page.click('#reader-top .settings-btn');
await page.fill('#settings [data-key="model"]', 'jev-1.13');
await page.dispatchEvent('#settings [data-key="model"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
msg = await page.textContent('#conn-result');
check(msg.includes('Unknown model: jev-1.13') && msg.includes('使えるモデルを確認'), `知らないモデル名なら一覧を案内 (${msg})`);
await page.click('#models-btn');
await page.waitForSelector('#model-list button');
const names = await page.$$eval('#model-list button', (bs) => bs.map((b) => b.firstChild.textContent));
check(names.join() === 'jev-latest（2026-09-01）,jev-2026-09-01（2026-09-01）', `一覧を表示 (${names})`);
await page.click('#model-list button:nth-child(2)');
check(await page.inputValue('#settings [data-key="model"]') === 'jev-2026-09-01' && await page.evaluate(() => JV.Settings.get('model')) === 'jev-2026-09-01', '押すとモデル版に入り、保存される');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
msg = await page.textContent('#conn-result');
check(msg.startsWith('接続できました') && upstreamLog.at(-1).body.model === 'jev-2026-09-01', `選んだ版で接続できる (${msg})`);
await page.click('#settings header button');

// 関数の環境変数が未設定のときの案内
delete process.env.RELAY_PASSPHRASE;
await page.click('#reader-top .settings-btn');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
msg = await page.textContent('#conn-result');
check(msg.includes('環境変数'), `未設定なら環境変数の設定を案内 (${msg.slice(0, 50)}…)`);

check(app.errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, `想定外のコンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
upstream.close();
done();
