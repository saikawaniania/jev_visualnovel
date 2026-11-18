// manga.js — 手描き漫画文庫：小説の場面（判定単位の本文）を「1場面＝1ページの漫画（数コマ）」にする。
//
// 工程（移植セット 04_scene_to_page.md の順）：
//   1. コマ割り        Manga.split(text, items)            本文 → コマの下書き（導入・会話・動作・締め）
//   2. Jevアシスト判定  Manga.questions(drafts)              コマごとの役割・感情の強さ・最重要コマ（場面判定と同じ1回の問い合わせに束ねる）
//                      Manga.emotionQuestions(drafts, ans)  強さ 1.0 以上のコマだけ、感情の細目（23択）を2回目で聞く
//   3. 演出の対応       Manga.assist(drafts, answers)        判定 → カメラ・背景効果（03_jev_assist_spec.md の表と閾値のまま）
//   4. ページを組む     Manga.buildPage({...})                レイアウト（02 のレイアウト表）・コマごとの人物と吹き出し
//   5. 描く            Manga.render(tg, page, t, opts)       手描きの絵（draw.js）をコマの中に描き、枠・吹き出し・ナレーションを載せる
//
// Jev の判定に加えて、コード側でもコマの地の文を読む（Manga.readText）：手の形・表情・座る・後ろ姿や横顔・目元や手元などの見え方・
// 誰の話か を言い回しで拾う（プレビューアーの人物の描き方と同じ言い回しの表）。言い回しで分かったことは Jev より優先する。
// 単調にならないように、場所を見せなくてよいコマは背景をあせたパステルの単色・グラデーションで塗り（夕方・夜は時間の色）、
// 導入のコマは背景だけ（動物がいれば動物だけ）にする。
(function (root) {
  'use strict';
  const T = root.Tegaki, D = root.Draw;
  const { hash, clamp, lerp } = T;

  /* ================= Jevアシストの質問票と対応表（03_jev_assist_spec.md。文言・数値は変えない） ================= */
  const THRESHOLDS = { gate_intensity: 1.0, flag_confidence: 0.3, camera_min_confidence: 0.35, two_action_threshold: 0.5 };
  const ROLES = [
    ['状況説明', '場所や状況を読み手に示す導入のコマ'],
    ['会話', 'セリフのやり取りが中心のコマ'],
    ['反応', '相手の言葉や出来事への受け・返しのコマ'],
    ['感情の山場', '感情が最も高まる、その場面の見せ場のコマ'],
    ['決意・転機', '心が決まる、物語の流れが変わるコマ'],
    ['動作', '行動・作業・移動そのものが中心のコマ'],
    ['締め・ヒキ', '場面やページを閉じて、次へ読み手を引くコマ'],
    ['日常', '穏やかで何気ない時間のコマ'],
  ];
  const INTENSITY = ['弱い：さりげない', '中くらい：はっきり分かる', '強い：前面に出ている'];
  const EMOTIONS = [
    ['喜び', '嬉しさ、楽しさ'], ['期待', 'わくわく、待ち遠しさ'], ['興奮', '熱狂、高揚'], ['安心', '安堵、緊張が解けた'], ['感動', '胸が熱くなる'],
    ['照れ・ときめき', '恋心や恥ずかしさでドキドキ'], ['悲しみ', '落ち込み、喪失感'], ['寂しさ', '孤独感'], ['不安', '心配、先の見えなさへの怖れ'],
    ['恐怖', '身の危険や強い怖れ'], ['焦り', '追われて落ち着かない'], ['緊張', '張り詰めた空気'], ['怒り', '腹立ち、理不尽への反発'],
    ['後悔', '自分を責める'], ['疲労', '心身の疲れ'], ['平穏', '穏やかで満ち足りている'], ['冷静', '落ち着いて判断'],
    ['威圧', '相手を圧倒する存在感'], ['自信', '余裕のある自信'], ['決意', '覚悟を決めている'], ['驚き', '予想外に目を見開く'],
    ['困惑', '状況が飲み込めず戸惑う'], ['呆れ', 'あきれている、ややコミカル'],
  ];
  // 感情 → カメラ（系統と英語文）。喜び・期待・安心・感動・平穏・冷静は指定しない
  const EMO_CAMERA = {
    '威圧': ['low_angle', 'a strong low-angle shot looking up at the figure, giving an overwhelming, imposing presence'],
    '自信': ['low_angle', 'a low-angle shot looking slightly up; the figure looks confident and self-assured'],
    '決意': ['low_angle', 'a close shot from a slightly low angle, firm and resolute'],
    '怒り': ['low_angle', 'a close low-angle shot, tense and confrontational'],
    '興奮': ['low_angle', 'a dynamic low-angle shot, charged with energy and excitement'],
    '寂しさ': ['high_angle', 'a high-angle shot looking down; the figure is small and alone in the frame'],
    '悲しみ': ['high_angle', 'a high-angle shot looking down; the figure seems small and sunk in grief'],
    '後悔': ['high_angle', 'a high-angle shot looking down on the figure, weighed down by regret'],
    '疲労': ['high_angle', 'a slightly high-angle shot looking down at the weary figure'],
    '不安': ['dutch', 'a dutch angle: the frame is clearly tilted diagonally, uneasy and unstable'],
    '困惑': ['dutch_light', 'a very slightly tilted, subtly off-balance framing'],
    '焦り': ['dutch_light', 'a very slightly tilted, subtly off-balance and restless framing'],
    '恐怖': ['close_up', 'a tight close-up on the face, frozen with fear'],
    '緊張': ['close_up', 'a tense close shot, holding on the strained, held-breath expression'],
    '驚き': ['close_up', 'a straight-on close-up on the face, eyes wide with surprise'],
    '照れ・ときめき': ['profile_soft', 'a soft close shot in profile or three-quarter view, in gentle light'],
    '呆れ': ['flat_medium', 'a flat, slightly pulled-back medium shot with deadpan timing'],
  };
  // 役割 → カメラ（感情がないコマの補充）
  const ROLE_CAMERA = {
    '状況説明': ['wide', 'a wide establishing shot that shows the whole location'],
    '動作': ['dynamic', 'a dynamic angled shot that follows the motion'],
    '日常': ['medium_long', 'a relaxed medium-long shot at a natural eye level'],
  };
  // 会話・反応のバリエーション（プールから回し、直前と同じ系統は続けて使わない）
  const POOL = {
    '会話': [['medium', 'a medium shot at eye level'], ['over_shoulder', 'an over-the-shoulder shot from behind the listener, facing the speaker'], ['profile', 'a profile two-shot: the two speakers facing each other']],
    '反応': [['close_up', 'a close-up on the face, catching the reaction'], ['over_shoulder', "an over-the-shoulder reaction shot, from behind the speaker toward the listener's face"], ['profile', 'a profile close-up, catching the reaction from the side'], ['detail', 'a cutaway to the hands or a telling small detail that carries the reaction']],
  };
  // 感情 → 背景効果（感情が強いコマだけ）
  const EFFECT = {
    '喜び': 'キラキラ', '期待': 'キラキラ', '安心': 'オーラ', '感動': 'オーラ', '決意': 'オーラ', '照れ・ときめき': '花',
    '悲しみ': 'トーン', '寂しさ': 'トーン', '不安': 'トーン', '恐怖': 'トーン', '後悔': 'トーン',
    '興奮': '集中線', '怒り': '集中線', '驚き': '集中線', '焦り': '流線', '困惑': '白ドット', '呆れ': '白ドット',
  };
  // 緊張系の感情（ページのレイアウトを崩す・見せ場を大きくする判断材料）
  const TENSE = new Set(['怒り', '恐怖', '興奮', '不安', '驚き', '焦り', '困惑', '緊張', '決意', '威圧']);
  // 感情 → 手描きの顔（draw.js の表情 7 種）
  const EXPR = {
    '喜び': 'joy', '期待': 'joy', '興奮': 'joy', '感動': 'joy', '照れ・ときめき': 'joy', '自信': 'joy',
    '安心': 'calm', '平穏': 'calm', '冷静': 'calm',
    '悲しみ': 'sadness', '寂しさ': 'sadness', '後悔': 'sadness', '疲労': 'sadness',
    '不安': 'anxiety', '恐怖': 'anxiety', '焦り': 'anxiety', '緊張': 'anxiety', '困惑': 'anxiety',
    '怒り': 'anger', '威圧': 'anger', '驚き': 'surprise', '決意': 'normal', '呆れ': 'normal',
  };
  // 場面判定の気持ち（手描き版の 6 種）→ 23 種のどれに近いか（2回目の判定がないコマの顔に使う）
  const SCENE_EMO = { anxiety: '不安', joy: '喜び', calm: '平穏', sadness: '悲しみ', anger: '怒り', surprise: '驚き' };

  /* ================= レイアウト表（02_prompt_spec.md。数値はページ全体に対する割合） ================= */
  // 矩形は [x, y, w, h]（0〜1、左上が原点）。並びはコマの順（右上が 1）
  const G = { side: 0.012, row: 0.016 }; // 余白：横並びのコマの間・段の間
  const LAYOUTS = {
    full_page: { n: 1, rects: [[0, 0, 1, 1]], en: 'Panel layout — a single panel fills the whole page (full-page splash).' },
    '2comma': {
      n: 2,
      rects: [[0.095, 0.068, 0.81, (1 - 0.136 - 0.017) / 2], [0.095, 0.068 + (1 - 0.136 - 0.017) / 2 + 0.017, 0.81, (1 - 0.136 - 0.017) / 2]],
      noMargin: true,
      en: 'Panel layout — 2 panels, no layout reference image is provided: divide the page yourself.\n- Leave a margin of about 9.5% of the page width on the left and right, and about 6.8% of the page height at the top and bottom, with a gap of about 1.7% of the page height between the two panels.\n- Inside that margin, stack two panels of equal size at full width: panel 1 on top → panel 2 below it.',
    },
    '3comma': {
      n: 3,
      rects: [[0.4, 0, 0.6, 0.45], [0, 0, 0.4, 0.45], [0, 0.45, 1, 0.55]],
      en: 'Panel layout — 3 panels, no layout reference image is provided: divide the page yourself.\n- The top row takes 45% of the page height: panel 1 on the right (60% of the page width) → panel 2 on the left (40%).\n- Panel 3 takes the bottom 55% of the page at full width.',
    },
    '4comma': {
      n: 4,
      rects: [[0.4, 0, 0.6, 0.5], [0, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5], [0, 0.5, 0.6, 0.5]],
      en: 'Panel layout — 4 panels, no layout reference image is provided: divide the page yourself.\n- The top row takes 50% of the page height: panel 1 on the right (60% of the page width) → panel 2 on the left (40%).\n- The bottom row takes the remaining 50%: panel 3 on the right (40% of the page width) → panel 4 on the left (60%).\n- The wide panel is on the RIGHT in the top row and on the LEFT in the bottom row, so the vertical gutters of the two rows must NOT line up with each other.',
    },
    'T4-G': {
      n: 4,
      rects: [[0.45, 0, 0.55, 0.36], [0, 0, 0.45, 0.36], [0, 0.36, 1, 0.32], [0, 0.68, 1, 0.32]],
      en: 'Panel layout — 4 panels, no layout reference image is provided: divide the page yourself.\n- Three stacked rows. The top row takes 36% of the page height: panel 1 on the right (55% of the page width) → panel 2 on the left (45%).\n- Panel 3 takes the middle 32% of the page at full width.\n- Panel 4 takes the bottom 32% of the page at full width.',
    },
  };
  /** コマ数と山場からレイアウトを選ぶ：見せ場は大きなコマ、穏やかな場面は段組み */
  function chooseLayout(n, { tense = false, calm = false } = {}) {
    if (n <= 1) return 'full_page';
    if (n === 2) return '2comma';
    if (n === 3) return '3comma';
    return calm && !tense ? 'T4-G' : '4comma';
  }
  /** ページの中のコマの矩形（px）。page = {x, y, w, h}。余白（ガター）を引いた値 */
  function panelRects(name, page) {
    const L = LAYOUTS[name] || LAYOUTS['3comma'];
    const m = L.noMargin || name === 'full_page' ? 0 : 0.045; // ページの外周の余白
    const ix = page.x + page.w * m, iy = page.y + page.h * m * 0.75, iw = page.w * (1 - m * 2), ih = page.h * (1 - m * 1.5);
    const gx = page.w * G.side / 2, gy = page.h * G.row / 2;
    return L.rects.map(([x, y, w, h]) => {
      const x0 = ix + x * iw + (x > 0.001 ? gx : 0), x1 = ix + (x + w) * iw - (x + w < 0.999 ? gx : 0);
      const y0 = iy + y * ih + (y > 0.001 && !L.noMargin ? gy : 0), y1 = iy + (y + h) * ih - (y + h < 0.999 && !L.noMargin ? gy : 0);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    });
  }

  /* ================= 1. コマ割り ================= */
  const SENT = /[^。！？!?]*[。！？!?]+[」』）)]*|[^。！？!?]+$/g;
  const sentences = (s) => (String(s || '').match(SENT) || []).map((x) => x.replace(/[\s　]+/g, ' ').trim()).filter((x) => x && x !== '◇');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  /** 長い地の文はナレーションの枠に入る長さで切る（文の途中なら「…」） */
  function caption(s, max = 34) {
    if (!s) return '';
    const t = s.replace(/[\s　]+/g, '');
    if (t.length <= max) return t;
    const cut = t.slice(0, max), k = Math.max(cut.lastIndexOf('、'), cut.lastIndexOf('。'));
    return (k >= max * 0.5 ? cut.slice(0, k) : cut.slice(0, max - 1)) + '…';
  }
  /**
   * 本文 → コマの下書き。items は Parser.quoteItems（最大4つのセリフ候補。前後の地の文つき）
   * 基本形：導入（状況説明）→ 展開（会話・動作）→ 反応・感情の山 → 締め。目安 3〜4 コマ、短い場面は 2 コマ
   *   kind: establish（導入・引きの絵）| talk（セリフ）| action（動作）| close（締め・反応の寄り）
   *   lines: このコマのセリフ（items の番号）。1コマ 2つまで
   *   narration: ナレーション（白い四角枠）に入れる地の文。場面の理解に要るものだけ
   */
  /**
   * 本文の流れ：地の文の文とセリフを、本文の順に。pos / end は本文の中の位置（字）
   *   { q: items の番号 } または { n: 地の文の 1 文 }
   */
  function flowOf(text, items = []) {
    const src = String(text || ''), flow = [];
    const narr = (from, to) => {
      const chunk = src.slice(from, to);
      for (const m of chunk.matchAll(SENT)) {
        const t = m[0].replace(/[\s　]+/g, ' ').trim();
        if (!t || t === '◇') continue;
        flow.push({ n: t, pos: from + m.index, end: from + m.index + m[0].length });
      }
    };
    let last = 0;
    const used = new Set();
    for (const m of src.matchAll(/「([^「」]{1,120})」|『([^『』]{1,120})』/g)) {
      const t = norm(m[1] || m[2]);
      const idx = items.findIndex((it, i) => !used.has(i) && it.text === t);
      if (idx < 0) continue; // 候補から外れたセリフ・地の文の中の名前は地の文のまま
      narr(last, m.index);
      flow.push({ q: idx, pos: m.index, end: m.index + m[0].length }); used.add(idx);
      last = m.index + m[0].length;
    }
    narr(last, src.length);
    return flow;
  }
  /** 1 ページ分の流れ → コマの下書き */
  function draftFlow(flow, items) {
    const quotes = flow.filter((f) => f.q != null);
    const narrAll = flow.filter((f) => f.n).map((f) => f.n);
    const drafts = [];
    const add = (kind, o) => drafts.push(Object.assign({ kind, lines: [], narration: '', text: '', hasChar: kind !== 'establish' }, o));

    if (!quotes.length) {
      // セリフのない場面：導入（引き）→ 動作 → 締め（寄り）。短ければ 2 コマ
      const ss = narrAll;
      if (!ss.length) { add('establish', { text: '' }); return drafts; }
      const three = ss.join('').replace(/\s/g, '').length >= 120 && ss.length >= 3;
      add('establish', { narration: caption(ss[0]), text: ss[0] });
      if (three) { const mid = ss[Math.floor(ss.length / 2)]; add('action', { text: ss.slice(1, -1).join('') || mid }); }
      add('close', { text: ss.length > 1 ? ss[ss.length - 1] : ss[0] });
      return drafts;
    }

    // セリフのある場面
    const firstQ = flow.findIndex((f) => f.q != null);
    const opening = flow.slice(0, firstQ).map((f) => f.n);
    const lastQ = flow.map((f) => f.q != null).lastIndexOf(true);
    const closing = flow.slice(lastQ + 1).map((f) => f.n);
    const hasOpen = opening.length > 0;
    let budget = 4 - (hasOpen ? 1 : 0);
    const wantClose = closing.length > 0 && quotes.length < budget;
    if (wantClose) budget--;
    // セリフをコマに割る（多すぎるときは、続くセリフを 2 つずつ 1 コマに）
    const groups = quotes.map((f) => [f.q]);
    while (groups.length > budget) {
      let best = -1, bl = Infinity;
      for (let i = 0; i < groups.length - 1; i++) {
        if (groups[i].length + groups[i + 1].length > 2) continue;
        const l = [...groups[i], ...groups[i + 1]].reduce((a, q) => a + items[q].text.length, 0);
        if (l < bl) { bl = l; best = i; }
      }
      if (best < 0) { groups.length = budget; break; } // これ以上まとめられない（入りきらないセリフは絵にしない）
      groups.splice(best, 2, [...groups[best], ...groups[best + 1]]);
    }
    if (hasOpen) add('establish', { narration: caption(opening[0]), text: opening.join('') });
    // セリフの間と直後の地の文（「と少女が言った」など）は、そのコマの説明に添える
    for (const g of groups) {
      const pos = flow.findIndex((f) => f.q === g[0]), end = flow.findIndex((f) => f.q === g[g.length - 1]);
      const around = flow.slice(pos + 1, Math.min(flow.length, end + 2)).filter((f) => f.n).map((f) => f.n).join('');
      add('talk', { lines: g.slice(), text: g.map((q) => `「${items[q].text}」`).join('') + around });
    }
    if (wantClose) add('close', { text: closing.join('') });
    return drafts;
  }
  /** 1 ページとして割る（ページ分けはしない）。起動画面の見本や、ページの中身を作るときに使う */
  function split(text, items = []) { return finish(draftFlow(flowOf(text, items), items), items); }

  /* ---------- ページ分け：会話の多い場面・途中で場面が変わる場面は、2〜3 ページにする ---------- */
  // 地の文の文頭で、時間や場面が変わったことを表す言い回し
  const TURN = /^(やがて|翌朝|翌日|翌晩|その夜|その晩|その日の夕方|しばらくして|しばらくすると|数日後|数日が|夜が明け|日が暮れ|朝になる|夕方になる|夜になる|次の日|それから)/;
  const PAGE_QUOTES = 3, MAX_PAGES = 3;
  /**
   * 本文 → ページの並び [{ drafts, start, end }]。start / end は本文の中の位置（字）で、読んでいる位置からページを選ぶのに使う
   * - セリフが 5 つ以上あれば、1 ページに 3 つまで（残りが 1 つだけならそのページに入れる）
   * - 地の文の文頭に場面の変わる言い回し（やがて・翌朝・その夜…）があり、それまでにセリフか 2 文以上あれば、そこで次のページ
   * - コマの番号はページをまたいで通し番号（Jev の質問のキーを重ねないため）
   */
  function paginate(text, items = []) {
    const src = String(text || ''), flow = flowOf(src, items);
    const totalQ = flow.filter((f) => f.q != null).length;
    const cuts = [0];
    let q = 0, nn = 0, seenQ = 0;
    flow.forEach((f, i) => {
      if (i === 0 || cuts.length >= MAX_PAGES) { if (f.q != null) { q++; seenQ++; } else nn++; return; }
      const turn = f.n && TURN.test(f.n) && (q >= 1 || nn >= 2);
      const many = f.q != null && totalQ > 4 && q >= PAGE_QUOTES && totalQ - seenQ >= 2;
      if (turn || many) { cuts.push(i); q = 0; nn = 0; }
      if (f.q != null) { q++; seenQ++; } else nn++;
    });
    let n = 0;
    return cuts.map((c, k) => {
      const part = flow.slice(c, cuts[k + 1] ?? flow.length);
      const drafts = finish(draftFlow(part, items), items);
      for (const d of drafts) d.n = ++n; // 通し番号
      return { drafts, start: k ? flow[c].pos : 0, end: k + 1 < cuts.length ? flow[cuts[k + 1]].pos : src.length };
    });
  }
  /** 本文の中の位置（字）→ ページの番号 */
  function pageAt(pages, offset) {
    for (let k = pages.length - 1; k >= 0; k--) if (offset >= pages[k].start) return k;
    return 0;
  }
  function finish(drafts, items) {
    drafts.forEach((d, i) => {
      d.n = i + 1;
      d.prose = (d.text || '').replace(/「[^」]*」|『[^』]*』/g, '');
      const body = (d.text || '').replace(/[\s　]+/g, '');
      d.summary = body.length > 28 ? body.slice(0, 27) + '…' : body;
    });
    return drafts;
  }

  /* ================= 1b. コード側の判定：コマの地の文の言い回し（プレビューアーの人物の描き方と同じ表） ================= */
  // 手の形：上の行から順に調べて、最初に当てはまったもの
  const GESTURES = [
    ['cheer', /両手を(上げ|挙げ|突き上げ)|万歳|ばんざい|ガッツポーズ/],
    ['wave', /手を振|手をふ|手を挙げ|手を上げ|振り上げ|掲げ|拳を上げ|指を立て/],
    ['point', /指す|指さ|指差|指を向け|突きつけ|差し出|手を伸ば|構え/],
    ['think', /顎に手|あごに手|口元に手を当て|考え込/],
    ['cover', /口(元)?を(覆|押さえ)|顔を覆|両手で顔/],
    ['akimbo', /腰に手/],
    ['surprise', /両手を広げ|のけぞ|仰け反|身を引|後ずさ/],
    ['hold', /腕を組|(?<!気)持[つちっ]|抱え|抱[くきい]|握|受け取|手にする|手に取|胸の前/],
  ];
  const SIT = /座|腰掛|腰かけ|腰を下ろ|膝の上|椅子に|ソファ|正座/;
  const CROUCH = /しゃが|うずくま|かがみ込/;
  // 表情：上の行ほど優先（「泣き笑い」は泣く）。地の文によく出る「明るい（光）」「沈む（日）」は外した
  const FACES = [
    ['cry', /泣|涙|嗚咽/],
    ['sleep', /眠|寝息|目を閉じ/],
    ['surprise', /驚|見開|目を丸|瞠|ぎょっ|息を呑|息をのん/],
    ['anger', /怒|睨|にら[みん]|苛立|眉間|眉を吊/],
    ['anxiety', /不安|困|心配|戸惑|焦|汗|動揺|怯/],
    ['sadness', /悲|寂|淋|落ち込|うなだれ|切な|憂/],
    ['joy', /笑顔|(?<!微)笑[うっいみ]|にっこり|満面|嬉|喜/],
    ['calm', /微笑|穏やか|柔らか|目を細め|口角を上げ|安堵/],
    ['talk', /口を開|叫|声を上げ|話す|語る|言う|言っ|答え/],
  ];
  // 見え方（向きより優先）
  const VIEWS = [
    [/後頭部|後ろ頭/, { view: 'back', crop: 'head' }],
    [/後ろ姿|背中|背を向け/, { view: 'back' }],
    [/横顔/, { view: 'side' }],
    [/目元|瞳/, { crop: 'eyes' }],
    [/口元|唇/, { crop: 'mouth' }],
    [/手元|指先|手のひら|掌/, { crop: 'hand' }],
    [/足元|足もと|靴/, { crop: 'feet' }],
  ];
  // 表情 → 対応表の感情（Jev の細目がないコマで、カメラを決めるのに使う）
  const FACE_EMO = { cry: '悲しみ', surprise: '驚き', anger: '怒り', anxiety: '不安', sadness: '悲しみ', joy: '喜び', calm: '平穏' };
  // 人物を指す言葉（見た目の種類ごと）。「◯◯は」「◯◯が」の◯◯で、文の主語が誰かを見る
  const WHO = {
    man: '男|青年|彼(?!女)|兄|父|私|僕|俺', woman: '女(?!の子)|彼女|娘|妻|母|姉|妹', girl: '少女|女の子|娘|妹', boy: '少年|男の子|弟',
    oldman: '老人|爺|翁|祖父', oldwoman: '老婆|婆|祖母|老女', middleman: '主人|店主|親父|おじさん|旦那', middlewoman: '女将|おばさん|奥さん|母',
    soldier: '兵|騎士|衛兵', monk: '僧|和尚|住職|神父|牧師', baby: '赤ん坊|赤子|幼子', ghost: '幽霊|おばけ|お化け',
  };
  const SCENERY = /空|雨|雪|風|月|星|光|音|景色|海|山|川|木|花|道|街|町|窓|夜|朝|夕/;
  function subject(sentence, f) {
    if (!f) return null;
    let best = null, at = Infinity;
    for (const role of ['main', 'sub']) {
      const type = f[role]; if (!type || !WHO[type]) continue;
      if (role === 'sub' && (f.layout !== 'two' || f.sub === f.main)) continue;
      const m = new RegExp(`(${WHO[type]})(は|が|も)`).exec(sentence);
      if (m && m.index < at) { at = m.index; best = role; }
    }
    return best;
  }
  /**
   * コマの地の文を読む：{ gesture, face, pose（sit・crouch）, view（back・side）, crop（head・eyes・mouth・hand・feet）, who（main・sub）, person（人を指す言葉があるか） }
   * 文ごとに調べ、最初に見つかったものを使う。who はその文の主語
   */
  function readText(prose, f) {
    const out = { gesture: null, face: null, pose: null, view: null, crop: null, who: null, person: false };
    const ss = sentences(prose);
    const all = Object.values(WHO).join('|');
    out.person = new RegExp(all).test(prose);
    for (const sn of ss) {
      const who = subject(sn, f);
      const hit = (k, v) => { if (v && !out[k]) { out[k] = v; if (!out.who && who) out.who = who; } };
      hit('gesture', (GESTURES.find(([, re]) => re.test(sn)) || [])[0]);
      hit('face', (FACES.find(([, re]) => re.test(sn)) || [])[0]);
      hit('pose', CROUCH.test(sn) ? 'crouch' : SIT.test(sn) ? 'sit' : null);
      const v = VIEWS.find(([re]) => re.test(sn));
      if (v) { hit('view', v[1].view); hit('crop', v[1].crop); }
    }
    // 手元だけのコマは、何をしていても両手を体の前に（前から描く）
    if (out.crop === 'hand') { out.gesture = 'hold'; out.view = null; }
    return out;
  }

  /* ---------- 背景の塗り：あせたパステル（朝・昼）と、時間を表す色（夕方・夜） ---------- */
  const PALETTE = {
    day: ['#E6DCCB', '#D6E2D2', '#D3DEE8', '#E9D7DA', '#E6E0C6', '#DBD5E6', '#D1E4E1', '#EADCCD'],
    morning: ['#F0E2CF', '#E9E4CC', '#F1DCD2', '#DDE6DA', '#E4E0EC'],
    evening: [['#F1C6A2', '#D8939A'], ['#EFB894', '#B98AA6'], ['#F3D2A6', '#E09A7E'], ['#E8B4A0', '#9E7FA0']],
    night: [['#2F3A5E', '#1B2138'], ['#3A345E', '#1E1C36'], ['#24344F', '#141C30'], ['#34405E', '#252038']],
  };
  /** コマの背景の塗りを選ぶ（unit とコマ番号で決まる。前のコマと同じ色は続けない） */
  function plainFill(time, unit, n, prevIdx) {
    const t = PALETTE[time] ? time : 'day', list = PALETTE[t];
    let idx = Math.floor(hash(unit == null ? 0 : unit, n, 3) * list.length);
    if (idx === prevIdx) idx = (idx + 1) % list.length;
    if (t === 'evening' || t === 'night') { const [a, b] = list[idx]; return { kind: 'gradient', colors: [a, b], idx, angle: hash(unit, n, 5) < 0.5 ? 'v' : 'd' }; }
    const a = list[idx];
    if (hash(unit, n, 4) < 0.45) return { kind: 'flat', colors: [a], idx };
    return { kind: 'gradient', colors: [mixHex(a, '#FFFFFF', 0.45), list[(idx + 3) % list.length]], idx, angle: hash(unit, n, 5) < 0.5 ? 'v' : 'd' };
  }
  function mixHex(a, b, k) { const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * k).toString(16).padStart(2, '0')).join(''); }

  /* ================= 2. Jevアシストの質問 ================= */
  const isPanelKey = (k) => /^(role|intensity|emotion)_\d+$/.test(k) || /^key_panel(_\d+)?$/.test(k);
  /** ページ k（0 から）の最重要コマの質問のキー */
  const keyName = (k) => (k ? `key_panel_${k + 1}` : 'key_panel');
  /** 1回目：全コマの役割＋（キャラのいるコマは）感情の強さ、ページの最重要コマ。場面判定と同じ問い合わせに足す */
  function questions(drafts, pages = null) {
    const out = {};
    const roles = Object.fromEntries(ROLES);
    for (const d of drafts) {
      out[`role_${d.n}`] = { type: 'choice', instructions: `コマ${d.n}（panels の ${d.n} 番目）の役割は？`, criteria: { ...roles } };
      if (d.hasChar) out[`intensity_${d.n}`] = { type: 'score', instructions: `コマ${d.n}（panels の ${d.n} 番目）の中心人物の感情の強さは？`, criteria: INTENSITY.slice() };
    }
    // 最重要コマはページごとに（ページが 1 つなら key_panel、2 ページ目からは key_panel_2 …）
    (pages || [{ drafts }]).forEach((pg, k) => {
      if (pg.drafts.length < 2) return;
      const where = pages && pages.length > 1 ? `${k + 1}ページ目（panels の「ページ」が ${k + 1}）` : 'このページ（panels）';
      out[keyName(k)] = { type: 'choice', instructions: `${where}で最も重要なコマは？`, criteria: Object.fromEntries(pg.drafts.map((d) => [String(d.n), `コマ${d.n}：${d.summary}`])) };
    });
    return out;
  }
  /** 2回目：感情の強さが gate_intensity（1.0）以上のコマだけ、感情の細目 */
  function emotionQuestions(drafts, answers) {
    const out = {}, crit = Object.fromEntries(EMOTIONS);
    for (const d of drafts) {
      const a = answers && answers[`intensity_${d.n}`];
      if (!d.hasChar || !a || !(Number(a.score) >= THRESHOLDS.gate_intensity)) continue;
      out[`emotion_${d.n}`] = { type: 'choice', instructions: `コマ${d.n}（panels の ${d.n} 番目）の中心人物の感情は？`, criteria: { ...crit } };
    }
    return out;
  }
  /** 判定に渡す state に足すコマの一覧 */
  function stateOf(drafts, items, pages = null) {
    const pageOf = (d) => (pages ? pages.findIndex((pg) => pg.drafts.includes(d)) + 1 : 1);
    return drafts.map((d) => ({ ...(pages && pages.length > 1 ? { ページ: pageOf(d) } : {}), コマ: d.n, 内容: d.text, ...(d.lines.length ? { セリフ: d.lines.map((q) => items[q].text) } : {}), ...(d.narration ? { ナレーション: d.narration } : {}) }));
  }

  /* ---------- API なしで試すときの判定（キーワード） ---------- */
  const KW = {
    emotion: {
      '喜び': ['嬉し', 'うれし', '喜', '楽し', '笑', '幸せ'], '期待': ['楽しみ', 'わくわく', '待ち遠', 'きっと'], '興奮': ['やった', '熱', '高鳴', '叫ん'],
      '安心': ['ほっと', '安心', 'よかった', '無事'], '感動': ['胸が熱', '感動', '涙ぐ', 'ありがとう'], '照れ・ときめき': ['頬を赤', '赤くな', '照れ', 'どきどき', 'ドキドキ'],
      '悲しみ': ['悲し', '哀し', '泣', '涙', 'さよなら', '亡'], '寂しさ': ['寂し', '淋し', '独り', 'ひとりきり', 'ひとりぼっち'], '不安': ['不安', '心配', 'どうしよう', '大丈夫', '胸騒ぎ'],
      '恐怖': ['怖', '恐', '震え', '悲鳴', 'ひっ'], '焦り': ['急', '早く', '間に合', '焦'], '緊張': ['息をのん', '息を呑', '張り詰', '緊張', 'ごくり'],
      '怒り': ['怒', '許さ', 'ふざけ', '憎', '腹が立'], '後悔': ['ごめん', 'すまな', '後悔', 'もっと早く'], '疲労': ['疲れ', 'くたくた', 'へとへと', 'ため息'],
      '平穏': ['穏やか', 'のどか', '静か'], '冷静': ['落ち着', '静かに言', '冷静'], '威圧': ['立ちはだか', '見下ろし', '睨'],
      '自信': ['任せ', '平気', '当然'], '決意': ['行こう', '行きます', '決め', '覚悟', '必ず', '届け'], '驚き': ['驚', 'えっ', 'まさか', '！？', '目を丸', 'びっくり'],
      '困惑': ['え？', 'どういう', '分からな', 'わからな', '戸惑'], '呆れ': ['やれやれ', 'あきれ', '呆れ', 'まったく'],
    },
    peak: ['！', '!', '叫', '泣', '涙', '決め', '覚悟', 'まさか', '震え'],
    action: ['走', '駆け', '歩', '振', '斬', '殴', '飛', '投げ', '開け', '登', '下り', '抱'],
    turn: ['決め', '覚悟', '行こう', '行きます', '届け', 'やる', '必ず'],
  };
  const count = (s, kws) => kws.reduce((n, k) => n + (s.split(k).length - 1), 0);
  function probs(keys, w) {
    const sum = w.reduce((a, b) => a + b, 0) || 1, p = {};
    keys.forEach((k, i) => { p[k] = w[i] / sum; });
    let best = keys[0]; for (const k of keys) if (p[k] > p[best]) best = k;
    return { choice: best, probabilities: p, confidence: p[best] };
  }
  /** モック判定器から呼ばれる：コマの質問 1 つに答える */
  function mockAnswer(key, q, st) {
    const panels = (st && st.panels) || [];
    const at = (n) => panels[n - 1] || { 内容: (st && st.current) || '', セリフ: [] };
    const body = (p) => `${p.内容 || ''}${(p.セリフ || []).join('')}`;
    const intensityOf = (p) => {
      const s = body(p);
      const n = count(s, ['！', '!', '？！', '……']) * 0.6 + Object.values(KW.emotion).reduce((a, kws) => a + count(s, kws), 0) * 0.8 + count(s, KW.peak) * 0.3;
      return clamp(0.2 + n * 0.6, 0, 2);
    };
    if (/^key_panel/.test(key)) {
      const keys = Object.keys(q.criteria);
      return { type: 'choice', ...probs(keys, keys.map((k, i) => 0.4 + intensityOf(at(Number(k))) + (i === keys.length - 1 ? 0.3 : 0))) };
    }
    const n = Number(key.split('_')[1]), p = at(n), s = body(p);
    if (key.startsWith('intensity_')) {
      const v = intensityOf(p), pr = { 0: Math.max(0.05, 1 - v), 1: 0.6, 2: Math.max(0.05, v - 1) }, z = pr[0] + pr[1] + pr[2];
      for (const k in pr) pr[k] /= z;
      return { type: 'score', score: v, probabilities: pr, confidence: 0.6 };
    }
    if (key.startsWith('role_')) {
      const keys = Object.keys(q.criteria), has = (p.セリフ || []).length;
      const sc = {
        '状況説明': !has && n === 1 ? 2.2 : 0, '会話': has ? 1.2 + 0.2 * has : 0, '反応': has && /^[…ー！？!?、。\s]*$|^(え|あ|は|う|そう)/.test((p.セリフ || [''])[0]) ? 1.3 : 0,
        '感情の山場': intensityOf(p) >= 1.4 ? 1.5 : 0, '決意・転機': count(s, KW.turn) * 0.9, '動作': count(s, KW.action) * 0.5,
        '締め・ヒキ': n === panels.length && n > 1 && !has ? 1.4 : 0, '日常': 0.3,
      };
      return { type: 'choice', ...probs(keys, keys.map((k) => 0.08 + (sc[k] || 0))) };
    }
    if (key.startsWith('emotion_')) {
      const keys = Object.keys(q.criteria);
      const sc = Object.fromEntries(keys.map((k) => [k, count(s, KW.emotion[k] || [])]));
      const top = Math.max(0, ...Object.values(sc));
      // 手がかりがなければ確信度を低くする（カメラも効果も付けない）
      return { type: 'choice', ...probs(keys, keys.map((k) => (top ? 0.02 + sc[k] * 1.4 : 0.1 + (k === '緊張' ? 0.05 : 0)))) };
    }
    return null;
  }

  /* ================= 3. 判定 → 演出（カメラ・背景効果） ================= */
  const confOf = (a) => { if (!a) return 0; if (a.confidence != null) return Number(a.confidence); const p = a.probabilities && a.probabilities[a.choice]; return p != null ? Number(p) : 0; };
  const roleFallback = (d) => (d.kind === 'establish' ? '状況説明' : d.kind === 'talk' ? '会話' : d.kind === 'action' ? '動作' : d.kind === 'close' ? '締め・ヒキ' : '日常');
  /**
   * コマごとの判定結果をカメラ・背景効果に変える（03 の対応表のまま）
   * - カメラは人物の感情に付ける。感情が判定できたコマは感情→カメラ、感情のないコマだけ役割で補う
   * - 確信度が camera_min_confidence（0.35）未満ならカメラ行を付けない（役割側も同じ）
   * - 不安のダッチアングルは、感情の強さが「強い」（2段階目相当）のときだけ
   * - 背景効果は感情が強いコマだけ
   */
  function assist(drafts, answers = {}, keyQ = 'key_panel') {
    const minC = THRESHOLDS.camera_min_confidence;
    let prevFam = null;
    const panels = drafts.map((d) => {
      const R = answers[`role_${d.n}`], I = answers[`intensity_${d.n}`], E = answers[`emotion_${d.n}`];
      const roleOk = R && ROLES.some(([l]) => l === R.choice);
      const role = roleOk ? R.choice : roleFallback(d), roleConf = roleOk ? confOf(R) : 0;
      const intensity = d.hasChar && I ? clamp(Number(I.score), 0, 2) : null;
      const emoOk = E && EMOTIONS.some(([l]) => l === E.choice);
      const emotion = emoOk ? E.choice : null, emoConf = emoOk ? confOf(E) : 0;
      const strong = intensity != null && intensity >= 1.5;
      let camera = null, how = '';
      if (emotion && emoConf >= minC) {
        const c = EMO_CAMERA[emotion];
        if (c && !(c[0] === 'dutch' && !strong)) { camera = c; how = `感情「${emotion}」`; }
        else if (!c) how = `感情「${emotion}」（カメラ指定なし）`;
        else how = '不安だが強くない（ダッチアングルなし）';
      }
      if (!camera && !(emotion && emoConf >= minC) && roleConf >= minC) {
        if (ROLE_CAMERA[role]) { camera = ROLE_CAMERA[role]; how = `役割「${role}」`; }
        else if (POOL[role]) {
          const pool = POOL[role], start = Math.floor(hash(d.n, role.length) * pool.length);
          for (let k = 0; k < pool.length; k++) { const c = pool[(start + k) % pool.length]; if (c[0] !== prevFam) { camera = c; break; } }
          how = `役割「${role}」のバリエーション`;
        }
      }
      if (camera) prevFam = camera[0];
      const effect = emotion && emoConf >= minC && strong ? EFFECT[emotion] || null : null;
      return {
        n: d.n, kind: d.kind, role, roleConf, intensity, emotion, emoConf,
        camera: camera ? { family: camera[0], en: camera[1] } : null, cameraWhy: how,
        effect, flag: roleOk && roleConf < THRESHOLDS.flag_confidence,
      };
    });
    const K = answers[keyQ], key = K ? parseInt(String(K.choice).replace(/\D/g, ''), 10) : NaN;
    return { panels, key: drafts.some((d) => d.n === key) ? key : null };
  }

  /* ================= 4. ページを組む ================= */
  // 破裂型の吹き出しにする条件
  const SHOUT_WORDS = /叫|怒鳴|どな[っりる]|声を荒|わめ|喚|がなり|絶叫|吠え/;
  const SHOUT_EMO = new Set(['怒り', '驚き', '興奮']);
  const SHOUT_MARKS = /[！!][^！!？?]*[！!]|！？|!\?|？！|\?!/;
  // 背景を単色・グラデーションにしやすい撮り方（場所を見せなくてよい寄り）
  const TIGHT = new Set(['close_up', 'detail', 'profile_soft', 'over_shoulder']);
  /**
   * scene：場面判定から決めた場面（Director.decide の scene）。lines：items ごとの { text, speaker(main/sub/other), importance }
   * 戻り値 page：{ layout, panels: [{ n, kind, content, role, camera, effect, emotion, focal, faces, gestures, poses, views, talking, crop, bg, lines, narration }], key, scene }
   *   content：people（人物）| scenery（背景だけ）| animal（動物だけ）
   *   bg：null（場所を描く）| { kind: flat | gradient, colors }
   */
  function buildPage({ scene, drafts, answers = {}, lines = [], unit = null, keyQ = 'key_panel' }) {
    const A = assist(drafts, answers, keyQ);
    const f = scene && scene.figures;
    const people = !!(f && f.layout !== 'none' && (f.main || f.sub));
    const animal = f && f.animal;
    const sceneEmo = scene && scene.emotion ? SCENE_EMO[scene.emotion] : null;
    const minC = THRESHOLDS.camera_min_confidence;
    let prevIdx = -1;
    const panels = drafts.map((d, i) => {
      const a = Object.assign({}, A.panels[i]);
      const ls = d.lines.map((q) => Object.assign({ text: '', speaker: 'main', importance: 0.5 }, lines[q] || {}, { q }));
      const R = readText(d.prose || '', f);
      // 何を映すか：導入は背景だけ（動物がいれば動物だけ）。地の文が人を指さず景色だけを語る動作のコマも背景だけ
      let content = people ? 'people' : animal ? 'animal' : 'scenery';
      if (d.kind === 'establish') content = animal ? 'animal' : 'scenery';
      else if (d.kind === 'action' && !R.person && SCENERY.test(d.prose || '')) content = animal ? 'animal' : 'scenery';
      // 中心人物：セリフのコマはその話し手、それ以外は地の文の主語（分からなければ主人物）
      let focal = content === 'people' ? 'main' : null;
      if (content === 'people' && f.layout === 'two' && f.sub) {
        if (ls.length && ls[0].speaker === 'sub') focal = 'sub';
        else if (!ls.length && R.who) focal = R.who;
      }
      // 気持ち：言い回しで分かればそれ（コード）、なければ Jev の細目、強ければ場面の気持ち
      if (!(a.emotion && a.emoConf >= minC) && R.face && FACE_EMO[R.face] && content === 'people') {
        a.emotion = FACE_EMO[R.face]; a.emoConf = 0.6; a.emotionBy = 'code';
        const c = EMO_CAMERA[a.emotion];
        if (c && !(c[0] === 'dutch' && !(a.intensity >= 1.5))) { a.camera = { family: c[0], en: c[1] }; a.cameraWhy = `言い回し「${R.face}」`; }
      }
      const emo = a.emotion && a.emoConf >= minC ? a.emotion : (a.intensity != null && a.intensity >= 0.6 ? sceneEmo : null);
      const target = R.who || focal || 'main';
      const faces = {}, gestures = {}, poses = {}, views = {}, talking = {};
      if (content === 'people') {
        faces[focal] = R.face && R.face !== 'talk' ? R.face : emo ? EXPR[emo] || 'normal' : 'normal';
        if (R.face && R.face !== 'talk' && target !== focal) faces[target] = R.face;
        if (R.gesture) gestures[target] = R.gesture;
        if (R.pose) poses[target] = R.pose;
        if (R.view) views[target] = R.view;
        for (const l of ls) if (l.speaker === 'main' || l.speaker === 'sub') talking[l.speaker] = true;
        if (R.face === 'talk') talking[target] = true;
        // 横顔のカメラのコマだけ、本当の横顔にする（2人なら向き合う）
        if (a.camera && (a.camera.family === 'profile' || a.camera.family === 'profile_soft')) for (const role of ['main', 'sub']) if (!views[role]) views[role] = 'side';
      }
      const crop = content === 'people' ? R.crop : null;
      // 破裂型の吹き出し：地の文の叫ぶ言い回し（コード）・感情の細目が怒り／驚き／興奮で強い（Jev）・セリフに「！」が 2 つ以上か「！？」
      const strongEmo = a.emotion && SHOUT_EMO.has(a.emotion) && a.emoConf >= minC && a.intensity != null && a.intensity >= 1.5;
      for (const l of ls) {
        const why = SHOUT_WORDS.test(d.prose || '') ? '叫ぶ言い回し' : strongEmo ? `${a.emotion}（強い）` : SHOUT_MARKS.test(l.text) ? '！が重なる' : null;
        if (why) { l.shout = true; l.shoutWhy = why; }
      }
      return Object.assign(a, { lines: ls, narration: d.narration, text: d.text, summary: d.summary, content, hasChar: content === 'people', focal, faces, gestures, poses, views, talking, crop, read: R, expr: faces[focal] || 'normal' });
    });
    // 背景の塗り：場所を見せなくてよいコマ（人物の寄り・感情の効果がないコマ）から選ぶ。どのページにも場所の見えるコマを 1 つは残す
    const time = (scene && scene.time) || 'day';
    for (const p of panels) {
      p.bg = null;
      if (p.content !== 'people' || p.effect) continue;
      const fam = p.camera ? p.camera.family : p.kind === 'close' ? 'close_up' : null;
      const tight = TIGHT.has(fam) || p.crop === 'eyes' || p.crop === 'mouth' || p.crop === 'hand' || p.crop === 'head';
      if (tight || hash(unit == null ? 0 : unit, p.n, 7) < 0.4) { p.bg = plainFill(time, unit, p.n, prevIdx); prevIdx = p.bg.idx; }
    }
    if (panels.length && panels.every((p) => p.bg || p.effect)) { const keep = panels.find((p) => !p.effect); if (keep) keep.bg = null; }
    const tense = panels.some((p) => p.emotion && TENSE.has(p.emotion)) || (scene && scene.mood > 0.66);
    const calm = !tense && (!scene || scene.mood < 0.4);
    const layout = chooseLayout(panels.length, { tense, calm });
    const key = A.key || (panels.length > 1 ? panels.reduce((b, p) => ((p.intensity || 0) > (b.intensity || 0) ? p : b), panels[0]).n : panels.length ? panels[0].n : null);
    const sig = (p) => `${p.role}:${p.content}:${p.camera ? p.camera.family : '-'}:${p.effect || '-'}:${p.bg ? p.bg.colors.join('') : '-'}:${JSON.stringify([p.faces, p.gestures, p.poses, p.views, p.crop])}:${p.lines.map((l) => l.speaker).join('')}`;
    return { unit, layout, panels, key, scene, tense, key2: `${unit}|${layout}|${panels.map(sig).join('/')}` };
  }

  /* ================= 5. 描く ================= */
  // カメラの系統 → 手描きの絵の撮り方（ズーム・傾き・縦の伸び・どこを中心に置くか）
  const SHOTS = {
    wide: { z: 1, focus: 'scene' },
    medium: { z: 1.55, focus: 'chest', ay: 0.52 },
    over_shoulder: { z: 1.9, focus: 'head', ay: 0.42, pull: 0.3 },
    profile: { z: 1.75, focus: 'pair', ay: 0.45 },
    close_up: { z: 3.1, focus: 'head', ay: 0.48 },
    detail: { z: 3.4, focus: 'hands', ay: 0.5 },
    low_angle: { z: 1.55, focus: 'body', ay: 0.46, sy: 1.14 },
    high_angle: { z: 1.2, focus: 'body', ay: 0.6, sy: 0.86 },
    dutch: { z: 1.6, focus: 'chest', ay: 0.48, rot: 0.17 },
    dutch_light: { z: 1.5, focus: 'chest', ay: 0.48, rot: 0.06 },
    dynamic: { z: 1.4, focus: 'body', ay: 0.52, rot: -0.09 },
    medium_long: { z: 1.22, focus: 'body', ay: 0.52 },
    flat_medium: { z: 1.45, focus: 'chest', ay: 0.5 },
    profile_soft: { z: 2.4, focus: 'head', ay: 0.47, soft: true },
    plain: { z: 1.5, focus: 'chest', ay: 0.5 },
    // 見え方（地の文の言い回しから）
    eyes: { z: 5.2, focus: 'eyes', ay: 0.5 },
    mouth: { z: 4.4, focus: 'mouth', ay: 0.5 },
    hand: { z: 3.4, focus: 'hands', ay: 0.5 },
    feet: { z: 2.6, focus: 'feet', ay: 0.62 },
    head: { z: 2.6, focus: 'head', ay: 0.5 },
    animal: { z: 1, focus: 'animal' },
  };
  function shotOf(p) {
    if (p.content === 'animal') return SHOTS.animal;
    if (!p.hasChar) return SHOTS.wide;
    if (p.crop && SHOTS[p.crop]) return SHOTS[p.crop];
    if (p.camera && SHOTS[p.camera.family]) return SHOTS[p.camera.family];
    if (p.kind === 'establish') return SHOTS.wide;
    return p.kind === 'close' ? SHOTS.close_up : SHOTS.plain;
  }
  /** 絵（コマと同じ大きさの「世界」）の中で、カメラが見る点と変形 */
  function camera(L, p, scene, shot) {
    const seat = scene.location === 'washitsu' ? 'seiza' : 'chair';
    const people = D.placement(L, scene.figures, 0).map((q) => (p.poses && p.poses[q.role] ? Object.assign({}, q, { pose: p.poses[q.role] }) : q));
    const focal = people.find((q) => q.role === p.focal) || people[0];
    const other = people.find((q) => q !== focal);
    let fx = L.W / 2, fy = L.H / 2;
    // 動物だけのコマ：動物に寄る（小さい動物ほど寄る）
    if (shot.focus === 'animal') {
      const kind = scene.figures && scene.figures.animal, small = kind === 'cat' || kind === 'dog' || kind === 'rabbit';
      shot = { z: small ? 2.3 : kind === 'bird' ? 1.5 : 1.15, focus: 'scene', ay: small ? 0.58 : 0.5 };
      fx = L.W / 2; fy = L.floor - (small ? L.H * 0.08 : L.H * 0.22);
    }
    // 相手のいないコマの肩越し・横顔：寄りの大きさと、顔を置く位置で違いを出す
    if (!other && (shot === SHOTS.over_shoulder || shot === SHOTS.profile)) shot = shot === SHOTS.profile ? { z: 2.5, focus: 'head', ay: 0.5, ax: 0.62 } : { z: 2.1, focus: 'head', ay: 0.45, ax: 0.36 };
    if (focal && shot.focus !== 'scene' && shot.focus !== 'animal') {
      const h = D.headOf(L, focal, seat);
      const feet = L.floor;
      if (shot.focus === 'head') { fx = h.x; fy = h.y + h.r * 0.25; if (shot.pull && other) { const o = D.headOf(L, other, seat); fx = lerp(fx, o.x, shot.pull); } }
      else if (shot.focus === 'chest') { fx = h.x; fy = lerp(h.y, feet, 0.32); }
      else if (shot.focus === 'hands') { fx = h.x + focal.facing * h.r * 0.6; fy = lerp(h.y, feet, 0.45); }
      else if (shot.focus === 'body') { fx = h.x; fy = lerp(h.y - h.r, feet, 0.5); }
      else if (shot.focus === 'eyes') { fx = h.x + h.r * 0.1 * (focal.facing || 1) * -1; fy = h.y + h.r * 0.2; }
      else if (shot.focus === 'mouth') { fx = h.x; fy = h.y + h.r * 0.62; }
      else if (shot.focus === 'feet') { fx = h.x; fy = feet - h.r * 0.6; }
      else if (shot.focus === 'pair') { const o = other ? D.headOf(L, other, seat) : h; fx = (h.x + o.x) / 2; fy = (h.y + o.y) / 2 + h.r * 0.6; }
    }
    const z = shot.z || 1, sy = shot.sy || 1, rot = (shot.rot || 0) * (p.n % 2 ? 1 : -1);
    // 傾けても四隅が絵の外に出ないだけ拡大する
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const cover = Math.max((L.W * c + L.H * s) / L.W, (L.W * s + L.H * c) / L.H);
    const zz = Math.max(z, cover * (sy < 1 ? 1 / sy : 1));
    const ax = L.W * (shot.ax || 0.5), ay = L.H * (shot.ay || 0.5);
    // 見える範囲が絵の外に出ないように、見る点を寄せる
    const hw = (L.W * c + L.H * s) / (2 * zz), hh = (L.W * s + L.H * c) / (2 * zz * sy);
    const cx = clamp(fx + (L.W / 2 - ax) / zz, hw, L.W - hw), cy = clamp(fy + (L.H / 2 - ay) / (zz * sy), hh, L.H - hh);
    return { zz, sy, rot, cx, cy, apply(ctx) { ctx.translate(L.W / 2, L.H / 2); ctx.rotate(rot); ctx.scale(zz, zz * sy); ctx.translate(-cx, -cy); },
      map(x, y) { const dx = (x - cx) * zz, dy = (y - cy) * zz * sy, co = Math.cos(rot), si = Math.sin(rot); return [L.W / 2 + dx * co - dy * si, L.H / 2 + dx * si + dy * co]; } };
  }

  /** 背景効果（感情が強いコマだけ）。コマの画面の座標で描く。focus は中心人物の顔（画面の座標） */
  function effect(tg, L, kind, t, focus) {
    const c = tg.ctx, U = Math.min(L.W, L.H) / 600, [fx, fy] = focus || [L.W / 2, L.H / 2];
    const R = Math.hypot(L.W, L.H);
    c.save();
    if (kind === 'トーン' || kind === '白ドット') {
      const dark = kind === 'トーン';
      c.fillStyle = dark ? 'rgba(28,30,44,0.82)' : 'rgba(150,152,160,0.78)'; c.fillRect(0, 0, L.W, L.H);
      // 網点
      const step = Math.max(5, 7 * U); c.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(80,80,90,.35)';
      for (let y = 0, r = 0; y < L.H + step; y += step, r++) for (let x = (r % 2) * step / 2; x < L.W + step; x += step) { c.beginPath(); c.arc(x, y, step * 0.28, 0, Math.PI * 2); c.fill(); }
      if (!dark) for (let k = 0; k < 26; k++) { const x = hash(k, 1) * L.W, y = hash(k, 2) * L.H, rr = (6 + hash(k, 3) * 18) * U; tg.ellipse(x, y + Math.sin(t + k) * 2 * U, rr, rr, { fill: '#FFFFFF', stroke: null, seed: 7100 + k, amp: 0.4 }); }
      if (dark) { const g = c.createRadialGradient(fx, fy, 0, fx, fy, R * 0.45); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H); }
    } else if (kind === '集中線') {
      c.fillStyle = 'rgba(255,253,246,0.9)'; c.fillRect(0, 0, L.W, L.H);
      c.fillStyle = 'rgba(30,30,36,0.85)';
      for (let k = 0; k < 72; k++) {
        const a = k / 72 * Math.PI * 2 + hash(k, 1) * 0.04, w = 0.006 + hash(k, 2) * 0.012, r1 = R * (0.2 + 0.12 * hash(k, 3) + 0.03 * Math.sin(t * 9 + k));
        c.beginPath(); c.moveTo(fx + Math.cos(a - w) * R, fy + Math.sin(a - w) * R); c.lineTo(fx + Math.cos(a) * r1, fy + Math.sin(a) * r1); c.lineTo(fx + Math.cos(a + w) * R, fy + Math.sin(a + w) * R); c.fill();
      }
    } else if (kind === '流線') {
      c.fillStyle = 'rgba(250,250,246,0.88)'; c.fillRect(0, 0, L.W, L.H);
      c.strokeStyle = 'rgba(30,30,36,0.7)'; c.lineCap = 'round';
      for (let k = 0; k < 46; k++) { const y = hash(k, 1) * L.H, len = (0.2 + hash(k, 2) * 0.5) * L.W, x = ((hash(k, 3) * L.W * 1.6 - t * L.W * 1.4) % (L.W * 1.6) + L.W * 1.6) % (L.W * 1.6) - L.W * 0.3; c.lineWidth = (1 + hash(k, 4) * 2.4) * U; c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke(); }
    } else if (kind === 'キラキラ') {
      const g = c.createLinearGradient(0, 0, 0, L.H); g.addColorStop(0, 'rgba(255,246,214,.86)'); g.addColorStop(1, 'rgba(255,214,222,.86)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);
      for (let k = 0; k < 22; k++) { const tw = 0.5 + 0.5 * Math.sin(t * 3.4 + k * 1.9); if (tw < 0.2) continue; const x = hash(k, 5) * L.W, y = hash(k, 6) * L.H; if (Math.hypot(x - fx, y - fy) < Math.min(L.W, L.H) * 0.18) continue; tg.star(x, y, (6 + tw * 12) * U, { fill: '#FFF8D8', lw: 2 * U, seed: 7200 + k, amp: 0.4 }); }
    } else if (kind === 'オーラ') {
      c.fillStyle = 'rgba(250,246,236,.78)'; c.fillRect(0, 0, L.W, L.H);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      const g = c.createRadialGradient(fx, fy, 0, fx, fy, R * (0.42 + 0.04 * pulse)); g.addColorStop(0, 'rgba(255,240,190,.95)'); g.addColorStop(0.5, 'rgba(255,226,170,.45)'); g.addColorStop(1, 'rgba(255,226,170,0)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);
      for (let k = 0; k < 3; k++) tg.ellipse(fx, fy, R * (0.16 + k * 0.08 + pulse * 0.02), R * (0.2 + k * 0.08 + pulse * 0.02), { stroke: 'rgba(230,180,90,.45)', lw: 2.5 * U, seed: 7300 + k, amp: 2, second: false });
    } else if (kind === '花') {
      const g = c.createLinearGradient(0, 0, L.W, L.H); g.addColorStop(0, 'rgba(255,232,238,.88)'); g.addColorStop(1, 'rgba(252,244,226,.88)'); c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);
      for (let k = 0; k < 14; k++) {
        const x = hash(k, 7) * L.W, y = ((hash(k, 8) * L.H + t * 12 * U * (1 + hash(k, 9))) % (L.H + 60 * U)) - 30 * U;
        if (Math.hypot(x - fx, y - fy) < Math.min(L.W, L.H) * 0.2) continue;
        const r = (10 + hash(k, 10) * 12) * U, col = ['#F6B6C8', '#FBD3A8', '#F9E6F0'][k % 3];
        for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2 + t * 0.3 + k; tg.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.5, r * 0.5, { fill: col, lw: 1.6 * U, seed: 7400 + k * 7 + j, second: false, amp: 0.4 }); }
        tg.ellipse(x, y, r * 0.25, r * 0.25, { fill: '#F2C84B', lw: 1.4 * U, seed: 7490 + k, second: false, amp: 0.3 });
      }
    }
    c.restore();
  }

  /* ---------- 縦書きの吹き出し・ナレーション ---------- */
  const ROTATE = /[ー－—―…‥〜～（）()「」『』【】\-~A-Za-z0-9]/;
  const PUNCT = /[、。，．]/;
  const SMALL = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
  const HEAD_NG = /[、。，．」』）)！？!?ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
  const toFull = (t) => t.replace(/!/g, '！').replace(/\?/g, '？').replace(/[\s　]+/g, '');
  const FONT_SPEECH = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
  /** 縦書きの文字の箱：列の高さ maxH に収まるよう、字の大きさと列数を決める（4列まで） */
  // minFs：これより小さくしない（スマホで読める大きさ）。入りきらなければ、文字を小さくする代わりに列を 1 つ足す
  function columns(text, fs0, maxH, maxCols = 4, pad = 0.7, minFs = 0) {
    let fs = Math.max(fs0, minFs), t = toFull(text);
    for (let k = 0; k < 6; k++) {
      const per = Math.max(2, Math.floor((maxH - fs * pad * 2) / fs));
      const cols = Math.ceil(t.length / per);
      if (cols <= maxCols || k === 5 || (fs <= minFs && cols <= maxCols + 1)) {
        if (fs <= minFs && cols === maxCols + 1) maxCols++;
        if (cols > maxCols) { t = t.slice(0, per * maxCols - 1) + '…'; }
        const n = Math.ceil(t.length / Math.min(maxCols, cols)), rows = [];
        for (let i = 0; i < t.length; i += n) rows.push(t.slice(i, i + n));
        // 禁則：句読点・閉じ括弧・長音・小さい仮名を列の頭に置かない（前の列の最後にぶら下げる）
        for (let i = 1; i < rows.length; i++) while (rows[i] && HEAD_NG.test(rows[i][0])) { rows[i - 1] += rows[i][0]; rows[i] = rows[i].slice(1); }
        const rs = rows.filter(Boolean), hmax = Math.max(...rs.map((r) => r.length));
        return { fs, rows: rs, w: rs.length * fs * 1.32 + fs * pad * 2 - fs * 0.32, h: hmax * fs + fs * pad * 2, pad: fs * pad };
      }
      fs = Math.max(minFs, fs * 0.86);
    }
  }
  function verticalText(tg, B, x, y, color, weight) {
    const c = tg.ctx; c.save(); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `${weight} ${B.fs}px ${FONT_SPEECH}`;
    B.rows.forEach((col, ci) => {
      const x0 = x + B.w - B.pad - B.fs / 2 - ci * B.fs * 1.32;
      [...col].forEach((ch, i) => {
        const y0 = y + B.pad + B.fs * (i + 0.5);
        c.save(); c.translate(x0, y0);
        if (PUNCT.test(ch)) c.translate(B.fs * 0.32, -B.fs * 0.3);
        else if (SMALL.test(ch)) c.translate(B.fs * 0.1, -B.fs * 0.08);
        if (ROTATE.test(ch)) c.rotate(Math.PI / 2);
        c.fillText(ch, 0, 0); c.restore();
      });
    });
    c.restore();
  }
  /** 吹き出しの輪郭：角の丸い箱にしっぽを継ぎ足した1本の線（手描きで揺れる）。tip が null ならしっぽなし */
  function balloon(tg, x, y, w, h, tip, { lw, seed, shout } = {}) {
    const fs = Math.min(w, h) * 0.2, r = Math.min(w, h) * 0.46, step = Math.max(8, fs * 0.5);
    let pts = tg.points.rrPts(x, y, w, h, r, step);
    if (shout) pts = pts.map((p, i) => { if (i % 2) return p; const cx = x + w / 2, cy = y + h / 2, k = 1.12; return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]; });
    if (tip) {
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.hypot(p[0] - tip[0], p[1] - tip[1]); if (d < bd) { bd = d; best = i; } });
      const span = Math.max(1, Math.round(Math.min(w, h) * 0.12 / step)), n = pts.length, out = [];
      for (let i = 0; i < n; i++) { const di = Math.min(Math.abs(i - best), n - Math.abs(i - best)); if (di > span) out.push(pts[i]); else if (i === best) out.push(tip); }
      pts = out;
    }
    tg.shape(pts, { fill: '#FFFFFF', lw, seed, amp: 1 });
  }

  /** コマの吹き出しの置き場所を決める（ページの座標）。セリフ 2 つなら右が先（読み順は右→左） */
  function placeBubbles(p, r, heads, U, minFs = 0) {
    const out = [];
    const n = p.lines.length; if (!n) return out;
    const m = Math.max(6, Math.min(r.w, r.h) * 0.04);
    const fs0 = clamp(Math.min(r.w * 0.075, r.h * 0.07), 11 * U, 30 * U);
    const maxH = r.h * (n > 1 ? 0.62 : 0.66) - m;
    let rightEdge = r.x + r.w - m;
    p.lines.forEach((l, i) => {
      const imp = l.importance ?? 0.5;
      const B = columns(l.text, fs0 * (imp >= 0.75 ? 1.1 : 1), maxH, n > 1 ? 3 : 4, 0.7, minFs);
      const head = heads[l.speaker];
      // 1つだけのセリフは話し手の側に、2つなら右から順に
      let x = rightEdge - B.w;
      if (n === 1 && head && head[0] < r.x + r.w / 2) x = r.x + m;
      x = clamp(x, r.x + m, r.x + r.w - m - B.w);
      let y = r.y + m + (i % 2) * Math.min(r.h * 0.06, 18 * U);
      y = clamp(y, r.y + m, r.y + r.h - m - B.h);
      // しっぽ：話し手の頭へ。頭がコマの外・場面にいない声ならしっぽなし
      let tip = null;
      if (head && l.speaker !== 'other' && head[0] > r.x && head[0] < r.x + r.w && head[1] > r.y && head[1] < r.y + r.h) {
        // 吹き出しの縁でいちばん頭に近いところから、頭のほうへ伸ばす（口元の手前で止める）
        const tx = head[0], ty = head[1] + head[2] * 0.2;
        const ex = clamp(tx, x + B.w * 0.15, x + B.w * 0.85), ey = clamp(ty, y + B.h * 0.15, y + B.h * 0.85);
        const inside = tx > x && tx < x + B.w && ty > y && ty < y + B.h;
        const dx = tx - ex, dy = ty - ey, len = Math.hypot(dx, dy);
        if (!inside && len > 1) {
          const edge = Math.min(Math.abs(dx) > 1e-6 ? (dx > 0 ? x + B.w - ex : ex - x) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? (dy > 0 ? y + B.h - ey : ey - y) / Math.abs(dy) : Infinity) * len;
          const reach = clamp(len - edge - head[2] * 1.05, B.fs * 0.5, B.fs * 2.2);
          if (len - edge > head[2] * 0.3) tip = [ex + dx / len * (edge + reach), ey + dy / len * (edge + reach)];
        }
      }
      out.push({ x, y, B, tip, imp, speaker: l.speaker, text: l.text, shout: !!l.shout });
      rightEdge = x - m * 0.6;
    });
    return out;
  }

  // 線のゆがみ（手描きの線の震え）の大きさ。手描き挿絵文庫の 0.4 倍に抑える
  const LINE_AMP = 0.4;
  /** 作業用の canvas（コマの絵）。大きさごとに 1 枚を使い回す */
  const pool = new Map();
  function scratch(w, h) {
    const k = `${w}x${h}`;
    let s = pool.get(k);
    if (!s) {
      if (pool.size > 10) pool.clear();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const f = document.createElement('canvas'); f.width = w; f.height = h;
      s = { tg: T.create(c, { style: 'paper', post: false, amp: LINE_AMP }), ftg: T.create(f, { style: 'paper', post: false, amp: LINE_AMP }) };
      pool.set(k, s);
    }
    return s;
  }

  /** 背景の塗り（単色・グラデーション）。コマの画面の座標で塗る */
  function fillPlain(c, w, h, bg) {
    if (bg.kind === 'flat') { c.fillStyle = bg.colors[0]; c.fillRect(0, 0, w, h); return; }
    const g = bg.angle === 'd' ? c.createLinearGradient(0, 0, w, h) : c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg.colors[0]); g.addColorStop(1, bg.colors[1]);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }

  /** コマ 1 つの絵：背景（場所・塗り）→ 背景効果 → 人物か動物（カメラ）→ 天候 → 空気 */
  function drawPanelScene(p, scene, w, h, t, opts) {
    const S = scratch(w, h), tg = S.tg, c = tg.ctx;
    tg.setTime(t);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
    const L = D.layout(tg); L.still = true;
    const shot = shotOf(p), cam = camera(L, p, scene, shot);
    const world = { location: scene.location || 'none', time: scene.time || 'day', era: scene.era || 'modern' };
    if (p.bg) fillPlain(c, w, h, p.bg);
    else { c.save(); cam.apply(c); D.background(tg, L, world, t); c.restore(); }
    // 人物の顔（コマの座標）。コマごとの姿勢（座るなど）で頭の位置が変わる
    const seat = world.location === 'washitsu' ? 'seiza' : 'chair';
    const heads = {};
    if (p.content === 'people') for (const q0 of D.placement(L, scene.figures, 0)) { const q = p.poses && p.poses[q0.role] ? Object.assign({}, q0, { pose: p.poses[q0.role] }) : q0; const hd = D.headOf(L, q, seat), [x, y] = cam.map(hd.x, hd.y); heads[q.role] = [x, y, hd.r * cam.zz]; }
    const focus = heads[p.focal] || heads.main || null;
    if (p.effect) effect(tg, L, p.effect, t, focus);
    const f = scene.figures;
    const figs = p.content === 'people' ? f : p.content === 'animal' && f && f.animal ? { layout: 'none', animal: f.animal } : null;
    if (opts.figures !== false && figs && (figs.layout !== 'none' || figs.animal)) {
      const ft = S.ftg, fc = ft.ctx; ft.setTime(t);
      fc.setTransform(1, 0, 0, 1, 0, 0); fc.clearRect(0, 0, w, h);
      fc.save(); cam.apply(fc);
      const F = p.faces || {};
      D.figures(ft, L, { figures: figs, era: world.era, time: world.time, location: world.location, expr: F.main || 'normal', subExpr: F.sub || 'normal', gestures: p.gestures, poses: p.poses, views: p.views, talking: p.talking, innerK: p.effect || p.bg ? 0.7 : 0, crowdVariant: scene.crowdVariant || 0 }, t);
      fc.restore();
      c.drawImage(ft.canvas, 0, 0);
    }
    if (!p.effect && !p.bg) {
      const w2 = scene.weather, indoor = INDOOR.has(world.location);
      D.weather(tg, L, { rain: w2 === 'rain' && !indoor ? 1 : 0, snow: w2 === 'snow' && !indoor ? 1 : 0, cloudy: w2 === 'cloudy' ? 1 : w2 === 'rain' || w2 === 'snow' ? 0.6 : 0, fog: w2 === 'fog' ? (indoor ? 0.3 : 1) : 0 }, t);
    }
    const m = scene.mood || 0;
    if (m > 0.4 && !p.effect) {
      c.save(); c.globalCompositeOperation = 'saturation'; c.fillStyle = `rgba(128,128,128,${(0.5 * (m - 0.4)).toFixed(3)})`; c.fillRect(0, 0, w, h); c.restore();
    }
    if (shot.soft) { c.save(); c.globalCompositeOperation = 'screen'; const g = c.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.max(w, h)); g.addColorStop(0, 'rgba(255,236,220,.45)'); g.addColorStop(1, 'rgba(255,236,220,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.restore(); }
    return { canvas: tg.canvas, heads, shot };
  }
  const INDOOR = new Set(['washitsu', 'yoshitsu', 'kitchen', 'genkan', 'classroom', 'shop', 'bedroom', 'library', 'office', 'hospital', 'church', 'castle', 'cave']);

  /** ページの外枠（2:3）を、描く場所 box に収める */
  function pageBox(box) {
    const r = 2 / 3;
    let w = box.w, h = w / r;
    if (h > box.h) { h = box.h; w = h * r; }
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  /**
   * ページを描く。tg はページ全体の canvas。opts：
   *   box：ページを置く範囲（既定は canvas 全体）　reveal(n) → 0〜1：コマごとの出方（順に出す）
   *   alpha：ページ全体の濃さ　bubbles：吹き出しを出すか　figures：人物を出すか
   */
  function render(tg, page, t, opts = {}) {
    if (!page) return;
    const c = tg.ctx, box = opts.box || { x: 0, y: 0, w: tg.W, h: tg.H };
    const P = pageBox(box), U = P.w / 600, a0 = opts.alpha ?? 1;
    c.save(); c.globalAlpha = a0;
    // 紙
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(P.x + 4 * U, P.y + 6 * U, P.w, P.h);
    c.fillStyle = '#FFFFFF'; c.fillRect(P.x, P.y, P.w, P.h);
    const rects = panelRects(page.layout, P);
    page.panels.forEach((p, i) => {
      const r = rects[i]; if (!r) return;
      const k = opts.reveal ? opts.reveal(i) : 1;
      if (k <= 0.003) return;
      const w = Math.max(16, Math.round(r.w)), h = Math.max(16, Math.round(r.h));
      const S = drawPanelScene(p, page.scene || {}, w, h, t, opts);
      c.save(); c.globalAlpha = a0 * k;
      // 枠の中だけに絵
      c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
      c.drawImage(S.canvas, r.x, r.y, r.w, r.h);
      // 吹き出し・ナレーション
      const heads = {}; for (const [role, v] of Object.entries(S.heads)) heads[role] = [r.x + v[0] * r.w / w, r.y + v[1] * r.h / h, v[2] * r.w / w];
      if (opts.bubbles !== false) {
        for (const b of placeBubbles(p, r, heads, U, opts.minFont || 0)) {
          balloon(tg, b.x, b.y, b.B.w, b.B.h, b.tip, { lw: (b.imp >= 0.75 ? 3.2 : 2.2) * U, seed: 5000 + i * 10 + b.text.length, shout: b.shout || b.imp >= 0.75 || (/[！!]/.test(b.text) && b.imp >= 0.6) });
          verticalText(tg, b.B, b.x, b.y, '#16161C', b.imp >= 0.75 ? 700 : 600);
        }
        if (p.narration) {
          const m = Math.max(6, Math.min(r.w, r.h) * 0.035), B = columns(p.narration, clamp(Math.min(r.w * 0.06, r.h * 0.058), 10 * U, 22 * U), r.h * 0.7, 3, 0.55, (opts.minFont || 0) * 0.9);
          const x = r.x + r.w - m - B.w, y = r.y + m;
          c.fillStyle = '#FFFFFF'; c.fillRect(x, y, B.w, B.h);
          c.strokeStyle = '#16161C'; c.lineWidth = 1.6 * U; c.strokeRect(x, y, B.w, B.h);
          verticalText(tg, B, x, y, '#16161C', 400);
        }
      }
      c.restore();
      // 枠線（最重要コマは太く）
      tg.rrect(r.x, r.y, r.w, r.h, 1.5 * U, { stroke: '#16161C', lw: (page.key === p.n && page.panels.length > 1 ? 4.4 : 2.8) * U, seed: 6000 + i, amp: 0.7, second: false });
      c.restore();
    });
    c.restore();
    return { P, rects };
  }

  /** デバッグ表示用：コマごとの判定と演出（03 のサンプル JSON の形に近い） */
  function describe(page) {
    if (!page) return '';
    const code = (p) => { const R = p.read || {}; return [R.gesture && `手:${R.gesture}`, R.face && `顔:${R.face}`, R.pose && R.pose, R.view && R.view, R.crop && `切り取り:${R.crop}`, R.who && `主語:${R.who}`].filter(Boolean).join(' '); };
    return [`レイアウト ${page.layout}・最重要コマ ${page.key}`, ...page.panels.map((p) => `コマ${p.n}［${p.role} ${p.roleConf.toFixed(2)}${p.flag ? '・要確認' : ''}］${p.content !== 'people' ? (p.content === 'animal' ? '動物だけ・' : '背景だけ・') : ''}${p.intensity != null ? `強さ ${p.intensity.toFixed(2)}` : ''}${p.emotion ? `・${p.emotion} ${p.emoConf.toFixed(2)}${p.emotionBy === 'code' ? '（言い回し）' : ''}` : ''} → ${p.camera ? p.camera.family : 'カメラなし'}${p.effect ? `・${p.effect}` : ''}${p.bg ? `・塗り ${p.bg.kind}` : ''}${p.lines.length ? `・セリフ${p.lines.length}` : ''}${p.lines.some((l) => l.shout) ? `・破裂（${p.lines.filter((l) => l.shout).map((l) => l.shoutWhy).join('・')}）` : ''}${code(p) ? `｜コード：${code(p)}` : ''}`)].join('\n');
  }

  const Manga = {
    THRESHOLDS, ROLES, EMOTIONS, EMO_CAMERA, ROLE_CAMERA, POOL, EFFECT, TENSE, EXPR, LAYOUTS, SHOTS, PALETTE, GESTURES, FACES,
    split, paginate, pageAt, keyName, sentences, caption, questions, emotionQuestions, stateOf, isPanelKey, mockAnswer, assist, readText, plainFill, buildPage, chooseLayout, panelRects, pageBox,
    render, drawPanelScene, placeBubbles, columns, describe, LINE_AMP,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Manga;
  root.Manga = Manga;
})(typeof window !== 'undefined' ? window : globalThis);
