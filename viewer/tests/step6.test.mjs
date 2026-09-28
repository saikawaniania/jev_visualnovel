// ステップ6：実素材への差し替え（assets/manifest.json 経由）
// 実素材の代わりに、色で見分けられる小さな画像をブラウザ内で配信して確かめる。
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 1000, height: 800 } });
const { page } = app;

const svg = (fill, w = 160, h = 90) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fill}"/></svg>`;
const served = {
  'bg/bg_modern_washitsu_day.webp': svg('#a08060'),
  'bg/bg_modern_river_day.webp': svg('#6080a0'),
  'bg/bg_modern_river_night.webp': svg('#102040'),
  'sil/sil_woman_stand.png': svg('#000', 40, 100),
  'sil/sil_man_talk.png': svg('#000', 40, 100),
  'sil/crowd_1.png': svg('#000', 200, 100),
  // 'bg/bg_modern_station_day.webp' と 'sil/sil_man_stand.png' は manifest にあるがファイルがない
};
let manifest = {
  version: 1, fallbackEra: 'modern', silFacing: 'left',
  bg: ['bg/bg_modern_washitsu_day.webp', 'bg/bg_modern_river_day.webp', 'bg/bg_modern_river_night.webp', 'bg/bg_modern_station_day.webp', 'bg/bg_modern_kitchen.webp'],
  sil: ['sil/sil_woman_stand.png', 'sil/sil_man_talk.png', 'sil/sil_man_stand.png', 'sil/sil_cat_stand.png'],
  crowd: ['sil/crowd_1.png'],
};
await page.route('**/assets/**', (route) => {
  const path = new URL(route.request().url()).pathname.replace(/^.*\/assets\//, '');
  if (path === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
  if (served[path]) return route.fulfill({ contentType: 'image/svg+xml', body: served[path] });
  return route.fulfill({ status: 404, body: 'not found' });
});
await page.goto(app.url + '?debug=1');
await page.waitForTimeout(300);

console.log('manifest.json の読込');
const m = await page.evaluate(() => ({ bg: Object.keys(JV.Assets.manifest.bg), sil: Object.keys(JV.Assets.manifest.sil), crowd: JV.Assets.manifest.crowd.length, skipped: JV.Assets.manifestSkipped, dbg: JV.Debug.lines.assets }));
check(m.bg.join() === 'modern_washitsu_day,modern_river_day,modern_river_night,modern_station_day', `背景をファイル名の規則で登録 (${m.bg})`);
check(m.sil.join() === 'woman_stand,man_talk,man_stand' && m.crowd === 1, `シルエット・群衆 (${m.sil})`);
check(m.skipped.join() === 'bg/bg_modern_kitchen.webp,sil/sil_cat_stand.png', `規則外の名前は除外 (${m.skipped})`);
check(/背景 4・シルエット 3・群衆 1（名前の規則外 2）/.test(m.dbg), `デバッグ表示に素材数 (${m.dbg})`);

await page.click('#sample-list li:first-child button');
await page.waitForTimeout(400);

// 判定結果を直接与えて演出させるヘルパー
const showScene = (o) => page.evaluate(async (o) => {
  const ch = (k, label) => ({ type: 'choice', choice: label, probabilities: { [label]: 0.9 }, confidence: 0.9 });
  const ans = {
    scene_changed: { type: 'noul', noul: 0.9 },
    location: ch('location', o.loc), time: ch('time', o.time), weather: ch('weather', '記述なし'),
    people: ch('people', o.people || '1人'), figure_main: ch('figure_main', o.main || '成人女性'),
    figure_sub: ch('figure_sub', o.sub || '不明'), pose: ch('pose', o.pose || '立っている'),
    mood: { type: 'score', score: 0, confidence: 0.9 },
  };
  JV.StopDetector.detach();
  const plan = JV.Director.decide(ans, { chapter: 0, now: performance.now() + (window.__t = (window.__t || 0) + 10000) });
  await JV.Stage.show(plan);
  await new Promise((r) => setTimeout(r, 900));
  const st = document.getElementById('stage');
  const front = [...st.querySelectorAll('.bg')].find((b) => b.style.zIndex === '2');
  return {
    key: front.dataset.key, bgImage: front.style.backgroundImage, label: front.querySelector('.bg-label').textContent,
    night: Number(st.querySelector('.tint-night').style.opacity), morning: Number(st.querySelector('.tint-morning').style.opacity),
    figs: [...st.querySelectorAll('.fig')].filter((f) => f.style.display !== 'none').map((f) => ({ cls: f.className, src: f.querySelector('img').src.slice(0, 60), tf: getComputedStyle(f.querySelector('img')).transform })),
    faceRight: st.querySelector('.figures').classList.contains('face-right'),
  };
}, o);

console.log('背景の差し替え');
let r = await showScene({ loc: '和室', time: '朝' });
check(r.key === 'modern_washitsu_day' && /bg_modern_washitsu_day\.webp/.test(r.bgImage) && r.label === '', `和室の実素材 (${r.key})`);
check(r.morning === 1, `朝の絵がないので昼の絵＋色調レイヤー (朝 ${r.morning})`);
const sil = r.figs.find((f) => f.cls.includes('main'));
check(sil && /sil_woman_stand\.png/.test(sil.src), `シルエットの実素材 (${sil && sil.src})`);

r = await showScene({ loc: '川・水辺', time: '夜' });
check(r.key === 'modern_river_night' && /bg_modern_river_night/.test(r.bgImage), `時間帯専用の絵を優先 (${r.key})`);
check(r.night > 0 && r.night < 0.5, `時間帯専用の絵では色調を弱める (夜 ${r.night})`);

r = await showScene({ loc: '川・水辺', time: '昼' });
check(r.key === 'modern_river_day', `時間帯だけ変わっても、絵があれば背景を替える (${r.key})`);

r = await showScene({ loc: '駅・車内', time: '昼' });
check(r.key === 'ph_station' && r.label === '駅・車内', `ファイルが読めなければ仮素材 (${r.key})`);

r = await showScene({ loc: '森・山道', time: '昼', people: '2人', main: '成人男性', sub: '成人女性', pose: '向き合って話す' });
check(r.key === 'ph_forest', `manifest にない場所は仮素材 (${r.key})`);
const main2 = r.figs.find((f) => f.cls.includes('main')), sub2 = r.figs.find((f) => f.cls.includes('sub'));
check(/sil_man_talk\.png/.test(main2.src) && main2.cls.includes('pos-right'), '主人物（実素材）は右');
check(sub2.src.startsWith('data:image/svg') && sub2.cls.includes('pos-left') && sub2.tf.startsWith('matrix(-1'), '相手は左で反転して向かい合う（素材がなければ仮素材）');

r = await showScene({ loc: '森・山道', time: '昼', people: '1人', main: '成人男性', pose: '立っている' });
const broken = r.figs.find((f) => f.cls.includes('main'));
check(broken.src.startsWith('data:image/svg'), `読めないシルエットは仮素材に戻る (${broken.src.slice(0, 30)})`);

r = await showScene({ loc: '森・山道', time: '昼', people: '3人以上', main: '成人女性', pose: '立っている' });
check(r.figs.some((f) => f.cls.includes('crowd') && /crowd_1\.png/.test(f.src)), '群衆の実素材');

console.log('時代の代用（fallbackEra）と向き');
const other = await page.evaluate(() => JV.Assets.background('present', 'washitsu', 'day').key);
check(other === 'modern_washitsu_day', `現代日本の絵がなければ fallbackEra の絵 (${other})`);
manifest = { ...manifest, silFacing: 'right' };
await page.evaluate(() => JV.Assets.loadManifest());
r = await showScene({ loc: '森・山道', time: '昼', people: '2人', main: '成人女性', sub: '成人男性', pose: '立っている' });
const m3 = r.figs.find((f) => f.cls.includes('main')), s3 = r.figs.find((f) => f.cls.includes('sub'));
check(r.faceRight && m3.tf.startsWith('matrix(-1') && s3.tf === 'none', 'silFacing: right なら反転を逆にする');

check(app.errors.filter((e) => !/404|Failed to load resource/.test(e)).length === 0, `想定外のコンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
