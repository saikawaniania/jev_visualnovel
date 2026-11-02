// 時代の判定し直し：最初の判定（冒頭約3,000字）で時代が決まらなかったら、読み進めてからもう一度判定する
import { openApp, check, done } from './harness.mjs';

const app = await openApp();
const { page } = app;

// 冒頭の約5,500字には時代の手がかりがなく、そのあとに「魔法」「王国」が出てくる作品
const text = (() => {
  const plain = [], magic = [];
  for (let i = 0; i < 40; i++) plain.push(`　第${i + 1}段。わたしは歩いた。` + '風が吹いて、遠くで誰かが笑った。しばらく黙って考えていた。'.repeat(4));
  for (let i = 0; i < 12; i++) magic.push(`　第${i + 41}段。王国の魔法使いが呪文を唱えた。` + '光が満ちて、竜が空を渡った。'.repeat(4));
  return `時代の試験\n試作\n\n${[...plain, ...magic].join('\n')}\n`;
})();

console.log('最初の判定で時代が決まらないとき');
await page.evaluate((t) => JV.App.openText(t, 'era.txt'), text);
await page.waitForTimeout(1200);
let w = await page.evaluate(() => ({ era: JV.App.work.era, ok: JV.App.work.eraOk, from: JV.App.eraRetry.from }));
check(w.era === 'modern' && w.ok === false, `手がかりがなければ「近代日本」として描き、未確定にしておく (${w.era}, ${w.ok})`);

// 冒頭のうち、まだ読み進めていない（判定済みの範囲内）ところでは判定し直さない
const at = await page.evaluate(() => {
  const d = JV.App.doc; let n = 0;
  const unitAt = (chars) => { let s = 0; for (let i = 0; i < d.units.length; i++) { s += d.units[i].text.length + 1; if (s >= chars) return i; } return d.units.length - 1; };
  return { early: unitAt(2500), magic: d.units.findIndex((u) => u.text.includes('魔法')) };
});
await page.evaluate((u) => JV.App.maybeRetryEra(u), at.early);
await page.waitForTimeout(400);
w = await page.evaluate(() => ({ tries: JV.App.eraRetry.tries, era: JV.App.work.era }));
check(w.tries === 0, `読み進めていなければ判定し直さない (${w.tries}回)`);

// 「魔法」の出てくるところまで読み進めると、キーワードで判定し直して時代が決まる
await page.evaluate((u) => JV.App.maybeRetryEra(u), at.magic + 1);
await page.waitForTimeout(800);
w = await page.evaluate(() => ({ tries: JV.App.eraRetry.tries, era: JV.App.work.era, ok: JV.App.work.eraOk }));
check(w.era === 'fantasy' && w.ok === true && w.tries === 1, `読み進めたら判定し直して時代が決まる (${w.era}, ${w.tries}回)`);

// 決まった時代は保存され、開き直すと最初から使う
await page.evaluate(() => JV.App.showHome());
await page.waitForTimeout(1300);
await page.evaluate(async () => {
  const rec = ((await JV.Store.all('works')) || []).find((r) => r.name === 'era.txt');
  JV.App.openText(rec.text, rec.name);
});
await page.waitForTimeout(1000);
w = await page.evaluate(() => ({ era: JV.App.work.era, ok: JV.App.work.eraOk }));
check(w.era === 'fantasy' && w.ok === true, `判定し直した時代は保存される (${w.era})`);

console.log('Jev が使えるとき');
// 本物の Jev の代わり：渡された本文の長さを記録し、確信度の低い答えを返す
await page.evaluate(() => {
  window.__jev = [];
  JV.Judge.adapter = () => ({
    name: 'fake-jev',
    async judge(state, questions) {
      if (questions.era && !questions.protagonist) window.__jev.push(String(state).length);
      const a = await JV.Adapters.mock.judge(state, questions);
      if (questions.era) a.era = { type: 'choice', choice: '西洋風', probabilities: { '西洋風': 0.35 }, confidence: 0.35 };
      return a;
    },
  });
});
await page.evaluate((t) => JV.App.openText(t.replace('時代の試験', '時代の試験2'), 'era2.txt'), text);
await page.waitForTimeout(1200);
w = await page.evaluate(() => ({ era: JV.App.work.era, ok: JV.App.work.eraOk }));
check(w.ok === false, `Jev の確信度が低ければ未確定 (${w.era})`);
await page.evaluate((u) => JV.App.maybeRetryEra(u), at.magic + 1);
await page.waitForTimeout(900);
w = await page.evaluate(() => ({ era: JV.App.work.era, ok: JV.App.work.eraOk, sent: window.__jev }));
check(w.sent.length === 1 && w.sent[0] <= 1500, `判定し直しで Jev に送るのは 1,500 字まで (${w.sent})`);
check(w.era === 'fantasy' && w.ok === true, `Jev で決まらなければキーワードで決める (${w.era})`);

console.log('最初の判定で決まったとき');
await page.evaluate(() => { window.__jev = []; JV.Judge.adapter = () => JV.Adapters.mock; });
await page.evaluate(() => JV.App.openText('魔法の国\n\n' + '　王国の魔法使いが呪文を唱えた。竜が空を渡った。\n'.repeat(80), 'era3.txt'));
await page.waitForTimeout(1200);
await page.evaluate(() => JV.App.maybeRetryEra(JV.App.doc.units.length - 1));
await page.waitForTimeout(300);
w = await page.evaluate(() => ({ era: JV.App.work.era, ok: JV.App.work.eraOk, tries: JV.App.eraRetry.tries }));
check(w.era === 'fantasy' && w.ok === true && w.tries === 0, `決まっていれば判定し直さない (${w.era}, ${w.tries}回)`);

console.log('一般公開中は最初から本物の Jev');
// 公開状況が分かる前に作品を開いても、作品判定は公開状況が分かるのを待ってから始まる
const route = await page.evaluate(async () => {
  const seen = [];
  const base = JV.Adapters.mock;
  JV.Judge.adapter = () => ({ name: 'probe', async judge(st, q, o) { if (q.protagonist) seen.push(JV.Settings.route()); return base.judge(st, q, o); } });
  JV.Settings.set('route', 'mock'); JV.Settings.set('routeChosen', false);
  JV.App.publicRelay = null;
  JV.App.publicReady = new Promise((r) => setTimeout(() => { JV.App.publicRelay = { open: true, reason: 'open', until: '2026-11-30' }; r(); }, 600));
  JV.App.openText('公開の試験\n\n' + '　王国の魔法使いが呪文を唱えた。\n'.repeat(40), 'pub.txt');
  await new Promise((r) => setTimeout(r, 1500));
  return seen;
});
check(route[0] === 'relay', `公開状況を待ってから作品判定する（${route[0]}）`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
