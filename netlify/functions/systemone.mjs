// Netlify Functions：ビューアと同じサイトで Jev（TypeSafe）への中継を行う。
// ページと同じオリジンなので、ブラウザの CORS 制限はかからない。キーは Netlify の環境変数だけに置く。
//
//   POST /v1/systemone     判定（TypeSafe の /v1/systemone へ中継）
//   GET  /v1/models        使えるモデルの一覧（持ち主だけ）
//   GET  /v1/relay-status  公開中かどうか（誰でも）
//   POST /v1/relay-admin   公開の停止・再開・状況（持ち主だけ）
//
// 使える人：
//   - 持ち主：X-Relay-Passphrase に合言葉を付けた人。期間・上限に関係なく使える
//   - 一般の人：公開期間中（RELAY_PUBLIC_UNTIL の日まで）で、停止されておらず、
//     その日の回数が上限（RELAY_DAILY_LIMIT）未満のときだけ、合言葉なしで使える
//
// 環境変数：
//   TYPESAFE_API_KEY    必須。TypeSafe の API キー
//   RELAY_PASSPHRASE    必須。持ち主の合言葉
//   RELAY_PUBLIC_UNTIL  任意。一般公開の最終日（日本時間、例 2026-10-10）。未設定なら一般公開しない
//   RELAY_DAILY_LIMIT   任意。一般の人が1日に使える判定の回数（全員の合計、日本時間で日替わり）。既定 2000
//   TYPESAFE_BASE_URL   任意。既定 https://api.typesafe.ai（テスト用）
//
// 停止スイッチと回数は Netlify Blobs に置くので、止める・再開するのに再デプロイは要らない。
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 9000; // Netlify の同期関数は 10 秒で打ち切られる
const DEFAULT_DAILY_LIMIT = 2000;
const STORE_NAME = 'jev-relay';

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

// テストでは globalThis.__jevRelayStore（get/set を持つもの）と __jevNow（ミリ秒）で差し替える
async function store() {
  if (globalThis.__jevRelayStore) return globalThis.__jevRelayStore;
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}
const now = () => (globalThis.__jevNow ?? Date.now());
/** 日本時間の日付（YYYY-MM-DD） */
const todayJST = () => new Date(now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 一般公開の状態。reason：open | closed（期間外・未設定）| stopped（停止中）| limit（今日の上限） */
async function publicState() {
  const until = env('RELAY_PUBLIC_UNTIL');
  const limit = Number(env('RELAY_DAILY_LIMIT')) || DEFAULT_DAILY_LIMIT;
  const day = todayJST();
  const s = await store();
  const stopped = (await s.get('stopped')) === 'true';
  const used = Number(await s.get(`count-${day}`)) || 0;
  let reason = 'open';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || day > until) reason = 'closed';
  else if (stopped) reason = 'stopped';
  else if (used >= limit) reason = 'limit';
  return { reason, open: reason === 'open', until: until || null, limit, used, day, stopped };
}

async function countUse(day) {
  const s = await store();
  const key = `count-${day}`;
  const n = Number(await s.get(key)) || 0;
  await s.set(key, String(n + 1));
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const route = path.endsWith('/v1/models') ? 'models'
    : path.endsWith('/v1/relay-status') ? 'status'
      : path.endsWith('/v1/relay-admin') ? 'admin' : 'judge';
  const method = { models: 'GET', status: 'GET', admin: 'POST', judge: 'POST' }[route];
  if (req.method !== method) return json(405, { error: `${method} only` });

  const apiKey = env('TYPESAFE_API_KEY');
  const passphrase = env('RELAY_PASSPHRASE');
  if (!apiKey || !passphrase) {
    return json(500, { error: 'relay is not configured: set TYPESAFE_API_KEY and RELAY_PASSPHRASE in Netlify environment variables, then redeploy' });
  }
  const owner = sameSecret(req.headers.get('x-relay-passphrase') || '', passphrase);

  // 公開状況（誰でも見られる。回数は持ち主にだけ見せる）
  if (route === 'status') {
    const st = await publicState();
    return json(200, { open: st.open, reason: st.reason, until: st.until, ...(owner ? { limit: st.limit, used: st.used, stopped: st.stopped, day: st.day } : {}) });
  }

  // 停止・再開（持ち主だけ）
  if (route === 'admin') {
    if (!owner) return json(403, { error: 'relay passphrase is wrong or missing', code: 'passphrase' });
    let body = {};
    try { body = JSON.parse((await req.text()) || '{}'); } catch { return json(400, { error: 'invalid json' }); }
    const s = await store();
    if (body.action === 'stop') await s.set('stopped', 'true');
    else if (body.action === 'resume') await s.set('stopped', 'false');
    else if (body.action !== 'status') return json(400, { error: 'action must be stop, resume or status' });
    return json(200, await publicState());
  }

  let publicDay = null;
  if (!owner) {
    if (route === 'models') return json(403, { error: 'relay passphrase is wrong or missing', code: 'passphrase' });
    const st = await publicState();
    if (!st.open) {
      const why = { closed: 'the public period is over', stopped: 'public access is stopped', limit: 'today\'s limit has been reached' }[st.reason];
      return json(403, { error: `relay is not open to the public: ${why}`, code: st.reason, until: st.until });
    }
    publicDay = st.day;
  }

  const base = (env('TYPESAFE_BASE_URL') || 'https://api.typesafe.ai').replace(/\/+$/, '');
  if (route === 'models') return forward(`${base}/v1/models`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } });

  const raw = await req.text();
  if (!raw || raw.length > MAX_BODY) return json(400, { error: 'invalid body size' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid json' }); }

  if (publicDay) await countUse(publicDay);
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

export const config = { path: ['/v1/systemone', '/v1/models', '/v1/relay-status', '/v1/relay-admin'] };
