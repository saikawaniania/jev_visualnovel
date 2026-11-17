/*!
 * tegaki.js
 * Based on the drawing engine of "Animation Studio" (claude-animation-studio)
 * https://github.com/i-afaqrashid/claude-animation-studio
 *
 * MIT License
 *
 * Copyright (c) 2026 Afaq Rashid
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/*!
 * tegaki.js — canvas に「手描きアニメ風」の絵を描く小さなライブラリ（依存なし）
 *
 * 仕組み：図形を約20px間隔の点に分け、点ごとに少しずらして（wobble）、
 *         2次ベジェで滑らかにつなぐ。ずれ方は 1秒に fps 回だけ変わる（boil）。
 *         乱数は使わず、ハッシュ関数で決める → 同じ時刻なら必ず同じ絵になる。
 *
 * 使い方：
 *   <script src="tegaki.js"></script>
 *   const tg = Tegaki.create(document.querySelector('canvas'), { style: 'paper' });
 *   tg.play((t) => {                 // t = 秒。毎フレーム t だけを見て描く
 *     tg.background('#F4E6CC');
 *     tg.ellipse(540, 540, 200, 180, { fill: '#F6C7A6', seed: 1, hatch: {} });
 *     tg.line([[300, 800], [780, 800]], { seed: 2 });
 *   });
 *
 * 図形（すべて現在の ctx の変形＝translate/scale/rotate が効く）：
 *   tg.rrect(x, y, w, h, r, o)   角丸四角
 *   tg.ellipse(cx, cy, rx, ry, o) 楕円
 *   tg.poly([[x,y], ...], o)     多角形（角の点を渡す）
 *   tg.star(x, y, r, o)          星
 *   tg.shape(points, o)          任意の点列（閉じた形）
 *   tg.line([[x,y], ...], o)     揺れる開いた線
 *   tg.limb([[x,y], ...], o)     縁取り付きの太い線（腕・脚・しっぽ）
 *   tg.hatch([x0,y0,x1,y1], o)   鉛筆の斜線（呼ぶ側で clip しておく）
 *   tg.text(str, x, y, o)        縁取り文字（少し揺れる）
 *   tg.background(color)         背景を塗る（ネオンなら夜色）
 *
 * 図形のオプション o：
 *   fill    塗り色（#RRGGBB）
 *   stroke  線の色（既定はインク色、null で線なし）
 *   lw      線の太さ（既定 4）
 *   seed    パーツごとに別の数字を渡す（揺れ方が決まる）
 *   amp     揺れの大きさ（既定 1.6、0 で揺れない）
 *   hatch   {} を渡すとハッチング。{ gap, angle, color, lw } で調整
 *   second  false で2本目の薄い鉛筆線を消す
 *   alpha   不透明度
 *
 * 全体の設定（tg.opt。いつでも変えられる）：
 *   style   'paper' | 'flat' | 'neon'
 *   amp     揺れの全体倍率（既定 1）
 *   fps     揺れの描き直し回数/秒（既定 12、0 で止まる）
 *   hatch / second / smooth / post   各機能のオン・オフ
 *   paper / vignette / grain         仕上げの強さ
 *
 * その他：
 *   tg.play(draw, { loop })   再生開始。戻り値 { pause(), resume(), seek(t), get time(), get playing() }
 *   tg.renderAt(t, draw)      1コマだけ描く（書き出し・静止画用）
 *   tg.setTime(t)             揺れのコマを t に合わせる（renderAt を使わず自前で描くとき）
 *   tg.post()                 仕上げ（紙の質感・ビネット・粒子）を重ねる
 *   tg.light(cx, cy, stops)   乗算の放射グラデーションで光を当てる
 *   tg.confetti(t, t0, o)     t の式だけで計算する紙吹雪
 *   tg.ctx / tg.W / tg.H      canvas の 2D コンテキストとサイズ
 *   Tegaki.hash(...)          決定的な 0〜1 の値
 *   Tegaki.rng(seed)          シード付き乱数（mulberry32）
 *   Tegaki.clamp / lerp / ease / tint / ik
 */
(function (root) {
  'use strict';

  // ---------------- 小道具 ----------------
  function hash(...xs) {
    let h = 2166136261 >>> 0;
    for (const x of xs) {
      h ^= (Math.round(x * 1000) | 0);
      h = Math.imul(h, 16777619); h ^= h >>> 13;
      h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    }
    return (h >>> 0) / 4294967296;
  }
  function rng(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = {
    inQuad: (x) => x * x, outQuad: (x) => 1 - (1 - x) * (1 - x), inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    outCubic: (x) => 1 - Math.pow(1 - x, 3), outBack: (x, s = 1.7) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
    outBounce: (x) => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; },
  };
  // 色を明るく（k>0）／暗く（k<0）
  const tint = (hex, k) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return '#' + v.map((x) => Math.round(k > 0 ? x + (255 - x) * k : x * (1 + k)).toString(16).padStart(2, '0')).join(''); };
  // 2関節IK：肩S・手の目標P・上腕a・前腕b → 肘E と手H。bend=1/-1 で曲げる向き
  function ik(S, P, a, b, bend = 1) {
    let dx = P[0] - S[0], dy = P[1] - S[1], d = Math.hypot(dx, dy);
    const maxd = a + b - 0.01; if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
    const ang = Math.atan2(dy, dx), A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)) * bend;
    return { E: [S[0] + Math.cos(ang + A) * a, S[1] + Math.sin(ang + A) * a], H: [S[0] + dx, S[1] + dy] };
  }

  // ---------------- 点列化（形 → 約 step px 間隔の点） ----------------
  function rrPts(x, y, w, h, r, step = 22) {
    r = Math.min(r, w / 2, h / 2); const pts = [];
    const edge = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)); for (let i = 0; i < n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
    const arc = (cx, cy, a0) => { if (r <= 0) return; const n = Math.max(2, Math.round(r * Math.PI / 2 / step)); for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    edge(x + r, y, x + w - r, y); arc(x + w - r, y + r, -Math.PI / 2);
    edge(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
    edge(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, Math.PI / 2);
    edge(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI);
    return pts;
  }
  function ellPts(cx, cy, rx, ry) { const n = Math.max(10, Math.round(Math.PI * (rx + ry) / 20)), pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return pts; }
  function polyPts(arr, step = 22) { const pts = []; for (let i = 0; i < arr.length; i++) { const a = arr[i], b = arr[(i + 1) % arr.length], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return pts; }
  function subdivide(pts, step = 20) { const out = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } out.push(pts[pts.length - 1]); return out; }
  const bbox = (p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const q of p) { if (q[0] < a) a = q[0]; if (q[1] < b) b = q[1]; if (q[0] > c) c = q[0]; if (q[1] > d) d = q[1]; } return [a, b, c, d]; };

  const STYLES = {
    paper: { amp: 1, outline: true, hatch: true, second: true, post: true },
    flat: { amp: 0, outline: false, hatch: false, second: false, post: false },
    neon: { amp: 0.3, outline: true, hatch: false, second: false, post: false, neon: true, bg: '#0A0A1E' },
  };

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------------- 本体 ----------------
  function create(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const INK = options.ink || '#2A2320';
    const opt = Object.assign({ style: 'paper', amp: 1, fps: 12, hatch: true, second: true, smooth: true, post: true, paper: 0.5, vignette: 0.3, grain: 0.06 }, options);
    let boil = 0, time = 0;
    const st = () => STYLES[opt.style] || STYLES.paper;

    const setTime = (t) => { time = t; boil = opt.fps > 0 ? Math.floor(t * opt.fps) : 0; };
    const jit = (seed, i, amp) => [(hash(seed, i, boil) - 0.5) * 2 * amp, (hash(seed, i + 7919, boil) - 0.5) * 2 * amp];
    const wobble = (pts, seed, amp) => pts.map((p, i) => { const j = jit(seed, i, amp); return [p[0] + j[0], p[1] + j[1]]; });

    // 点を2次ベジェで滑らかにつなぐ（各点が制御点、隣との中点を通る）
    function path(p, closed = true) {
      const n = p.length; if (n < 2) return;
      if (!opt.smooth) { ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(p[i][0], p[i][1]); if (closed) ctx.closePath(); return; }
      if (!closed) {
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        ctx.lineTo(p[n - 1][0], p[n - 1][1]); return;
      }
      ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
      for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      ctx.closePath();
    }

    // 鉛筆のハッチング（箱いっぱいに斜線。呼ぶ側で clip しておく）
    function hatch([x0, y0, x1, y1], { color = 'rgba(0,0,0,.18)', gap = 8, angle = -0.95, lw = 1.6, seed = 3, jitter = 1.5 } = {}) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 4, ca = Math.cos(angle), sa = Math.sin(angle);
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath();
      for (let d = -R, k = 0; d <= R; d += gap, k++) {
        const j1 = (hash(seed, k, boil) - 0.5) * jitter * 2, j2 = (hash(seed + 1, k, boil) - 0.5) * jitter * 2;
        ctx.moveTo(cx - ca * R - sa * (d + j1), cy - sa * R + ca * (d + j1));
        ctx.lineTo(cx + ca * R - sa * (d + j2), cy + sa * R + ca * (d + j2));
      }
      ctx.stroke(); ctx.restore();
    }

    // 万能関数：揺らす → 塗る → ハッチング → インク線 → 薄い2本目の線
    function shape(pts, o = {}) {
      const S = st();
      const { fill, stroke = INK, lw = 4, seed = 1, closed = true, alpha = 1 } = o;
      const amp = (o.amp ?? 1.6) * S.amp * opt.amp;
      const p = amp > 0 ? wobble(pts, seed, amp) : pts;
      ctx.save();
      if (alpha !== 1) ctx.globalAlpha *= alpha;
      ctx.beginPath(); path(p, closed);
      if (fill && closed) { if (S.neon) { ctx.globalAlpha *= 0.18; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha /= 0.18; } else { ctx.fillStyle = fill; ctx.fill(); } }
      if (o.hatch && S.hatch && opt.hatch && closed) {
        ctx.save(); ctx.beginPath(); path(p, true); ctx.clip();
        hatch(bbox(p), Object.assign({ seed: seed + 11, color: fill ? tint(fill, -0.45) + '55' : 'rgba(0,0,0,.2)' }, o.hatch));
        ctx.restore();
      }
      if (stroke && lw > 0 && (S.outline || !fill)) {
        ctx.beginPath(); path(p, closed); // clip のあとはパスを作り直す
        ctx.lineJoin = ctx.lineCap = 'round';
        if (S.neon) { const col = fill ? tint(fill, 0.35) : tint(stroke === INK ? '#DDF3FF' : stroke, 0.2); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.lineWidth = lw * 0.8; }
        else { ctx.strokeStyle = stroke; ctx.lineWidth = lw; }
        ctx.stroke();
        if ((o.second ?? true) && S.second && opt.second) {
          const p2 = wobble(pts, seed + 5, amp * 1.4 + 0.6);
          ctx.beginPath(); path(p2, closed);
          ctx.globalAlpha *= 0.3; ctx.lineWidth = Math.max(1, lw * 0.55); ctx.stroke();
        }
      }
      ctx.restore();
      return p;
    }
    const rrect = (x, y, w, h, r, o) => shape(rrPts(x, y, w, h, r, o && o.step), o);
    const ellipse = (cx, cy, rx, ry, o) => shape(ellPts(cx, cy, rx, ry), o);
    const poly = (corners, o) => shape(polyPts(corners, (o && o.step) || 22), o);
    const line = (pts, o = {}) => shape(subdivide(pts, o.step || 20), Object.assign({ closed: false, amp: 1.4, second: false }, o));
    function star(x, y, r, o) { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } return poly(pts, Object.assign({ step: 14 }, o)); }

    // 縁取り付きの太い線：インクで太く → その上に色で細く
    function limb(pts, { color = '#F6C7A6', lw = 26, outline = 4.5, seed = 1 } = {}) {
      const S = st(), amp = 1.2 * S.amp * opt.amp, base = subdivide(pts, 24);
      const p = amp > 0 ? wobble(base, seed, amp) : base;
      ctx.save(); ctx.lineCap = ctx.lineJoin = 'round';
      if (S.neon) { ctx.strokeStyle = tint(color, 0.3); ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 16; ctx.lineWidth = lw * 0.45; ctx.beginPath(); path(p, false); ctx.stroke(); ctx.restore(); return; }
      if (S.outline) { ctx.strokeStyle = INK; ctx.lineWidth = lw + outline * 2; ctx.beginPath(); path(p, false); ctx.stroke(); }
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); path(p, false); ctx.stroke();
      ctx.restore();
    }

    // 縁取り文字（boil に合わせて少しだけ揺れる）
    function text(str, x, y, { size = 64, font = '"Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", sans-serif', weight = 900, color = '#FFFDF6', stroke = INK, strokeW = 12, align = 'center', boilAmp = 1 } = {}) {
      const a = boilAmp * st().amp * opt.amp, jx = (hash(str.length, 1, boil) - 0.5) * 2 * a, jy = (hash(str.length, 2, boil) - 0.5) * 2 * a;
      ctx.save(); ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      if (stroke && strokeW > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW; ctx.strokeText(str, x + jx, y + jy); }
      ctx.fillStyle = color; ctx.fillText(str, x + jx, y + jy); ctx.restore();
    }

    function background(color = '#F4EDE0') { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = st().bg || color; ctx.fillRect(0, 0, W, H); ctx.restore(); }

    // 乗算の放射グラデーションで光を当てる（シーンを描き終えたあとに呼ぶ）
    function light(cx, cy, stops = [[0, '#FFFFFF'], [0.45, '#C3C8EE'], [1, '#4E5080']], radius = Math.max(W, H)) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'multiply';
      const g = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius); for (const [k, c] of stops) g.addColorStop(k, c);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // t の式だけで計算する紙吹雪（t0 から始まる）
    function confetti(t, t0, { n = 80, seed = 1, x = W / 2, y = H / 2, spread = 900, up = 600, gravity = 900, life = 2.2, colors = ['#E0703E', '#F2B84B', '#3FA89B', '#E8718D', '#B79CFF'] } = {}) {
      const age = t - t0; if (age < 0 || age > life) return;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const vx = (hash(seed, i, 1) - 0.5) * spread, vy = -up * (0.5 + hash(seed, i, 2) * 0.8);
        const px = x + vx * age, py = y + vy * age + gravity * age * age; if (py > H + 20) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(age * 8 + i); ctx.fillStyle = colors[i % colors.length]; ctx.globalAlpha = clamp(life - age); ctx.fillRect(-8, -4, 16, 8); ctx.restore();
      }
      ctx.restore();
    }

    // ---------------- 仕上げ（テクスチャは最初の post で1回だけ作る） ----------------
    let paperTex = null, grainTiles = null;
    function buildTextures() {
      paperTex = makeCanvas(W, H); const x = paperTex.getContext('2d'), r = rng(5);
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      const specks = Math.round(W * H / 30);
      for (let i = 0; i < specks; i++) { const v = 200 + Math.floor(r() * 55); x.fillStyle = `rgba(${v - 20},${v - 28},${v - 40},${0.08 + r() * 0.12})`; x.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
      x.lineCap = 'round';
      for (let i = 0; i < specks / 60; i++) { x.strokeStyle = `rgba(150,130,100,${0.04 + r() * 0.06})`; x.lineWidth = 0.6 + r(); const px = r() * W, py = r() * H, a = r() * 6.28, l = 6 + r() * 26; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + r() * 6, py + Math.sin(a) * l * 0.5 + r() * 6, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
      for (let i = 0; i < 30; i++) { const gx = r() * W, gy = r() * H, gr = 80 + r() * 240, g = x.createRadialGradient(gx, gy, 0, gx, gy, gr); g.addColorStop(0, `rgba(210,190,160,${0.05 + r() * 0.05})`); g.addColorStop(1, 'rgba(210,190,160,0)'); x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); }
      grainTiles = [0, 1, 2, 3].map((k) => { const c = makeCanvas(256, 256), gx = c.getContext('2d'), img = gx.createImageData(256, 256), rr = rng(100 + k); for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (rr() - 0.5) * 120; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } gx.putImageData(img, 0, 0); return c; });
    }
    function post() {
      if (!opt.post) return;
      if (!paperTex) buildTextures();
      const S = st();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (S.post && opt.paper > 0) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = opt.paper; ctx.drawImage(paperTex, 0, 0); }
      const v = S.neon ? 0.5 : opt.vignette;
      if (v > 0) {
        ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1;
        const m = Math.min(W, H), g = ctx.createRadialGradient(W / 2, H / 2, m * 0.35, W / 2, H / 2, m * 1.05);
        g.addColorStop(0, '#fff'); g.addColorStop(1, `rgb(${255 * (1 - v) | 0},${250 * (1 - v) | 0},${245 * (1 - v) | 0})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      if (opt.style !== 'flat' && opt.grain > 0) {
        ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = opt.grain;
        const tile = grainTiles[boil % 4], ox = -Math.floor(hash(boil, 1) * 256), oy = -Math.floor(hash(boil, 2) * 256);
        for (let y = oy; y < H; y += 256) for (let x = ox; x < W; x += 256) ctx.drawImage(tile, x, y);
      }
      ctx.restore();
    }

    // ---------------- 1コマ描画と再生 ----------------
    function renderAt(t, draw) {
      setTime(t);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.clearRect(0, 0, W, H);
      draw(t, api);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      post();
    }
    // requestAnimationFrame が止まる環境（埋め込みプレビュー等）でもタイマーで描き続ける
    function play(draw, { loop = 0, onFrame } = {}) {
      let playing = true, t0 = performance.now(), tNow = 0, last = 0, stopped = false;
      const tick = () => {
        if (stopped) return;
        const now = performance.now();
        if (playing) { tNow = (now - t0) / 1000; if (loop > 0) tNow %= loop; }
        renderAt(tNow, draw); last = now;
        if (onFrame) onFrame(tNow);
      };
      const raf = () => { if (stopped) return; tick(); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      const iv = setInterval(() => { if (performance.now() - last > 80) tick(); }, 33);
      tick();
      return {
        pause() { if (playing) { playing = false; } },
        resume() { if (!playing) { playing = true; t0 = performance.now() - tNow * 1000; } },
        seek(t) { tNow = t; t0 = performance.now() - t * 1000; if (!playing) tick(); },
        stop() { stopped = true; clearInterval(iv); },
        get time() { return tNow; }, get playing() { return playing; },
      };
    }

    const api = {
      ctx, canvas, W, H, opt, INK,
      get t() { return time; }, get boil() { return boil; },
      setTime, wobble, path, hatch, shape, rrect, ellipse, poly, line, star, limb, text, background, light, confetti, post, renderAt, play,
      points: { rrPts, ellPts, polyPts, subdivide, bbox },
    };
    return api;
  }

  const Tegaki = { create, hash, rng, clamp, lerp, ease, tint, ik, STYLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tegaki;
  root.Tegaki = Tegaki;
})(typeof window !== 'undefined' ? window : globalThis);
