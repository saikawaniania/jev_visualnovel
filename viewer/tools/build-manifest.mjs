// assets/bg と assets/sil の中身から assets/manifest.json を作り直す。
// 実行：node viewer/tools/build-manifest.mjs
//
// ファイル名の規則（これ以外の名前は警告して manifest に入れない）：
//   bg/bg_{era}_{location}_{time}.(webp|png|jpg)   例 bg_modern_washitsu_day.webp
//   sil/sil_{figure}_{pose}.(png|jpg|webp)         例 sil_woman_sit.png
//   sil/crowd_*.(png|jpg|webp)                     群衆シルエット（3人以上用）
//   シルエットは透過 PNG でも、白地に黒の JPG でもよい（白地はビューアが読み込み時に透明にする）
// fallbackEra・silFacing は既存の manifest.json の値を引き継ぐ。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
const ERAS = ['modern', 'present', 'western', 'fantasy'];
const LOCATIONS = ['washitsu', 'yoshitsu', 'kitchen', 'genkan', 'classroom', 'shop', 'station', 'street', 'alley', 'garden', 'field', 'forest', 'river', 'seaside', 'nightsky'];
const TIMES = ['morning', 'day', 'evening', 'night'];
const FIGURES = ['man', 'woman', 'boy', 'girl', 'old', 'unknown'];
const POSES = ['stand', 'sit', 'walk', 'lie', 'talk'];

const list = async (dir) => { try { return (await readdir(join(ASSETS, dir))).sort(); } catch { return []; } };
let prev = {};
try { prev = JSON.parse(await readFile(join(ASSETS, 'manifest.json'), 'utf8')); } catch { /* 新規 */ }

const warn = [];
const bg = [];
for (const f of await list('bg')) {
  if (f.startsWith('.') || /\.md$/i.test(f)) continue;
  const m = f.match(/^bg_([a-z0-9]+)_([a-z0-9]+)_([a-z0-9]+)\.(webp|png|jpe?g|avif)$/i);
  if (m && ERAS.includes(m[1]) && LOCATIONS.includes(m[2]) && TIMES.includes(m[3])) bg.push(`bg/${f}`);
  else warn.push(`bg/${f}`);
}
const sil = [];
const crowd = [];
for (const f of await list('sil')) {
  if (f.startsWith('.') || /\.md$/i.test(f)) continue;
  if (/^crowd_.*\.(png|jpe?g|webp)$/i.test(f)) { crowd.push(`sil/${f}`); continue; }
  const m = f.match(/^sil_([a-z0-9]+)_([a-z0-9]+)\.(png|jpe?g|webp)$/i);
  if (m && FIGURES.includes(m[1]) && POSES.includes(m[2])) sil.push(`sil/${f}`);
  else warn.push(`sil/${f}`);
}

const manifest = {
  version: 1,
  fallbackEra: prev.fallbackEra ?? 'modern',
  silFacing: prev.silFacing ?? 'left',
  bg, sil, crowd,
};
await writeFile(join(ASSETS, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 足りない素材（MVP：1時代 × 16場所の昼、30シルエット、群衆2枚）
const era = manifest.fallbackEra;
const missingBg = LOCATIONS.filter((l) => !bg.includes(`bg/bg_${era}_${l}_day.webp`) && !bg.some((b) => b.startsWith(`bg/bg_${era}_${l}_day.`)));
const missingSil = FIGURES.flatMap((f) => POSES.map((p) => `${f}_${p}`)).filter((k) => !sil.some((s) => s.startsWith(`sil/sil_${k}.`)));
console.log(`manifest.json: 背景 ${bg.length}・シルエット ${sil.length}・群衆 ${crowd.length}`);
console.log(`未作成：${era} の昼の背景 ${missingBg.length}/${LOCATIONS.length}、シルエット ${missingSil.length}/30、群衆 ${Math.max(0, 2 - crowd.length)}/2`);
if (warn.length) console.log(`名前の規則に合わないため除外：\n  ${warn.join('\n  ')}`);
