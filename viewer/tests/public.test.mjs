// 期間限定の一般公開：公開期間・1日の上限回数・停止スイッチ（Netlify 関数とビューア）
// Netlify Blobs の代わりにメモリの保存場所、TypeSafe の代わりに偽サーバーを使う。
import { createServer } from 'node:http';
import { openApp, check, done } from './harness.mjs';

const upstreamLog = [];
const upstream = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    upstreamLog.push({ auth: req.headers.authorization, body });
    const answers = {};
    for (const [k, q] of Object.entries(body.questions || {})) {
      if (q.type === 'noul') answers[k] = { type: 'noul', noul: 0.7 };
      else if (q.type === 'score') answers[k] = { type: 'score', score: 0, confidence: 0.8, probabilities: { 0: 0.8, 1: 0.1, 2: 0.1 } };
      else { const keys = Object.keys(q.criteria); answers[k] = { type: 'choice', choice: keys[0], confidence: 0.9, probabilities: Object.fromEntries(keys.map((x, i) => [x, i ? 0.1 / (keys.length - 1) : 0.9])) }; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answers }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));

// Netlify Blobs の代わり
const blobs = new Map();
globalThis.__jevRelayStore = { get: async (k) => (blobs.has(k) ? blobs.get(k) : null), set: async (k, v) => { blobs.set(k, v); } };
const at = (iso) => { globalThis.__jevNow = Date.parse(iso); };

process.env.TYPESAFE_API_KEY = 'secret-key';
process.env.RELAY_PASSPHRASE = 'owner-pass';
process.env.RELAY_PUBLIC_UNTIL = '2026-10-10';
process.env.RELAY_DAILY_LIMIT = '3';
process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
const fn = await import('../../netlify/functions/systemone.mjs');
const req = (path, { method = 'POST', pass, body } = {}) => fn.default(new Request(`https://site.example${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(pass ? { 'X-Relay-Passphrase': pass } : {}) }, body: method === 'GET' ? undefined : (body ?? JSON.stringify({ state: 'x', questions: {} })),
}));
const judge = (pass) => req('/v1/systemone', { pass });

console.log('関数：公開期間');
check(JSON.stringify(fn.config.path) === '["/v1/systemone","/v1/models","/v1/relay-status","/v1/relay-admin"]', 'パス');
at('2026-10-05T12:00:00+09:00');
let r = await req('/v1/relay-status', { method: 'GET' });
let st = await r.json();
check(r.status === 200 && st.open === true && st.until === '2026-10-10' && !('used' in st), `期間中は公開中（回数は一般には見せない）${JSON.stringify(st)}`);
r = await judge();
check(r.status === 200 && upstreamLog.at(-1).auth === 'Bearer secret-key', '合言葉なしでも判定できる');
check(blobs.get('count-2026-10-05') === '1', '一般の利用を日ごとに数える');

console.log('関数：1日の上限');
await judge(); await judge();
r = await judge();
let body = await r.json();
check(r.status === 403 && body.code === 'limit', `上限（3回）を超えたら断る (${body.code})`);
r = await judge('owner-pass');
check(r.status === 200 && blobs.get('count-2026-10-05') === '3', '持ち主は上限に関係なく使え、回数にも数えない');
at('2026-10-06T00:30:00+09:00');
r = await judge();
check(r.status === 200 && blobs.get('count-2026-10-06') === '1', '日本時間の0時で回数がリセット');

console.log('関数：停止スイッチ');
r = await req('/v1/relay-admin', { body: JSON.stringify({ action: 'stop' }) });
check(r.status === 403, '合言葉なしでは止められない');
r = await req('/v1/relay-admin', { pass: 'owner-pass', body: JSON.stringify({ action: 'stop' }) });
st = await r.json();
check(r.status === 200 && st.reason === 'stopped' && blobs.get('stopped') === 'true', '持ち主は止められる（再デプロイ不要）');
r = await judge();
body = await r.json();
check(r.status === 403 && body.code === 'stopped', '停止中は一般の人を断る');
check((await judge('owner-pass')).status === 200, '停止中も持ち主は使える');
r = await req('/v1/relay-admin', { pass: 'owner-pass', body: JSON.stringify({ action: 'resume' }) });
check((await r.json()).open === true && (await judge()).status === 200, '再開できる');
r = await req('/v1/relay-status', { method: 'GET', pass: 'owner-pass' });
st = await r.json();
check(st.used === 2 && st.limit === 3, `持ち主には回数を見せる (${st.used}/${st.limit})`);

console.log('関数：期間の終わり');
at('2026-10-10T23:59:00+09:00');
check((await judge()).status === 200, '最終日（10/10）の23:59までは使える');
at('2026-10-11T00:00:30+09:00');
r = await judge();
body = await r.json();
check(r.status === 403 && body.code === 'closed', `10/11 0:00 からは断る (${body.code})`);
check((await judge('owner-pass')).status === 200, '期間後も持ち主は使える');
r = await req('/v1/models', { method: 'GET' });
check(r.status === 403, 'モデル一覧は持ち主だけ');
delete process.env.RELAY_PUBLIC_UNTIL;
at('2026-10-05T12:00:00+09:00');
st = await (await req('/v1/relay-status', { method: 'GET' })).json();
check(st.open === false && st.reason === 'closed', 'RELAY_PUBLIC_UNTIL が未設定なら一般公開しない');
process.env.RELAY_PUBLIC_UNTIL = '2026-10-10';

console.log('ビューア：一般の人');
blobs.clear();
const app = await openApp({ viewport: { width: 400, height: 820 } });
const { page } = app;
const browserReqs = [];
await page.route(/\/v1\/(systemone|models|relay-status|relay-admin)$/, async (route) => {
  const rq = route.request();
  browserReqs.push({ path: new URL(rq.url()).pathname, pass: rq.headers()['x-relay-passphrase'] });
  const res = await fn.default(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: rq.method() === 'GET' ? undefined : rq.postData() }));
  await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});
await page.reload();
await page.waitForTimeout(500);
let v = await page.evaluate(() => ({ route: JV.Settings.route(), adapter: JV.Judge.adapter().name || 'mock', status: document.getElementById('route-status').textContent }));
check(v.route === 'relay' && v.adapter === 'relay', `初めての人は、公開中の中継を自動で使う (${v.route})`);
check(v.status.includes('一般公開中・10/10まで'), `起動画面に公開中と表示 (${v.status})`);

upstreamLog.length = 0;
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(1500);
check(upstreamLog.some((x) => x.body.questions && x.body.questions.location), '合言葉なしで本物の判定が届く');
check(browserReqs.filter((x) => x.path === '/v1/systemone').every((x) => !x.pass), 'ブラウザは合言葉を送っていない');

// 上限に達する → 簡易判定に切り替えて知らせる
await page.evaluate(() => JV.Judge.memory.clear());
blobs.set('count-2026-10-05', '999');
await page.evaluate(() => { const el = [...document.querySelectorAll('.seg')].find((e) => e.textContent.includes('日が暮れてから')); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 6); });
await page.waitForTimeout(1500);
v = await page.evaluate(() => ({ notice: document.getElementById('notice').textContent, visible: !document.getElementById('notice').classList.contains('hidden'), adapter: JV.Judge.adapter() === JV.Adapters.mock, judge: JV.Debug.lines.judge || '' }));
check(v.visible && v.notice.includes('今日の利用上限'), `上限に達したら知らせる (${v.notice.slice(0, 20)}…)`);
check(v.adapter, '簡易判定（モック）に切り替わる');
const bg = await page.evaluate(() => [...document.querySelectorAll('#stage .bg')].find((b) => b.style.zIndex === '2')?.dataset.loc);
check(!!bg, `絵は出続ける (${bg})`);

// 自分で経路を選んだ人（モック）は、公開中でも中継を使わない
await page.evaluate(() => { JV.App.publicRelay = { open: true }; JV.Settings.set('route', 'mock'); JV.Settings.set('routeChosen', true); });
check(await page.evaluate(() => JV.Settings.route()) === 'mock', '自分でモックを選んだ人には中継を使わない');
await page.evaluate(() => { JV.Settings.set('routeChosen', false); });

console.log('ビューア：公開の管理（持ち主）');
blobs.clear();
await page.evaluate(() => JV.App.showHome());
await page.click('#home-footer button');
await page.selectOption('#settings [data-key="route"]', 'relay');
check(await page.isVisible('text=公開の管理'), '中継では「公開の管理」欄が出る');
await page.click('text=一般公開を止める');
await page.waitForTimeout(200);
const noPass = await page.textContent('#admin-result');
check(noPass.includes('「合言葉」を入れて'), `合言葉がないと操作できない (${noPass})`);
await page.fill('#settings [data-key="relayPass"]', 'owner-pass');
await page.dispatchEvent('#settings [data-key="relayPass"]', 'change');
await page.click('text=一般公開を止める');
await page.waitForFunction(() => /一般公開：/.test(document.getElementById('admin-result').textContent));
let msg = await page.textContent('#admin-result');
check(msg.includes('一時停止中') && blobs.get('stopped') === 'true', `止められる (${msg})`);
await page.click('text=再開する');
await page.waitForFunction(() => /公開中/.test(document.getElementById('admin-result').textContent));
msg = await page.textContent('#admin-result');
check(msg.includes('公開中') && msg.includes('期限 2026-10-10') && msg.includes('今日 0 / 3 回'), `再開と状況表示 (${msg})`);
await page.click('#settings header button');

check(app.errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, `想定外のコンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
upstream.close();
done();
