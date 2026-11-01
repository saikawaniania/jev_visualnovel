// 舞台（canvas）：質問定義・モック判定・発火ロジック・手描きの描画と演出
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
check(q.keys.join() === 'scene_changed,location,time,weather,people,figure_main,figure_sub,pose,mood,inner,emotion', `場面判定の質問キー ${q.keys}`);
check(q.locN === 16 && q.mood === 3, `location 16択・mood 3段階 (${q.locN}, ${q.mood})`);
check(q.types.scene_changed === 'noul' && q.types.mood === 'score' && q.types.location === 'choice', '型は Noul / Score / Choice');
check(q.types.inner === 'noul' && q.types.emotion === 'choice', '心象：inner は Noul・emotion は Choice');
check(q.sub.join() === '成人男性,成人女性,少年,少女,老人（男）,老人（女）,不明', 'figure_sub は figure_main と同じ選択肢');
check(q.work.join() === 'era,narration,protagonist', `作品判定の質問 (${q.work})`);
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
    inner: { type: 'noul', noul: o.inner ?? 0.1 },
    emotion: ch('emotion', o.emo ?? '不明', o.emoP ?? 0.8),
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
  // 心象：心の中だけの段落なら気持ちの背景、外の描写に戻れば消す（場所はそのまま）
  const inn = (o) => { t += 6000; const p = D.decide(ans({ loc: '和室', ...o }), { chapter: 1, now: t }); return { inner: p.scene.inner, flag: p.inner, loc: p.scene.location, why: p.why.join(',') }; };
  r.push(inn({ inner: 0.85, emo: '不安' }));                 // 12 心象に入る
  r.push(inn({ inner: 0.85, emo: '喜び' }));                 // 13 気持ちが変わる
  r.push(inn({ inner: 0.85, emo: '喜び' }));                 // 14 同じなら変化なし
  r.push(inn({ inner: 0.85, emo: '不明' }));                 // 15 気持ちが不明なら出さない
  r.push(inn({ inner: 0.3, emo: '悲しみ' }));                // 16 心の中だけでなければ出さない
  r.push(inn({ inner: 0.9, emo: '悲しみ', emoP: 0.3 }));     // 17 気持ちの確信度が低ければ出さない
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

check(R[12].inner === 'anxiety' && R[12].flag && R[12].loc === 'washitsu' && R[12].why.includes('心象 → 不安'), `心の中だけの段落で心象の背景を出す (${R[12].why})`);
check(R[13].inner === 'joy' && R[13].flag, `気持ちが変われば心象も替える (${R[13].inner})`);
check(R[14].inner === 'joy' && !R[14].flag, `同じ気持ちなら替えない (${R[14].flag})`);
check(R[15].inner === null && R[15].flag && R[15].why.includes('心象おわり'), `気持ちが不明なら心象を消す (${R[15].why})`);
check(R[16].inner === null && !R[16].flag, `inner がしきい値未満なら出さない (${R[16].inner})`);
check(R[17].inner === null, `emotion の確信度が低ければ出さない (${R[17].inner})`);

console.log('心象の背景');
const emo = await page.evaluate(() => {
  const S = JV.Stage;
  S.setInner('sadness', 0);
  S.setTone({ time: 'day', weather: 'rain', location: 'street', inner: 'sadness' }, 0);
  S.setMood(1, 0);
  const a = S.state();
  S.setInner(null, 0);
  S.setTone({ time: 'day', weather: 'rain', location: 'street', inner: null }, 0);
  S.setMood(0.5, 0);
  const b = S.state();
  S.reset();
  return { a, b };
});
check(emo.a.emo.sadness === 1 && emo.a.emo.joy === 0 && emo.a.inner === 'sadness', `悲しみの絵だけを出す (${JSON.stringify(emo.a.emo)})`);
check(emo.a.rain === 0 && emo.a.mood === 0, `心象の間は雨を止め、緊張感で色を抜かない (rain ${emo.a.rain}, mood ${emo.a.mood})`);
check(Object.values(emo.b.emo).every((v) => v === 0) && emo.b.rain === 1 && emo.b.mood === 0.5, `心象が終われば元に戻る (rain ${emo.b.rain})`);

console.log('気持ち → 表情');
const face = await page.evaluate(async () => {
  const D = JV.Director; D.reset();
  const ch = (k, label, p = 0.9) => ({ type: 'choice', choice: label, probabilities: { [label]: p }, confidence: p });
  const p1 = D.decide({ location: ch('location', '和室'), people: ch('people', '1人'), figure_main: ch('figure_main', '少女'), emotion: ch('emotion', '喜び') }, { chapter: 0 });
  await JV.Stage.show(p1);
  const a = JV.Stage.state();
  const p2 = D.decide({ emotion: ch('emotion', '怒り', 0.2), mood: { type: 'score', score: 2, confidence: 0.9 } }, { chapter: 0 });
  await JV.Stage.show(p2);
  const b = JV.Stage.state();
  return { e1: p1.scene.emotion, x1: a.expr, f1: a.figs, e2: p2.scene.emotion, x2: b.expr };
});
check(face.e1 === 'joy' && face.x1 === 'joy' && face.f1.startsWith('one|girl'), `喜びなら笑顔の少女 (${face.x1}, ${face.f1})`);
check(face.e2 === null && face.x2 === 'anxiety', `気持ちの確信度が低く緊迫した場面なら不安の顔 (${face.x2})`);

console.log('手描きの部品（全部の組み合わせを描いてみる）');
const all = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 480; c.height = 300;
  const tg = Tegaki.create(c, { style: 'paper' }), L = Draw.layout(tg), bad = [];
  let n = 0;
  for (const era of ['modern', 'present', 'western', 'fantasy']) {
    for (const loc of JV.Schema.options('scene', 'location').map((o) => o.id)) for (const time of ['morning', 'day', 'evening', 'night']) {
      try { tg.renderAt(1.2, (t) => Draw.background(tg, L, { location: loc, time, era }, t)); n++; } catch (e) { bad.push(`${era}/${loc}/${time}: ${e.message}`); }
    }
    for (const type of JV.Schema.options('scene', 'figure_main').map((o) => o.id)) for (const pose of JV.Schema.options('scene', 'pose').map((o) => o.id)) for (const expr of ['normal', ...Draw.EMOTIONS]) {
      try { tg.renderAt(2.3, (t) => Draw.person(tg, L, { type, era, pose, expr, x: 240, y: 280, h: 200, facing: -1 }, t)); n++; } catch (e) { bad.push(`${era}/${type}/${pose}/${expr}: ${e.message}`); }
    }
  }
  for (const id of Draw.EMOTIONS) { try { tg.renderAt(0.5, (t) => Draw.emotion(tg, L, id, t, 1)); n++; } catch (e) { bad.push(`emo ${id}: ${e.message}`); } }
  return { n, bad, missing: JV.Schema.options('scene', 'location').map((o) => o.id).filter((id) => !Draw.LOCATIONS.includes(id)) };
});
check(all.bad.length === 0 && all.n > 1000, `${all.n} 通りを描いてエラーなし ${all.bad.slice(0, 3)}`);
check(all.missing.length === 0, `スキーマの場所はすべて描き方がある (${all.missing})`);

console.log('合成と演出（サンプルで通しで確認）');
await page.click('#sample-list li:first-child button');
await page.waitForTimeout(2200);
const S = () => page.evaluate(() => JV.Stage.state());
const first = await S();
check((first.world || '').startsWith('modern|washitsu'), `冒頭は近代日本の和室 (${first.world})`);
check((first.figs || '').length > 0, `人物を描く (${first.figs})`);
const px = await page.evaluate(() => {
  const c = document.querySelector('#stage canvas'), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; sum2 += v * v; n++; }
  return { w: c.width, h: c.height, sd: Math.sqrt(sum2 / n - (sum / n) ** 2) };
});
check(px.w > 0 && px.sd > 20, `canvas に絵が描かれている (${px.w}×${px.h}, ばらつき ${Math.round(px.sd)})`);
const f0 = (await S()).frames; await page.waitForTimeout(1000); const f1 = (await S()).frames;
check(f1 - f0 >= 8 && f1 - f0 <= 40, `手描きの線は止まっていても描き直す（1秒に ${f1 - f0} コマ）`);

// 章「二」の冒頭へ：暗転してから新しい場面
await page.evaluate(() => {
  window.__maxBlack = 0;
  const iv = setInterval(() => { window.__maxBlack = Math.max(window.__maxBlack, JV.Stage.state().black); }, 30);
  setTimeout(() => clearInterval(iv), 2500);
  const el = [...document.querySelectorAll('.seg')].find((e) => e.textContent.includes('日が暮れてから'));
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 10);
});
await page.waitForTimeout(2600);
const ch2 = await S();
check(await page.evaluate(() => window.__maxBlack) > 0.9, '章が変わると一度黒に落とす');
check((ch2.world || '').includes('|river|') && ch2.black === 0, `章「二」は川・水辺 (${ch2.world})`);

const scrollToText = (t) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('.seg')].find((e) => e.textContent.includes(t));
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2 + 10);
}, t);
await scrollToText('夜更けの停車場');
await page.waitForTimeout(2600);
const ch3 = await S();
check(ch3.world === 'modern|station|night', `章「三」は夜の駅・車内 (${ch3.world})`);
check(ch3.snow === 1, `雪が降る (${ch3.snow})`);
const crowd = await page.evaluate(async () => {
  const ch = (label) => ({ type: 'choice', choice: label, probabilities: { [label]: 0.9 }, confidence: 0.9 });
  const plan = JV.Director.decide({ people: ch('3人以上'), figure_main: ch('成人男性') }, { chapter: 2 });
  await JV.Stage.show(plan);
  await new Promise((r) => setTimeout(r, 600));
  return JV.Stage.state().figs;
});
check(crowd.startsWith('many|man'), `3人以上は群衆＋主人物 (${crowd})`);

const fade = await page.evaluate(async () => {
  JV.Settings.set('fadeScale', 2);
  JV.Director.reset();
  const plan = JV.Director.decide({ location: { type: 'choice', choice: '海辺', probabilities: { '海辺': 0.9 }, confidence: 0.9 } }, { chapter: 2 });
  JV.Stage.show(plan);
  await new Promise((r) => setTimeout(r, 30));
  JV.Settings.set('fadeScale', 1);
  return { ms: JV.Stage.world.ms, from: JV.Stage.state().worldFrom, to: JV.Stage.state().world };
});
check(fade.ms === 1600 && fade.from && fade.to.includes('seaside'), `場所替えのクロスフェード 800ms × 倍率 (${fade.ms}ms, ${fade.from} → ${fade.to})`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
