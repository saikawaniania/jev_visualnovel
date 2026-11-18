// ステップ2：読書画面（上に漫画のページ・下に本文）、停止検知、デバッグ表示
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 420, height: 800 } });
const { page } = app;
await page.goto(app.url + '?debug=1');

await page.click('#sample-list li:first-child button');
await page.waitForSelector('#reader:not(.hidden)');

console.log('読書画面（縦持ち）');
const layout = await page.evaluate(() => {
  const stage = document.getElementById('stage').getBoundingClientRect();
  return { illust: document.body.classList.contains('illust'), novel: document.body.classList.contains('novel'), stageH: stage.height / innerHeight, pos: getComputedStyle(document.getElementById('stage')).position };
});
check(layout.illust && !layout.novel, '漫画のページと本文を分けて出す（絵を背景にする表示はない）');
check(layout.pos === 'fixed' && layout.stageH > 0.6 && layout.stageH <= 0.745, `縦持ちではページの欄は上の 7 割前後 (${layout.stageH.toFixed(2)})`);
check(await page.isVisible('#effects-toggle'), '右下に演出トグル');

// onStop の呼び出しを記録する
await page.evaluate(() => {
  window.__stops = [];
  const orig = JV.App.onStop.bind(JV.App);
  JV.StopDetector.onStop = (e) => { window.__stops.push({ unit: e.unit, t: performance.now() }); orig(e); };
});

console.log('停止検知');
await page.waitForTimeout(600);
let stops = await page.evaluate(() => window.__stops);
check(stops.length === 1, `開いた直後に1回判定対象が決まる (${stops.length})`);

// 連続スクロール中は発火しない
await page.evaluate(() => { window.__stops = []; });
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(120); }
stops = await page.evaluate(() => window.__stops);
check(stops.length === 0, `スクロールし続けている間は発火しない (${stops.length})`);
await page.waitForTimeout(550);
stops = await page.evaluate(() => window.__stops);
check(stops.length === 1, `静止後に1回発火 (${stops.length})`);

// 中央の断片が判定単位として選ばれている
const center = await page.evaluate(() => {
  const cy = JV.StopDetector.centerY();
  const cur = [...document.querySelectorAll('#text .seg.current')];
  const rects = cur.map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
  return { top, bottom, cy, unit: window.__stops.at(-1).unit, u: cur[0] && cur[0].dataset.u };
});
check(center.top - 40 <= center.cy && center.cy <= center.bottom + 40, `画面中央付近の単位 #${center.u} (${Math.round(center.top)}〜${Math.round(center.bottom)} / 中央 ${center.cy})`);

// 同じ単位の中で少し動かしただけなら何もしない
await page.evaluate(() => { window.__stops = []; });
await page.mouse.wheel(0, 2);
await page.waitForTimeout(550);
stops = await page.evaluate(() => window.__stops);
check(stops.length === 0, `同じ段落なら何もしない (${stops.length})`);

console.log('章名');
await page.evaluate(() => {
  const h = document.querySelectorAll('#text .chapter-title')[1];
  window.scrollTo(0, h.getBoundingClientRect().top + scrollY - innerHeight / 2 + 120);
});
await page.waitForTimeout(600);
check((await page.textContent('#chapter-name')) === '二', `上部に章名を表示 (${await page.textContent('#chapter-name')})`);

console.log('デバッグ表示');
const dbg = await page.textContent('#debug');
check(await page.isVisible('#debug') && dbg.includes('単位 #'), `デバッグ表示に単位情報 (${dbg.split('\n')[0]})`);
await page.keyboard.press('d');
check(!(await page.isVisible('#debug')), 'D キーでデバッグ表示を消せる');

console.log('演出トグル');
await page.click('#effects-toggle');
check(!(await page.isVisible('#stage')) && (await page.textContent('#effects-toggle')).includes('オフ'), '演出オフで絵を隠す');
await page.click('#effects-toggle');
check(await page.isVisible('#stage'), '演出オンで戻る');

console.log('戻る');
await page.click('#reader-top button');
await page.waitForSelector('#home:not(.hidden)');
check(await page.evaluate(() => JV.StopDetector.io === null), '起動画面に戻ると停止検知を外す');

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await page.screenshot({ path: '/tmp/claude-0/shots/s2-home.png' });
await app.close();
done();
