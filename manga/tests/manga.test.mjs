// 漫画にする工程（manga.js）：コマ割り・Jevアシストの質問と対応表・レイアウト・吹き出し・ページプロンプト
import { openApp, check, done } from './harness.mjs';

const app = await openApp({ viewport: { width: 1000, height: 800 } });
const { page } = app;

console.log('コマ割り（1場面＝1ページ・2〜4コマ）');
const sp = await page.evaluate(() => {
  const run = (text) => { const items = JV.Parser.quoteItems(text); return Manga.split(text, items).map((d) => ({ kind: d.kind, lines: d.lines, narration: d.narration, hasChar: d.hasChar })); };
  const talk = '夜更けの停車場は、雪になっていた。\n「汽車は、まだでしょうか」\n女は線路の先を見た。\n「もうすぐ来ますよ」\n私がそう言うと、女は少しだけ笑った。';
  const many = '雨だった。\n「あ」\n「い」\n「う、うそでしょう！」\n「本当だよ」\n「え……」\n「最後の一言だ！」\nふたりは黙った。';
  const quiet = '朝の座敷には、障子越しに淡い光がさしていた。';
  const long = '昼過ぎ、私は町の大通りを歩いていた。往来には荷車が行き交い、軒を並べた店の暖簾が風に揺れている。角の古本屋の前で足を止めた。店先に積まれた本の山の中に、見覚えのある背表紙が一冊まじっていた。手に取ると、それは母が若い頃に読んでいた詩集だった。私はしばらく、そこから動けなかった。';
  const startQ = '「おはよう」\n少女が言った。';
  return { talk: run(talk), many: run(many), quiet: run(quiet), long: run(long), startQ: run(startQ), cap: Manga.caption('あ'.repeat(50)), caps: Manga.caption('一つ目の文で、少し長めに続いていく説明のところ、さらに続く文章がここにあって終わる。') };
});
check(sp.talk.map((d) => d.kind).join() === 'establish,talk,talk,close', `導入 → 会話 → 会話 → 締め (${sp.talk.map((d) => d.kind)})`);
check(sp.talk[0].narration === '夜更けの停車場は、雪になっていた。' && !sp.talk[0].hasChar && sp.talk.slice(1).every((d) => d.hasChar), '導入のコマは地の文をナレーションに・人物の感情は聞かない');
check(sp.many.length <= 4 && sp.many.every((d) => d.lines.length <= 2), `1 ページに割るときは 4 コマまで・1コマ 2 つまで（入りきらない分はページ分けで次のページへ） (${JSON.stringify(sp.many.map((d) => d.lines))})`);
check(sp.quiet.length === 2 && sp.long.length === 3, `セリフのない場面：短ければ 2 コマ、長ければ 3 コマ (${sp.quiet.length}, ${sp.long.length})`);
check(sp.startQ[0].kind === 'talk' && sp.startQ[0].lines.join() === '0', `セリフで始まる場面は導入のコマを作らない (${sp.startQ.map((d) => d.kind)})`);
check(sp.cap.length <= 34 && sp.cap.endsWith('…') && sp.caps.endsWith('…'), `ナレーションは枠に入る長さで切る (${sp.caps})`);

console.log('ページ分け（会話の多い場面・途中で場面が変わる場面）');
const pg = await page.evaluate(() => {
  const run = (text) => { const items = JV.Parser.quoteItems(text); const pages = Manga.paginate(text, items); return { items, text, pages }; };
  const talk7 = '夕方の教室に、二人だけが残っていた。\n「まだ帰らないの」\n少女が言った。\n「宿題が終わらないんだ」\n「手伝ってあげようか」\n「いいよ」\n少年は首を振った。\n「意地っ張りね」\n「そっちこそ」\n「じゃあ、先に帰るから」';
  const turn = '朝の座敷は静かだった。私は手紙を読み返した。\n「行ってきます」\nやがて日が暮れて、雨が降り出した。私は傘を探した。';
  const four = '雨だった。\n「あ」\n「い」\n「う」\n「え」\nふたりは黙った。';
  const five = '雨だった。\n「あ」\n「い」\n「う」\n「え」\n「お」\nふたりは黙った。';
  const A = run(talk7), B = run(turn), C = run(four), D = run(five);
  const nums = A.pages.flatMap((p) => p.drafts.map((d) => d.n));
  const linesOf = (r) => r.pages.map((p) => p.drafts.flatMap((d) => d.lines).length);
  const q = Manga.questions(A.pages.flatMap((p) => p.drafts), A.pages);
  const st = Manga.stateOf(A.pages.flatMap((p) => p.drafts), A.items, A.pages);
  const at = (r, t) => Manga.pageAt(r.pages, r.text.indexOf(t));
  return {
    a: linesOf(A), aAll: A.pages.flatMap((p) => p.drafts.flatMap((d) => d.lines)).length, nums, contiguous: A.pages.every((p, k) => k === 0 || p.start === A.pages[k - 1].end) && A.pages[0].start === 0 && A.pages.at(-1).end === talk7.length,
    b: B.pages.length, bSecond: B.pages[1] && B.pages[1].drafts[0].kind, c: C.pages.length, d: linesOf(D),
    keys: Object.keys(q).filter((k) => /^key_panel/.test(k)), page2: st.find((x) => x.ページ === 2) && st.find((x) => x.ページ === 2).コマ,
    at: [at(A, '夕方の教室'), at(A, '意地っ張り'), at(A, 'じゃあ'), at(B, 'やがて'), at(B, '朝の座敷')],
  };
});
check(pg.a.length >= 2 && pg.a.every((n) => n <= 4) && pg.aAll === 7, `セリフが 5 つ以上なら、ページに分けて全部描く (${pg.a}・計 ${pg.aAll})`);
check(pg.nums.join() === pg.nums.map((_, i) => i + 1).join(), `コマの番号はページをまたいで通し番号 (${pg.nums})`);
check(pg.contiguous, 'ページの範囲は本文を切れ目なく覆う');
check(pg.b === 2 && pg.bSecond === 'establish', `「やがて」で場面が変わると次のページ・導入のコマから (${pg.b}, ${pg.bSecond})`);
check(pg.c === 1 && pg.d.length === 2 && pg.d.reduce((a, b) => a + b, 0) === 5, `セリフ 4 つまでは 1 ページ・5 つなら 2 ページ (${pg.c} / ${pg.d})`);
check(pg.keys.length === pg.a.length && pg.keys[0] === 'key_panel' && pg.keys[1] === 'key_panel_2', `最重要コマはページごとに聞く (${pg.keys})`);
check(pg.page2 > 0, 'state のコマにページの番号を付ける');
check(pg.at[0] === 0 && pg.at[2] === pg.a.length - 1 && pg.at[3] === 1 && pg.at[4] === 0, `読んでいる位置からページを選ぶ (${pg.at})`);

console.log('Jevアシストの質問（03 の質問票）');
const qs = await page.evaluate(() => {
  const text = '森の奥。\n「見つけた！」\n少女は走り出した。';
  const items = JV.Parser.quoteItems(text), drafts = Manga.split(text, items);
  const q = Manga.questions(drafts);
  const strong = { intensity_2: { score: 1.4 }, intensity_3: { score: 0.6 } };
  const eq = Manga.emotionQuestions(drafts, strong);
  const scene = JV.Judge.questions('scene', items, 'fantasy');
  return { keys: Object.keys(q), roles: Object.keys(q.role_1.criteria), intensity: q.intensity_2, key: Object.keys(q.key_panel.criteria), eq: Object.keys(eq), emoN: Object.keys(eq.emotion_2.criteria).length, clash: Object.keys(q).filter((k) => k in scene), state: Manga.stateOf(drafts, items) };
});
check(qs.keys.join() === 'role_1,role_2,intensity_2,role_3,intensity_3,key_panel', `全コマの役割・人物のいるコマの感情の強さ・最重要コマ (${qs.keys})`);
check(qs.roles.join() === '状況説明,会話,反応,感情の山場,決意・転機,動作,締め・ヒキ,日常', '役割は 8 項目');
check(qs.intensity.type === 'score' && qs.intensity.criteria.length === 3, '感情の強さは Score（0〜2）');
check(qs.key.join() === '1,2,3', 'ページの最重要コマは Choice');
check(qs.eq.join() === 'emotion_2' && qs.emoN === 23, `感情の細目は強さ 1.0 以上のコマだけ・23 項目 (${qs.eq})`);
check(qs.clash.length === 0, '場面判定の質問とキーが重ならない（1回の問い合わせに束ねられる）');
check(qs.state.length === 3 && qs.state[1].セリフ[0] === '見つけた！', 'state にコマの一覧（内容・セリフ）を足す');

console.log('判定 → 演出（03 の対応表と閾値）');
const as = await page.evaluate(() => {
  const ch = (label, p) => ({ type: 'choice', choice: label, probabilities: { [label]: p }, confidence: p });
  const d = (n, kind = 'talk') => ({ n, kind, lines: [0], hasChar: kind !== 'establish' });
  const one = (ans, kind = 'talk') => Manga.assist([d(1, kind)], ans).panels[0];
  const r = {
    awe: one({ role_1: ch('会話', 0.6), intensity_1: { score: 1.6 }, emotion_1: ch('威圧', 0.8) }),
    anxWeak: one({ role_1: ch('会話', 0.6), intensity_1: { score: 1.2 }, emotion_1: ch('不安', 0.8) }),
    anxStrong: one({ role_1: ch('会話', 0.6), intensity_1: { score: 1.8 }, emotion_1: ch('不安', 0.8) }),
    joy: one({ role_1: ch('状況説明', 0.9), intensity_1: { score: 1.7 }, emotion_1: ch('喜び', 0.9) }),
    joyMid: one({ role_1: ch('日常', 0.9), intensity_1: { score: 1.2 }, emotion_1: ch('喜び', 0.9) }),
    lowEmo: one({ role_1: ch('状況説明', 0.8), intensity_1: { score: 1.7 }, emotion_1: ch('怒り', 0.3) }),
    lowRole: one({ role_1: ch('状況説明', 0.3) }, 'establish'),
    action: one({ role_1: ch('動作', 0.5), intensity_1: { score: 0.3 } }),
    peak: one({ role_1: ch('感情の山場', 0.9), intensity_1: { score: 0.6 } }),
    shy: one({ role_1: ch('会話', 0.6), intensity_1: { score: 1.9 }, emotion_1: ch('照れ・ときめき', 0.7) }),
    flag: one({ role_1: ch('会話', 0.2) }),
  };
  const talk = Manga.assist([1, 2, 3, 4].map((n) => d(n)), Object.fromEntries([1, 2, 3, 4].map((n) => [`role_${n}`, ch('会話', 0.7)]))).panels.map((p) => p.camera.family);
  const react = Manga.assist([1, 2, 3].map((n) => d(n)), Object.fromEntries([1, 2, 3].map((n) => [`role_${n}`, ch('反応', 0.7)]))).panels.map((p) => p.camera.family);
  const key = Manga.assist([d(1), d(2)], { key_panel: ch('2', 0.7) }).key;
  const cam = (p) => p.camera && p.camera.family;
  return { r: Object.fromEntries(Object.entries(r).map(([k, p]) => [k, [cam(p), p.effect, p.flag]])), en: r.awe.camera.en, talk, react, key };
});
check(as.r.awe[0] === 'low_angle' && as.r.awe[1] === null, `威圧 → ローアングル・効果なし (${as.r.awe})`);
check(as.r.anxWeak[0] === null && as.r.anxStrong[0] === 'dutch', `不安のダッチアングルは「強い」ときだけ (${as.r.anxWeak[0]} / ${as.r.anxStrong[0]})`);
check(as.r.anxStrong[1] === 'トーン' && as.r.anxWeak[1] === null, '背景効果は感情が強いコマだけ（不安 → トーン）');
check(as.r.joy[0] === null && as.r.joy[1] === 'キラキラ' && as.r.joyMid[1] === null, `喜びはカメラ指定なし（役割より感情が優先）・強ければキラキラ (${as.r.joy})`);
check(as.r.lowEmo[0] === 'wide' && as.r.lowEmo[1] === null, `感情の確信度が 0.35 未満なら感情は使わず、役割で補う (${as.r.lowEmo})`);
check(as.r.lowRole[0] === null, `役割の確信度も 0.35 未満ならカメラ行を付けない (${as.r.lowRole})`);
check(as.r.action[0] === 'dynamic' && as.r.peak[0] === null, `役割 → カメラは状況説明・動作・日常だけ (${as.r.action[0]} / ${as.r.peak[0]})`);
check(as.r.shy[0] === 'profile_soft' && as.r.shy[1] === '花', `照れ・ときめき → 横顔の柔らかい寄り・花 (${as.r.shy})`);
check(as.r.flag[2] === true && as.r.awe[2] === false, '役割の確信度がかなり低い（0.3 未満）ときだけ要確認');
check(as.en === 'a strong low-angle shot looking up at the figure, giving an overwhelming, imposing presence', '英語文は対応表のまま');
check(as.talk.every((f, i) => i === 0 || f !== as.talk[i - 1]) && as.react.every((f, i) => i === 0 || f !== as.react[i - 1]), `会話・反応はプールから回し、直前と同じ系統を続けない (${as.talk} / ${as.react})`);
check(as.key === 2, '最重要コマ');

console.log('レイアウト（02 のレイアウト表）');
const lay = await page.evaluate(() => {
  const P = { x: 0, y: 0, w: 600, h: 900 };
  const pick = [1, 2, 3, 4].map((n) => Manga.chooseLayout(n, { calm: true })).concat(Manga.chooseLayout(4, { tense: true }));
  const out = {};
  for (const name of Object.keys(Manga.LAYOUTS)) {
    const R = Manga.panelRects(name, P);
    const inside = R.every((r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= 600.01 && r.y + r.h <= 900.01 && r.w > 50 && r.h > 50);
    let overlap = false;
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], b = R[j]; if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlap = true; }
    // 読む順：同じ段では右が先、段は上が先
    let order = true;
    for (let i = 1; i < R.length; i++) { const a = R[i - 1], b = R[i]; const sameRow = Math.abs(a.y - b.y) < 2; if (sameRow ? !(b.x < a.x) : !(b.y > a.y)) order = false; }
    out[name] = { n: R.length, inside, overlap, order };
  }
  const box = Manga.pageBox({ x: 0, y: 0, w: 1000, h: 600 });
  return { pick, out, ratio: box.w / box.h };
});
check(lay.pick.join() === 'full_page,2comma,3comma,T4-G,4comma', `コマ数と山場から選ぶ：穏やかな4コマは T4-G、緊張した4コマは 4comma (${lay.pick})`);
for (const [name, o] of Object.entries(lay.out)) check(o.inside && !o.overlap && o.order, `${name}：${o.n} コマがページに収まり、重ならず、右上から読む順`);
check(Math.abs(lay.ratio - 2 / 3) < 0.001, 'ページは縦長 2:3');

console.log('吹き出しと縦書き');
const bb = await page.evaluate(() => {
  const B = Manga.columns('お忘れですか。昔、この川のほとりで、よくお会いしましたのに', 20, 200);
  const r = { x: 100, y: 50, w: 300, h: 260 };
  const p = { lines: [{ text: '汽車は、まだでしょうか', speaker: 'sub', importance: 0.5 }, { text: 'もうすぐ来ますよ。きっと', speaker: 'main', importance: 0.9 }] };
  const heads = { main: [330, 220, 20], sub: [160, 230, 20] };
  const out = Manga.placeBubbles(p, r, heads, 1);
  const other = Manga.placeBubbles({ lines: [{ text: '至急、城へ戻れ', speaker: 'other' }] }, r, heads, 1)[0];
  return { rows: B.rows, out: out.map((b) => ({ x: b.x, y: b.y, w: b.B.w, h: b.B.h, tip: b.tip })), other: other.tip, r };
});
check(bb.rows.every((row, i) => i === 0 || !/^[、。」…ー]/.test(row)), `禁則：句読点を列の頭に置かない (${bb.rows.join(' / ')})`);
check(bb.out.every((b) => b.x >= bb.r.x && b.y >= bb.r.y && b.x + b.w <= bb.r.x + bb.r.w + 0.5 && b.y + b.h <= bb.r.y + bb.r.h + 0.5), '吹き出しはコマの中に収める（枠の外に文字を出さない）');
check(bb.out[0].x > bb.out[1].x, '1 つ目のセリフが右（右から左へ読む）');
const toward = (b, hx) => Math.sign(b.tip[0] - (b.x + b.w / 2)) === Math.sign(hx - (b.x + b.w / 2));
check(bb.out[0].tip && bb.out[1].tip && toward(bb.out[0], 160) && bb.out[1].tip[1] > bb.out[1].y, `しっぽは話し手の頭のほうへ (${bb.out.map((b) => b.tip && b.tip.map(Math.round))})`);
check(bb.other === null, '場面にいない声はしっぽなし');

console.log('コード側の判定（地の文の言い回し）');
const rd = await page.evaluate(() => {
  const f2 = { layout: 'two', main: 'man', sub: 'woman', pose: 'stand' };
  const r = (t, f = f2) => { const x = Manga.readText(t, f); return [x.gesture, x.face, x.pose, x.view, x.crop, x.who].map((v) => v || '-').join(','); };
  return {
    cheer: r('少年は両手を上げて跳ねた。', { layout: 'one', main: 'boy' }),
    smile: r('女は少しだけ笑った。'),
    micro: r('私は微笑んだ。'),
    cry: r('女は泣き笑いの顔になった。'),
    kimochi: r('私は複雑な気持ちになった。'),
    sit: r('老人は縁側に腰を下ろした。', { layout: 'one', main: 'oldman' }),
    back: r('彼女は背を向けたまま、窓の外を見ていた。'),
    side: r('男の横顔が、街灯に照らされた。'),
    eyes: r('彼女の目元が、かすかに揺れた。'),
    hand: r('私は手のひらの切符を見つめた。'),
    think: r('男は顎に手を当てて考え込んだ。'),
    none: r('雨が降っていた。'),
    person: [Manga.readText('雨が降っていた。', f2).person, Manga.readText('女が立っていた。', f2).person],
  };
});
check(rd.cheer === 'cheer,-,-,-,-,main', `両手を上げる (${rd.cheer})`);
check(rd.smile.startsWith('-,joy') && rd.smile.endsWith(',sub') && rd.micro.startsWith('-,calm'), `「笑った」は笑顔、「微笑」は穏やか・主語の「女は」で相手のこと (${rd.smile} / ${rd.micro})`);
check(rd.cry.startsWith('-,cry'), `泣き笑いは泣く（上の行が優先） (${rd.cry})`);
check(rd.kimochi.startsWith('-,'), `「気持ち」は「持つ」と読まない (${rd.kimochi})`);
check(rd.sit.split(',')[2] === 'sit', `腰を下ろす → 座る (${rd.sit})`);
check(rd.back.split(',')[3] === 'back' && rd.side.split(',')[3] === 'side', `背を向ける → 後ろ姿・横顔 → 横顔 (${rd.back} / ${rd.side})`);
check(rd.eyes.split(',')[4] === 'eyes' && rd.hand.split(',')[4] === 'hand' && rd.hand.startsWith('hold'), `目元・手元の切り取り（手元は両手を前に） (${rd.eyes} / ${rd.hand})`);
check(rd.think.startsWith('think'), `顎に手 → 考える (${rd.think})`);
check(rd.none === '-,-,-,-,-,-' && rd.person.join() === 'false,true', '人を指す言葉がない文は何も拾わない');

console.log('背景だけ・動物だけのコマと、背景の塗り');
const bgs = await page.evaluate(async () => {
  const text = '夕暮れの川べりに、風が吹いていた。\n「どなたです」\n女はゆっくりと振り向いた。\n「お忘れですか」\n男は驚いて目を見開いた。';
  const items = JV.Parser.quoteItems(text), drafts = Manga.split(text, items);
  const lines = [{ text: items[0].text, speaker: 'main' }, { text: items[1].text, speaker: 'sub' }];
  const mk = (time, animal, unit) => Manga.buildPage({ scene: { location: 'river', time, era: 'modern', mood: 0.2, figures: { layout: 'two', main: 'man', sub: 'woman', pose: 'stand', animal } }, drafts, answers: {}, lines, unit });
  const pages = [];
  for (let u = 0; u < 30; u++) pages.push(mk(['day', 'evening', 'night', 'morning'][u % 4], u % 5 ? null : 'cat', u));
  const plains = pages.flatMap((pg) => pg.panels.filter((p) => p.bg).map((p) => ({ time: pg.scene.time, bg: p.bg, kind: p.kind })));
  const pal = Manga.PALETTE;
  const okColor = plains.every((x) => (x.time === 'evening' || x.time === 'night' ? pal[x.time].some((g) => g[0] === x.bg.colors[0]) && x.bg.kind === 'gradient' : true));
  const consecutive = pages.some((pg) => pg.panels.some((p, i) => i && p.bg && pg.panels[i - 1].bg && p.bg.colors.join() === pg.panels[i - 1].bg.colors.join()));
  const day = pages.find((pg) => pg.scene.time === 'day' && !pg.scene.figures.animal);
  const cat = pages.find((pg) => pg.scene.figures.animal === 'cat');
  const last = day.panels[day.panels.length - 1];
  return {
    content: day.panels.map((p) => p.content), catFirst: cat.panels[0].content, n: plains.length, kinds: [...new Set(plains.map((x) => x.bg.kind))],
    estPlain: pages.some((pg) => pg.panels.some((p) => p.kind === 'establish' && p.bg)), allPlain: pages.some((pg) => pg.panels.every((p) => p.bg)),
    okColor, consecutive, lastFace: last.faces, lastFocal: last.focal, lastCam: last.camera && last.camera.family, talking: day.panels[1].talking,
  };
});
check(bgs.content[0] === 'scenery' && bgs.content.slice(1).every((c) => c === 'people'), `導入のコマは背景だけ (${bgs.content})`);
check(bgs.catFirst === 'animal', `動物がいる場面の導入は動物だけ (${bgs.catFirst})`);
check(bgs.n > 10 && bgs.kinds.includes('flat') && bgs.kinds.includes('gradient'), `場所を見せなくてよいコマは単色かグラデーションで塗る (${bgs.n} コマ・${bgs.kinds})`);
check(!bgs.estPlain && !bgs.allPlain, '導入のコマは塗らない・どのページにも場所の見えるコマが残る');
check(bgs.okColor, '夕方・夜は時間を表す色のグラデーション');
check(!bgs.consecutive, '続くコマを同じ色で塗らない');
check(bgs.lastFace.main === 'surprise' && bgs.lastCam === 'close_up', `「男は驚いて目を見開いた」→ 主人物が驚きの顔・顔の寄り (${JSON.stringify(bgs.lastFace)} ${bgs.lastCam})`);
check(bgs.talking.main === true, 'セリフのコマは話し手の口を動かす');

console.log('人物の描き方（手の形・後ろ姿・横顔）');
const fig = await page.evaluate(() => {
  const bad = []; let n = 0;
  const c = document.createElement('canvas'); c.width = 400; c.height = 400;
  const tg = Tegaki.create(c), L = Draw.layout(tg);
  for (const era of ['modern', 'present', 'western', 'fantasy']) for (const type of JV.Schema.options('scene', 'figure_main').map((o) => o.id)) for (const view of [null, 'back', 'side']) for (const gesture of [null, ...Manga.GESTURES.map((g) => g[0])]) for (const pose of ['stand', 'sit']) {
    try { tg.renderAt(1.1, (t) => Draw.person(tg, L, { type, era, pose, expr: ['cry', 'sleep', 'surprise', 'anger', 'joy'][n % 5], x: 200, y: 380, h: 300, facing: n % 2 ? 1 : -1, view, gesture, talking: n % 3 === 0 }, t)); n++; } catch (e) { bad.push(`${era}/${type}/${view}/${gesture}: ${e.message}`); }
  }
  return { n, bad };
});
check(fig.bad.length === 0 && fig.n > 2000, `${fig.n} 通りを描いてエラーなし ${fig.bad.slice(0, 3)}`);

console.log('モックの判定はコマの質問の選択肢の中から答える');
const mk = await page.evaluate(async () => {
  const bad = [];
  let n = 0, detail = 0;
  for (const file of ['samples/shuden_no_ato.txt', 'samples/ryu_no_yubinya.md', 'samples/doukutsu_no_kage.md', 'samples/otera_no_neko.txt']) {
    const doc = JV.Parser.parse(JV.Encoding.decode(await (await fetch(file)).arrayBuffer()), file);
    for (const u of doc.units) {
      const items = JV.Parser.quoteItems(u.text), drafts = Manga.split(u.text, items), st = { current: u.text, panels: Manga.stateOf(drafts, items) };
      const q = Manga.questions(drafts), a = await JV.Adapters.mock.judge(st, q);
      const eq = Manga.emotionQuestions(drafts, a), b = Object.keys(eq).length ? await JV.Adapters.mock.judge(st, eq) : {};
      detail += Object.keys(eq).length;
      for (const [k, qq] of Object.entries({ ...q, ...eq })) {
        const x = a[k] || b[k]; n++;
        if (!x) { bad.push(`${k} missing`); continue; }
        if (qq.type === 'choice') { if (!(x.choice in qq.criteria)) bad.push(`${k}=${x.choice}`); const s = Object.values(x.probabilities).reduce((p, v) => p + v, 0); if (Math.abs(s - 1) > 1e-6) bad.push(`${k} sum`); }
        else if (!(x.score >= 0 && x.score <= 2)) bad.push(`${k} score ${x.score}`);
      }
      // ページを組んで描いてみる
      const lines = items.map((it) => ({ text: it.text, speaker: 'main' }));
      const pg = Manga.buildPage({ scene: { location: 'street', time: 'day', era: 'present', figures: { layout: 'two', main: 'girl', sub: 'oldwoman', pose: 'talk' }, lines }, drafts, answers: { ...a, ...b }, lines, unit: u.i });
      const c = document.createElement('canvas'); c.width = 400; c.height = 600;
      try { const tg = Tegaki.create(c); tg.renderAt(1, (t) => Manga.render(tg, pg, t)); } catch (e) { bad.push(`render ${u.i}: ${e.message}`); }
    }
  }
  return { n, bad, detail };
});
check(mk.bad.length === 0 && mk.n > 100, `${mk.n} 問・描画もエラーなし ${mk.bad.slice(0, 3)}`);
check(mk.detail > 0, `感情の細目を聞くコマがある (${mk.detail})`);

console.log('カメラ・背景効果の描き分け（全部の系統と効果を描いてみる）');
const all = await page.evaluate(() => {
  const bad = [];
  const scene = { location: 'washitsu', time: 'evening', era: 'modern', weather: 'rain', mood: 0.8, figures: { layout: 'two', main: 'man', sub: 'woman', pose: 'walk' } };
  const fams = Object.keys(Manga.SHOTS), effects = [null, ...new Set(Object.values(Manga.EFFECT))];
  let n = 0;
  for (const fam of fams) for (const effect of effects) for (const focal of ['main', 'sub']) {
    const p = { n: 1, kind: 'talk', hasChar: true, focal, expr: 'surprise', camera: { family: fam }, effect, lines: [] };
    try { Manga.drawPanelScene(p, scene, 240, 180, 1.3, {}); n++; } catch (e) { bad.push(`${fam}/${effect}: ${e.message}`); }
  }
  return { n, bad };
});
check(all.bad.length === 0 && all.n > 200, `${all.n} 通りを描いてエラーなし ${all.bad.slice(0, 3)}`);

check(app.errors.length === 0, `コンソールエラーなし ${app.errors.join(' / ')}`);
await app.close();
done();
