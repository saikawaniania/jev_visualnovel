// ステップ1：起動画面、.txt/.md 読込、青空文庫記法の除去と段落分割
import { openApp, check, done } from './harness.mjs';
import { join } from 'node:path';

const app = await openApp();
const { page } = app;

console.log('起動画面');
check(await page.isVisible('#drop-zone'), 'ファイル投入エリアが表示される');
check(await page.getAttribute('#file-input', 'onchange') !== null, 'ファイル入力は onchange 属性で書かれている');

console.log('文字コード判定');
const enc = await page.evaluate(() => {
  const sjisBytes = new Uint8Array([0x8F, 0xAC, 0x90, 0xE0]); // 「小説」(Shift_JIS)
  const utf8 = new TextEncoder().encode('小説');
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8]);
  return [JV.Encoding.decode(sjisBytes.buffer), JV.Encoding.decode(utf8.buffer), JV.Encoding.decode(bom.buffer)];
});
check(enc[0] === '小説', `Shift_JIS を判定できる (${enc[0]})`);
check(enc[1] === '小説', 'UTF-8 を判定できる');
check(enc[2] === '小説', 'BOM 付き UTF-8 を判定できる');

console.log('青空文庫（Shift_JIS サンプルをファイル選択で読込）');
await page.setInputFiles('#file-input', join(app.ROOT, 'samples/ame_no_teishaba.txt'));
await page.waitForSelector('#reader:not(.hidden)');
const az = await page.evaluate(() => {
  const d = JV.App.doc;
  const all = d.paragraphs.map((p) => p.text).join('\n');
  return {
    format: d.format, title: d.title, author: d.author,
    chapters: d.chapters.map((c) => c.title),
    nParas: d.paragraphs.length,
    first: d.paragraphs[0].text,
    hasRuby: /《|》|｜/.test(all), hasNote: /［＃/.test(all),
    hasLegend: /テキスト中に現れる記号/.test(all), hasTeihon: /底本/.test(all),
    breaks: d.paragraphs.filter((p) => p.breakBefore).map((p) => p.i),
    longSegs: d.paragraphs.filter((p) => p.segs.length > 1).map((p) => p.segs.map((s) => d.segments[s].text.length)),
    units: d.units.map((u) => ({ segs: u.segs.length, text: u.text.slice(0, 20) })),
    domParas: document.querySelectorAll('#text p.para').length,
    title2: document.getElementById('work-title').textContent,
  };
});
check(az.format === 'aozora', `形式判定 = aozora (${az.format})`);
check(az.title === '雨の停車場' && az.author === '試作太郎', `作品名・著者名 (${az.title} / ${az.author})`);
check(JSON.stringify(az.chapters) === JSON.stringify(['一', '二', '三']), `見出し注記を章として拾う ${JSON.stringify(az.chapters)}`);
check(az.first.startsWith('　朝の座敷には、障子越しに') && az.first.includes('古箪笥の抽斗を'), `ルビを外して親文字だけ残す: ${az.first.slice(0, 30)}`);
check(!az.hasRuby && !az.hasNote, 'ルビ記号・注記が残っていない');
check(!az.hasLegend && !az.hasTeihon, '凡例と底本以降が除去されている');
check(az.breaks.length === 1, `◇ を場面区切りとして扱う (breakBefore: ${az.breaks})`);
check(az.longSegs.length === 1 && az.longSegs[0].every((n) => n <= 400), `長い段落を句点で分割 ${JSON.stringify(az.longSegs)}`);
check(az.domParas === az.nParas, `表示は原文の段落どおり (${az.domParas} 段落)`);
check(az.units.length < az.nParas, `会話を束ねて判定単位が段落より少ない (${az.units.length} < ${az.nParas})`);
const dialogueOnly = await page.evaluate(() => JV.App.doc.units.filter((u) => u.segs.every((s) => JV.App.doc.segments[s].dialogue)).length);
check(dialogueOnly === 0, `会話だけの判定単位がない (${dialogueOnly})`);
console.log('    units:', az.units.map((u) => `${u.segs}:${u.text}`).join(' | '));

console.log('Markdown');
await page.evaluate(() => JV.App.showHome());
await page.setInputFiles('#file-input', join(app.ROOT, 'samples/umibe_no_kissaten.md'));
await page.waitForSelector('#reader:not(.hidden)');
const md = await page.evaluate(() => {
  const d = JV.App.doc;
  const all = d.paragraphs.map((p) => p.text).join('\n');
  return { format: d.format, title: d.title, author: d.author, chapters: d.chapters.map((c) => c.title),
    breaks: d.paragraphs.filter((p) => p.breakBefore).length, hasMarkup: /\*\*|\]\(|^#/m.test(all),
    link: d.paragraphs.find((p) => p.text.includes('橙色')).text };
});
check(md.format === 'md', '形式判定 = md');
check(md.title === '海辺の喫茶店' && md.author === '試作花子', `front matter の作品名・著者名 (${md.title} / ${md.author})`);
check(JSON.stringify(md.chapters) === JSON.stringify(['第一話　潮風', '第二話　嵐の夜']), `# 見出しを章に ${JSON.stringify(md.chapters)}`);
check(md.breaks === 1, `--- を場面区切りに (${md.breaks})`);
check(!md.hasMarkup && md.link.includes('夕日が海を橙色に染めて'), '強調・リンク記法を除去');

console.log('プレーンテキスト');
await page.evaluate(() => JV.App.showHome());
await page.setInputFiles('#file-input', join(app.ROOT, 'samples/mori_no_michi.txt'));
await page.waitForSelector('#reader:not(.hidden)');
const tx = await page.evaluate(() => {
  const d = JV.App.doc;
  return { format: d.format, title: d.title, author: d.author, chapters: d.chapters.map((c) => c.title),
    breaks: d.paragraphs.filter((p) => p.breakBefore).length, n: d.paragraphs.length };
});
check(tx.format === 'txt', '形式判定 = txt');
check(tx.title === '森の道' && tx.author === '試作次郎', `冒頭行から作品名・著者名 (${tx.title} / ${tx.author})`);
check(JSON.stringify(tx.chapters) === JSON.stringify(['第一章　霧の朝', '第二章　夜の森']), `章見出し ${JSON.stringify(tx.chapters)}`);
check(tx.breaks === 1, `＊　＊　＊ を場面区切りに (${tx.breaks})`);

console.log('空行区切りのテキスト（block モード）');
const blk = await page.evaluate(() => {
  const t = 'これは一行目の\n続きです。\n\n次の段落。\n\n\n\n場面が変わった。\n\nまた次。\n';
  const d = JV.Parser.parse(t, 'x.txt');
  return d.paragraphs.map((p) => [p.text, p.breakBefore]);
});
check(blk.length === 4 && blk[0][0] === 'これは一行目の続きです。' && blk[2][1] === true, `空行区切りの段落と空行の連続 ${JSON.stringify(blk)}`);

console.log('サンプル一覧から読込（fetch）');
await page.evaluate(() => JV.App.showHome());
await page.click('#sample-list li:first-child button');
await page.waitForSelector('#reader:not(.hidden)');
check((await page.textContent('#work-title')).includes('雨の停車場'), 'サンプルボタンで開ける');

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
