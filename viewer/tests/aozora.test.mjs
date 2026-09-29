// 青空文庫のURLから読む／zip を直接読む
// 本物の www.aozora.gr.jp の代わりに偽のサーバーを立て、Netlify の関数（/aozora）と local_server.py の両方で確かめる。
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { openApp, check, done } from './harness.mjs';

const VIEWER = fileURLToPath(new URL('..', import.meta.url));
const sjisText = await readFile(join(VIEWER, 'samples/ame_no_teishaba.txt'));

// 最小の zip を作る（method 8 = deflate、0 = 無圧縮）
function makeZip(files, method = 8) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const rubyZip = makeZip([['ame_no_teishaba.txt', sjisText]]);
const plainZip = makeZip([['readme.html', Buffer.from('<p>x</p>')], ['ame.txt', sjisText]], 0);
const card = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>図書カード：雨の停車場</title></head><body>
<table class="download"><tr><td><a href="./files/92_ruby_164.zip">92_ruby_164.zip</a></td></tr>
<tr><td><a href="./files/92_14545.html">92_14545.html</a></td></tr></table></body></html>`;
const noTextCard = '<html><body>テキストファイルは準備中です</body></html>';

const hits = [];
const aozora = createServer((req, res) => {
  hits.push(req.url);
  const send = (type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
  if (req.url === '/cards/000879/card92.html') return send('text/html; charset=UTF-8', card);
  if (req.url === '/cards/000879/card93.html') return send('text/html', noTextCard);
  if (req.url === '/cards/000879/files/92_ruby_164.zip') return send('application/zip', rubyZip);
  if (req.url === '/cards/000879/files/92_plain.zip') return send('application/zip', plainZip);
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => aozora.listen(0, '127.0.0.1', r));
process.env.AOZORA_BASE_URL = `http://127.0.0.1:${aozora.address().port}`;

console.log('Netlify の関数 /aozora');
const fn = await import('../../netlify/functions/aozora.mjs');
const get = (path) => fn.default(new Request(`https://site.example/aozora?path=${encodeURIComponent(path)}`));
check(fn.config.path === '/aozora', 'パスは /aozora');
let r = await get('cards/000879/card92.html');
check(r.status === 200 && (await r.text()).includes('92_ruby_164.zip'), '図書カードを取ってくる');
r = await get('cards/000879/files/92_ruby_164.zip');
check(r.status === 200 && r.headers.get('content-type') === 'application/zip' && r.headers.get('cache-control').includes('max-age'), 'zip を取ってくる（CDN にキャッシュ）');
for (const bad of ['index.html', '../etc/passwd', 'cards/000879/../../x', 'cards/000879/files/a.txt', 'https://evil.example/x.zip']) {
  r = await get(bad);
  check(r.status === 400, `青空文庫の図書カードと zip 以外は取らない (${bad})`);
}
r = await get('cards/000879/card99.html');
check(r.status === 404, 'ないファイルは 404');

console.log('URLの解釈');
const app = await openApp({ viewport: { width: 400, height: 820 } });
const { page } = app;
const parsed = await page.evaluate(() => [
  'https://www.aozora.gr.jp/cards/000879/card92.html',
  'http://aozora.gr.jp/cards/000879/card92.html#download',
  'https://www.aozora.gr.jp/cards/000879/files/92_14545.html',
  'www.aozora.gr.jp/cards/000879/files/92_ruby_164.zip',
  'https://example.com/cards/000879/card92.html',
  'https://www.aozora.gr.jp/index.html',
].map((u) => JV.Aozora.parse(u)));
check(parsed[0].card === 'cards/000879/card92.html' && parsed[1].card === 'cards/000879/card92.html', '図書カードのURL');
check(parsed[2].card === 'cards/000879/card92.html', 'XHTML 本文のURLは図書カードに読み替える');
check(parsed[3].zip === 'cards/000879/files/92_ruby_164.zip', 'zip のURL');
check(parsed[4] === null && parsed[5] === null, '青空文庫の作品以外のURLは受け付けない');

console.log('ビューアから URL で読む');
const relayed = [];
await page.route(/\/aozora\?/, async (route) => {
  relayed.push(new URL(route.request().url()).searchParams.get('path'));
  const res = await fn.default(new Request(route.request().url()));
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
const openUrl = async (url) => {
  await page.evaluate(() => JV.App.showHome());
  await page.fill('#url-input', url);
  await page.click('#url-submit');
  await page.waitForFunction(() => !document.getElementById('url-submit').disabled);
  await page.waitForTimeout(200);
};
check(await page.isVisible('#url-form'), '起動画面にURL欄');
await openUrl('https://www.aozora.gr.jp/cards/000879/card92.html');
let state = await page.evaluate(() => ({ reader: !document.getElementById('reader').classList.contains('hidden'), title: JV.App.doc && JV.App.doc.title, chapters: JV.App.doc && JV.App.doc.chapters.length }));
check(state.reader && state.title === '雨の停車場' && state.chapters === 3, `図書カードのURLから開ける (${state.title})`);
check(relayed.join() === 'cards/000879/card92.html,cards/000879/files/92_ruby_164.zip', `図書カード → ルビ付き zip の順に取る (${relayed})`);
check(await page.inputValue('#url-input') === '', '読み込んだら入力欄を空にする');

relayed.length = 0;
await openUrl('https://www.aozora.gr.jp/cards/000879/files/92_plain.zip');
state = await page.evaluate(() => JV.App.doc.title);
check(state === '雨の停車場' && relayed.join() === 'cards/000879/files/92_plain.zip', 'zip のURLなら直接（無圧縮 zip・html 混在でも .txt を選ぶ）');

await openUrl('https://example.com/novel.txt');
let err = await page.textContent('#home-error');
check(err.includes('図書カードのURL'), `青空文庫以外のURLは案内 (${err.slice(0, 30)}…)`);
await openUrl('https://www.aozora.gr.jp/cards/000879/card93.html');
err = await page.textContent('#home-error');
check(err.includes('zip）が見つかりません'), `テキスト版がない作品は案内 (${err.slice(0, 30)}…)`);
await openUrl('https://www.aozora.gr.jp/cards/000879/card99.html');
err = await page.textContent('#home-error');
check(err.includes('ありません'), `存在しない作品は案内 (${err.slice(0, 30)}…)`);

await page.unroute(/\/aozora\?/);
await openUrl('https://www.aozora.gr.jp/cards/000879/card92.html');
err = await page.textContent('#home-error');
check(err.includes('Netlify'), `中継のない場所（GitHub Pages など）では案内 (${err.slice(0, 40)}…)`);

console.log('zip ファイルを直接選ぶ');
const tmpZip = join(tmpdir(), `jev-viewer-test-${process.pid}.zip`);
await writeFile(tmpZip, rubyZip);
await page.evaluate(() => JV.App.showHome());
await page.setInputFiles('#file-input', tmpZip);
await page.waitForSelector('#reader:not(.hidden)');
check(await page.evaluate(() => JV.App.doc.title) === '雨の停車場', 'ダウンロードした zip をそのまま開ける');
await (await import('node:fs/promises')).unlink(tmpZip);

check(app.errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, `想定外のコンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();

console.log('local_server.py の /aozora');
const port = 19000 + Math.floor(Math.random() * 900);
const relay = spawn('python3', [join(VIEWER, 'relay/local_server.py'), '--port', String(port), '--host', '127.0.0.1'], {
  env: { ...process.env, TYPESAFE_API_KEY: 'k', AOZORA_BASE_URL: process.env.AOZORA_BASE_URL }, stdio: 'ignore',
});
let ok = false;
for (let i = 0; i < 50 && !ok; i++) { await new Promise((res) => setTimeout(res, 100)); ok = await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false); }
const lz = await fetch(`http://127.0.0.1:${port}/aozora?path=cards/000879/files/92_ruby_164.zip`);
check(lz.status === 200 && Buffer.from(await lz.arrayBuffer()).equals(rubyZip), 'zip を中継する');
const lb = await fetch(`http://127.0.0.1:${port}/aozora?path=../../etc/passwd`);
check(lb.status === 400, '青空文庫以外のパスは取らない');
relay.kill();
aozora.close();
done();
