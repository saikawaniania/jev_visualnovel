// manga.js — 手描き漫画文庫：小説の場面（判定単位の本文）を「1場面＝1ページの漫画（数コマ）」にする。
//
// 工程（移植セット 04_scene_to_page.md の順）：
//   1. コマ割り        Manga.split(text, items)            本文 → コマの下書き（導入・会話・動作・締め）
//   2. Jevアシスト判定  Manga.questions(drafts)              コマごとの役割・感情の強さ・最重要コマ（場面判定と同じ1回の問い合わせに束ねる）
//                      Manga.emotionQuestions(drafts, ans)  強さ 1.0 以上のコマだけ、感情の細目（23択）を2回目で聞く
//   3. 演出の対応       Manga.assist(drafts, answers)        判定 → カメラ・背景効果（03_jev_assist_spec.md の表と閾値のまま）
//   4. ページを組む     Manga.buildPage({...})                レイアウト（02 のレイアウト表）・コマごとの人物と吹き出し
//   5. 描く            Manga.render(tg, page, t, opts)       手描きの絵（draw.js）をコマの中に描き、枠・吹き出し・ナレーションを載せる
//   6. プロンプト       Manga.prompt(page, opts)              画像生成モデルへ渡すページプロンプト（02_prompt_spec.md の型と固定ルール）
//
// 絵は draw.js の手描きをそのまま使う（画像生成はしない）。画像生成モデルを使うときは、6 のプロンプトを持っていく。
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
  const EFFECT_EN = {
    'キラキラ': 'sparkles and small twinkling stars scattered across the background',
    'オーラ': 'a soft glowing aura of light radiating behind the figure',
    '花': 'soft flowers drifting in the background',
    'トーン': 'a dark screentone background that sinks the mood',
    '集中線': 'radial focus lines converging on the figure',
    '流線': 'horizontal speed lines streaming across the background',
    '白ドット': 'a grey screentone background scattered with white dots',
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
  function split(text, items = []) {
    const src = String(text || '');
    const flow = []; // { q: items の番号 } または { n: 地の文 }
    let last = 0;
    const used = new Set();
    for (const m of src.matchAll(/「([^「」]{1,120})」|『([^『』]{1,120})』/g)) {
      const t = norm(m[1] || m[2]);
      const idx = items.findIndex((it, i) => !used.has(i) && it.text === t);
      if (idx < 0) continue; // 候補から外れたセリフ・地の文の中の名前は地の文のまま
      const before = src.slice(last, m.index);
      if (before.trim()) flow.push({ n: before });
      flow.push({ q: idx }); used.add(idx);
      last = m.index + m[0].length;
    }
    if (src.slice(last).trim()) flow.push({ n: src.slice(last) });

    const quotes = flow.filter((f) => f.q != null);
    const narrAll = flow.filter((f) => f.n).flatMap((f) => sentences(f.n));
    const drafts = [];
    const add = (kind, o) => drafts.push(Object.assign({ kind, lines: [], narration: '', text: '', hasChar: kind !== 'establish' }, o));

    if (!quotes.length) {
      // セリフのない場面：導入（引き）→ 動作 → 締め（寄り）。短ければ 2 コマ
      const ss = narrAll;
      if (!ss.length) { add('establish', { text: src.trim() }); return finish(drafts, items); }
      const three = src.replace(/\s/g, '').length >= 120 && ss.length >= 3;
      add('establish', { narration: caption(ss[0]), text: ss[0] });
      if (three) { const mid = ss[Math.floor(ss.length / 2)]; add('action', { text: ss.slice(1, -1).join('') || mid }); }
      add('close', { text: ss.length > 1 ? ss[ss.length - 1] : ss[0] });
      return finish(drafts, items);
    }

    // セリフのある場面
    const opening = flow[0].n != null ? sentences(flow[0].n) : [];
    const lastQ = flow.map((f) => f.q != null).lastIndexOf(true);
    const closing = flow.slice(lastQ + 1).filter((f) => f.n).flatMap((f) => sentences(f.n));
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
    // セリフの間の地の文（「と少女が言った」など）は、そのコマの説明に添える
    for (const g of groups) {
      const pos = flow.findIndex((f) => f.q === g[0]), end = flow.findIndex((f) => f.q === g[g.length - 1]);
      const around = flow.slice(pos + 1, Math.min(flow.length, end + 2)).filter((f) => f.n).map((f) => sentences(f.n)[0] || '').join('');
      add('talk', { lines: g.slice(), text: g.map((q) => `「${items[q].text}」`).join('') + around });
    }
    if (wantClose) add('close', { text: closing.join('') });
    return finish(drafts, items);
  }
  function finish(drafts, items) {
    drafts.forEach((d, i) => {
      d.n = i + 1;
      const body = (d.text || '').replace(/[\s　]+/g, '');
      d.summary = body.length > 28 ? body.slice(0, 27) + '…' : body;
    });
    return drafts;
  }

  /* ================= 2. Jevアシストの質問 ================= */
  const isPanelKey = (k) => /^(role|intensity|emotion)_\d+$/.test(k) || k === 'key_panel';
  /** 1回目：全コマの役割＋（キャラのいるコマは）感情の強さ、ページの最重要コマ。場面判定と同じ問い合わせに足す */
  function questions(drafts) {
    const out = {};
    const roles = Object.fromEntries(ROLES);
    for (const d of drafts) {
      out[`role_${d.n}`] = { type: 'choice', instructions: `コマ${d.n}（panels の ${d.n} 番目）の役割は？`, criteria: { ...roles } };
      if (d.hasChar) out[`intensity_${d.n}`] = { type: 'score', instructions: `コマ${d.n}（panels の ${d.n} 番目）の中心人物の感情の強さは？`, criteria: INTENSITY.slice() };
    }
    if (drafts.length >= 2) {
      out.key_panel = { type: 'choice', instructions: 'このページ（panels）で最も重要なコマは？', criteria: Object.fromEntries(drafts.map((d) => [String(d.n), `コマ${d.n}：${d.summary}`])) };
    }
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
  function stateOf(drafts, items) {
    return drafts.map((d) => ({ コマ: d.n, 内容: d.text, ...(d.lines.length ? { セリフ: d.lines.map((q) => items[q].text) } : {}), ...(d.narration ? { ナレーション: d.narration } : {}) }));
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
    if (key === 'key_panel') {
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
  function assist(drafts, answers = {}) {
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
    const K = answers.key_panel, key = K ? parseInt(String(K.choice).replace(/\D/g, ''), 10) : NaN;
    return { panels, key: key >= 1 && key <= drafts.length ? key : null };
  }

  /* ================= 4. ページを組む ================= */
  /**
   * scene：場面判定から決めた場面（Director.decide の scene）。lines：items ごとの { text, speaker(main/sub/other), importance }
   * 戻り値 page：{ layout, panels: [{ n, kind, role, camera, effect, emotion, expr, focal, lines, narration, ... }], key, scene }
   */
  function buildPage({ scene, drafts, answers = {}, lines = [], unit = null }) {
    const A = assist(drafts, answers);
    const f = scene && scene.figures;
    const people = !!(f && f.layout !== 'none' && (f.main || f.sub));
    const sceneEmo = scene && scene.emotion ? SCENE_EMO[scene.emotion] : null;
    const panels = drafts.map((d, i) => {
      const a = A.panels[i];
      const ls = d.lines.map((q) => Object.assign({ text: '', speaker: 'main', importance: 0.5 }, lines[q] || {}, { q }));
      // 中心人物：セリフのコマはその話し手（場面にいない声なら主人物）、それ以外は主人物
      let focal = people && d.hasChar ? 'main' : null;
      if (people && ls.length && ls[0].speaker === 'sub' && f.layout === 'two' && f.sub) focal = 'sub';
      const emo = a.emotion && a.emoConf >= THRESHOLDS.camera_min_confidence ? a.emotion : (a.intensity != null && a.intensity >= 0.6 ? sceneEmo : null);
      return Object.assign({}, a, { lines: ls, narration: d.narration, text: d.text, summary: d.summary, hasChar: people && d.hasChar, focal, expr: emo ? EXPR[emo] || 'normal' : 'normal' });
    });
    const tense = panels.some((p) => p.emotion && TENSE.has(p.emotion)) || (scene && scene.mood > 0.66);
    const calm = !tense && (!scene || scene.mood < 0.4);
    const layout = chooseLayout(panels.length, { tense, calm });
    const key = A.key || (panels.length > 1 ? panels.reduce((b, p) => ((p.intensity || 0) > (b.intensity || 0) ? p : b), panels[0]).n : 1);
    return { unit, layout, panels, key, scene, tense, key2: `${unit}|${layout}|${panels.map((p) => `${p.role}:${p.camera ? p.camera.family : '-'}:${p.effect || '-'}:${p.lines.map((l) => l.speaker).join('')}`).join('/')}` };
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
  };
  function shotOf(p) {
    if (!p.hasChar) return SHOTS.wide;
    if (p.camera && SHOTS[p.camera.family]) return SHOTS[p.camera.family];
    if (p.kind === 'establish') return SHOTS.wide;
    return p.kind === 'close' ? SHOTS.close_up : SHOTS.plain;
  }
  /** 絵（コマと同じ大きさの「世界」）の中で、カメラが見る点と変形 */
  function camera(L, p, scene, shot) {
    const seat = scene.location === 'washitsu' ? 'seiza' : 'chair';
    const people = D.placement(L, scene.figures, 0);
    const focal = people.find((q) => q.role === p.focal) || people[0];
    const other = people.find((q) => q !== focal);
    let fx = L.W / 2, fy = L.H / 2;
    // 相手のいないコマの肩越し・横顔：寄りの大きさと、顔を置く位置で違いを出す
    if (!other && (shot === SHOTS.over_shoulder || shot === SHOTS.profile)) shot = shot === SHOTS.profile ? { z: 2.5, focus: 'head', ay: 0.5, ax: 0.62 } : { z: 2.1, focus: 'head', ay: 0.45, ax: 0.36 };
    if (focal && shot.focus !== 'scene') {
      const h = D.headOf(L, focal, seat);
      const feet = L.floor;
      if (shot.focus === 'head') { fx = h.x; fy = h.y + h.r * 0.25; if (shot.pull && other) { const o = D.headOf(L, other, seat); fx = lerp(fx, o.x, shot.pull); } }
      else if (shot.focus === 'chest') { fx = h.x; fy = lerp(h.y, feet, 0.32); }
      else if (shot.focus === 'hands') { fx = h.x + focal.facing * h.r * 0.6; fy = lerp(h.y, feet, 0.45); }
      else if (shot.focus === 'body') { fx = h.x; fy = lerp(h.y - h.r, feet, 0.5); }
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
  function columns(text, fs0, maxH, maxCols = 4, pad = 0.7) {
    let fs = fs0, t = toFull(text);
    for (let k = 0; k < 6; k++) {
      const per = Math.max(2, Math.floor((maxH - fs * pad * 2) / fs));
      const cols = Math.ceil(t.length / per);
      if (cols <= maxCols || k === 5) {
        if (cols > maxCols) { t = t.slice(0, per * maxCols - 1) + '…'; }
        const n = Math.ceil(t.length / Math.min(maxCols, cols)), rows = [];
        for (let i = 0; i < t.length; i += n) rows.push(t.slice(i, i + n));
        // 禁則：句読点・閉じ括弧・長音・小さい仮名を列の頭に置かない（前の列の最後にぶら下げる）
        for (let i = 1; i < rows.length; i++) while (rows[i] && HEAD_NG.test(rows[i][0])) { rows[i - 1] += rows[i][0]; rows[i] = rows[i].slice(1); }
        const rs = rows.filter(Boolean), hmax = Math.max(...rs.map((r) => r.length));
        return { fs, rows: rs, w: rs.length * fs * 1.32 + fs * pad * 2 - fs * 0.32, h: hmax * fs + fs * pad * 2, pad: fs * pad };
      }
      fs *= 0.86;
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
  function placeBubbles(p, r, heads, U) {
    const out = [];
    const n = p.lines.length; if (!n) return out;
    const m = Math.max(6, Math.min(r.w, r.h) * 0.04);
    const fs0 = clamp(Math.min(r.w * 0.075, r.h * 0.07), 11 * U, 30 * U);
    const maxH = r.h * (n > 1 ? 0.62 : 0.66) - m;
    let rightEdge = r.x + r.w - m;
    p.lines.forEach((l, i) => {
      const imp = l.importance ?? 0.5;
      const B = columns(l.text, fs0 * (imp >= 0.75 ? 1.1 : 1), maxH, n > 1 ? 3 : 4);
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
      out.push({ x, y, B, tip, imp, speaker: l.speaker, text: l.text });
      rightEdge = x - m * 0.6;
    });
    return out;
  }

  /** 作業用の canvas（コマの絵）。大きさごとに 1 枚を使い回す */
  const pool = new Map();
  function scratch(w, h) {
    const k = `${w}x${h}`;
    let s = pool.get(k);
    if (!s) {
      if (pool.size > 10) pool.clear();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const f = document.createElement('canvas'); f.width = w; f.height = h;
      s = { tg: T.create(c, { style: 'paper', post: false }), ftg: T.create(f, { style: 'paper', post: false }) };
      pool.set(k, s);
    }
    return s;
  }

  /** コマ 1 つの絵：背景（カメラ）→ 背景効果 → 人物（カメラ）→ 天候 → 空気 */
  function drawPanelScene(p, scene, w, h, t, opts) {
    const S = scratch(w, h), tg = S.tg, c = tg.ctx;
    tg.setTime(t);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
    const L = D.layout(tg); L.still = true;
    const shot = shotOf(p), cam = camera(L, p, scene, shot);
    const world = { location: scene.location || 'none', time: scene.time || 'day', era: scene.era || 'modern' };
    c.save(); cam.apply(c); D.background(tg, L, world, t); c.restore();
    // 中心人物の顔（コマの座標）
    const seat = world.location === 'washitsu' ? 'seiza' : 'chair';
    const heads = {};
    for (const q of D.placement(L, scene.figures, 0)) { const hd = D.headOf(L, q, seat), [x, y] = cam.map(hd.x, hd.y); heads[q.role] = [x, y, hd.r * cam.zz]; }
    const focus = heads[p.focal] || heads.main || null;
    if (p.effect) effect(tg, L, p.effect, t, focus);
    if (opts.figures !== false && p.hasChar !== false && scene.figures && (scene.figures.layout !== 'none' || scene.figures.animal)) {
      const ft = S.ftg, fc = ft.ctx; ft.setTime(t);
      fc.setTransform(1, 0, 0, 1, 0, 0); fc.clearRect(0, 0, w, h);
      fc.save(); cam.apply(fc);
      const mainExpr = p.focal === 'sub' ? 'normal' : p.expr, subExpr = p.focal === 'sub' ? p.expr : 'normal';
      D.figures(ft, L, { figures: scene.figures, era: world.era, time: world.time, location: world.location, expr: mainExpr, subExpr, innerK: p.effect ? 0.7 : 0, crowdVariant: scene.crowdVariant || 0 }, t);
      fc.restore();
      c.drawImage(ft.canvas, 0, 0);
    } else if (!p.hasChar && scene.figures && scene.figures.layout !== 'none' && opts.figures !== false && p.kind === 'establish') {
      // 導入のコマでも、人がいる場面なら引きで小さく描く
      const ft = S.ftg, fc = ft.ctx; ft.setTime(t);
      fc.setTransform(1, 0, 0, 1, 0, 0); fc.clearRect(0, 0, w, h);
      fc.save(); cam.apply(fc);
      D.figures(ft, L, { figures: scene.figures, era: world.era, time: world.time, location: world.location, expr: 'normal' }, t);
      fc.restore(); c.drawImage(ft.canvas, 0, 0);
    }
    if (!p.effect) {
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
        for (const b of placeBubbles(p, r, heads, U)) {
          balloon(tg, b.x, b.y, b.B.w, b.B.h, b.tip, { lw: (b.imp >= 0.75 ? 3.2 : 2.2) * U, seed: 5000 + i * 10 + b.text.length, shout: b.imp >= 0.75 || /[！!]{1}/.test(b.text) && b.imp >= 0.6 });
          verticalText(tg, b.B, b.x, b.y, '#16161C', b.imp >= 0.75 ? 700 : 600);
        }
        if (p.narration) {
          const m = Math.max(6, Math.min(r.w, r.h) * 0.035), B = columns(p.narration, clamp(Math.min(r.w * 0.06, r.h * 0.058), 10 * U, 22 * U), r.h * 0.7, 3, 0.55);
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

  /* ================= 6. ページプロンプト（02_prompt_spec.md） ================= */
  const STYLES = {
    flat: { label: '簡易カラー（手描きの絵に近い）', line: 'Simple flat-colour manga artwork, clean line art.', colour: true },
    colour: { label: 'カラー', line: 'Colour: Full colour artwork.', colour: true },
    watercolour: { label: 'カラー＋水彩寄り', line: 'Colour: Full colour artwork in a pale watercolour style with bold unpainted areas.', colour: true },
    mono: { label: 'モノクロ（スクリーントーン）', line: 'Black-and-white manga artwork with screentones.', colour: false },
  };
  const FIXED = {
    open: 'Generate a complete manga page. Lay the panels out yourself using the panel layout rules below — do not look for a layout reference image.',
    order: 'Reading order: this is a JAPANESE manga page — the panels are read RIGHT TO LEFT. Panel 1 is at the TOP RIGHT of the page and the last panel is at the BOTTOM LEFT. Never lay the page out left-to-right.',
    halo: '重要: Around every character silhouette, add a soft blurred white edge about 3px wide, just outside the black outline, so the characters separate cleanly from the background. Keep it subtle — a soft halo, not a hard sticker-like cutout border.',
    format: 'The page is vertical portrait format (taller than wide, 2:3 ratio).',
  };
  const TAIL = `CRITICAL rules for text in speech bubbles:
- A bubble contains ONLY the spoken words. NEVER write a character's name inside or near a bubble, and NEVER prefix speech with a name like '佐々木：' or '課長：'.
- All bubble/caption text must be in Japanese, set vertically (top-to-bottom columns read right-to-left) in a clear manga font — never horizontally. Make the lettering large: fill most of its bubble or caption box, never small or thin. This applies to speech bubbles, inner monologue boxes and narration captions alike.
- Keep each vertical text column short enough to fit inside its bubble or caption box without overflowing.
CRITICAL rules for character line art:
- Maintain consistent character appearance across all panels.
- Anyone who is NOT listed as a character in this prompt (unnamed passers-by, bystanders, figures only mentioned in a panel description, people from the past) must be designed independently: never give them the face, hairstyle, hair colour or outfit of any listed character, and never draw them in a way that could be mistaken for a named character.
- Vary the camera work in every panel — angle, shot size, lens height and framing — drawing freely on the full vocabulary of Japanese manga camera work rather than a fixed set of shots. Do NOT repeat the same camera work in consecutive panels.
- For dramatic or emotional highlight moments, boldly use a large panel to fill significant space. Contrast large panels with small ones to create visual rhythm and impact on the page.
- The last panel of the page should end on a moment that makes the reader want to turn the page — a reaction shot, a cliffhanger line, an unresolved tension, or a surprising reveal.
CRITICAL rules for panel layout:
- NEVER draw panel numbers (①②③④ or 1234), labels, markers or annotations anywhere in the image. Panels are told apart by their borders alone.
- Draw the panels in EXACTLY the order given above. NEVER reorder them, never merge two panels into one, never split one panel into two, and never drop a panel.
- Gutters: about 6px between panels that sit side by side, about 16px between rows. The area outside the panels is pure white.`;
  const TAIL_WHO = `CRITICAL rules for who says what (panels with two or more characters):
- Follow the Character placement block exactly. Do NOT swap which character is on the right and which is on the left.
- Every speech bubble must have a visible tail, and that tail must point to the mouth of the ONE character named as its speaker — never to any other character.
- Each bubble states where to place it. Where a bubble is placed away from its speaker to preserve reading order, keep that placement and stretch the tail across to the speaker — reading order wins over putting the bubble near its speaker.
- A character marked SILENT must have no speech bubble at all. Do not invent lines for them.
- The speaker names in this prompt are instructions for tail direction only. They must never appear as drawn text anywhere in the image.
- Bubbles are read right-to-left then top-to-bottom, so the numbered order above must match that reading order.`;

  // 簡易キャラ表：見た目の種類 × 時代（作品の中では同じ文を使い回す → 場面をまたいで見た目が崩れない）
  const TYPE_JA = { man: '成人男性', woman: '成人女性', boy: '少年', girl: '少女', oldman: '老人（男）', oldwoman: '老人（女）', middleman: '中年男性', middlewoman: '中年女性', baby: '幼児', soldier: '兵士・騎士', monk: '僧侶・聖職者', ghost: 'おばけ', unknown: '人物' };
  const TYPE_EN = {
    man: 'male, about 25 — a slim young man, short black hair, calm eyes',
    woman: 'female, about 25 — a slender young woman, long dark hair, gentle almond-shaped eyes',
    boy: 'male, about 12 — a boy with short, slightly messy hair and a bright face',
    girl: 'female, about 10 — a small girl with round eyes and a lively face',
    oldman: 'male, about 70 — an old man, bald with a white fringe, slightly stooped, walks with a stick',
    oldwoman: 'female, about 70 — an old woman, grey hair in a bun, small and gentle',
    middleman: 'male, about 50 — a sturdy middle-aged man, short hair, a moustache',
    middlewoman: 'female, about 45 — a middle-aged woman, hair tied up, an apron',
    baby: 'a toddler of about 2, round cheeks and a tuft of hair',
    soldier: 'male, adult — an armed soldier or knight',
    monk: 'male, adult — a priest or monk with a shaved head',
    ghost: 'a ghost — a figure under a floating white sheet with two dark eye holes',
    unknown: 'an adult of unclear age and gender, plain features',
  };
  const WEAR = {
    modern: { man: 'a dark kimono and hakama', woman: 'a patterned kimono with an obi', boy: 'a dark school uniform with a cap', girl: 'a bright patterned kimono with a red ribbon', oldman: 'a plain brown kimono', oldwoman: 'a muted purple kimono', middleman: 'a brown kimono', middlewoman: 'a kimono with a white apron', soldier: 'an olive Imperial-era army uniform and cap', monk: 'a black monk’s robe with a brown kesa', baby: 'a small kimono', unknown: 'a plain kimono', ghost: '' },
    present: { man: 'a casual shirt and dark trousers', woman: 'a light blouse and a knee-length skirt', boy: 'a T-shirt and shorts', girl: 'a knee-length dress with pigtails and a red ribbon', oldman: 'a beige shirt and grey trousers, glasses', oldwoman: 'a long lavender dress and glasses', middleman: 'a white shirt and tie, dark trousers', middlewoman: 'a long dress with an apron', soldier: 'a modern camouflage uniform and helmet', monk: 'a black monk’s robe with a brown kesa', baby: 'a yellow T-shirt and shorts', unknown: 'plain casual clothes', ghost: '' },
    western: { man: 'a dark frock coat, waistcoat and tie, sometimes a top hat', woman: 'a long Victorian gown', boy: 'a tweed jacket, shorts and a tie', girl: 'a knee-length dress with a pale ribbon', oldman: 'a grey coat, a short beard, a walking stick', oldwoman: 'a long dark gown', middleman: 'a brown coat and tie, a moustache', middlewoman: 'a long dress with an apron', soldier: 'a red military coat with white trousers', monk: 'a black cassock with a cross', baby: 'a white gown', unknown: 'a plain coat', ghost: '' },
    fantasy: { man: 'a tunic, trousers and a cloak', woman: 'a long gown with a pale cloak', boy: 'a simple tunic', girl: 'a knee-length dress with pigtails and a yellow ribbon', oldman: 'a blue wizard robe and pointed hat, a long beard, a staff', oldwoman: 'a purple robe and a dark cloak', middleman: 'a tunic, a moustache', middlewoman: 'a long dress with an apron', soldier: 'silver plate armour, a helmet and a cloak', monk: 'a white robe with a golden cross', baby: 'a small tunic', unknown: 'a tunic and a grey cloak', ghost: '' },
  };
  const LOC_EN = {
    washitsu: 'a Japanese tatami room with shoji screens and fusuma', yoshitsu: 'a Western-style room with a table, chairs and a window', kitchen: 'a kitchen', genkan: 'an entrance hall and corridor',
    classroom: 'a school classroom with a blackboard', shop: 'the inside of a shop or café, with a counter', station: 'a railway station platform or the inside of a train', street: 'a town street',
    alley: 'a narrow back alley', garden: 'a garden', field: 'open fields and meadows', forest: 'a forest path', river: 'a riverbank with a bridge', seaside: 'a seashore',
    nightsky: 'an open place under a starry night sky', bedroom: 'a bedroom', library: 'a library with tall bookshelves', office: 'an office with desks', hospital: 'a hospital room',
    shrine: 'a temple or shrine precinct', church: 'a church interior', castle: 'a castle hall', park: 'a park with benches', rooftop: 'a building rooftop with a fence', ship: 'the deck of a ship',
    snowmountain: 'a snowy mountain', graveyard: 'a graveyard', cave: 'a dark cave', none: 'a plain background',
  };
  const TIME_EN = { morning: 'morning light', day: 'daytime', evening: 'evening, the glow of sunset', night: 'night' };
  const WEATHER_EN = { rain: 'rain is falling', snow: 'snow is falling', cloudy: 'an overcast sky', fog: 'fog hangs in the air' };
  const ERA_EN = { modern: 'Meiji–early Showa era Japan', present: 'present-day Japan', western: 'a 19th-century European setting', fantasy: 'a fantasy kingdom' };

  /** 場面の登場人物（簡易キャラ表の行）。役割 main / sub と見た目 */
  function cast(scene) {
    const f = scene && scene.figures; if (!f || f.layout === 'none') return [];
    const out = [];
    const era = scene.era || 'modern';
    const add = (role, type) => { if (!type) return; const same = out.find((c) => c.type === type); const name = `${TYPE_JA[type] || '人物'}${same ? 'B' : role === 'main' ? '' : ''}`; out.push({ role, type, name: same ? `${TYPE_JA[type]}（2人目）` : TYPE_JA[type] || '人物', en: TYPE_EN[type] || TYPE_EN.unknown, wear: (WEAR[era] || WEAR.modern)[type] || '' }); };
    add('main', f.main);
    if (f.layout === 'two') add('sub', f.sub);
    return out;
  }
  function prompt(page, { style = 'flat' } = {}) {
    if (!page) return '';
    const S = STYLES[style] || STYLES.flat, sc = page.scene || {}, L = LAYOUTS[page.layout];
    const people = cast(sc), who = (role) => people.find((c) => c.role === role);
    const loc = LOC_EN[sc.location || 'none'] || LOC_EN.none;
    const out = [FIXED.open];
    if (page.panels.length > 1) out.push(FIXED.order);
    out.push(S.line);
    if (S.colour && people.length) out.push(FIXED.halo);
    out.push(FIXED.format, '', L.en, '', 'Fill each panel with the following scenes:', '');
    out.push('Backgrounds:');
    out.push(`- The location notes below are the ART-SETTING reference. Follow each location's design, colour, lighting and props as described, and redraw the location from whatever camera angle the panel needs.`);
    out.push('- Use the background matching the location described for that panel. Never blend two locations in one panel.');
    out.push('- Give characters and background the same light source and colour temperature, and always add a contact shadow under the characters.');
    out.push(`Location notes:\n- 「${sc.location || 'none'}」: ${loc}, ${ERA_EN[sc.era] || ERA_EN.modern}; ${TIME_EN[sc.time] || TIME_EN.day}${WEATHER_EN[sc.weather] ? `; ${WEATHER_EN[sc.weather]}` : ''}.`);
    if (people.length) {
      out.push('', 'Character notes — these notes govern face, hair, build, proportions and what they wear. Keep them consistent in every panel:');
      for (const c of people) out.push(`- 「${c.name}」: ${c.en}.${c.wear ? ` Wearing: ${c.wear}` : ''}`);
    }
    page.panels.forEach((p) => {
      out.push('', `=== Panel ${p.n} ===`);
      const inPanel = p.hasChar ? people : (p.kind === 'establish' && people.length ? people : []);
      if (p.hasChar && inPanel.length) out.push(`Characters in this panel: ${inPanel.map((c) => `「${c.name}」`).join(', ')} — draw them exactly as described in the character notes.`);
      const focal = who(p.focal);
      const desc = p.kind === 'establish' ? `Establishing view of ${loc}${inPanel.length ? `, the characters small in the frame` : ', no people'}.` : `${focal ? `${focal.name} is the focus of this panel. ` : ''}Scene (from the novel, Japanese): ${p.text}`;
      out.push(desc);
      if (p.kind === 'establish') out.push(`Scene (from the novel, Japanese): ${p.text}`);
      if (p.camera) out.push(`Camera: ${p.camera.en}.`);
      if (p.effect) out.push(`Background effect: ${EFFECT_EN[p.effect]}.`);
      out.push("Background: draw this panel's concrete location, following the location notes.");
      if (p.narration) out.push(`Story narration caption box (rectangular banner at top or bottom of panel, Japanese vertical writing): ${p.narration}`);
      if (p.lines.length) {
        const two = p.hasChar && people.length >= 2;
        const speaks = (c) => p.lines.findIndex((l) => l.speaker === c.role);
        if (two) {
          out.push('Character placement (CRITICAL — these sides are fixed for the whole conversation. Use exactly these sides even if the speaking order changes; the two characters must NOT swap sides between panels):');
          for (const [side, role] of [['RIGHT', 'main'], ['LEFT', 'sub']]) {
            const c = who(role); if (!c) continue; const k = speaks(c);
            out.push(`  - ${side}: 「${c.name}」, facing ${side === 'RIGHT' ? 'left' : 'right'}, ${k >= 0 ? `speaks ${['1st', '2nd', '3rd', '4th'][k]}` : 'SILENT in this panel — give this character NO speech bubble'}`);
          }
        }
        out.push('Speech bubbles (白い吹き出し, rounded balloon, Japanese vertical writing). The speaker noted for each bubble tells you where to aim the tail — it is NOT text to draw:');
        p.lines.forEach((l, k) => {
          const c = who(l.speaker);
          out.push(`  ${k + 1}. bubble text only: 「${l.text}」`);
          if (c) out.push(`     spoken by 「${c.name}」${two ? ` (${l.speaker === 'main' ? 'RIGHT' : 'LEFT'} character)` : ''} — place this bubble near 「${c.name}」's head and draw a short pointed tail from the bubble to 「${c.name}」's mouth.`);
          else out.push('     spoken by someone who is not in the panel (a voice off-panel, a phone or a letter) — draw the bubble with no tail.');
        });
      }
    });
    out.push('', TAIL);
    if (page.panels.some((p) => p.lines.length && p.hasChar) && people.length >= 2) out.push(TAIL_WHO);
    return out.join('\n');
  }

  /** デバッグ表示用：コマごとの判定と演出（03 のサンプル JSON の形に近い） */
  function describe(page) {
    if (!page) return '';
    return [`レイアウト ${page.layout}・最重要コマ ${page.key}`, ...page.panels.map((p) => `コマ${p.n}［${p.role} ${p.roleConf.toFixed(2)}${p.flag ? '・要確認' : ''}］${p.intensity != null ? `強さ ${p.intensity.toFixed(2)}` : ''}${p.emotion ? `・${p.emotion} ${p.emoConf.toFixed(2)}` : ''} → ${p.camera ? p.camera.family : 'カメラなし'}${p.effect ? `・${p.effect}` : ''}${p.lines.length ? `・セリフ${p.lines.length}` : ''}`)].join('\n');
  }

  const Manga = {
    THRESHOLDS, ROLES, EMOTIONS, EMO_CAMERA, ROLE_CAMERA, POOL, EFFECT, EFFECT_EN, TENSE, EXPR, LAYOUTS, STYLES, SHOTS,
    split, sentences, caption, questions, emotionQuestions, stateOf, isPanelKey, mockAnswer, assist, buildPage, chooseLayout, panelRects, pageBox,
    render, drawPanelScene, placeBubbles, columns, prompt, cast, describe,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Manga;
  root.Manga = Manga;
})(typeof window !== 'undefined' ? window : globalThis);
