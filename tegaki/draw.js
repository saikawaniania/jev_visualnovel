// draw.js — 手描きサウンドノベルの「絵」：場所16種・人物・心象・天候を tegaki.js で描く。
// すべて「場面の値」と時刻 t だけで決まる（Math.random は使わない）ので、同じ場面・同じ時刻なら同じ絵になる。
//
//   Draw.layout(tg)                          → 基準線 L（地平線・床・単位）
//   Draw.background(tg, L, { location, time, era }, t)
//   Draw.person(tg, L, { type, era, pose, expr, x, y, h, facing, slot, time, seat, alpha }, t)
//   Draw.figures(tg, L, { figures, era, time, location, expr }, t)   人数・配置ごと
//   Draw.emotion(tg, L, id, t, alpha)        心象の背景（不安・喜び・落ち着き・悲しみ・怒り）
//   Draw.weather(tg, L, { rain, snow, cloudy, fog }, t)
(function (root) {
  'use strict';
  const T = root.Tegaki;
  const { hash, clamp, lerp } = T;

  /* ---------------- 色 ---------------- */
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (v) => '#' + v.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return hex(A.map((x, i) => x + (B[i] - x) * k)); };
  // 時間帯の光：色をその時間の光に寄せる（夜は紺へ、夕方は橙へ）
  const LIGHT = { morning: ['#FFE6CC', 0.1], day: [null, 0], evening: ['#E07040', 0.2], night: ['#141B44', 0.55] };
  function shader(time, k = 1) { const [c, w] = LIGHT[time] || LIGHT.day; return c ? (h) => mix(h, c, w * k) : (h) => h; }
  const SKY = { morning: ['#8FC1E6', '#F9D2AE'], day: ['#62AEE4', '#D3ECF8'], evening: ['#4E4F86', '#F39A5B'], night: ['#090E2C', '#27306A'] };
  const CLOUD = { morning: '#FFF1E4', day: '#FFFFFF', evening: '#F5B48A', night: '#363E74' };

  /* ---------------- レイアウト ---------------- */
  function layout(tg) {
    const W = tg.W, H = tg.H, U = H / 900;
    return { W, H, U, cx: W / 2, hz: H * 0.58, floor: H * 0.9, tall: H > W * 1.1 };
  }

  /* ---------------- 共通の部品 ---------------- */
  function skyFill(tg, time, x, y, w, h) {
    const c = tg.ctx, [a, b] = SKY[time] || SKY.day, g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(x, y, w, h);
  }
  function cloud(tg, x, y, s, col, seed) {
    tg.ellipse(x, y, 70 * s, 26 * s, { fill: col, lw: 3, seed, second: false });
    tg.ellipse(x - 34 * s, y - 14 * s, 36 * s, 26 * s, { fill: col, lw: 3, seed: seed + 1, second: false });
    tg.ellipse(x + 20 * s, y - 22 * s, 42 * s, 32 * s, { fill: col, lw: 3, seed: seed + 2, second: false });
    tg.ellipse(x, y + 2 * s, 64 * s, 20 * s, { fill: col, stroke: null, seed: seed + 3 });
  }
  // 空：太陽・月・星・雲（箱の中にクリップ）
  function skyBox(tg, L, time, t, x, y, w, h, { clouds = 3, stars = true } = {}) {
    const c = tg.ctx; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    skyFill(tg, time, x, y, w, h);
    const U = L.U;
    if (time === 'night') {
      if (stars) for (let k = 0; k < 18; k++) { const tw = 0.6 + 0.4 * Math.sin(t * 2 + k * 1.7); tg.star(x + hash(k, 1) * w, y + hash(k, 2) * h * 0.75, (3 + hash(k, 3) * 4) * U * tw, { fill: '#F6EBC0', lw: 1.5, seed: 900 + k, amp: 0.3, second: false }); }
      tg.ellipse(x + w * 0.78, y + h * 0.22, 34 * U, 34 * U, { fill: '#F6EBC0', lw: 3, seed: 880 });
      tg.ellipse(x + w * 0.78 + 12 * U, y + h * 0.22 - 6 * U, 28 * U, 28 * U, { fill: SKY.night[0], stroke: null, seed: 881, amp: 0.4 });
    } else {
      const pos = { morning: [0.2, 0.75], day: [0.62, 0.22], evening: [0.8, 0.8] }[time] || [0.62, 0.22];
      tg.ellipse(x + w * pos[0], y + h * pos[1], 40 * U, 40 * U, { fill: time === 'evening' ? '#F2784B' : '#FFD66B', lw: 3.5, seed: 882 });
    }
    for (let k = 0; k < clouds; k++) {
      const s = (0.7 + hash(k, 9) * 0.6) * U, sp = (6 + k * 4) * U;
      const cx = x + (((hash(k, 7) * (w + 300) + t * sp) % (w + 300)) - 150);
      cloud(tg, cx, y + h * (0.18 + 0.2 * hash(k, 8)), s, CLOUD[time] || CLOUD.day, 860 + k * 4);
    }
    c.restore();
  }
  // 窓：空が見える
  function windowFrame(tg, L, time, t, x, y, w, h, C, seed, { cross = true } = {}) {
    skyBox(tg, L, time, t, x, y, w, h, { clouds: 1 });
    tg.rrect(x, y, w, h, 4, { lw: 5 * L.U, seed });
    if (cross) {
      tg.line([[x + w / 2, y], [x + w / 2, y + h]], { lw: 4 * L.U, seed: seed + 1 });
      tg.line([[x, y + h / 2], [x + w, y + h / 2]], { lw: 4 * L.U, seed: seed + 2 });
    }
    tg.rrect(x - 10 * L.U, y + h, w + 20 * L.U, 12 * L.U, 3, { fill: C('#C9A27E'), lw: 3, seed: seed + 3 });
  }
  function ground(tg, L, y, col, seed, hatch = { gap: 14, angle: -0.25 }) {
    tg.rrect(-40, y, L.W + 80, L.H - y + 40, 0, { fill: col, lw: 5 * L.U, seed, hatch });
  }
  function tree(tg, L, x, y, s, C, t, seed, kind = 'round') {
    const sway = Math.sin(t * 1.2 + seed) * 0.03, c = tg.ctx;
    tg.rrect(x - 14 * s, y - 150 * s, 28 * s, 152 * s, 8, { fill: C('#8E6444'), lw: 4, seed });
    c.save(); c.translate(x, y - 150 * s); c.rotate(sway);
    if (kind === 'pine') {
      for (let k = 0; k < 3; k++) tg.poly([[-90 * s + k * 18 * s, -k * 55 * s + 20 * s], [0, -k * 55 * s - 90 * s], [90 * s - k * 18 * s, -k * 55 * s + 20 * s]], { fill: C(k % 2 ? '#3F7A4A' : '#4A8A52'), lw: 4, seed: seed + 1 + k, hatch: { gap: 9 } });
    } else {
      tg.ellipse(0, -60 * s, 100 * s, 90 * s, { fill: C('#4E9A57'), lw: 4, seed: seed + 1, hatch: { gap: 9 } });
      tg.ellipse(-50 * s, -20 * s, 60 * s, 50 * s, { fill: C('#5AA862'), lw: 4, seed: seed + 2 });
      tg.ellipse(55 * s, -25 * s, 55 * s, 48 * s, { fill: C('#468E50'), lw: 4, seed: seed + 3 });
    }
    c.restore();
  }
  function lantern(tg, L, x, y, s, C, time, seed) {
    tg.line([[x, y], [x, y - 20 * s]], { lw: 3, seed });
    tg.ellipse(x, y + 26 * s, 20 * s, 28 * s, { fill: time === 'night' ? '#FFB45A' : C('#E8664A'), lw: 3, seed: seed + 1 });
    if (time === 'night' || time === 'evening') glow(tg, x, y + 26 * s, 90 * s, 'rgba(255,190,110,0.35)');
  }
  function glow(tg, x, y, r, col) {
    const c = tg.ctx; c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }
  function wallFill(tg, L, col, y1, seed) {
    tg.background(col);
    const c = tg.ctx; c.save(); c.beginPath(); c.rect(0, 0, L.W, y1); c.clip();
    tg.hatch([0, 0, L.W, y1], { color: 'rgba(120,80,40,.06)', gap: 18, seed }); c.restore();
  }
  // 建物（街路・路地）：時代で作りを変える
  function building(tg, L, x, w, top, base, era, C, time, seed) {
    const U = L.U, h = base - top;
    const col = { modern: ['#8A6A4E', '#5A4636'], present: ['#C8C2B8', '#9AA0A8'], western: ['#C9B49A', '#A88F74'], fantasy: ['#D8C8A8', '#B89A78'] }[era] || ['#8A6A4E', '#5A4636'];
    tg.rrect(x, top, w, h, 4, { fill: C(col[hash(seed, 1) > 0.5 ? 0 : 1]), lw: 5 * U, seed, hatch: { gap: 16, angle: 1.4, color: 'rgba(0,0,0,.08)' } });
    if (era === 'modern') {
      tg.poly([[x - 16 * U, top + 6 * U], [x + w / 2, top - 46 * U], [x + w + 16 * U, top + 6 * U]], { fill: C('#4A4A52'), lw: 4 * U, seed: seed + 1, hatch: { gap: 7, angle: 0.2 } });
      tg.rrect(x + w * 0.15, base - h * 0.42, w * 0.7, h * 0.42, 2, { fill: C('#3A2E28'), lw: 4 * U, seed: seed + 2 });
      tg.rrect(x + w * 0.1, base - h * 0.5, w * 0.8, h * 0.1, 2, { fill: C(hash(seed, 3) > 0.5 ? '#2F4A6A' : '#7A2E2E'), lw: 3 * U, seed: seed + 3 });
    } else if (era === 'fantasy') {
      tg.poly([[x - 10 * U, top + 4 * U], [x + w / 2, top - 70 * U], [x + w + 10 * U, top + 4 * U]], { fill: C('#A84A3A'), lw: 4 * U, seed: seed + 1, hatch: { gap: 8 } });
      tg.rrect(x + w * 0.35, base - h * 0.35, w * 0.3, h * 0.35, 14, { fill: C('#6A4A32'), lw: 4 * U, seed: seed + 2 });
    } else {
      tg.rrect(x + w * 0.35, base - h * 0.3, w * 0.3, h * 0.3, 3, { fill: C(era === 'present' ? '#7A8A9A' : '#5A4232'), lw: 4 * U, seed: seed + 2 });
    }
    const rows = Math.max(1, Math.floor((h * (era === 'modern' ? 0.4 : 0.62)) / (60 * U))), cols = Math.max(1, Math.floor(w / (70 * U)));
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const wx = x + (k + 0.5) * w / cols - 16 * U, wy = top + 20 * U + r * 60 * U;
      const lit = time === 'night' || time === 'evening' ? hash(seed, r, k) > 0.35 : false;
      tg.rrect(wx, wy, 32 * U, 38 * U, 3, { fill: lit ? '#FFD58A' : C('#A8C8DC'), lw: 3 * U, seed: seed + 10 + r * 7 + k, second: false });
    }
  }

  /* ---------------- 場所（16種＋無地） ---------------- */
  const BG = {
    none(tg, L, s, t) { tg.background(s.time === 'night' ? '#2B2F55' : '#F2EADB'); },

    washitsu(tg, L, s, t, C) {
      const U = L.U, fy = L.H * 0.68;
      wallFill(tg, L, C('#EADCBF'), fy, 10);
      // 障子
      const sx = L.W * 0.08, sw = L.W * 0.5, sy = fy - 430 * U, sh = 430 * U;
      const c = tg.ctx; c.save(); c.globalAlpha = 1; tg.rrect(sx, sy, sw, sh, 2, { fill: s.time === 'night' ? C('#E8DDC0') : '#FBF6EA', lw: 6 * U, seed: 11 }); c.restore();
      if (s.time !== 'night') glow(tg, sx + sw / 2, sy + sh / 2, sw * 0.7, s.time === 'evening' ? 'rgba(255,170,90,0.25)' : 'rgba(255,250,230,0.25)');
      for (let k = 1; k < 6; k++) tg.line([[sx + sw * k / 6, sy], [sx + sw * k / 6, sy + sh]], { lw: 3 * U, seed: 12 + k, amp: 0.8 });
      for (let k = 1; k < 5; k++) tg.line([[sx, sy + sh * k / 5], [sx + sw, sy + sh * k / 5]], { lw: 3 * U, seed: 20 + k, amp: 0.8 });
      // 床の間と掛軸
      const tx = L.W * 0.66, tw = L.W * 0.26;
      tg.rrect(tx, sy - 20 * U, tw, sh + 20 * U, 2, { fill: C('#D8C6A2'), lw: 6 * U, seed: 30 });
      tg.rrect(tx + tw * 0.36, sy + 20 * U, tw * 0.28, sh * 0.62, 3, { fill: C('#F4EEDC'), lw: 4 * U, seed: 31 });
      tg.line([[tx + tw * 0.5, sy + 60 * U], [tx + tw * 0.46, sy + 120 * U], [tx + tw * 0.54, sy + 170 * U]], { lw: 5 * U, seed: 32 });
      tg.rrect(tx, fy - 40 * U, tw, 40 * U, 2, { fill: C('#7A5A3E'), lw: 5 * U, seed: 33 });
      // 長押
      tg.rrect(-20, sy - 60 * U, L.W + 40, 22 * U, 2, { fill: C('#9A7652'), lw: 5 * U, seed: 34 });
      // 畳
      ground(tg, L, fy, C('#C9C27A'), 35, { gap: 7, angle: 0.02, color: 'rgba(90,90,30,.18)' });
      for (let k = -1; k < 4; k++) tg.line([[L.W * (0.15 + k * 0.32), fy], [L.W * (0.05 + k * 0.38), L.H]], { lw: 5 * U, seed: 36 + k, color: C('#5E6A3A') });
      tg.line([[0, fy + (L.H - fy) * 0.5], [L.W, fy + (L.H - fy) * 0.5]], { lw: 5 * U, seed: 41 });
    },

    yoshitsu(tg, L, s, t, C) {
      const U = L.U, fy = L.H * 0.7;
      wallFill(tg, L, C('#E6D3B3'), fy, 50);
      const c = tg.ctx; c.save(); c.globalAlpha = 0.25; for (let x = 0; x < L.W; x += 46 * U) tg.line([[x, 0], [x, fy]], { lw: 6 * U, seed: 51 + x, color: C('#C9A97E'), amp: 0.6 }); c.restore();
      windowFrame(tg, L, s.time, t, L.W * 0.1, fy - 470 * U, 300 * U, 300 * U, C, 52);
      // カーテン
      for (const sd of [0, 1]) tg.poly([[L.W * 0.1 - 30 * U + sd * 330 * U, fy - 500 * U], [L.W * 0.1 + 40 * U + sd * 260 * U, fy - 500 * U], [L.W * 0.1 + 20 * U + sd * 300 * U, fy - 120 * U], [L.W * 0.1 - 40 * U + sd * 340 * U, fy - 120 * U]], { fill: C('#9A3E4A'), lw: 4 * U, seed: 56 + sd, hatch: { gap: 12, angle: 1.5, color: 'rgba(60,0,10,.25)' } });
      // 暖炉か本棚
      const bx = L.W * 0.62;
      if (s.era === 'western' || s.era === 'fantasy') {
        tg.rrect(bx, fy - 300 * U, 280 * U, 300 * U, 4, { fill: C('#B8A48A'), lw: 5 * U, seed: 58, hatch: { gap: 14, angle: 0 } });
        tg.rrect(bx + 60 * U, fy - 180 * U, 160 * U, 180 * U, 30, { fill: '#2A1E1A', lw: 5 * U, seed: 59 });
        for (let k = 0; k < 3; k++) { const f = Math.sin(t * 7 + k * 2) * 8 * U; tg.poly([[bx + 90 * U + k * 40 * U, fy - 10 * U], [bx + 110 * U + k * 40 * U, fy - 90 * U - f], [bx + 130 * U + k * 40 * U, fy - 10 * U]], { fill: k % 2 ? '#F2B84B' : '#E0703E', lw: 3, seed: 60 + k }); }
        glow(tg, bx + 140 * U, fy - 60 * U, 260 * U, 'rgba(255,150,70,0.3)');
      } else {
        tg.rrect(bx, fy - 420 * U, 260 * U, 420 * U, 4, { fill: C('#7A5638'), lw: 5 * U, seed: 58 });
        for (let r = 0; r < 4; r++) {
          tg.line([[bx, fy - 420 * U + (r + 1) * 100 * U], [bx + 260 * U, fy - 420 * U + (r + 1) * 100 * U]], { lw: 4 * U, seed: 62 + r });
          for (let k = 0; k < 7; k++) tg.rrect(bx + 14 * U + k * 34 * U, fy - 410 * U + r * 100 * U + hash(r, k) * 20 * U, 26 * U, 88 * U - hash(r, k) * 20 * U, 2, { fill: C(['#B5485A', '#3F7A8A', '#C9A24B', '#5A6A3A'][(r + k) % 4]), lw: 2.5 * U, seed: 70 + r * 8 + k, second: false });
        }
      }
      ground(tg, L, fy, C('#9A6A44'), 90, { gap: 40, angle: 0, color: 'rgba(60,30,10,.25)' });
      // 絨毯
      tg.ellipse(L.W * 0.5, fy + (L.H - fy) * 0.55, L.W * 0.36, (L.H - fy) * 0.35, { fill: C('#8A3E3E'), lw: 5 * U, seed: 91, hatch: { gap: 10 } });
      if (s.time === 'night') { tg.line([[L.W * 0.42, 0], [L.W * 0.42, 90 * U]], { lw: 3, seed: 92 }); tg.ellipse(L.W * 0.42, 110 * U, 34 * U, 24 * U, { fill: '#FFD58A', lw: 3, seed: 93 }); glow(tg, L.W * 0.42, 120 * U, 380 * U, 'rgba(255,210,140,0.3)'); }
    },

    kitchen(tg, L, s, t, C) {
      const U = L.U, fy = L.H * 0.72;
      wallFill(tg, L, C(s.era === 'present' ? '#E8E4DA' : '#CDB898'), fy, 100);
      windowFrame(tg, L, s.time, t, L.W * 0.38, fy - 520 * U, 260 * U, 190 * U, C, 101);
      // 棚と鍋
      tg.rrect(L.W * 0.06, fy - 470 * U, 280 * U, 18 * U, 2, { fill: C('#8A6444'), lw: 4 * U, seed: 105 });
      for (let k = 0; k < 4; k++) tg.rrect(L.W * 0.06 + 20 * U + k * 64 * U, fy - 540 * U, 46 * U, 70 * U, 10, { fill: C(['#E8E2D0', '#6A8AA8', '#C97A4A', '#E8E2D0'][k]), lw: 3 * U, seed: 106 + k });
      if (s.era === 'present') {
        tg.rrect(-20, fy - 230 * U, L.W + 40, 230 * U, 4, { fill: C('#F2EEE6'), lw: 5 * U, seed: 110 });
        tg.rrect(-20, fy - 250 * U, L.W + 40, 24 * U, 2, { fill: C('#B8B4AC'), lw: 4 * U, seed: 111 });
        for (let k = 0; k < 5; k++) tg.rrect(L.W * (0.04 + k * 0.2), fy - 210 * U, L.W * 0.17, 180 * U, 6, { fill: C('#E2DCD0'), lw: 3.5 * U, seed: 112 + k, second: false });
        tg.line([[L.W * 0.55, fy - 250 * U], [L.W * 0.55, fy - 320 * U], [L.W * 0.6, fy - 320 * U]], { lw: 6 * U, seed: 118 });
      } else {
        // 竈
        const kx = L.W * 0.62;
        tg.rrect(kx, fy - 210 * U, 300 * U, 210 * U, 18, { fill: C('#B8A08A'), lw: 5 * U, seed: 110, hatch: { gap: 12 } });
        tg.ellipse(kx + 150 * U, fy - 60 * U, 46 * U, 40 * U, { fill: '#2A1E1A', lw: 4 * U, seed: 111 });
        glow(tg, kx + 150 * U, fy - 60 * U, 120 * U, 'rgba(255,140,60,0.4)');
        tg.ellipse(kx + 150 * U, fy - 230 * U, 90 * U, 34 * U, { fill: C('#3A3A3A'), lw: 4 * U, seed: 112 });
        for (let k = 0; k < 3; k++) { const ph = (t * 0.5 + k / 3) % 1; tg.line([[kx + 120 * U + k * 30 * U, fy - 270 * U - ph * 120 * U], [kx + 130 * U + k * 30 * U + Math.sin(t * 2 + k) * 14 * U, fy - 320 * U - ph * 120 * U]], { lw: 4 * U, seed: 113 + k, stroke: 'rgba(240,240,240,' + (0.7 * (1 - ph)).toFixed(2) + ')' }); }
      }
      ground(tg, L, fy, C(s.era === 'present' ? '#C8B89A' : '#8A7A66'), 120, { gap: 18, angle: -0.2 });
    },

    genkan(tg, L, s, t, C) {
      const U = L.U, vx = L.W * 0.5, vy = L.H * 0.48, fy = L.H * 0.9;
      wallFill(tg, L, C('#DCC8A6'), L.H, 130);
      // 奥へ続く廊下（一点透視）
      const dw = 150 * U, dh = 260 * U;
      tg.poly([[0, fy], [vx - dw, vy + dh / 2], [vx + dw, vy + dh / 2], [L.W, fy], [L.W, L.H], [0, L.H]], { fill: C('#A87A50'), lw: 5 * U, seed: 131, hatch: { gap: 30, angle: 0, color: 'rgba(60,30,10,.2)' } });
      for (let k = 1; k < 6; k++) { const f = k / 6; tg.line([[lerp(vx - dw, 0, f), lerp(vy + dh / 2, fy, f)], [lerp(vx + dw, L.W, f), lerp(vy + dh / 2, fy, f)]], { lw: 3 * U, seed: 132 + k, amp: 0.8 }); }
      tg.poly([[0, 0], [vx - dw, vy - dh / 2], [vx - dw, vy + dh / 2], [0, fy]], { fill: C('#CDB48E'), lw: 5 * U, seed: 140 });
      tg.poly([[L.W, 0], [vx + dw, vy - dh / 2], [vx + dw, vy + dh / 2], [L.W, fy]], { fill: C('#C4A983'), lw: 5 * U, seed: 141 });
      // 突き当たりの戸
      tg.rrect(vx - dw, vy - dh / 2, dw * 2, dh, 3, { fill: s.era === 'modern' ? '#F4EEDC' : C('#7A5638'), lw: 5 * U, seed: 142 });
      if (s.era === 'modern') { for (let k = 1; k < 4; k++) tg.line([[vx - dw + dw * 2 * k / 4, vy - dh / 2], [vx - dw + dw * 2 * k / 4, vy + dh / 2]], { lw: 2.5 * U, seed: 143 + k }); }
      else tg.ellipse(vx + dw * 0.6, vy, 8 * U, 8 * U, { fill: '#E8C66A', lw: 2, seed: 147 });
      // 横の戸
      for (const sd of [-1, 1]) { const x0 = sd < 0 ? L.W * 0.12 : L.W * 0.88; tg.poly([[x0, L.H * 0.2], [x0 + sd * -60 * U, L.H * 0.3], [x0 + sd * -60 * U, L.H * 0.72], [x0, L.H * 0.82]], { fill: C('#8A6444'), lw: 4 * U, seed: 148 + sd }); }
      // 上がり框
      tg.rrect(-20, fy - 10 * U, L.W + 40, 26 * U, 3, { fill: C('#6A4A32'), lw: 5 * U, seed: 150 });
      if (s.time === 'night') glow(tg, vx, vy - dh * 0.8, 300 * U, 'rgba(255,200,130,0.25)');
    },

    classroom(tg, L, s, t, C) {
      const U = L.U, fy = L.H * 0.72;
      wallFill(tg, L, C('#E4D8C0'), fy, 160);
      tg.rrect(L.W * 0.2, fy - 470 * U, L.W * 0.6, 250 * U, 6, { fill: C('#3E6A52'), lw: 8 * U, seed: 161 });
      tg.rrect(L.W * 0.2, fy - 220 * U, L.W * 0.6, 16 * U, 2, { fill: C('#8A6444'), lw: 4 * U, seed: 162 });
      tg.line([[L.W * 0.27, fy - 400 * U], [L.W * 0.42, fy - 410 * U]], { lw: 4 * U, seed: 163, stroke: 'rgba(255,255,255,.75)' });
      tg.line([[L.W * 0.27, fy - 350 * U], [L.W * 0.5, fy - 345 * U]], { lw: 4 * U, seed: 164, stroke: 'rgba(255,255,255,.75)' });
      tg.text(s.era === 'present' ? '自習' : '修身', L.W * 0.66, fy - 300 * U, { size: 54 * U, color: 'rgba(255,255,255,.85)', stroke: null, strokeW: 0, weight: 700, boilAmp: 0.5 });
      // 窓（左）
      for (let k = 0; k < 2; k++) windowFrame(tg, L, s.time, t, L.W * 0.02 + k * 0 , fy - 520 * U + k * 0, L.W * 0.14, 220 * U, C, 165 + k * 5);
      ground(tg, L, fy, C('#A8845E'), 180, { gap: 34, angle: 0, color: 'rgba(60,30,10,.2)' });
      // 机
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
        const w = (170 + r * 40) * U, x = L.W * (0.1 + k * 0.24) - w / 2 + r * 40 * U, y = fy + 30 * U + r * 90 * U;
        tg.rrect(x, y, w, 24 * U, 3, { fill: C('#B88A5A'), lw: 4 * U, seed: 190 + r * 5 + k });
        tg.line([[x + 14 * U, y + 24 * U], [x + 14 * U, y + 80 * U]], { lw: 5 * U, seed: 200 + r * 5 + k });
        tg.line([[x + w - 14 * U, y + 24 * U], [x + w - 14 * U, y + 80 * U]], { lw: 5 * U, seed: 210 + r * 5 + k });
      }
    },

    shop(tg, L, s, t, C) {
      const U = L.U, fy = L.H * 0.74;
      wallFill(tg, L, C('#C9A983'), fy, 230);
      // 棚と瓶
      for (let r = 0; r < 3; r++) {
        const y = fy - 520 * U + r * 120 * U;
        tg.rrect(L.W * 0.05, y, L.W * 0.9, 14 * U, 2, { fill: C('#6A4A32'), lw: 4 * U, seed: 231 + r });
        for (let k = 0; k < 11; k++) { if (hash(r, k, 3) < 0.25) continue; const x = L.W * (0.08 + k * 0.08), hh = (50 + hash(r, k) * 40) * U; tg.rrect(x, y - hh, 30 * U, hh, 8, { fill: C(['#5A8A6A', '#B5485A', '#C9A24B', '#6A7AA8', '#E8E2D0'][(r * 3 + k) % 5]), lw: 2.5 * U, seed: 240 + r * 12 + k, second: false }); }
      }
      // 吊り下げの灯り
      for (let k = 0; k < 3; k++) { const x = L.W * (0.22 + k * 0.28), sw = Math.sin(t * 1.3 + k) * 6 * U; tg.line([[x, 0], [x + sw, 70 * U]], { lw: 3, seed: 280 + k }); tg.poly([[x + sw - 36 * U, 110 * U], [x + sw, 66 * U], [x + sw + 36 * U, 110 * U]], { fill: C('#3A3A3A'), lw: 3, seed: 284 + k }); glow(tg, x + sw, 120 * U, 220 * U, s.time === 'night' || s.time === 'evening' ? 'rgba(255,200,120,0.35)' : 'rgba(255,220,160,0.18)'); }
      ground(tg, L, fy, C('#7A5A40'), 290, { gap: 20, angle: -0.2 });
      // カウンター
      tg.rrect(L.W * 0.48, fy - 150 * U, L.W * 0.6, 240 * U, 6, { fill: C('#8A5A36'), lw: 6 * U, seed: 291, hatch: { gap: 18, angle: 1.5, color: 'rgba(40,20,0,.25)' } });
      tg.rrect(L.W * 0.46, fy - 168 * U, L.W * 0.62, 26 * U, 4, { fill: C('#A87048'), lw: 5 * U, seed: 292 });
      tg.rrect(L.W * 0.62, fy - 230 * U, 52 * U, 62 * U, 10, { fill: '#F4EEDC', lw: 3.5 * U, seed: 293 });
      for (let k = 0; k < 2; k++) { const ph = (t * 0.6 + k / 2) % 1; tg.line([[L.W * 0.62 + 20 * U + k * 14 * U, fy - 240 * U - ph * 60 * U], [L.W * 0.62 + 26 * U + k * 14 * U + Math.sin(t * 3 + k) * 8 * U, fy - 270 * U - ph * 60 * U]], { lw: 3 * U, seed: 294 + k, stroke: 'rgba(120,100,90,' + (0.7 * (1 - ph)).toFixed(2) + ')' }); }
    },

    station(tg, L, s, t, C) {
      const U = L.U, py = L.H * 0.72;
      skyBox(tg, L, s.time, t, 0, 0, L.W, py, { clouds: 2 });
      // 遠くの町並み
      for (let k = 0; k < 9; k++) tg.rrect(k * L.W / 8 - 30 * U, py - 120 * U - hash(k, 5) * 90 * U, L.W / 8 - 10 * U, 300 * U, 2, { fill: C('#8A90A0'), lw: 3 * U, seed: 300 + k, second: false });
      // 線路
      tg.rrect(-20, py - 40 * U, L.W + 40, 60 * U, 0, { fill: C('#6A6058'), lw: 4 * U, seed: 310, hatch: { gap: 22, angle: 1.57, color: 'rgba(0,0,0,.25)' } });
      tg.line([[0, py - 30 * U], [L.W, py - 30 * U]], { lw: 5 * U, seed: 311, stroke: C('#B8B8C0') });
      tg.line([[0, py - 2 * U], [L.W, py - 2 * U]], { lw: 5 * U, seed: 312, stroke: C('#B8B8C0') });
      // 屋根と柱
      tg.poly([[-20, 0], [L.W + 20, 0], [L.W + 20, 70 * U], [-20, 110 * U]], { fill: C(s.era === 'present' ? '#9AA4B0' : '#6A5A4A'), lw: 5 * U, seed: 313, hatch: { gap: 14, angle: 0.1 } });
      for (let k = 0; k < 4; k++) tg.rrect(L.W * (0.08 + k * 0.3), 80 * U, 22 * U, py + 30 * U, 3, { fill: C('#5A4A3E'), lw: 4 * U, seed: 315 + k });
      // 駅名標
      tg.rrect(L.W * 0.4, py - 260 * U, 240 * U, 70 * U, 6, { fill: '#F8F4EA', lw: 4 * U, seed: 320 });
      tg.text(s.era === 'present' ? 'えき' : 'ていしやば', L.W * 0.4 + 120 * U, py - 212 * U, { size: 30 * U, color: C('#2A2320'), stroke: null, strokeW: 0, weight: 700, boilAmp: 0.4 });
      // ホーム
      tg.rrect(-20, py + 20 * U, L.W + 40, L.H - py, 0, { fill: C('#B8AE9E'), lw: 5 * U, seed: 321, hatch: { gap: 30, angle: 0, color: 'rgba(0,0,0,.08)' } });
      tg.rrect(-20, py + 20 * U, L.W + 40, 16 * U, 0, { fill: C('#E8D86A'), lw: 3 * U, seed: 322 });
      if (s.time === 'night' || s.time === 'evening') for (let k = 0; k < 3; k++) glow(tg, L.W * (0.15 + k * 0.3), 120 * U, 260 * U, 'rgba(255,220,150,0.3)');
    },

    street(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.74;
      skyBox(tg, L, s.time, t, 0, 0, L.W, gy, { clouds: 3 });
      let x = -40 * U, k = 0;
      while (x < L.W) { const w = (180 + hash(k, 2) * 120) * U, top = gy - (260 + hash(k, 3) * (s.era === 'present' ? 260 : 120)) * U; building(tg, L, x, w, top, gy, s.era, C, s.time, 340 + k * 20); x += w + 14 * U; k++; }
      ground(tg, L, gy, C(s.era === 'present' ? '#8A8E94' : '#B8A486'), 500, { gap: 24, angle: -0.15 });
      // 電柱・街灯
      for (let i = 0; i < 2; i++) {
        const px = L.W * (0.18 + i * 0.6);
        tg.rrect(px - 8 * U, gy - 380 * U, 16 * U, 400 * U, 3, { fill: C('#5A4A3E'), lw: 3.5 * U, seed: 510 + i });
        if (s.era === 'present') { tg.line([[px - 50 * U, gy - 350 * U], [px + 50 * U, gy - 350 * U]], { lw: 4 * U, seed: 514 + i }); tg.line([[px, gy - 350 * U], [px + L.W * 0.6, gy - 330 * U]], { lw: 2 * U, seed: 518 + i, amp: 1 }); }
        else { tg.rrect(px - 26 * U, gy - 420 * U, 52 * U, 52 * U, 6, { fill: s.time === 'night' || s.time === 'evening' ? '#FFD58A' : C('#E8E2D0'), lw: 3.5 * U, seed: 520 + i }); if (s.time === 'night' || s.time === 'evening') glow(tg, px, gy - 394 * U, 240 * U, 'rgba(255,210,130,0.35)'); }
      }
    },

    alley(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.8;
      skyBox(tg, L, s.time, t, L.W * 0.3, 0, L.W * 0.4, gy, { clouds: 1 });
      // 両側に迫る壁
      building(tg, L, -60 * U, L.W * 0.36 + 60 * U, -40, gy, s.era, C, s.time, 600);
      building(tg, L, L.W * 0.64, L.W * 0.36 + 60 * U, -40, gy, s.era, C, s.time, 640);
      // 奥の壁
      tg.rrect(L.W * 0.36, gy - 340 * U, L.W * 0.28, 340 * U, 3, { fill: C('#7A6A5A'), lw: 4 * U, seed: 680, hatch: { gap: 12 } });
      lantern(tg, L, L.W * 0.36 + 30 * U, gy - 420 * U, U, C, s.time, 690);
      // 鉢植え・配管
      tg.line([[L.W * 0.64 - 10 * U, 0], [L.W * 0.64 - 10 * U, gy]], { lw: 8 * U, seed: 693, stroke: C('#5A5A5E') });
      for (let k = 0; k < 3; k++) { const x = L.W * (0.38 + k * 0.08); tg.rrect(x, gy - 50 * U, 50 * U, 50 * U, 6, { fill: C('#B86A44'), lw: 3.5 * U, seed: 700 + k }); tg.ellipse(x + 25 * U, gy - 70 * U, 40 * U, 30 * U, { fill: C('#4E8A50'), lw: 3.5 * U, seed: 705 + k }); }
      ground(tg, L, gy, C('#8A8070'), 710, { gap: 16, angle: -0.6 });
    },

    garden(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.66;
      skyBox(tg, L, s.time, t, 0, 0, L.W, gy, { clouds: 3 });
      tree(tg, L, L.W * 0.82, gy + 20 * U, 1.5 * U, C, t, 720, s.era === 'modern' ? 'pine' : 'round');
      tree(tg, L, L.W * 0.12, gy + 10 * U, 1.1 * U, C, t, 730);
      // 垣根
      for (let x = -10; x < L.W + 20; x += 34 * U) tg.line([[x, gy - 110 * U], [x, gy + 4 * U]], { lw: 6 * U, seed: 740 + Math.round(x), stroke: C('#9A7A4A') });
      tg.line([[0, gy - 80 * U], [L.W, gy - 84 * U]], { lw: 6 * U, seed: 741, stroke: C('#7A5A32') });
      tg.line([[0, gy - 30 * U], [L.W, gy - 26 * U]], { lw: 6 * U, seed: 742, stroke: C('#7A5A32') });
      ground(tg, L, gy, C('#7DB060'), 743, { gap: 12, angle: -0.3 });
      // 池・石灯籠・植え込み
      tg.ellipse(L.W * 0.3, gy + (L.H - gy) * 0.55, L.W * 0.18, 50 * U, { fill: C('#6AA8C8'), lw: 5 * U, seed: 744 });
      tg.line([[L.W * 0.24, gy + (L.H - gy) * 0.55], [L.W * 0.3 + Math.sin(t) * 10 * U, gy + (L.H - gy) * 0.55 - 4 * U]], { lw: 3 * U, seed: 745, stroke: 'rgba(255,255,255,.6)' });
      if (s.era === 'modern' || s.era === 'present') {
        const lx = L.W * 0.62, ly = gy + 70 * U;
        tg.rrect(lx - 14 * U, ly - 70 * U, 28 * U, 70 * U, 3, { fill: C('#A8A49A'), lw: 4 * U, seed: 746 });
        tg.rrect(lx - 32 * U, ly - 120 * U, 64 * U, 50 * U, 6, { fill: s.time === 'night' ? '#FFD58A' : C('#B8B4AA'), lw: 4 * U, seed: 747 });
        tg.poly([[lx - 50 * U, ly - 118 * U], [lx, ly - 160 * U], [lx + 50 * U, ly - 118 * U]], { fill: C('#9A968C'), lw: 4 * U, seed: 748 });
      } else {
        for (let k = 0; k < 5; k++) tg.ellipse(L.W * (0.55 + k * 0.08), gy + 40 * U, 22 * U, 22 * U, { fill: C(['#E8718D', '#F2B84B', '#F4EEDC'][k % 3]), lw: 3 * U, seed: 750 + k });
      }
      for (let k = 0; k < 3; k++) tg.ellipse(L.W * (0.05 + k * 0.35), gy + 6 * U, 80 * U, 40 * U, { fill: C('#4E8A50'), lw: 4 * U, seed: 760 + k, hatch: { gap: 9 } });
    },

    field(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.56;
      skyBox(tg, L, s.time, t, 0, 0, L.W, gy, { clouds: 4 });
      tg.poly([[-40, gy], [L.W * 0.2, gy - 140 * U], [L.W * 0.45, gy - 40 * U], [L.W * 0.7, gy - 180 * U], [L.W + 40, gy - 30 * U], [L.W + 40, gy + 10], [-40, gy + 10]], { fill: C('#7A8EA8'), lw: 4 * U, seed: 770, hatch: { gap: 14, color: 'rgba(0,0,0,.08)' } });
      ground(tg, L, gy, C('#9CC46A'), 771, { gap: 16, angle: -0.1 });
      // 畑の畝（遠近）
      for (let k = 0; k < 8; k++) { const y = gy + (L.H - gy) * Math.pow(k / 8, 1.6); tg.line([[-20, y], [L.W + 20, y + 6 * U]], { lw: (2 + k * 0.6) * U, seed: 772 + k, stroke: C('#6A8A3E') }); }
      // 揺れる草
      for (let k = 0; k < 16; k++) { const x = hash(k, 1) * L.W, y = L.H - hash(k, 2) * (L.H - gy) * 0.4, sw = Math.sin(t * 2 + k) * 8 * U; tg.line([[x, y], [x + sw, y - 40 * U]], { lw: 3 * U, seed: 790 + k, stroke: C('#4E7A30') }); }
      tg.line([[L.W * 0.55, L.H], [L.W * 0.5, gy]], { lw: 30 * U, seed: 810, stroke: C('#C8B080') });
    },

    forest(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.76;
      skyBox(tg, L, s.time, t, 0, 0, L.W, gy, { clouds: 1 });
      const c = tg.ctx; c.save(); c.globalAlpha = 0.9;
      tg.rrect(-20, -20, L.W + 40, gy * 0.6, 40, { fill: C('#3E6A44'), lw: 4 * U, seed: 820, hatch: { gap: 12, color: 'rgba(0,0,0,.15)' } }); c.restore();
      for (let k = 0; k < 7; k++) tg.ellipse(hash(k, 4) * L.W, gy * (0.15 + hash(k, 5) * 0.4), (120 + hash(k, 6) * 100) * U, (80 + hash(k, 7) * 60) * U, { fill: C(['#4E8A50', '#3F7A4A', '#5A9A58'][k % 3]), lw: 4 * U, seed: 822 + k, hatch: { gap: 10 } });
      ground(tg, L, gy, C('#6A8A44'), 840, { gap: 14, angle: -0.3 });
      tg.poly([[L.W * 0.4, L.H], [L.W * 0.47, gy], [L.W * 0.53, gy], [L.W * 0.7, L.H]], { fill: C('#B89A6A'), lw: 4 * U, seed: 841 });
      // 幹（奥ほど細く薄く）
      for (let k = 0; k < 9; k++) {
        const far = k < 4, x = L.W * (far ? 0.15 + k * 0.22 : (k - 4) * 0.25 - 0.02) + hash(k, 8) * 40 * U, w = (far ? 22 : 48) * U;
        tg.rrect(x, -20, w, gy + (far ? -10 * U : 40 * U), 6, { fill: C(far ? '#7A6A52' : '#5A4232'), lw: 4 * U, seed: 850 + k, hatch: far ? undefined : { gap: 10, angle: 1.5 } });
      }
      if (s.time !== 'night') { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.12 + 0.04 * Math.sin(t); c.fillStyle = '#FFF2C0'; c.beginPath(); c.moveTo(L.W * 0.55, 0); c.lineTo(L.W * 0.65, 0); c.lineTo(L.W * 0.5, gy); c.lineTo(L.W * 0.35, gy); c.fill(); c.restore(); }
    },

    river(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.5;
      skyBox(tg, L, s.time, t, 0, 0, L.W, gy, { clouds: 3 });
      ground(tg, L, gy - 10 * U, C('#8AB868'), 870, { gap: 14 });
      // 川
      const wy0 = gy + 50 * U, wy1 = L.H * 0.8;
      tg.poly([[-20, wy0], [L.W + 20, wy0 - 20 * U], [L.W + 20, wy1], [-20, wy1 + 30 * U]], { fill: C('#5E9EC8'), lw: 5 * U, seed: 871 });
      for (let k = 0; k < 10; k++) { const y = lerp(wy0, wy1, (k + 0.5) / 10), x = ((hash(k, 3) * L.W + t * (30 + k * 6) * U) % (L.W + 200)) - 100; tg.line([[x, y], [x + 60 * U, y - 2 * U]], { lw: 3 * U, seed: 872 + k, stroke: 'rgba(255,255,255,.65)' }); }
      // 遠くの橋
      const bx = L.W * 0.62, by = wy0 - 10 * U;
      tg.line([[bx - 220 * U, by], [bx, by - 60 * U], [bx + 220 * U, by]], { lw: 12 * U, seed: 885, stroke: C('#8A5A3A') });
      for (let k = -2; k <= 2; k++) tg.line([[bx + k * 80 * U, by - 60 * U * (1 - Math.abs(k) / 3) ], [bx + k * 80 * U, by + 40 * U]], { lw: 6 * U, seed: 886 + k, stroke: C('#6A4A32') });
      // 柳
      const wx = L.W * 0.12;
      tg.rrect(wx - 12 * U, gy - 240 * U, 24 * U, 260 * U, 6, { fill: C('#6A5A44'), lw: 4 * U, seed: 892 });
      for (let k = 0; k < 9; k++) { const a = (k - 4) * 22 * U, sw = Math.sin(t * 1.4 + k * 0.6) * 12 * U; tg.line([[wx + a * 0.3, gy - 240 * U], [wx + a, gy - 190 * U], [wx + a * 1.2 + sw, gy - 40 * U]], { lw: 4 * U, seed: 893 + k, stroke: C('#5A9A4A') }); }
      ground(tg, L, wy1 + 10 * U, C('#9AC070'), 905, { gap: 14 });
    },

    seaside(tg, L, s, t, C) {
      const U = L.U, hz = L.H * 0.48;
      skyBox(tg, L, s.time, t, 0, 0, L.W, hz, { clouds: 3 });
      const sea = s.time === 'night' ? '#1E2A5A' : s.time === 'evening' ? '#C87A6A' : '#3E8EC8';
      tg.rrect(-20, hz, L.W + 40, L.H * 0.3, 0, { fill: sea, lw: 4 * U, seed: 910 });
      if (s.time === 'evening' || s.time === 'night') { const c = tg.ctx; c.save(); c.globalAlpha = 0.5; for (let k = 0; k < 6; k++) tg.line([[L.W * 0.7 - (30 + k * 12) * U, hz + 14 * U + k * 18 * U], [L.W * 0.7 + (30 + k * 12) * U, hz + 14 * U + k * 18 * U]], { lw: 4 * U, seed: 911 + k, stroke: s.time === 'night' ? '#F6EBC0' : '#FFD08A' }); c.restore(); }
      for (let k = 0; k < 12; k++) { const y = hz + 20 * U + (k % 6) * 30 * U, x = ((hash(k, 2) * L.W + t * 20 * U * (1 + (k % 3))) % (L.W + 200)) - 100; tg.line([[x, y], [x + 30 * U, y - 8 * U], [x + 60 * U, y]], { lw: 3 * U, seed: 920 + k, stroke: 'rgba(255,255,255,.7)' }); }
      // 砂浜と打ち寄せる波
      const sy = L.H * 0.74, wv = Math.sin(t * 0.9) * 14 * U;
      ground(tg, L, sy, C('#E8D2A0'), 940, { gap: 16, angle: -0.1, color: 'rgba(120,90,40,.12)' });
      const pts = []; for (let k = 0; k <= 12; k++) pts.push([k * L.W / 12, sy + wv + Math.sin(k * 1.3 + t * 1.5) * 8 * U]);
      tg.line(pts, { lw: 5 * U, seed: 941, stroke: '#FFFFFF' });
      if (s.time !== 'night') for (let k = 0; k < 2; k++) { const x = ((t * 30 + k * 400) % (L.W + 200)) - 100, y = hz * (0.45 + 0.1 * k) + Math.sin(t * 2 + k) * 10 * U; tg.line([[x - 18 * U, y], [x, y + 8 * U], [x + 18 * U, y]], { lw: 3 * U, seed: 950 + k }); }
    },

    nightsky(tg, L, s, t, C) {
      const U = L.U, gy = L.H * 0.78, c = tg.ctx;
      const g = c.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, '#060A24'); g.addColorStop(1, s.time === 'evening' ? '#5A4A7A' : '#2A3270'); c.fillStyle = g; c.fillRect(0, 0, L.W, gy);
      // 天の川
      c.save(); c.globalAlpha = 0.25; c.translate(L.W * 0.5, gy * 0.5); c.rotate(-0.5); const mw = c.createLinearGradient(0, -80 * U, 0, 80 * U); mw.addColorStop(0, 'rgba(200,200,255,0)'); mw.addColorStop(0.5, 'rgba(220,220,255,0.9)'); mw.addColorStop(1, 'rgba(200,200,255,0)'); c.fillStyle = mw; c.fillRect(-L.W, -80 * U, L.W * 2, 160 * U); c.restore();
      for (let k = 0; k < 60; k++) { const tw = 0.5 + 0.5 * Math.sin(t * 2.4 + k * 2.1); const x = hash(k, 11) * L.W, y = hash(k, 12) * gy * 0.92; if (k < 14) tg.star(x, y, (4 + hash(k, 13) * 5) * U * (0.6 + 0.4 * tw), { fill: '#FFF6D0', lw: 1.5, seed: 960 + k, amp: 0.3, second: false }); else { c.fillStyle = `rgba(255,250,230,${0.4 + 0.6 * tw})`; c.fillRect(x, y, 2.4 * U, 2.4 * U); } }
      tg.ellipse(L.W * 0.2, gy * 0.25, 46 * U, 46 * U, { fill: '#F6EBC0', lw: 3, seed: 1030 });
      glow(tg, L.W * 0.2, gy * 0.25, 200 * U, 'rgba(246,235,192,0.25)');
      // 流れ星（8秒に一度）
      const ph = (t % 8) / 8; if (ph < 0.12) { const k = ph / 0.12, x = L.W * (0.9 - k * 0.5), y = gy * (0.1 + k * 0.25); tg.line([[x, y], [x + 90 * U, y - 45 * U]], { lw: 3 * U, seed: 1031, stroke: `rgba(255,255,230,${1 - k})` }); }
      tg.poly([[-40, gy + 20 * U], [L.W * 0.3, gy - 80 * U], [L.W * 0.65, gy - 30 * U], [L.W + 40, gy - 110 * U], [L.W + 40, L.H + 40], [-40, L.H + 40]], { fill: C('#1E2A3A'), lw: 5 * U, seed: 1032, hatch: { gap: 14, color: 'rgba(255,255,255,.04)' } });
    },
  };
  BG.unknown = BG.none;
  const OUTDOOR_SKY = new Set(['station', 'street', 'alley', 'garden', 'field', 'forest', 'river', 'seaside', 'nightsky']);

  function background(tg, L, s, t) {
    const time = s.location === 'nightsky' && s.time !== 'evening' ? 'night' : (s.time || 'day');
    const sc = Object.assign({}, s, { time, era: s.era || 'modern' });
    const C = shader(time, OUTDOOR_SKY.has(s.location) ? 0.85 : 1);
    (BG[s.location] || BG.none)(tg, L, sc, t, C);
    // 夜と夕方は全体に光を当てる（窓の明かり・月明かりの方向）
    if (time === 'night' && s.location !== 'nightsky') tg.light(L.W * 0.3, L.H * 0.2, [[0, '#FFFFFF'], [0.5, '#C9CCEE'], [1, '#6A6C98']]);
    if (time === 'evening') tg.light(L.W * 0.8, L.H * 0.3, [[0, '#FFFFFF'], [1, '#EAB9A0']]);
  }

  /* ================= 人物 ================= */
  // 服装：時代 × 人物の種類。slot（主人物 0・相手 1・群衆 2〜）で色を変える
  const pick = (arr, slot) => arr[slot % arr.length];
  const COSTUME = {
    modern: {
      man: (k) => ({ kind: 'robe', top: pick(['#3E4A5E', '#5A4A3E', '#4A5A4A'], k), accent: pick(['#8A7A5A', '#3A3030'], k), hair: 'short' }),
      woman: (k) => ({ kind: 'robe', top: pick(['#B5485A', '#4E6E9A', '#7A5A9A'], k), accent: pick(['#E8C66A', '#F2E6D0'], k), hair: 'bun', pattern: true }),
      boy: () => ({ kind: 'uniform', top: '#2E3240', bottom: '#2E3240', hair: 'short', hat: 'cap' }),
      girl: (k) => ({ kind: 'robe', top: pick(['#E58A8A', '#E5B85A', '#8AB8E5'], k), accent: '#C0392B', hair: 'bob', ribbon: '#D04A4A', pattern: true }),
      oldman: () => ({ kind: 'robe', top: '#6E6458', accent: '#4A4038', hair: 'bald', cane: true }),
      oldwoman: () => ({ kind: 'robe', top: '#6E5E72', accent: '#4A3E48', hair: 'bun', grey: true }),
      unknown: (k) => ({ kind: 'robe', top: pick(['#6A7078', '#7A6A5A'], k), accent: '#4A4A4A', hair: 'short' }),
    },
    present: {
      man: (k) => ({ kind: 'shirt', top: pick(['#5B7FA6', '#E8E2D6', '#6A8A5A'], k), bottom: '#3B4252', hair: 'short', tie: k % 2 === 0 }),
      woman: (k) => ({ kind: 'dress', top: pick(['#F2E6D8', '#E8C8C0', '#D8E2EE'], k), bottom: pick(['#8C5A7A', '#5A7A8C', '#C9A24B'], k), length: 'knee', hair: 'long' }),
      boy: (k) => ({ kind: 'shorts', top: pick(['#E07A4A', '#4AA07A'], k), bottom: '#3B5A8C', hair: 'spiky' }),
      girl: (k) => ({ kind: 'dress', top: pick(['#F5B5C5', '#B5D5F5'], k), bottom: pick(['#F5B5C5', '#B5D5F5'], k), length: 'knee', hair: 'pigtails', ribbon: '#E8505A' }),
      oldman: () => ({ kind: 'shirt', top: '#8A7A5E', bottom: '#5A5A5A', hair: 'bald', glasses: true }),
      oldwoman: () => ({ kind: 'dress', top: '#9A8AA8', bottom: '#6A5A70', length: 'ankle', hair: 'bun', grey: true, glasses: true }),
      unknown: (k) => ({ kind: 'shirt', top: pick(['#8A9099', '#A8907A'], k), bottom: '#4A4E58', hair: 'short' }),
    },
    western: {
      man: (k) => ({ kind: 'coat', top: pick(['#2E3A4A', '#4A3A2E'], k), bottom: '#4A4038', hair: 'short', hat: k % 2 ? null : 'top', tie: true }),
      woman: (k) => ({ kind: 'dress', top: pick(['#A84A5A', '#4A6A8A', '#6A8A5A'], k), bottom: pick(['#A84A5A', '#4A6A8A', '#6A8A5A'], k), length: 'gown', hair: 'long' }),
      boy: () => ({ kind: 'shorts', top: '#5A6A3A', bottom: '#4A4038', hair: 'short', tie: true }),
      girl: (k) => ({ kind: 'dress', top: pick(['#6A9AD0', '#E8A0B0'], k), bottom: pick(['#6A9AD0', '#E8A0B0'], k), length: 'knee', hair: 'long', ribbon: '#F4EEDC' }),
      oldman: () => ({ kind: 'coat', top: '#4A4A4A', bottom: '#3A3A3A', hair: 'bald', beard: 'short', cane: true }),
      oldwoman: () => ({ kind: 'dress', top: '#5A4A5A', bottom: '#5A4A5A', length: 'gown', hair: 'bun', grey: true }),
      unknown: () => ({ kind: 'coat', top: '#5A5A62', bottom: '#3A3A42', hair: 'short' }),
    },
    fantasy: {
      man: (k) => ({ kind: 'tunic', top: pick(['#5A7A4A', '#4A5A8A'], k), bottom: '#5A4A3A', cloak: pick(['#8A3A3A', '#3A5A3A'], k), hair: 'short' }),
      woman: (k) => ({ kind: 'dress', top: pick(['#6A5AA8', '#3A8A8A'], k), bottom: pick(['#6A5AA8', '#3A8A8A'], k), length: 'gown', hair: 'long', cloak: '#E8E2D0' }),
      boy: (k) => ({ kind: 'tunic', top: pick(['#A8743A', '#3A7AA8'], k), bottom: '#5A4A3A', hair: 'spiky' }),
      girl: (k) => ({ kind: 'dress', top: pick(['#D07AA0', '#7AB0D0'], k), bottom: pick(['#D07AA0', '#7AB0D0'], k), length: 'knee', hair: 'pigtails', ribbon: '#F2D06A' }),
      oldman: () => ({ kind: 'robe', top: '#3A4A8A', accent: '#C9A24B', hair: 'bald', beard: 'long', hat: 'wizard', cane: true }),
      oldwoman: () => ({ kind: 'robe', top: '#5A3A6A', accent: '#C9A24B', hair: 'bun', grey: true, cloak: '#3A2A4A' }),
      unknown: () => ({ kind: 'tunic', top: '#6A6A5A', bottom: '#4A4A3A', cloak: '#4A4A52', hair: 'short' }),
    },
  };
  const HAIR = { jp: ['#2A2320', '#3B2A22', '#2E2626'], west: ['#6B4A2E', '#D9B266', '#9A4A2A', '#3B2A22'] };
  const SKIN = ['#F7D7BE', '#F2CBA9', '#EFC4A0'];

  function costume(type, era, slot) {
    const table = COSTUME[era] || COSTUME.modern, fn = table[type] || table.unknown;
    const c = Object.assign({ skin: pick(SKIN, slot), shoes: '#4A3A32' }, fn(slot));
    c.hairColor = c.grey || type === 'oldman' ? '#D9D6CF' : pick(era === 'western' || era === 'fantasy' ? HAIR.west : HAIR.jp, slot + (type === 'woman' ? 1 : 0));
    return c;
  }

  // 体の寸法（h＝身長。顔は大きめ・目は低めにして柔らかい印象に）
  function dims(type, h) {
    const child = type === 'boy' || type === 'girl', old = type === 'oldman' || type === 'oldwoman';
    const r = h * (child ? 0.15 : 0.122);
    const hy = -h + r * 1.02;
    const neck = hy + r * 0.98;
    const shY = neck + h * 0.035;
    const hipY = -h * (child ? 0.43 : 0.47);
    const narrow = type === 'woman' || type === 'oldwoman' || type === 'girl';
    const sw = h * (child ? 0.085 : narrow ? 0.085 : 0.1);
    return { r, hy, neck, shY, hipY, sw, child, old, limb: h * (child ? 0.05 : 0.044) };
  }

  // 姿勢 → 関節の位置（右向き＝+x が前。左右反転は呼ぶ側で）
  function joints(pose, d, h, t, seed, seat) {
    const ph = t + seed * 1.37;
    const J = { dy: Math.sin(ph * 1.6) * 0.004 * h, rot: 0, mouth: 0, legs: true };
    let hipY = d.hipY;
    const leg = (x0, x1, y1) => ({ hip: [x0, hipY], knee: [lerp(x0, x1, 0.5), lerp(hipY, y1, 0.5)], foot: [x1, y1] });
    J.legL = leg(-0.045 * h, -0.05 * h, 0); J.legR = leg(0.045 * h, 0.05 * h, 0);
    const arm = (sd, ex, ey, hx, hy) => ({ sh: [sd * d.sw, d.shY], el: [ex, ey], hand: [hx, hy] });
    J.armL = arm(-1, -d.sw - 0.015 * h, lerp(d.shY, hipY, 0.5), -d.sw - 0.022 * h, hipY + 0.02 * h);
    J.armR = arm(1, d.sw + 0.015 * h, lerp(d.shY, hipY, 0.5), d.sw + 0.022 * h, hipY + 0.02 * h);
    if (pose === 'walk') {
      const w = ph * 5.5, s = Math.sin(w);
      J.dy = -Math.abs(Math.sin(w)) * 0.014 * h;
      J.legL = leg(-0.04 * h, -0.04 * h + s * 0.07 * h, -Math.max(0, Math.cos(w)) * 0.03 * h);
      J.legR = leg(0.04 * h, 0.04 * h - s * 0.07 * h, -Math.max(0, -Math.cos(w)) * 0.03 * h);
      J.legL.knee[0] += 0.02 * h; J.legR.knee[0] += 0.02 * h;
      J.armL.hand[0] -= s * 0.05 * h; J.armL.el[0] -= s * 0.025 * h;
      J.armR.hand[0] += s * 0.05 * h; J.armR.el[0] += s * 0.025 * h;
      J.rot = 0.03;
    } else if (pose === 'talk') {
      J.armR.el = [d.sw + 0.07 * h, d.shY + 0.11 * h];
      J.armR.hand = [d.sw + 0.12 * h, d.shY + 0.03 * h + Math.sin(ph * 3.2) * 0.018 * h];
      J.mouth = Math.sin(ph * 9) > 0.1 ? 1 : 0;
    } else if (pose === 'sit') {
      if (seat === 'seiza') {
        const drop = -0.12 * h - hipY; J.drop = drop; hipY += drop; J.legs = false; J.seiza = true;
        J.armL.hand = [-d.sw * 0.4, hipY + 0.02 * h + -drop]; J.armR.hand = [d.sw * 0.5, hipY + 0.02 * h + -drop];
      } else {
        const sy = -0.27 * h, drop = sy - hipY; J.drop = drop; hipY = sy; J.chair = true;
        J.legL = { hip: [-0.04 * h, sy], knee: [0.09 * h, sy - 0.005 * h], foot: [0.1 * h, 0] };
        J.legR = { hip: [0.045 * h, sy], knee: [0.15 * h, sy], foot: [0.16 * h, 0] };
        J.armL.hand = [0.06 * h, sy - 0.02 * h - drop]; J.armR.hand = [0.12 * h, sy - 0.02 * h - drop];
        J.armL.el = [-d.sw * 0.6, lerp(d.shY, d.hipY, 0.6)]; J.armR.el = [d.sw * 1.1, lerp(d.shY, d.hipY, 0.6)];
      }
    }
    return J;
  }

  function person(tg, L, o, t) {
    const c = tg.ctx, h = o.h, type = o.type || 'unknown', d = dims(type, h), cos = costume(type, o.era || 'modern', o.slot || 0);
    const S = o.shade || ((x) => x);
    const lw = Math.max(2, h * 0.007), seed = 2000 + (o.slot || 0) * 300;
    const pose = o.pose || 'stand';
    const J = joints(pose, d, h, t, o.slot || 0, o.seat);
    c.save();
    if (o.alpha != null) c.globalAlpha *= o.alpha;
    c.translate(o.x, o.y);
    // 影
    c.save(); c.fillStyle = 'rgba(20,10,20,.18)'; c.beginPath(); c.ellipse(0, 0, h * 0.13, h * 0.018, 0, 0, Math.PI * 2); c.fill(); c.restore();
    c.scale(o.facing || 1, 1);
    // 横たわる：足を右、頭を左にして床に寝かせる
    if (pose === 'lie') { c.translate(h * 0.5, -h * 0.085); c.rotate(-Math.PI / 2); }
    // 椅子・座布団（体より奥）
    if (J.chair) { tg.rrect(-0.1 * h, -0.28 * h, 0.24 * h, 0.03 * h, 3, { fill: S('#8A6444'), lw, seed: seed + 1 }); tg.line([[-0.08 * h, -0.25 * h], [-0.08 * h, 0]], { lw: lw * 1.6, seed: seed + 2 }); tg.line([[0.12 * h, -0.25 * h], [0.12 * h, 0]], { lw: lw * 1.6, seed: seed + 3 }); tg.rrect(-0.11 * h, -0.5 * h, 0.03 * h, 0.25 * h, 3, { fill: S('#8A6444'), lw, seed: seed + 4 }); }
    if (J.seiza) tg.rrect(-0.15 * h, -0.025 * h, 0.32 * h, 0.035 * h, 8, { fill: S('#A8484A'), lw, seed: seed + 5 });
    c.translate(0, J.dy + (J.drop || 0));
    c.rotate(J.rot);
    const up = -(J.drop || 0); // 座ったとき脚は元の高さに描く

    const { r, hy, shY, hipY, sw } = d;
    const skin = S(cos.skin), top = S(cos.top), bottom = S(cos.bottom || cos.top);
    // マント（いちばん奥）
    if (cos.cloak) tg.poly([[-sw * 1.05, shY], [sw * 1.05, shY], [sw * 1.6, -0.08 * h + up], [-sw * 1.7, -0.06 * h + up]], { fill: S(cos.cloak), lw, seed: seed + 6, hatch: { gap: 10, angle: 1.4 } });
    // 後ろ髪
    hairBack(tg, cos, d, S, lw, seed);
    // 脚
    const longSkirt = cos.kind === 'robe' || (cos.kind === 'dress' && (cos.length === 'ankle' || cos.length === 'gown'));
    const legCol = cos.kind === 'shorts' || cos.kind === 'dress' ? skin : bottom;
    const drawLeg = (g, sd) => {
      const P = (p) => [p[0], p[1] + (J.chair || J.seiza ? 0 : 0)];
      const hip = P(g.hip), knee = P(g.knee), foot = P(g.foot);
      const pts = J.chair ? [[hip[0], hip[1]], knee, [foot[0], foot[1] + up]] : [hip, knee, foot];
      if (J.chair) { pts[0] = [hip[0], hip[1] + up]; pts[1] = [knee[0], knee[1] + up]; }
      if (!longSkirt || J.chair) {
        if (cos.kind === 'shorts') { tg.limb([pts[0], lerpP(pts[0], pts[1], 0.9)], { color: bottom, lw: d.limb * 1.25, seed: seed + 10 + sd }); tg.limb([lerpP(pts[0], pts[1], 0.85), pts[1], pts[2]], { color: skin, lw: d.limb * 0.85, seed: seed + 12 + sd }); }
        else tg.limb(pts, { color: legCol, lw: d.limb * (legCol === skin ? 0.85 : 1.1), seed: seed + 10 + sd });
      }
      const f = pts[2]; tg.ellipse(f[0] + 0.015 * h, f[1] - 0.008 * h, 0.032 * h, 0.014 * h, { fill: S(cos.shoes), lw, seed: seed + 14 + sd });
    };
    if (J.legs) { drawLeg(J.legL, 0); drawLeg(J.legR, 1); }
    if (J.seiza) tg.rrect(-0.1 * h, hipY - 0.02 * h, 0.24 * h, 0.13 * h, 0.05 * h, { fill: longSkirt ? top : bottom, lw, seed: seed + 16 });
    // 胴体・裾
    torso(tg, cos, d, h, J, S, lw, seed, up);
    // 腕
    const drawArm = (a, sd) => {
      const sleeveW = d.limb * (cos.kind === 'robe' ? 1.5 : 1.05);
      if (cos.kind === 'robe') { const m = lerpP(a.sh, a.el, 0.6); tg.poly([[a.sh[0], a.sh[1]], [m[0] + sd * 0.03 * h, m[1] + 0.02 * h], [a.el[0] + sd * 0.035 * h, a.el[1] + 0.07 * h], [a.el[0] - sd * 0.01 * h, a.el[1] + 0.06 * h]], { fill: top, lw, seed: seed + 20 + sd }); }
      tg.limb([a.sh, a.el, a.hand], { color: cos.kind === 'shorts' || (cos.kind === 'dress' && cos.length !== 'gown') ? (sd ? top : top) : top, lw: sleeveW, seed: seed + 22 + sd });
      tg.ellipse(a.hand[0], a.hand[1], d.limb * 0.62, d.limb * 0.66, { fill: skin, lw, seed: seed + 24 + sd });
    };
    drawArm(J.armL, 0);
    // 杖（手前の手で持つ）
    if (cos.cane && pose !== 'lie' && pose !== 'sit') tg.line([[J.armR.hand[0] + 0.01 * h, J.armR.hand[1]], [J.armR.hand[0] + 0.03 * h, -J.dy]], { lw: lw * 2, seed: seed + 26, stroke: S('#6A4A32') });
    drawArm(J.armR, 1);
    // 首と頭
    tg.rrect(-r * 0.22, hy + r * 0.7, r * 0.44, shY - hy - r * 0.6, 4, { fill: skin, lw, seed: seed + 30, second: false });
    tg.ellipse(0, hy, r * 0.98, r, { fill: skin, lw: lw * 1.1, seed: seed + 31 });
    tg.ellipse(-r * 0.93, hy + r * 0.12, r * 0.15, r * 0.2, { fill: skin, lw, seed: seed + 32 });
    hairFront(tg, cos, d, S, lw, seed, type);
    face(tg, d, o.expr || 'normal', J.mouth, t, seed, lw, cos, S, pose);
    hat(tg, cos, d, S, lw, seed);
    c.restore();
  }
  const lerpP = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

  function torso(tg, cos, d, h, J, S, lw, seed, up) {
    const { shY, hipY, sw } = d, top = S(cos.top), bottom = S(cos.bottom || cos.top);
    const waist = hipY - 0.06 * h;
    const walkSwing = J.legs && J.legL ? (J.legL.foot[0] + J.legR.foot[0]) * 0.3 : 0;
    if (cos.kind === 'robe') {
      const hem = J.seiza ? hipY + 0.06 * h : J.chair ? hipY + 0.04 * h : -0.025 * h;
      tg.poly([[-sw, shY], [sw, shY], [sw * 1.05, waist], [sw * 1.2 + walkSwing, hem], [-sw * 1.2 + walkSwing, hem], [-sw * 1.05, waist]], { fill: top, lw, seed: seed + 40, hatch: { gap: 9 } });
      if (cos.pattern) for (let k = 0; k < 5; k++) { const px = lerp(-sw, sw, hash(seed, k, 1)), py = lerp(waist + 0.03 * h, hem - 0.02 * h, hash(seed, k, 2)); tg.ellipse(px, py, 0.012 * h, 0.012 * h, { fill: S('#F4EEDC'), stroke: null, seed: seed + 41 + k, amp: 0.4 }); }
      // 衿（左前ではなく右前に重ねる）
      tg.line([[-sw * 0.45, shY - 0.005 * h], [sw * 0.15, shY + 0.11 * h]], { lw: lw * 1.3, seed: seed + 47 });
      tg.line([[sw * 0.45, shY - 0.005 * h], [0, shY + 0.07 * h]], { lw: lw * 1.3, seed: seed + 48 });
      tg.poly([[-sw * 0.4, shY], [0, shY + 0.07 * h], [sw * 0.4, shY]], { fill: S('#F4EEDC'), lw, seed: seed + 49 });
      tg.rrect(-sw * 1.06, waist - 0.035 * h, sw * 2.12, 0.06 * h, 3, { fill: S(cos.accent || '#8A7A5A'), lw, seed: seed + 50 });
      return;
    }
    if (cos.kind === 'dress') {
      const len = J.chair ? hipY + 0.06 * h : cos.length === 'gown' ? -0.015 * h : cos.length === 'ankle' ? -0.04 * h : hipY + 0.17 * h;
      const flare = cos.length === 'gown' ? 2.1 : cos.length === 'ankle' ? 1.5 : 1.75;
      tg.poly([[-sw * 0.95, waist + 0.01 * h], [sw * 0.95, waist + 0.01 * h], [sw * flare + walkSwing, len], [-sw * flare + walkSwing, len]], { fill: bottom, lw, seed: seed + 40, hatch: { gap: 10, angle: 1.4 } });
      tg.poly([[-sw, shY], [sw, shY], [sw * 0.85, waist + 0.015 * h], [-sw * 0.85, waist + 0.015 * h]], { fill: top, lw, seed: seed + 41 });
      tg.ellipse(0, shY + 0.012 * h, sw * 0.4, 0.018 * h, { fill: S('#F8F2E6'), lw, seed: seed + 42 });
      if (cos.ribbon) tg.poly([[-0.03 * h, shY + 0.03 * h], [0, shY + 0.045 * h], [0.03 * h, shY + 0.03 * h], [0.03 * h, shY + 0.065 * h], [0, shY + 0.05 * h], [-0.03 * h, shY + 0.065 * h]], { fill: S(cos.ribbon), lw, seed: seed + 43 });
      return;
    }
    const coatLen = cos.kind === 'coat' && !J.chair ? -0.2 * h : cos.kind === 'tunic' && !J.chair ? hipY + 0.12 * h : hipY + 0.035 * h;
    const fl = cos.kind === 'coat' ? 1.3 : cos.kind === 'tunic' ? 1.2 : 1.0;
    tg.poly([[-sw, shY], [sw, shY], [sw * 0.95, waist], [sw * fl + walkSwing * 0.5, coatLen], [-sw * fl + walkSwing * 0.5, coatLen], [-sw * 0.95, waist]], { fill: top, lw, seed: seed + 40, hatch: cos.kind === 'shirt' ? undefined : { gap: 10 } });
    if (cos.kind === 'coat') { tg.line([[0, shY + 0.02 * h], [0, coatLen]], { lw, seed: seed + 44 }); tg.poly([[-sw * 0.35, shY], [0, shY + 0.1 * h], [sw * 0.35, shY]], { fill: S('#F4EEDC'), lw, seed: seed + 45 }); }
    if (cos.kind === 'uniform') { tg.rrect(-sw * 0.35, shY - 0.012 * h, sw * 0.7, 0.03 * h, 3, { fill: top, lw, seed: seed + 45 }); for (let k = 0; k < 4; k++) tg.ellipse(0, shY + 0.04 * h + k * 0.045 * h, 0.008 * h, 0.008 * h, { fill: S('#E8C66A'), lw: lw * 0.6, seed: seed + 46 + k, amp: 0.3 }); }
    if (cos.kind === 'shirt' || cos.kind === 'shorts') tg.poly([[-sw * 0.38, shY], [0, shY + 0.04 * h], [sw * 0.38, shY], [sw * 0.2, shY + 0.015 * h], [-sw * 0.2, shY + 0.015 * h]], { fill: S('#F8F4EC'), lw, seed: seed + 45 });
    if (cos.tie) tg.poly([[-0.012 * h, shY + 0.03 * h], [0.012 * h, shY + 0.03 * h], [0.018 * h, shY + 0.12 * h], [0, shY + 0.14 * h], [-0.018 * h, shY + 0.12 * h]], { fill: S('#9A3A3A'), lw, seed: seed + 50 });
    if (cos.kind === 'tunic') tg.rrect(-sw * 1.02, waist - 0.01 * h, sw * 2.04, 0.035 * h, 3, { fill: S('#5A3E2A'), lw, seed: seed + 51 });
  }

  function hairBack(tg, cos, d, S, lw, seed) {
    const { r, hy } = d, col = S(cos.hairColor);
    if (cos.hair === 'long') tg.rrect(-r * 1.08, hy - r * 0.5, r * 2.16, r * 2.5, r * 0.9, { fill: col, lw, seed: seed + 60, hatch: { gap: 7, angle: 1.45 } });
    if (cos.hair === 'bob') tg.rrect(-r * 1.1, hy - r * 0.6, r * 2.2, r * 1.55, r * 0.8, { fill: col, lw, seed: seed + 60, hatch: { gap: 7, angle: 1.45 } });
    if (cos.hair === 'pigtails') for (const sd of [-1, 1]) { tg.ellipse(sd * r * 1.12, hy + r * 0.45, r * 0.32, r * 0.55, { fill: col, lw, seed: seed + 61 + sd, hatch: { gap: 6, angle: 1.4 } }); }
    if (cos.hair === 'bun') tg.ellipse(-r * 0.15, hy - r * 1.0, r * 0.5, r * 0.4, { fill: col, lw, seed: seed + 64, hatch: { gap: 6 } });
  }
  function hairFront(tg, cos, d, S, lw, seed, type) {
    const { r, hy } = d, col = S(cos.hairColor);
    if (cos.hair === 'bald') {
      for (const sd of [-1, 1]) tg.ellipse(sd * r * 0.88, hy - r * 0.05, r * 0.2, r * 0.32, { fill: col, lw, seed: seed + 70 + sd });
      if (cos.beard === 'long') tg.poly([[-r * 0.55, hy + r * 0.45], [r * 0.65, hy + r * 0.45], [r * 0.15, hy + r * 2.0]], { fill: col, lw, seed: seed + 73, hatch: { gap: 6, angle: 1.5 } });
      else if (cos.beard === 'short') tg.ellipse(r * 0.08, hy + r * 0.78, r * 0.5, r * 0.28, { fill: col, lw, seed: seed + 73 });
      return;
    }
    // 頭頂を覆う髪＋前髪（ぎざぎざの量は髪型で変える）
    const cyc = hy - r * 0.06, R = r * 1.07, pts = [];
    const a0 = Math.PI * 0.94, a1 = Math.PI * 2.06;
    for (let k = 0; k <= 14; k++) { const a = lerp(a0, a1, k / 14); const spike = cos.hair === 'spiky' && k % 2 ? 1.18 : 1; pts.push([Math.cos(a) * R * spike, cyc + Math.sin(a) * R * spike]); }
    const fy = hy - r * (cos.hair === 'bob' || cos.hair === 'pigtails' ? 0.12 : 0.22), n = 7;
    for (let k = n; k >= 0; k--) { const x = lerp(-R * 0.98, R * 0.98, k / n); pts.push([x, fy + (k % 2 ? r * 0.16 : 0) + (Math.abs(x) > R * 0.8 ? r * 0.25 : 0)]); }
    tg.shape(pts, { fill: col, lw, seed: seed + 75, hatch: { gap: 6, angle: 1.3 } });
    if (cos.hair === 'long' || cos.hair === 'bob') for (const sd of [-1, 1]) tg.poly([[sd * r * 0.95, hy - r * 0.2], [sd * r * 1.08, hy + r * (cos.hair === 'long' ? 1.1 : 0.7)], [sd * r * 0.78, hy + r * (cos.hair === 'long' ? 0.9 : 0.6)]], { fill: col, lw, seed: seed + 77 + sd, step: 10 });
    if (cos.hair === 'bun') tg.line([[-r * 0.6, hy - r * 1.15], [r * 0.3, hy - r * 0.85]], { lw: lw * 1.2, seed: seed + 80, stroke: S('#C9A24B') });
    if (cos.ribbon && (cos.hair === 'pigtails' || cos.hair === 'bob' || cos.hair === 'long')) for (const sd of cos.hair === 'pigtails' ? [-1, 1] : [1]) tg.poly([[sd * r * 0.85, hy - r * 0.7], [sd * r * 1.25, hy - r * 0.95], [sd * r * 1.2, hy - r * 0.45]], { fill: S(cos.ribbon), lw, seed: seed + 82 + sd, step: 10 });
  }
  function hat(tg, cos, d, S, lw, seed) {
    const { r, hy } = d;
    if (cos.hat === 'cap') { tg.rrect(-r * 1.0, hy - r * 1.15, r * 2.0, r * 0.6, r * 0.25, { fill: S('#2A2E3A'), lw, seed: seed + 85 }); tg.ellipse(r * 0.6, hy - r * 0.58, r * 0.6, r * 0.13, { fill: S('#1E2028'), lw, seed: seed + 86 }); tg.ellipse(0, hy - r * 0.9, r * 0.12, r * 0.1, { fill: S('#E8C66A'), lw: lw * 0.6, seed: seed + 87 }); }
    if (cos.hat === 'top') { tg.ellipse(0, hy - r * 0.78, r * 1.3, r * 0.2, { fill: S('#22222A'), lw, seed: seed + 85 }); tg.rrect(-r * 0.78, hy - r * 1.9, r * 1.56, r * 1.12, 4, { fill: S('#22222A'), lw, seed: seed + 86 }); tg.rrect(-r * 0.78, hy - r * 1.0, r * 1.56, r * 0.18, 2, { fill: S('#7A2E2E'), lw: lw * 0.7, seed: seed + 87 }); }
    if (cos.hat === 'wizard') { tg.ellipse(0, hy - r * 0.75, r * 1.4, r * 0.24, { fill: S('#2E3A7A'), lw, seed: seed + 85 }); tg.poly([[-r * 0.95, hy - r * 0.8], [r * 0.4, hy - r * 2.9], [r * 0.95, hy - r * 0.8]], { fill: S('#2E3A7A'), lw, seed: seed + 86, step: 14 }); tg.star(0, hy - r * 1.4, r * 0.22, { fill: S('#F2D06A'), lw: lw * 0.7, seed: seed + 87 }); }
  }

  // 顔：目は顔の中心より下・間隔広め・小さな口と頬の赤み
  function face(tg, d, expr, mouth, t, seed, lw, cos, S, pose) {
    const { r, hy } = d, dx = r * 0.1, ey = hy + r * 0.2, ex = r * 0.36;
    const ink = '#2A2320', fl = Math.max(1.6, r * 0.065);
    const blink = ((t + seed * 0.37) % 4.3) < 0.12;
    const closed = expr === 'sleep' || pose === 'lie' || blink;
    if (expr === 'sleep' || pose === 'lie') expr = 'sleep';
    // 頬
    for (const sd of [-1, 1]) tg.ellipse(dx + sd * r * 0.58, hy + r * 0.45, r * 0.15, r * 0.08, { fill: '#F0A0A0', stroke: null, seed: seed + 90 + sd, amp: 0.3, alpha: d.old ? 0.35 : 0.6 });
    for (const sd of [-1, 1]) {
      const x = dx + sd * ex, y = ey;
      if (expr === 'joy' || expr === 'calm') {
        // 笑った目（∩）／穏やかな目（‿）
        const k = expr === 'joy' ? -1 : 1;
        tg.line([[x - r * 0.13, y + (expr === 'joy' ? r * 0.03 : -r * 0.01)], [x, y + k * r * 0.09], [x + r * 0.13, y + (expr === 'joy' ? r * 0.03 : -r * 0.01)]], { lw: fl, seed: seed + 92 + sd, amp: 0.5, stroke: ink });
      } else if (closed) {
        tg.line([[x - r * 0.12, y], [x, y + r * 0.05], [x + r * 0.12, y]], { lw: fl, seed: seed + 94 + sd, amp: 0.5, stroke: ink });
      } else {
        const sy = expr === 'anger' ? 0.1 : expr === 'anxiety' ? 0.12 : 0.15;
        tg.ellipse(x, y, r * 0.11, r * sy, { fill: ink, lw: fl * 0.6, seed: seed + 96 + sd, amp: 0.3 });
        tg.ellipse(x + r * 0.04, y - r * sy * 0.45, r * 0.045, r * 0.045, { fill: '#FFFFFF', stroke: null, seed: seed + 98 + sd, amp: 0.2 });
      }
      // 眉
      const by = hy - r * 0.16;
      // 眉：怒りは内側を下げ、悲しみ・不安は内側を上げる
      const tilt = expr === 'anger' ? 0.09 : expr === 'sadness' || expr === 'anxiety' ? -0.08 : 0;
      const inner = [x - sd * r * 0.12, by + tilt * r], outer = [x + sd * r * 0.12, by - tilt * r * 0.3];
      tg.line([outer, inner], { lw: fl * 0.9, seed: seed + 102 + sd, amp: 0.4, stroke: S(cos.hairColor === '#D9D6CF' ? '#9A968E' : cos.hairColor) });
      if (cos.glasses) tg.ellipse(x, y, r * 0.2, r * 0.18, { lw: fl * 0.7, seed: seed + 104 + sd, amp: 0.4 });
    }
    if (cos.glasses) tg.line([[dx - ex + r * 0.2, ey], [dx + ex - r * 0.2, ey]], { lw: fl * 0.7, seed: seed + 106 });
    // 鼻（ほんの少し）
    tg.line([[dx * 1.8 + r * 0.03, hy + r * 0.38], [dx * 1.8 + r * 0.06, hy + r * 0.42]], { lw: fl * 0.7, seed: seed + 107, amp: 0.2, stroke: '#C08A70' });
    // 口
    const mx = dx * 1.5, my = hy + r * 0.58, mw = r * 0.12;
    if (expr === 'joy' || mouth) tg.shape([[mx - mw, my - r * 0.02], [mx + mw, my - r * 0.02], [mx + mw * 0.5, my + r * 0.1], [mx - mw * 0.5, my + r * 0.1]], { fill: '#B5484A', lw: fl * 0.7, seed: seed + 108, amp: 0.3 });
    else if (expr === 'sadness' || expr === 'anger') tg.line([[mx - mw * 0.8, my + r * 0.04], [mx, my - r * 0.02], [mx + mw * 0.8, my + r * 0.04]], { lw: fl * 0.8, seed: seed + 109, amp: 0.3, stroke: ink });
    else if (expr === 'anxiety') tg.line([[mx - mw, my], [mx - mw * 0.4, my - r * 0.03], [mx + mw * 0.2, my + r * 0.02], [mx + mw, my - r * 0.01]], { lw: fl * 0.8, seed: seed + 110, amp: 0.3, stroke: ink });
    else if (expr === 'sleep') tg.ellipse(mx, my + r * 0.02, r * 0.04, r * 0.035, { fill: '#B5484A', lw: fl * 0.6, seed: seed + 111, amp: 0.2 });
    else tg.line([[mx - mw * 0.7, my - r * 0.01], [mx, my + r * 0.04], [mx + mw * 0.7, my - r * 0.01]], { lw: fl * 0.8, seed: seed + 112, amp: 0.3, stroke: ink });
    // 気持ちの記号
    if (expr === 'sadness') { const ph = (t * 0.7 + seed) % 1; tg.shape([[dx - ex + r * 0.05, ey + r * 0.15 + ph * r * 0.35], [dx - ex + r * 0.1, ey + r * 0.28 + ph * r * 0.35], [dx - ex + r * 0.05, ey + r * 0.33 + ph * r * 0.35], [dx - ex, ey + r * 0.28 + ph * r * 0.35]], { fill: '#A8D8F0', lw: fl * 0.5, seed: seed + 113, amp: 0.2, alpha: 1 - ph }); }
    if (expr === 'anxiety') tg.shape([[-r * 1.0, hy - r * 0.5], [-r * 0.9, hy - r * 0.25], [-r * 1.0, hy - r * 0.15], [-r * 1.1, hy - r * 0.25]], { fill: '#BFE3F2', lw: fl * 0.6, seed: seed + 114, amp: 0.3 });
    if (expr === 'anger') { const px = r * 0.75, py = hy - r * 0.85, q = r * 0.12; for (const [a, b] of [[[px - q, py - q * 0.3], [px - q * 0.3, py - q * 0.3]], [[px + q * 0.3, py - q * 0.3], [px + q, py - q * 0.3]], [[px - q * 0.3, py + q * 0.3], [px - q, py + q * 0.3]], [[px + q, py + q * 0.3], [px + q * 0.3, py + q * 0.3]]]) tg.line([a, b], { lw: fl, seed: seed + 115, stroke: '#D04040', amp: 0.3 }); }
    if (expr === 'sleep' && pose === 'lie') for (let k = 0; k < 3; k++) { const a = (t * 0.5 + k / 3) % 1; tg.text('z', r * 1.2 + a * r * 1.2, hy - r * 0.8 - a * r * 2, { size: r * (0.4 + k * 0.12), color: '#FFFDF6', strokeW: r * 0.08, boilAmp: 0.4 }); }
  }

  /* 人数・配置ごとに描く */
  function figures(tg, L, st, t) {
    const f = st.figures; if (!f || f.layout === 'none') return;
    const S = shader(st.time || 'day', st.innerK != null ? 0.6 * (1 - st.innerK) : 0.6);
    const unit = Math.min(L.H, L.W * 1.25);
    const H = (type) => unit * (type === 'boy' || type === 'girl' ? 0.44 : type === 'oldman' || type === 'oldwoman' ? 0.55 : 0.58);
    const seat = st.location === 'washitsu' ? 'seiza' : 'chair';
    const y = L.floor;
    const P = (type, x, facing, slot, pose, expr) => person(tg, L, { type: type || 'unknown', era: st.era, pose, expr, x, y: pose === 'lie' ? y : y, h: H(type || 'unknown'), facing, slot, shade: S, seat }, t);
    if (f.layout === 'many') {
      for (let k = 0; k < 4; k++) {
        const types = ['man', 'woman', 'oldman', 'girl', 'woman', 'boy', 'oldwoman', 'man'];
        const ty = types[(k * 3 + (st.crowdVariant || 0)) % types.length];
        const x = L.W * (0.12 + k * 0.25), c = tg.ctx; c.save(); c.translate(x, y - L.H * 0.1); c.scale(0.62, 0.62); c.translate(-x, -(y - L.H * 0.1));
        person(tg, L, { type: ty, era: st.era, pose: k % 2 ? 'walk' : 'stand', expr: 'normal', x, y: y - L.H * 0.1, h: H(ty), facing: k % 2 ? 1 : -1, slot: 2 + k, shade: (h) => mix(S(h), '#B8BCC8', 0.35), alpha: 0.85 }, t);
        c.restore();
      }
      if (f.main) P(f.main, L.W * 0.62, -1, 0, f.pose === 'talk' ? 'stand' : f.pose, st.expr);
      return;
    }
    if (f.layout === 'two') {
      if (f.sub) P(f.sub, L.W * 0.32, 1, 1, f.pose === 'lie' ? 'stand' : f.pose, st.subExpr || 'normal');
      if (f.main) P(f.main, L.W * 0.68, -1, 0, f.pose, st.expr);
      return;
    }
    if (f.main) P(f.main, f.pose === 'lie' ? L.W * 0.62 : L.W * 0.6, -1, 0, f.pose, st.expr);
  }

  /* ================= 心象（気持ちの背景） ================= */
  function grad(tg, L, stops, radial) {
    const c = tg.ctx; let g;
    if (radial) g = c.createRadialGradient(L.W / 2, L.H * 0.55, 0, L.W / 2, L.H * 0.55, Math.max(L.W, L.H) * 0.75);
    else g = c.createLinearGradient(0, 0, 0, L.H);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);
  }
  const EMO = {
    anxiety(tg, L, t) {
      const U = L.U; grad(tg, L, ['#1E1F3A', '#3A2E54', '#18202F']);
      // 不規則に揺れる渦
      for (let k = 0; k < 7; k++) { const r = (60 + k * 80) * U * (1 + 0.04 * Math.sin(t * 2.3 + k)); tg.ellipse(L.W / 2 + Math.sin(t * 1.7 + k) * 14 * U, L.H * 0.5 + Math.cos(t * 1.3 + k) * 10 * U, r * 1.2, r * 0.9, { stroke: k % 2 ? '#8A7FC0' : '#5A6AA8', lw: 3 * U, seed: 3000 + k, amp: 5, second: false, alpha: 0.55 }); }
      for (let k = 0; k < 6; k++) { const pts = []; const y = L.H * (0.1 + k * 0.16); for (let i = 0; i <= 10; i++) pts.push([i * L.W / 10, y + Math.sin(i * 1.9 + t * 3 + k) * 16 * U]); tg.line(pts, { lw: 2 * U, seed: 3020 + k, stroke: 'rgba(170,160,230,.35)', amp: 4 }); }
    },
    joy(tg, L, t) {
      const U = L.U; grad(tg, L, ['#F8D08E', '#F2A88E', '#D98AA0']);
      const c = tg.ctx; c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(L.W / 2, L.H * 0.15, 0, L.W / 2, L.H * 0.15, L.H * 0.7); g.addColorStop(0, `rgba(255,250,215,${0.55 + 0.15 * Math.sin(t * 1.5)})`); g.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H); c.restore();
      for (let k = 0; k < 14; k++) { const tw = 0.5 + 0.5 * Math.sin(t * 4 + k * 1.7); if (tw < 0.25) continue; tg.star(L.W * (0.06 + hash(k, 1) * 0.88), L.H * (0.08 + hash(k, 2) * 0.6), (8 + tw * 14) * U, { fill: '#FFF4C8', lw: 2.5 * U, seed: 3100 + k, amp: 0.5 }); }
      for (let k = 0; k < 12; k++) { const ph = (t * 0.12 + hash(k, 5)) % 1; tg.ellipse(L.W * hash(k, 6) + Math.sin(t + k) * 20 * U, L.H * (1 - ph), (6 + hash(k, 7) * 8) * U, (6 + hash(k, 7) * 8) * U, { fill: '#FFFBEA', lw: 2, seed: 3120 + k, alpha: Math.min(1, (1 - ph) * 1.5), second: false }); }
    },
    calm(tg, L, t) {
      const U = L.U; grad(tg, L, ['#A8D2D8', '#9CC8B4', '#7EAE9C']);
      const c = tg.ctx; c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(L.W / 2, L.H * 0.4, 0, L.W / 2, L.H * 0.4, L.H * 0.6); g.addColorStop(0, `rgba(240,255,250,${0.3 + 0.12 * Math.sin(t * 0.8)})`); g.addColorStop(1, 'rgba(240,255,250,0)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H); c.restore();
      for (let k = 0; k < 7; k++) { const pts = [], y = L.H * (0.25 + k * 0.1); for (let i = 0; i <= 8; i++) pts.push([i * L.W / 8, y + Math.sin(i * 0.9 + t * 0.6 + k * 0.7) * 10 * U]); tg.line(pts, { lw: 3 * U, seed: 3200 + k, stroke: 'rgba(255,255,255,.4)', amp: 1 }); }
      for (let k = 0; k < 3; k++) { const x = ((t * 8 * U + k * L.W / 3) % (L.W + 200)) - 100; tg.ellipse(x, L.H * (0.18 + k * 0.08), 80 * U, 20 * U, { fill: '#EAF6F2', lw: 2, seed: 3210 + k, alpha: 0.6, second: false }); }
    },
    sadness(tg, L, t) {
      const U = L.U; grad(tg, L, ['#3A485C', '#5A6C82', '#788698']);
      const c = tg.ctx; c.save(); c.strokeStyle = 'rgba(210,225,245,.35)'; c.lineWidth = 2 * U; c.lineCap = 'round'; c.beginPath();
      for (let i = 0; i < 40; i++) { const sp = (90 + hash(i, 3) * 60) * U, x = hash(i, 1) * L.W, y = ((t * sp + hash(i, 2) * L.H) % (L.H + 80)) - 40; c.moveTo(x, y); c.lineTo(x, y + 26 * U); }
      c.stroke(); c.restore();
      for (let k = 0; k < 5; k++) { const x = L.W * (0.1 + k * 0.2); tg.line([[x, 0], [x + 10 * U, L.H * 0.3 + Math.sin(t * 0.7 + k) * 20 * U]], { lw: 2 * U, seed: 3300 + k, stroke: 'rgba(200,215,235,.25)' }); }
    },
    anger(tg, L, t) {
      const U = L.U; grad(tg, L, ['#8E2A26', '#4A1414', '#1E0A0A'], true);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      const c = tg.ctx; c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(L.W / 2, L.H * 0.6, 0, L.W / 2, L.H * 0.6, L.H * 0.55); g.addColorStop(0, `rgba(255,110,60,${0.25 + 0.25 * pulse})`); g.addColorStop(1, 'rgba(255,110,60,0)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H); c.restore();
      // 外から刺さるぎざぎざ線
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2 + 0.2, R0 = Math.max(L.W, L.H) * 0.75, R1 = R0 * (0.55 - 0.08 * pulse), cx = L.W / 2, cy = L.H * 0.55; const pts = []; for (let i = 0; i <= 4; i++) { const rr = lerp(R0, R1, i / 4), off = (i % 2 ? 1 : -1) * 0.04; pts.push([cx + Math.cos(a + off) * rr, cy + Math.sin(a + off) * rr]); } tg.line(pts, { lw: 4 * U, seed: 3400 + k, stroke: 'rgba(255,150,100,.55)', amp: 2 }); }
    },
  };
  function emotion(tg, L, id, t, alpha) {
    if (!EMO[id] || alpha <= 0) return;
    const c = tg.ctx; c.save(); c.globalAlpha = alpha; EMO[id](tg, L, t); c.restore();
  }

  /* ================= 天候 ================= */
  function weather(tg, L, w, t) {
    const c = tg.ctx, U = L.U;
    if (w.cloudy > 0) { c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = `rgba(110,115,128,${0.32 * w.cloudy})`; c.fillRect(0, 0, L.W, L.H); c.restore(); }
    if (w.rain > 0) {
      const n = Math.round(110 * w.rain); c.save(); c.strokeStyle = 'rgba(190,205,230,.7)'; c.lineWidth = 2.2 * U; c.lineCap = 'round'; c.beginPath();
      for (let i = 0; i < n; i++) { const sp = (900 + hash(i, 3) * 500) * U, x = hash(i, 1) * (L.W + 200) - 100 - ((t * sp * 0.15) % 200), y = ((t * sp + hash(i, 2) * L.H) % (L.H + 120)) - 60; c.moveTo(x, y); c.lineTo(x - 10 * U, y + 34 * U); }
      c.stroke(); c.restore();
    }
    if (w.snow > 0) {
      const n = Math.round(90 * w.snow); c.save(); c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < n; i++) { const sp = (40 + hash(i, 3) * 50) * U, x = (hash(i, 1) * L.W + Math.sin(t * 0.8 + i) * 30 * U + L.W) % L.W, y = ((t * sp + hash(i, 2) * L.H) % (L.H + 40)) - 20, r = (2 + hash(i, 4) * 3) * U; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    if (w.fog > 0) { c.save(); const g = c.createLinearGradient(0, L.H, 0, 0); g.addColorStop(0, `rgba(228,230,234,${0.8 * w.fog})`); g.addColorStop(0.55, `rgba(222,226,232,${0.4 * w.fog})`); g.addColorStop(1, `rgba(222,226,232,${0.15 * w.fog})`); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H); c.restore(); }
  }

  const Draw = { layout, background, person, figures, emotion, weather, costume, mix, shader, LOCATIONS: Object.keys(BG), EMOTIONS: Object.keys(EMO), COSTUME };
  if (typeof module !== 'undefined' && module.exports) module.exports = Draw;
  root.Draw = Draw;
})(typeof window !== 'undefined' ? window : globalThis);
