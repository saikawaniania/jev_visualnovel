// ステップ5：設定画面、実Jevアダプタ
// 外部APIには届かない環境でも確かめられるよう、接続先はブラウザ内で差し替えた偽サーバーにする。
import { openApp, check, done } from './harness.mjs';
import { createServer } from 'node:http';

// 本物の別オリジン（CORS ヘッダーを返さないサーバー）
const noCors = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"answers":{}}'); });
await new Promise((r) => noCors.listen(0, '127.0.0.1', r));
const noCorsUrl = `http://127.0.0.1:${noCors.address().port}/v1/systemone`;

const app = await openApp({ viewport: { width: 1000, height: 800 } });
const { page } = app;

// 偽の Jev：届いた questions に対して、criteria の先頭（または指定）の選択肢を返す
const requests = [];
let mode = 'ok';
const fakeAnswers = (q) => {
  const answers = {};
  const prefer = { location: ['和室', 'washitsu'], time: ['朝', 'morning'], era: ['近代日本', 'modern'], people: ['2人', 'two'] };
  for (const [k, v] of Object.entries(q)) {
    if (v.type === 'noul') answers[k] = { type: 'noul', noul: 0.8 };
    else if (v.type === 'score') answers[k] = { type: 'score', score: 0.4, confidence: 0.7, probabilities: { 0: 0.6, 1: 0.4, 2: 0 }, legend: {} };
    else {
      const keys = Object.keys(v.criteria);
      const pick = (prefer[k] || []).find((x) => keys.includes(x)) || keys[0];
      const probabilities = Object.fromEntries(keys.map((x) => [x, x === pick ? 0.9 : 0.1 / (keys.length - 1)]));
      answers[k] = { type: 'choice', choice: pick, confidence: 0.9, probabilities };
    }
  }
  return answers;
};
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, http-referer, x-title', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const handler = async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = req.postDataJSON();
  requests.push({ url: req.url(), headers: req.headers(), body });
  // CORS 拒否：ブラウザの fetch は TypeError で失敗する（ネットワーク断と区別できない）。
  // Playwright の fulfill は CORS 検査を通してしまうので、同じ失敗の仕方になる abort で再現する
  if (mode === 'nocors') return route.abort('failed');
  if (mode === '401') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid api key' } }) });
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ model: body.model, answers: fakeAnswers(body.questions), usage: { input_tokens: 1, output_tokens: 0 } }) });
};
await page.route('https://api.typesafe.ai/**', handler);
await page.route('https://openrouter.ai/**', handler);
await page.route('https://relay.example.com/**', handler);

console.log('設定画面');
await page.click('#home-footer button');
check(await page.isVisible('#settings'), '起動画面から設定を開ける');
const defaults = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#settings [data-key]')].map((e) => [e.dataset.key, e.type === 'checkbox' ? e.checked : e.value])));
check(defaults.route === 'mock' && defaults.apiKey === '', 'APIキー・経路は未設定（モック）');
check(defaults.model === 'jev-latest', 'モデル版 jev-latest');
check(defaults.stopDelay === '400' && defaults.sensitivity === '0.6' && defaults.fadeScale === '1', '停止待ち 400ms・感度 普通(0.6)・フェード 1.0');
check(defaults.displayMode === 'novel' && defaults.writingMode === 'horizontal' && defaults.fontSize === '18', 'ノベル・横書き・18px');
check(defaults.silhouettes === true && defaults.debug === false, 'シルエット オン・デバッグ オフ');
check(!(await page.isVisible('#settings [data-key="apiKey"]')), 'モックのときはキー欄を隠す');
check(await page.getAttribute('#settings [data-key="route"]', 'onchange') !== null, '入力は onchange 属性');

await page.fill('#settings [data-key="fontSize"]', '22');
await page.dispatchEvent('#settings [data-key="fontSize"]', 'change');
await page.check('#settings [data-key="debug"]');
check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size').trim()) === '22px', '文字サイズを反映');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('jev-viewer-settings')).fontSize) === 22, 'localStorage に保存');

console.log('経路：TypeSafe 直接');
await page.selectOption('#settings [data-key="route"]', 'typesafe');
check(await page.isVisible('#settings [data-key="apiKey"]'), 'キー欄が出る');
await page.click('#conn-test');
check((await page.textContent('#conn-result')).includes('APIキーを入力'), 'キー未設定なら接続テストで案内');
check(await page.evaluate(() => JV.Judge.adapter().name) === 'mock', 'キー未設定の間はモックで動く');
await page.fill('#settings [data-key="apiKey"]', 'ts-test-key-123');
await page.dispatchEvent('#settings [data-key="apiKey"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
const ok = await page.textContent('#conn-result');
check(ok.startsWith('接続できました') && ok.includes('近代日本'), `接続テスト成功 (${ok})`);
let r = requests.at(-1);
check(r.url === 'https://api.typesafe.ai/v1/systemone', `POST /v1/systemone (${r.url})`);
check(r.headers.authorization === 'Bearer ts-test-key-123', 'Bearer 認証');
check(r.body.model === 'jev-latest' && r.body.questions.era.type === 'choice', 'model と questions');
await page.click('#settings header button');

console.log('読書中の判定が実アダプタを通る');
requests.length = 0;
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(1800);
const sceneReq = requests.find((x) => x.body.questions.location);
check(!!sceneReq, `場面判定のリクエスト (${requests.length} 件)`);
const st = sceneReq.body.state;
check(st && st.era === '近代日本' && st.previous_scene && 'context_before' in st && typeof st.current === 'string', `state は {era, previous_scene, context_before, current} (${Object.keys(st)})`);
const qs = sceneReq.body.questions;
check(qs.scene_changed.type === 'noul' && qs.mood.type === 'score' && Array.isArray(qs.mood.criteria) && qs.location.criteria['和室'].includes('座敷'), 'questions は Noul / Score / Choice（criteria に言い換え例）');
const dbg = await page.evaluate(() => JV.Debug.lines.judge || '');
check(/typesafe/.test(dbg) && /location: 和室 0\.90/.test(dbg), `判定結果がデバッグ表示に (${dbg.split('\n')[0]})`);
const bgLoc = await page.evaluate(() => [...document.querySelectorAll('#stage .bg')].find((b) => b.style.opacity === '1')?.dataset.loc);
check(bgLoc === 'washitsu', `応答どおりに背景を合成 (${bgLoc})`);
const figs = await page.evaluate(() => [...document.querySelectorAll('#stage .fig')].filter((f) => f.style.display !== 'none').map((f) => f.className));
check(figs.some((c) => c.includes('pos-left')) && figs.some((c) => c.includes('pos-right')), `2人は左右に向かい合わせ (${figs})`);

console.log('英字IDのキー');
await page.click('#reader-top .settings-btn');
await page.selectOption('#settings [data-key="asciiKeys"]', 'true');
await page.click('#settings header button');
requests.length = 0;
await page.waitForTimeout(1500);
const asciiReq = requests.find((x) => x.body.questions.location);
check(asciiReq && 'washitsu' in asciiReq.body.questions.location.criteria, '選択肢のキーを英字IDで送る');
const dbg2 = await page.evaluate(() => JV.Debug.lines.judge || '');
check(/location: washitsu 0\.90/.test(dbg2), '英字IDの答えでも合成できる');

console.log('キャッシュは経路ごと');
const keys = await page.evaluate(async () => [...new Set(((await JV.Store.all('judgments')) || []).map((j) => j.k.split('|')[1]))]);
check(keys.length >= 2 && keys.some((k) => k.startsWith('typesafe:jev-latest')), `判定器・モデル・キー形式ごとに別キャッシュ (${keys})`);

console.log('エラー時は前の絵を維持');
mode = '401';
await page.evaluate(() => { JV.Judge.memory.clear(); return JV.Store.clearJudgments(); });
await page.evaluate(() => { const el = document.querySelector('.seg[data-u="12"]'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 6); });
await page.waitForTimeout(1200);
const err = await page.evaluate(() => JV.Debug.lines.judge || '');
check(/判定エラー: HTTP 401/.test(err) && err.includes('前の絵を維持'), `401 はエラー表示のみ (${err})`);
const kept = await page.evaluate(() => [...document.querySelectorAll('#stage .bg')].find((b) => b.style.opacity === '1')?.dataset.loc);
check(kept === 'washitsu', '絵は前のまま');
await page.click('#reader-top .settings-btn');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
check((await page.textContent('#conn-result')).includes('APIキーと経路'), `接続テストで認証エラーを案内 (${await page.textContent('#conn-result')})`);

console.log('CORS 拒否の検出');
mode = 'nocors';
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
const corsMsg = await page.textContent('#conn-result');
check(corsMsg.includes('CORS') && corsMsg.includes('中継サーバー'), `CORS 拒否を案内 (${corsMsg})`);
mode = 'ok';

// 実際に CORS ヘッダーのない別オリジンへ送ると、同じ案内になる
await page.fill('#settings [data-key="endpoint"]', noCorsUrl);
await page.dispatchEvent('#settings [data-key="endpoint"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
const realCors = await page.textContent('#conn-result');
check(realCors.includes('CORS'), `本物の CORS 拒否も検出 (${realCors.slice(0, 40)}…)`);
await page.fill('#settings [data-key="endpoint"]', '');
await page.dispatchEvent('#settings [data-key="endpoint"]', 'change');

console.log('経路：OpenRouter／中継');
await page.selectOption('#settings [data-key="route"]', 'openrouter');
await page.selectOption('#settings [data-key="asciiKeys"]', 'false');
await page.fill('#settings [data-key="apiKey"]', 'sk-or-test');
await page.dispatchEvent('#settings [data-key="apiKey"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
r = requests.at(-1);
check(r.url.startsWith('https://openrouter.ai/api/v1/') && r.headers.authorization === 'Bearer sk-or-test' && r.headers['x-title'], `OpenRouter へ送る (${r.url})`);
await page.selectOption('#settings [data-key="route"]', 'relay');
// APIキー（sk-or-test）は残っているが、中継には送らない
await page.fill('#settings [data-key="endpoint"]', 'https://relay.example.com/judge');
await page.dispatchEvent('#settings [data-key="endpoint"]', 'change');
await page.click('#conn-test');
await page.waitForFunction(() => !document.getElementById('conn-test').disabled);
r = requests.at(-1);
check(r.url === 'https://relay.example.com/judge' && !r.headers.authorization && (await page.textContent('#conn-result')).startsWith('接続できました'), '中継はURLだけで使える（キーなし）');

await page.click('#settings header button');
check(!(await page.isVisible('#settings')), '閉じる');
check(app.errors.filter((e) => !/Failed to load resource|CORS|Access-Control/.test(e)).length === 0, `想定外のコンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
noCors.close();
done();
