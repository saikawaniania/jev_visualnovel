# 手描きサウンドノベル

`viewer/`（青空文庫サウンドノベル化ビューア）の絵を、写真風の画像とシルエットから **手描きアニメ** に作り直した別サイト。
読み方・Jev の判定・中継・キャッシュは `viewer/` と同じで、違うのは「絵の描き方」だけ。

- 背景・人物・天候・心象を、`tegaki.js` で canvas に毎コマ描く。線が 1 秒に 12 回ふるえる（手描きアニメの「線の震え」）
- 画像素材は使わない（`assets/` も `manifest.json` も要らない）
- `preview.html`：部品の見本。場所・時間帯・時代・人物・姿勢・表情・天候・心象を選んで確かめられる

## 開き方

```bash
cd tegaki
python3 -m http.server 8000    # → http://localhost:8000/   見本は http://localhost:8000/preview.html
```

## 描けるもの（`draw.js`）

| 部品 | 中身 |
| --- | --- |
| 場所 | 16 種（和室・洋室・台所・廊下/玄関・教室・店/酒場・駅/車内・街路・路地・庭・田畑/野原・森/山道・川/水辺・海辺・夜空・無地）× 朝・昼・夕方・夜。街路・路地・台所・洋室・教室・駅は時代で作りが変わる |
| 人物 | 成人男性・成人女性・少年・少女・老人（男）・老人（女）・不明 の 7 種 × 時代 4 種（近代日本＝着物・学生服、現代日本＝シャツ・ワンピース、西洋風＝コート・ドレス・シルクハット、ファンタジー＝チュニック・マント・魔法使い）。主人物と相手で服の色を変える |
| 姿勢 | 立つ・座る（和室は正座と座布団、ほかは椅子）・歩く・横たわる・話す（手振りと口パク） |
| 表情 | ふつう・喜び・落ち着き・悲しみ（涙）・不安（汗）・怒り。数秒に一度まばたき |
| 天候 | 曇り・雨・雪・霧（屋内では雨雪を降らせない） |
| 心象 | 心の中だけを描く段落で、不安・喜び・落ち着き・悲しみ・怒りの絵を背景に重ねる |

顔は `tegaki-studio` の作りより、頭を大きめ・目を顔の中心より下・目の間隔を広め・口を小さくして、柔らかい印象にしている。

## `viewer/` から変えたところ

- `JV.Stage` を canvas 版に置き換えた。背景と人物はクロスフェード、天候・心象・緊張感・暗転は数値の補間。人物は別の canvas に描いてから重ねる（半透明のときに線が透けないように）
- `JV.Assets`・`JV.Weather`（画像素材と DOM の雨雪）は削除
- 人物の種類：`老人` を `老人（男）`・`老人（女）` に分けた
- 表情：判定の `emotion`（気持ち）が確信度 0.35 以上なら、その気持ちの顔にする。読み取れなければ、緊張感が高い場面で不安の顔
- 重さ対策：canvas は長辺 1600px まで、止まっているときは 1 秒 12 コマ・フェード中だけ 30 コマ。読書画面以外・演出オフ・タブが裏のときは描かない

## Netlify に置く（既存のビューアとは別のサイト）

同じリポジトリから、もう 1 つサイトを作る。中継関数（`../netlify/functions`）はビルドのときにコピーして使う。

1. https://app.netlify.com/ で **Add new project → Import an existing project → GitHub** → `jev_visualnovel`
2. **Base directory** に `tegaki` と入れる（Build command・Publish directory は `tegaki/netlify.toml` から自動で入る）→ **Deploy**
3. **Project configuration → Environment variables** に、既存のビューアと同じ `TYPESAFE_API_KEY`・`RELAY_PASSPHRASE`（必要なら `RELAY_PUBLIC_UNTIL`・`RELAY_DAILY_LIMIT`）を入れて再デプロイ

一般公開の回数（`RELAY_DAILY_LIMIT`）と停止スイッチは、サイトごとに別々に数える（Netlify Blobs はサイトごと）。

## 動作確認

```bash
cd tegaki
for t in step1 step2 step4 step5 reading stage; do node tests/$t.test.mjs; done
```

`stage.test.mjs` は、場所 16 種 × 時間帯 × 時代と、人物 7 種 × 姿勢 × 表情 × 時代のすべてを実際に描いてエラーがないことと、サンプルを通して読んだときの演出（暗転・場所替え・雪・群衆・心象・表情）を確かめる。

## ライセンス

- `tegaki.js`：MIT License © 2026 Afaq Rashid（[claude-animation-studio](https://github.com/i-afaqrashid/claude-animation-studio) の描画エンジンが元。ファイル冒頭の表示を消さないこと）
- それ以外：リポジトリの [MIT License](../LICENSE) © 2026 斉川ニア
