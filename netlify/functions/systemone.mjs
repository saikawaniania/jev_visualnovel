// Netlify Functions：ビューアと同じサイトの POST /v1/systemone（判定）と GET /v1/models（使えるモデルの一覧）を受け、
// API キーを付けて TypeSafe へ中継する。
// ページと同じオリジンなので、ブラウザの CORS 制限はかからない。キーは Netlify の環境変数だけに置く。
//
// 環境変数：
//   TYPESAFE_API_KEY   必須。TypeSafe の API キー
//   RELAY_PASSPHRASE   必須。合言葉。ビューアは X-Relay-Passphrase ヘッダーで送る
//   TYPESAFE_BASE_URL  任意。既定 https://api.typesafe.ai（テスト用）
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 9000; // Netlify の同期関数は 10 秒で打ち切られる

const env = (name) => {
  const v = globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
  return typeof v === 'string' ? v.trim() : '';
};

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// 長さの違いも含めて、比較時間から合言葉を推測されないようにハッシュどうしで比べる
const sameSecret = (a, b) => {
  const h = (s) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b));
};

export default async (req) => {
  const isModels = new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/v1/models');
  if (isModels ? req.method !== 'GET' : req.method !== 'POST') return json(405, { error: isModels ? 'GET only' : 'POST only' });

  const apiKey = env('TYPESAFE_API_KEY');
  const passphrase = env('RELAY_PASSPHRASE');
  if (!apiKey || !passphrase) {
    return json(500, { error: 'relay is not configured: set TYPESAFE_API_KEY and RELAY_PASSPHRASE in Netlify environment variables, then redeploy' });
  }
  if (!sameSecret(req.headers.get('x-relay-passphrase') || '', passphrase)) {
    return json(403, { error: 'relay passphrase is wrong or missing' });
  }

  const base = (env('TYPESAFE_BASE_URL') || 'https://api.typesafe.ai').replace(/\/+$/, '');
  if (isModels) return forward(`${base}/v1/models`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } });

  const raw = await req.text();
  if (!raw || raw.length > MAX_BODY) return json(400, { error: 'invalid body size' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid json' }); }

  // 判定に必要な3項目だけを渡す
  const payload = JSON.stringify({ model: body.model || 'jev-latest', state: body.state, questions: body.questions });
  return forward(`${base}/v1/systemone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    body: payload,
  });
};

async function forward(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return json(502, { error: `upstream unreachable: ${err.name === 'TimeoutError' ? 'timeout' : err.message}` });
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const config = { path: ['/v1/systemone', '/v1/models'] };
