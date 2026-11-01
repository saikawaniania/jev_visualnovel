// Netlify のビルド：公開するファイルを public/ にまとめ、中継関数をリポジトリ直下の netlify/functions から持ってくる。
// 実行場所はこのフォルダ（Netlify の Base directory を tegaki にする）。依存なし。
import { cp, mkdir, rm } from 'node:fs/promises';

const PUBLIC = ['index.html', 'preview.html', 'tegaki.js', 'draw.js', 'samples'];
await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
for (const f of PUBLIC) await cp(f, `public/${f}`, { recursive: true });
// 中継（Jev・青空文庫）は既存のビューアと同じ関数をそのまま使う
await rm('netlify/functions', { recursive: true, force: true });
await mkdir('netlify/functions', { recursive: true });
for (const f of ['systemone.mjs', 'aozora.mjs']) await cp(`../netlify/functions/${f}`, `netlify/functions/${f}`);
console.log('public/ と netlify/functions/ を作りました');
