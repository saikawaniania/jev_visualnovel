// ステップ3：モック判定アダプタ、判定結果に応じた5レイヤー合成・フェード（仮素材）
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 1000, height: 800 } });
const { page } = app;

console.log('質問定義');
const q = await page.evaluate(() => {
  const s = JV.Schema.toQuestions('scene');
  const w = JV.Schema.toQuestions('work');
  const a = JV.Schema.toQuestions('scene', { asciiKeys: true });
  return {
    keys: Object.keys(s), locN: Object.keys(s.location.criteria).length, mood: s.mood.criteria.length,
    sub: Object.keys(s.figure_sub.criteria), work: Object.keys(w), asciiLoc: Object.keys(a.location.criteria).slice(0, 3),
    types: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.type])),
  };
});
check(q.keys.join() === 'scene_changed,location,time,weather,people,figure_main,figure_sub,pose,mood', `場面判定の質問キー ${q.keys}`);
check(q.locN === 16 && q.mood === 3, `location 16択・mood 3段階 (${q.locN}, ${q.mood})`);
check(q.types.scene_changed === 'noul' && q.types.mood === 'score' && q.types.location === 'choice', '型は Noul / Score / Choice');
check(q.sub.join() === '成人男性,成人女性,少年,少女,老人,不明', 'figure_sub は figure_main と同じ選択肢');
check(q.work.join() === 'era,narration', '作品判定の質問');
check(q.asciiLoc.join() === 'washitsu,yoshitsu,kitchen', '英字IDの criteria も作れる');

console.log('モック判定器：スキーマ内の値だけを返す');
const mock = await page.evaluate(async () => {
  const bad = [];
  const texts = [];
  for (const file of ['samples/ame_no_teishaba.txt', 'samples/umibe_no_kissaten.md', 'samples/mori_no_michi.txt']) {
    const buf = await (await fetch(file)).arrayBuffer();
    const doc = JV.Parser.parse(JV.Encoding.decode(buf), file);
    for (const u of doc.units) texts.push(u.text);
  }
  for (const ascii of [false, true]) {
    const qs = JV.Schema.toQuestions('scene', { asciiKeys: ascii });
    for (const t of texts) {
      const ans = await JV.Adapters.mock.judge({ era: '近代日本', previous_scene: { location: '和室', time: '朝' }, context_before: '', current: t }, qs);
      for (const [k, qq] of Object.entries(qs)) {
        const a = ans[k];
        if (!a) { bad.push(`${k} missing`); continue; }
        if (qq.type === 'choice') {
          if (!(a.choice in qq.criteria)) bad.push(`${k}=${a.choice}`);
          const sum = Object.values(a.probabilities).reduce((x, y) => x + y, 0);
          if (Math.abs(sum - 1) > 1e-6) bad.push(`${k} sum ${sum}`);
          if (Object.keys(a.probabilities).some((l) => !(l in qq.criteria))) bad.push(`${k} prob key`);
        } else if (qq.type === 'score') {
          if (!(a.score >= 0 && a.score <= qq.criteria.length - 1)) bad.push(`${k} score ${a.score}`);
        } else if (!(a.noul >= 0 && a.noul <= 1)) bad.push(`${k} noul ${a.noul}`);
      }
    }
  }
  const w = await JV.Judge.judgeWork(JV.Parser.parse('　汽車が停車場に着いた。私は外套の襟を立てた。', 'x.txt'));
  return { n: texts.length, bad, work: [w.era, w.narration] };
});
check(mock.bad.length === 0, `${mock.n} 単位 × 2（表示名/英字ID）でスキーマ外の値なし ${mock.bad.slice(0, 5)}`);
check(mock.work.join() === 'modern,first', `作品判定のモック (${mock.work})`);

const abortable = await page.evaluate(async () => {
  const c = new AbortController();
  const p = JV.Adapters.mock.judge('x', JV.Schema.toQuestions('scene'), { signal: c.signal });
  c.abort();
  try { await p; return false; } catch (e) { return JV.util.isAbort(e); }
});
check(abortable, 'モック判定も AbortController で中断できる');

console.log('発火ロジック（仕様7章のルール）');
const rules = await page.evaluate(() => {
  const D = JV.Director;
  D.reset();
  const ch = (k, label, p, rest = {}) => {
    const opts = JV.Schema.options('scene', k).map((o) => o.label);
    const probabilities = {};
    const others = opts.filter((o) => o !== label);
    for (const o of others) probabilities[o] = (1 - p) / others.length;
    probabilities[label] = p;
    return { type: 'choice', choice: label, probabilities, confidence: p, ...rest };
  };
  const ans = (o = {}) => ({
    scene_changed: { type: 'noul', noul: o.sc ?? 0.1 },
    location: ch('location', o.loc ?? '不明', o.locP ?? 0.8),
    time: ch('time', o.time ?? '不明', o.timeP ?? 0.8),
    weather: ch('weather', o.weather ?? '記述なし', o.weatherP ?? 0.8),
    people: ch('people', o.people ?? '1人', o.peopleP ?? 0.8),
    figure_main: ch('figure_main', o.main ?? '成人男性', 0.7),
    figure_sub: ch('figure_sub', o.sub ?? '不明', 0.7),
    pose: ch('pose', o.pose ?? '立っている', 0.7),
    mood: { type: 'score', score: o.mood ?? 0, confidence: 0.8 },
  });
  const r = [];
  let t = 0;
  const run = (o, chapter = 0) => { const p = D.decide(ans(o), { chapter, now: t }); return { loc: p.scene.location, time: p.scene.time, weather: p.scene.weather, bg: p.bg, chapter: p.chapter, fig: p.scene.figures.layout, why: p.why.join(',') }; };
  r.push(run({ loc: '和室', locP: 0.7, time: '朝' }));                  // 0 最初の場所
  t += 2000; r.push(run({ loc: '洋室', locP: 0.9 }));                    // 1 5秒以内は替えない
  t += 4000; r.push(run({ loc: '不明', locP: 0.9, sc: 0.9 }));           // 2 不明なら維持
  t += 1000; r.push(run({ loc: '洋室', locP: 0.45, sc: 0.2 }));          // 3 確信度不足
  t += 1000; r.push(run({ loc: '庭', locP: 0.3, sc: 0.8 }));             // 4 scene_changed で替える
  t += 6000; r.push(run({ loc: '洋室', locP: 0.55, sc: 0.1 }));          // 5 location 確信度0.5以上で替える
  t += 6000; r.push(run({ loc: '洋室', time: '夜', timeP: 0.55 }));      // 6 時間帯0.6未満は引き継ぐ
  t += 100; r.push(run({ loc: '洋室', time: '夜', timeP: 0.7, weather: '雨', weatherP: 0.65 })); // 7 反映
  t += 100; r.push(run({ loc: '洋室', weather: '記述なし', weatherP: 0.9 }));  // 8 記述なしでは天候を消さない
  t += 100; r.push(run({ loc: '洋室', people: '誰もいない', peopleP: 0.8 })); // 9 人物を消す
  t += 100; r.push(run({ loc: '海辺', locP: 0.9 }, 1));                  // 10 章替わりは5秒ルールを無視
  // 英字IDで返ってきても読める／スキーマ外の値は捨てる
  t += 6000;
  const a2 = ans({ loc: '和室' });
  a2.location = { type: 'choice', choice: 'forest', probabilities: { forest: 0.9 }, confidence: 0.9 };
  a2.time = { type: 'choice', choice: '真夜中', probabilities: { '真夜中': 0.99 }, confidence: 0.99 };
  const p2 = D.decide(a2, { chapter: 1, now: t });
  r.push({ loc: p2.scene.location, time: p2.scene.time });
  return r;
});
const R = rules;
check(R[0].bg && R[0].loc === 'washitsu' && R[0].time === 'morning', `最初の場所で背景を出す (${R[0].why})`);
check(!R[1].bg && R[1].loc === 'washitsu' && R[1].why.includes('5秒'), `一度替えた背景は5秒替えない (${R[1].why})`);
check(!R[2].bg && R[2].why.includes('不明'), `location 不明なら背景は前のまま (${R[2].why})`);
check(!R[3].bg && R[3].why.includes('確信度不足'), `confidence 0.5 未満なら替えない (${R[3].why})`);
check(R[4].bg && R[4].loc === 'garden', `scene_changed ≥ 0.6 で替える (${R[4].why})`);
check(R[5].bg && R[5].loc === 'yoshitsu', `location が違い confidence ≥ 0.5 で替える (${R[5].why})`);
check(R[6].time === 'morning', `time は確率0.6未満なら引き継ぐ (${R[6].time})`);
check(R[7].time === 'night' && R[7].weather === 'rain', `0.6以上なら反映 (${R[7].time}, ${R[7].weather})`);
check(R[8].weather === 'rain', `「記述なし」では天候を消さない (${R[8].weather})`);
check(R[9].fig === 'none', `people が誰もいないなら人物を消す (${R[9].fig})`);
check(R[10].bg && R[10].chapter && R[10].loc === 'seaside', `章替わりは暗転し、5秒ルールより優先 (${R[10].why})`);
check(R[11].loc === 'forest' && R[11].time === 'night', `英字IDの答えも読め、スキーマ外の値は無視 (${R[11].loc}, ${R[11].time})`);

console.log('合成と演出（サンプルで通しで確認）');
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(2200);
const seen = [];
const layerState = () => page.evaluate(() => {
  const st = document.getElementById('stage');
  const front = [...st.querySelectorAll('.bg')].find((b) => b.style.opacity === '1');
  return {
    loc: front && front.dataset.loc, label: front && front.querySelector('.bg-label').textContent,
    night: st.querySelector('.tint-night').style.opacity, figs: st.querySelector('.figures').style.opacity,
    figShown: [...st.querySelectorAll('.fig')].filter((f) => f.style.display !== 'none').map((f) => f.className.split(' ').slice(1).join(' ')),
    vignette: st.querySelector('.vignette').style.opacity, weather: JV.Weather.targetType,
    blackout: st.querySelector('.blackout').style.opacity,
  };
});
const first = await layerState();
check(first.loc === 'washitsu' && first.label === '和室', `冒頭は和室の仮背景 (${first.loc} / ${first.label})`);
check(first.figs === '1' && first.figShown.length >= 1, `人物シルエットが出る (${first.figShown})`);

// 章「二」の冒頭へ：暗転してから新しい場面
await page.evaluate(() => {
  window.__blackouts = 0;
  const bo = document.querySelector('#stage .blackout');
  new MutationObserver(() => { if (bo.style.opacity === '1') window.__blackouts++; }).observe(bo, { attributes: true, attributeFilter: ['style'] });
  const el = document.querySelector('.seg[data-u="9"]');
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 10);
});
await page.waitForTimeout(2600);
const ch2 = await layerState();
check(await page.evaluate(() => window.__blackouts) === 1, '章が変わると一度黒に落とす');
check(ch2.loc === 'river' && ch2.blackout === '0', `章「二」は川・水辺 (${ch2.loc})`);

// 章「三」：夜更けの停車場、雪
const scrollToUnit = (u) => page.evaluate((u) => {
  const el = document.querySelector(`.seg[data-u="${u}"]`);
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 10);
}, u);
await scrollToUnit(13);
await page.waitForTimeout(2600);
const ch3 = await layerState();
check(ch3.loc === 'station' && Number(ch3.night) > 0.5, `章「三」は夜の駅・車内 (${ch3.loc}, 夜=${ch3.night})`);
check(ch3.weather === 'snow', `雪のパーティクル (${ch3.weather})`);
check(Number(ch3.vignette) > 0.3, `緊張感で周辺減光 (${ch3.vignette})`);
// 次の段落：大勢の人々 → 群衆。時間帯は引き継ぐ
await scrollToUnit(14);
await page.waitForTimeout(1500);
const ch3b = await layerState();
check(ch3b.figShown.includes('crowd pos-crowd'), `3人以上は群衆シルエット (${ch3b.figShown})`);
check(Number(ch3b.night) > 0.5 && ch3b.loc === 'station', '背景と時間帯は前の値を引き継ぐ');

// フェード時間の倍率
const fadeMs = await page.evaluate(async () => {
  JV.Settings.set('fadeScale', 2);
  JV.Director.reset();
  const plan = JV.Director.decide({ location: { type: 'choice', choice: '海辺', probabilities: { '海辺': 0.9 }, confidence: 0.9 } }, { chapter: 2 });
  JV.Stage.show(plan);
  await new Promise((r) => setTimeout(r, 30));
  const front = [...document.querySelectorAll('#stage .bg')].find((b) => b.dataset.loc === 'seaside');
  JV.Settings.set('fadeScale', 1);
  return front.style.transition;
});
check(fadeMs.includes('1600ms'), `場所替えのクロスフェード 800ms × 倍率 (${fadeMs})`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
