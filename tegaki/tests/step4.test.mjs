// ステップ4：キャッシュ（メモリ＋IndexedDB）、先読み、リクエスト中断
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 1000, height: 800 } });
const { page } = app;

// 判定器を「呼ばれた単位と中断」を記録するものに差し替える
const instrument = () => page.evaluate(() => {
  window.__log = { calls: [], aborted: [] };
  const base = JV.Adapters.mock;
  window.__spy = {
    name: 'mock', latency: [60, 120],
    async judge(state, questions, opts = {}) {
      const unit = typeof state === 'object' && state.current !== undefined ? JV.App.doc.units.findIndex((u) => u.text === state.current) : 'work';
      window.__log.calls.push(unit);
      if (opts.signal) opts.signal.addEventListener('abort', () => window.__log.aborted.push(unit), { once: true });
      await JV.util.sleep(this.latency[0] + Math.random() * (this.latency[1] - this.latency[0]), opts.signal);
      return base.judge(state, questions, {});
    },
  };
  JV.Judge.adapter = () => window.__spy;
});
const scrollToUnit = (u) => page.evaluate((u) => {
  const el = document.querySelector(`.seg[data-u="${u}"]`);
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 6);
}, u);
const log = () => page.evaluate(() => window.__log);
// 先読み・中断を確かめるには単位が多い方がよいので、1段落 ≒ 1判定単位（約200字）の40段落の文書を使う
const openLong = () => page.evaluate(() => {
  const places = ['座敷', '大通り', '川の土手', '停車場', '森の山道', '砂浜', '台所', '教室'];
  const paras = [];
  for (let i = 0; i < 40; i++) {
    const p = places[i % places.length];
    paras.push(`　第${i + 1}段。私は${p}にいた。` + 'あたりは静かで、遠くで鳥の声がしていた。私はしばらくそこに立ち止まり、昔のことを思い出していた。'.repeat(4));
  }
  JV.App.openText(`長い試験文\n試作\n\n${paras.join('\n')}\n`, 'long.txt');
});
const reset = () => page.evaluate(() => { window.__log.calls = []; window.__log.aborted = []; });

await instrument();
await openLong();
await page.waitForTimeout(1500);
check(await page.evaluate(() => JV.App.doc.units.length) === 40, '試験用の文書は40単位');

console.log('先読み');
let L = await log();
check(L.calls.includes('work'), '作品判定は開いたときに1回');
const u0 = await page.evaluate(() => JV.App.currentUnit);
check(L.calls.filter((c) => c !== 'work').sort((a, b) => a - b).join() === [u0, u0 + 1, u0 + 2, u0 + 3].join(), `停止した単位#${u0}＋次の3単位を判定 (${L.calls})`);

console.log('キャッシュ（メモリ）');
await reset();
await scrollToUnit(u0 + 2);
await page.waitForTimeout(900);
L = await log();
check(!L.calls.includes(u0 + 2), `先読み済みの単位は呼ばない (${L.calls})`);
check(L.calls.join() === [u0 + 4, u0 + 5].join(), `先読みの不足分だけ呼ぶ (${L.calls})`);
check((await page.textContent('#debug').catch(() => '')) !== null, 'デバッグ表示あり');

await reset();
await scrollToUnit(u0);
await page.waitForTimeout(900);
L = await log();
check(L.calls.length === 0, `戻ったときは呼ばない (${L.calls})`);
const src = await page.evaluate(() => JV.Debug.lines.judge);
check(/キャッシュ\(メモリ\)/.test(src), `キャッシュから表示 (${src.split('\n')[0]})`);

console.log('高速スクロール中は呼ばない');
await reset();
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(90); }
L = await log();
check(L.calls.length === 0, `スクロール中の呼び出し 0 (${L.calls})`);
await page.waitForTimeout(900);

console.log('リクエスト中断');
await page.evaluate(() => { window.__spy.latency = [1200, 1300]; });
await reset();
await scrollToUnit(9);
await page.waitForTimeout(550);               // 停止 → 判定開始（まだ終わらない）
L = await log();
check(L.calls.includes(9), `単位9の判定が始まる (${L.calls})`);
await scrollToUnit(16);
await page.waitForTimeout(550);
L = await log();
check(L.aborted.includes(9), `新しい停止で古い判定を中断 (aborted ${L.aborted})`);
check(L.calls.includes(16), `新しい単位の判定が始まる (${L.calls})`);
await page.waitForTimeout(1600);
const shownUnit = await page.evaluate(() => JV.Debug.lines.judge.match(/判定 #(\d+)/)[1]);
check(shownUnit === '16', `表示は新しい単位の結果 (#${shownUnit})`);

// 先読み中に別の場所で止まったら、先読みも中断する（単位16の判定後、17〜19 の先読みが走っている）
L = await log();
check([17, 18, 19].every((u) => L.calls.includes(u)), `単位16の後ろを先読み中 (${L.calls})`);
await reset();
await scrollToUnit(3);                 // キャッシュ済みの場所へ
await page.waitForTimeout(500);
L = await log();
check([17, 18, 19].every((u) => L.aborted.includes(u)), `先読みも中断 (aborted ${L.aborted})`);
await page.waitForTimeout(1500);

// 判定中の単位に戻ってきたら、中断せずその結果を待つ
await page.evaluate(() => { window.__spy.latency = [900, 1000]; });
await reset();
await scrollToUnit(11);
await page.waitForTimeout(500);
await page.mouse.wheel(0, 1);                 // 同じ単位の中で少し動く
await page.waitForTimeout(500);
L = await log();
check(!L.aborted.includes(11) && L.calls.filter((c) => c === 11).length === 1, `同じ単位では二重に呼ばない・中断しない (${L.calls} / ${L.aborted})`);
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__spy.latency = [60, 120]; });

console.log('IndexedDB（再読込後）');
const hash = await page.evaluate(() => JV.App.hash);
await page.reload();
await instrument();
await openLong();
await page.waitForTimeout(1500);
check(await page.evaluate(() => JV.App.doc.units.length) === 40, '試験用の文書は40単位');
L = await log();
const stats = await page.evaluate(() => JV.Judge.stats);
check(!L.calls.includes('work'), `作品判定もキャッシュから (${L.calls})`);
check(L.calls.length === 0 && stats.dbHits >= 1, `再読込後は IndexedDB から (呼び出し ${L.calls.length} / DB ${stats.dbHits})`);
check(await page.evaluate(() => JV.App.hash) === hash, '作品ハッシュが同じ');

console.log('最近読んだ作品');
await scrollToUnit(16);
await page.waitForTimeout(1700);
await page.click('#reader-top button');
await page.waitForSelector('#home:not(.hidden)');
await page.waitForTimeout(300);
const recent = await page.evaluate(() => [...document.querySelectorAll('#recent-list .name')].map((e) => e.textContent));
check(recent.length === 1 && recent[0].includes('長い試験文'), `起動画面に表示 (${recent})`);
await page.click('#recent-list .recent-item button');
await page.waitForTimeout(900);
const resumed = await page.evaluate(() => JV.App.currentUnit);
check(Math.abs(resumed - 16) <= 1, `続きの位置から開く (#${resumed})`);
await page.click('#reader-top button');
await page.waitForSelector('#home:not(.hidden)');
await page.click('#recent-list .del');
await page.waitForTimeout(300);
const after = await page.evaluate(async () => ({ n: document.querySelectorAll('#recent-list li').length, j: ((await JV.Store.all('judgments')) || []).length }));
check(after.n === 0 && after.j === 0, `履歴と判定キャッシュを削除できる (${after.n}, ${after.j})`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
