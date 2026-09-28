// Netlify Functions：GET /aozora?path=cards/000879/card92.html のように、青空文庫の図書カードと zip を取ってくる。
// ブラウザから www.aozora.gr.jp を直接読むと CORS で拒否されるため、同じサイトのこの関数を経由する。
// 取りに行けるのは青空文庫の「図書カード」と「files/ の zip」だけ（それ以外のURLの中継には使えない）。
//
// 環境変数：
//   AOZORA_BASE_URL  任意。既定 https://www.aozora.gr.jp（テスト用）
const PATH_RE = /^cards\/\d{6}\/(card\d+\.html|files\/[A-Za-z0-9_.-]+\.zip)$/;
const MAX_BYTES = 15_000_000;
const TIMEOUT_MS = 9000;

const env = (name) => {
  const v = globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
  return typeof v === 'string' ? v.trim() : '';
};

const text = (status, msg) => new Response(JSON.stringify({ error: msg }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export default async (req) => {
  if (req.method !== 'GET') return text(405, 'GET only');
  const path = new URL(req.url).searchParams.get('path') || '';
  if (!PATH_RE.test(path)) return text(400, 'path must be cards/NNNNNN/cardNNN.html or cards/NNNNNN/files/*.zip');

  const base = (env('AOZORA_BASE_URL') || 'https://www.aozora.gr.jp').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/${path}`, { headers: { 'User-Agent': 'jev-viewer (+netlify function)' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return text(502, `aozora unreachable: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
  }
  if (!res.ok) return text(res.status === 404 ? 404 : 502, `aozora returned HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return text(413, 'file too large');
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': path.endsWith('.zip') ? 'application/zip' : (res.headers.get('Content-Type') || 'text/html'),
      // 作品ファイルはほとんど変わらないので CDN に1日置く
      'Cache-Control': 'public, max-age=86400',
    },
  });
};

export const config = { path: '/aozora' };
