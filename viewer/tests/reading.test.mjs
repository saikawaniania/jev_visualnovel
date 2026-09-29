// 読み方まわりの改良：判定単位の長さをそろえる／主人公を作品単位で保持する／挿絵モード（上に絵・下に本文）
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 400, height: 820 } });
const { page } = app;

console.log('判定単位の長さ');
const units = await page.evaluate(() => {
  const lines = ['第一章　はじまり', ''];
  for (let i = 0; i < 30; i++) {
    lines.push(i % 3 === 0 ? `「そうだね、${i}回目だ」` : `　私は歩いた。${'風が吹いた。'.repeat(1 + (i % 4))}`);
  }
  lines.push('　' + '長い段落の文です。'.repeat(100)); // 900字
  lines.push('', '第二章　つづき', '', '　短い。');
  const d = JV.Parser.parse(lines.join('\n'), 'u.txt');
  JV.Reader.doc = d;
  const len = (u) => u.text.replace(/\n/g, '').length;
  const long = d.paragraphs.find((p) => p.text.length > 800);
  return {
    lens: d.units.map(len),
    chapters: d.units.map((u) => u.chapter),
    crossChapter: d.units.some((u) => new Set(u.segs.map((s) => d.paragraphs[d.segments[s].para].chapter)).size > 1),
    dialogueOnly: d.units.filter((u) => u.segs.every((s) => d.segments[s].dialogue)).length,
    longSplit: long.segs.map((s) => d.segments[s].text.length),
    ctx: d.units.map((u, i) => JV.Reader.contextBefore(i).length),
    ctxStartsClean: d.units.slice(1).every((u, i) => !/^[、。」]/.test(JV.Reader.contextBefore(i + 1))),
  };
});
const inChapter1 = units.lens.filter((_, i) => units.chapters[i] === 0);
const body = inChapter1.slice(0, -1); // 章の最後は短くてもよい
check(body.every((n) => n >= 140 && n <= 420), `判定単位はおおむね 160〜400 字 (${inChapter1.join(', ')})`);
check(!units.crossChapter, '章をまたがない');
check(units.dialogueOnly === 0, '会話だけの判定単位を作らない');
check(units.longSplit.length === 3 && Math.max(...units.longSplit) - Math.min(...units.longSplit) < 60, `長い段落は均等に分ける (${units.longSplit})`);
check(units.ctx.every((n) => n <= 300) && units.ctx.filter((n) => n >= 240).length >= units.ctx.length - 3, `直前の文脈は約300字 (${units.ctx.join(', ')})`);
check(units.ctxStartsClean, '文脈は文の途中から始めない');

console.log('主人公');
// 判定器を記録つきに差し替える（作品判定に渡した本文と、場面判定の state を見る）
await page.evaluate(() => {
  window.__work = [];
  window.__scene = [];
  const base = JV.Adapters.mock;
  JV.Judge.adapter = () => ({
    name: 'mock',
    async judge(state, questions, opts) {
      if (questions.protagonist) window.__work.push(state);
      else window.__scene.push(state);
      const a = await base.judge(state, questions, opts);
      // 作品判定：一人称・主人公は成人女性、と決め打ちで返す
      if (questions.protagonist) {
        a.narration = { type: 'choice', choice: '一人称', probabilities: { '一人称': 0.9, '三人称': 0.1 }, confidence: 0.9 };
        a.protagonist = { type: 'choice', choice: '成人女性', probabilities: { '成人女性': 0.8 }, confidence: 0.8 };
      }
      return a;
    },
  });
});
const longText = () => {
  const paras = [];
  for (let i = 0; i < 30; i++) paras.push(`　第${i + 1}段。わたしは座敷にいた。` + '障子越しに光がさしていた。しばらく黙って、昔のことを思い出していた。'.repeat(4));
  return `主人公の試験\n試作\n\n${paras.join('\n')}\n`;
};
await page.evaluate((t) => JV.App.openText(t, 'hero.txt'), longText());
await page.waitForTimeout(1500);
let w = await page.evaluate(() => ({ work: JV.App.work, pro: JV.App.protagonist(), head: window.__work[0], scene: window.__scene[0] }));
check(w.work.protagonist === 'woman' && w.pro === 'woman', `作品判定で主人公を決める (${w.work.protagonist})`);
check(w.head.startsWith('第1段。') && w.head.length <= 3000, '作品判定には冒頭（約3,000字）を渡す');
check(w.scene && /成人女性（一人称の語り手）/.test(w.scene.protagonist), `場面判定の state に主人公を添える (${w.scene && w.scene.protagonist})`);

// 途中から開き直しても、作品判定は冒頭で行う（キャッシュも同じ作品として使う）
await page.evaluate(() => { window.__work = []; JV.App.showHome(); });
await page.waitForTimeout(1300);
await page.evaluate(async () => {
  const rec = ((await JV.Store.all('works')) || []).find((r) => r.name === 'hero.txt');
  JV.App.openText(rec.text, rec.name, { resumeUnit: 12 });
});
await page.waitForTimeout(1500);
w = await page.evaluate(() => ({ cur: JV.App.currentUnit, pro: JV.App.protagonist(), calls: window.__work.length }));
check(w.cur >= 11 && w.pro === 'woman', `途中（#${w.cur}）から開いても主人公は同じ`);
check(w.calls === 0, '作品判定はキャッシュを使い、呼び直さない');

// 場面判定の人物が分からないとき、一人称なら主人公で描く
const figs = await page.evaluate(() => {
  const ch = (k, label, p) => ({ type: 'choice', choice: label, probabilities: { [label]: p }, confidence: p });
  const D = JV.Director;
  const run = (o, extra = {}) => { D.reset(); return D.decide({ location: ch('location', '和室', 0.9), people: ch('people', o.people, 0.9), figure_main: ch('figure_main', o.main, o.mainP), figure_sub: ch('figure_sub', o.sub || '不明', 0.7) }, { chapter: 0, protagonist: 'woman', narration: o.narration || 'first', ...extra }).scene.figures; };
  return {
    unknownFirst: run({ people: '1人', main: '不明', mainP: 0.8 }),
    weakFirst: run({ people: '1人', main: '成人男性', mainP: 0.45 }),
    sureFirst: run({ people: '1人', main: '成人男性', mainP: 0.8 }),
    twoFirst: run({ people: '2人', main: '老人', mainP: 0.8, sub: '少年' }),
    third: run({ people: '1人', main: '不明', mainP: 0.8, narration: 'third' }),
    hide: run({ people: '2人', main: '老人', mainP: 0.8 }, { hideNarrator: true }),
  };
});
check(figs.unknownFirst.main === 'woman', `人物が「不明」なら主人公 (${figs.unknownFirst.main})`);
check(figs.weakFirst.main === 'woman', `一人称で1人・確信度が低いなら主人公 (${figs.weakFirst.main})`);
check(figs.sureFirst.main === 'man', `はっきり別人なら判定どおり (${figs.sureFirst.main})`);
check(figs.twoFirst.main === 'old' && figs.twoFirst.sub === 'woman', `一人称で2人なら片方は語り手 (${figs.twoFirst.main}/${figs.twoFirst.sub})`);
check(figs.third.main === 'woman', `三人称でも、分からなければ主人公 (${figs.third.main})`);
check(figs.hide.layout === 'one' && figs.hide.main === 'old', `語り手を描かない設定では相手だけ (${figs.hide.layout}/${figs.hide.main})`);

// 設定画面で手動で直す → 作品ごとに保存され、開き直しても残る
await page.click('#reader-top .settings-btn');
check(await page.isVisible('#work-settings'), '読書中は設定に「この作品」の欄');
const auto = await page.$eval('#protagonist-select option', (o) => o.textContent);
check(auto.includes('自動（判定：成人女性）'), `自動の判定結果を表示 (${auto})`);
await page.selectOption('#protagonist-select', 'boy');
await page.click('#settings header button');
await page.waitForTimeout(300);
check(await page.evaluate(() => JV.App.protagonist()) === 'boy', '手動の指定が優先');
await page.evaluate(async () => {
  JV.App.showHome();
  const rec = ((await JV.Store.all('works')) || []).find((r) => r.name === 'hero.txt');
  JV.App.openText(rec.text, rec.name);
});
await page.waitForTimeout(1200);
check(await page.evaluate(() => JV.App.protagonist()) === 'boy', '開き直しても手動の指定が残る');
await page.click('#reader-top .settings-btn');
await page.selectOption('#protagonist-select', '');
await page.click('#settings header button');
await page.waitForTimeout(200);
check(await page.evaluate(() => JV.App.protagonist()) === 'woman', '「自動」に戻せる');
await page.evaluate(() => JV.App.showHome());
await page.click('#home-footer button');
check(!(await page.isVisible('#work-settings')), '起動画面の設定では「この作品」の欄を出さない');
await page.click('#settings header button');

console.log('挿絵モード（スマホ縦）');
await page.evaluate(() => { JV.Settings.set('displayMode', 'illust'); JV.App.applySettings(); JV.Settings.set('debug', true); JV.Debug.render(); });
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(1500);
let lay = await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const col = document.getElementById('text-column');
  const firstText = document.querySelector('#text .chapter-title, #text p').getBoundingClientRect();
  return { stTop: st.top, stH: st.height, stW: st.width, firstTop: firstText.top + scrollY, cy: JV.StopDetector.centerY(), line: document.getElementById('center-line').getBoundingClientRect().top, fig: [...document.querySelectorAll('#stage .fig')].filter((f) => f.style.display !== 'none').map((f) => f.getBoundingClientRect().height)[0] };
});
check(lay.stTop === 0 && Math.abs(lay.stH - 820 * 0.4) < 2 && lay.stW === 400, `上の4割に絵 (高さ ${lay.stH})`);
check(lay.firstTop >= lay.stH, `本文は絵の下から始まる (${Math.round(lay.firstTop)})`);
check(Math.abs(lay.cy - (lay.stH + 820) / 2) < 2 && Math.abs(lay.line - lay.cy) < 2, `停止検知の中央は「絵の下〜画面下」の中央 (${Math.round(lay.cy)})`);
check(lay.fig && lay.fig < lay.stH, `シルエットは絵の枠に収まる (${Math.round(lay.fig)} < ${Math.round(lay.stH)})`);

// 本文の中央にある単位が選ばれる
await page.evaluate(() => { const el = [...document.querySelectorAll('.seg')].find((e) => e.textContent.includes('日が暮れてから')); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - JV.StopDetector.centerY() + 6); });
await page.waitForTimeout(900);
const picked = await page.evaluate(() => JV.App.doc.units[JV.App.currentUnit].text.slice(0, 12));
check(picked.startsWith('日が暮れてから'), `本文の見えている範囲の中央の単位を判定 (${picked})`);

console.log('挿絵モード（横向き）');
await page.setViewportSize({ width: 820, height: 400 });
await page.waitForTimeout(500);
lay = await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const col = document.getElementById('text').getBoundingClientRect();
  return { stW: st.width, stH: st.height, colLeft: col.left, cy: JV.StopDetector.centerY() };
});
check(Math.abs(lay.stW - 410) < 2 && lay.stH === 400, `左半分に絵 (${lay.stW}×${lay.stH})`);
check(lay.colLeft >= 410, `本文は右半分 (${Math.round(lay.colLeft)})`);
check(lay.cy === 200, '横向きの中央は画面の中央');

console.log('演出オフ');
await page.setViewportSize({ width: 400, height: 820 });
await page.click('#effects-toggle');
await page.waitForTimeout(200);
lay = await page.evaluate(() => ({ cy: JV.StopDetector.centerY(), pad: parseFloat(getComputedStyle(document.getElementById('text-column')).paddingTop) }));
check(lay.cy === 410 && lay.pad < 100, `演出オフなら本文は画面いっぱい・中央も画面の中央 (${lay.cy}, 上余白 ${lay.pad})`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
