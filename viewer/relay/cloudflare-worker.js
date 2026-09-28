// ブラウザから Jev を直接呼べない（CORS で拒否される）場合の小さな中継。Cloudflare Workers 用。
//
// 使い方：
//   1. Workers を作成し、このファイルを貼り付ける
//   2. 環境変数（Secret）に TYPESAFE_API_KEY を設定。ALLOWED_ORIGIN にビューアを置くオリジンを設定
//      （例 https://example.github.io 。未設定なら全オリジンを許可）
//   3. ビューアの設定で「中継サーバー」を選び、Worker の URL を接続先URLに入れる（APIキー欄は空でよい）
//
// ビューアは TypeSafe と同じ本文 { model, state, questions } を POST する。ここでは中身をそのまま
// TypeSafe の /v1/systemone へ渡し、キーだけをサーバー側で付ける。
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
    if (allowed !== '*' && origin !== allowed) return new Response('origin not allowed', { status: 403, headers: cors });

    let body;
    try { body = await request.json(); } catch { return new Response('invalid json', { status: 400, headers: cors }); }
    // 送ってよいのは判定に必要な3項目だけ
    const payload = JSON.stringify({ model: body.model || 'jev-1.13', state: body.state, questions: body.questions });

    const res = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: payload,
    });
    return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/json' } });
  },
};
