# 青空文庫サウンドノベル化ビューア

スクロールを止めた箇所の場面を Jev が判定し、背景と人物シルエットをフェードで差し替える読書ビューア。
サーバーなしの単一 HTML（`index.html`）で動きます。仕様は `SPEC.md`（リポジトリ外）の MVP チェックリストに沿っています。

## 開き方

```bash
cd viewer
python3 -m http.server 8000     # または npx http-server -p 8000
# → http://localhost:8000/ を開く
```

`index.html` を直接（`file://`）開いても読書はできますが、サンプル一覧と `assets/manifest.json` は読めません
（ファイル選択とドラッグ＆ドロップは使えます。素材は仮素材になります）。

- 対応形式：青空文庫形式・プレーンテキスト（.txt）・Markdown（.md）・青空文庫の配布 zip。Shift_JIS / UTF-8 を自動判定
- 青空文庫のURLから読む：起動画面の欄に図書カードのURL（例 `https://www.aozora.gr.jp/cards/000879/card92.html`）を貼る。
  XHTML 本文や zip のURLでもよい。青空文庫はブラウザから直接読めない（CORS）ため、同じサイトの `/aozora`
  （Netlify の `netlify/functions/aozora.mjs` か `relay/local_server.py`）経由で取る。GitHub Pages や `file://` では使えない
- API キーが未設定ならモック判定（キーワード一致の偽の判定器）で動きます
- `D` キーまたは `?debug=1` でデバッグ表示（判定結果・確率・絵を替えた／替えなかった理由）

## 構成

| 場所 | 中身 |
| --- | --- |
| `index.html` | アプリ本体（HTML・CSS・JS をすべて含む） |
| `samples/` | 動作確認用の短い作品（青空文庫形式 Shift_JIS・Markdown・テキスト。すべて書き下ろし） |
| `assets/` | 素材ライブラリと `manifest.json`。置き方は `assets/README.md` |
| `tools/build-manifest.mjs` | `assets/` の中身から `manifest.json` を作り直す |
| `../netlify.toml`・`../netlify/functions/systemone.mjs` | Netlify で公開するときの設定と中継関数（合言葉つき） |
| `relay/local_server.py` | ビューアの配信と TypeSafe への中継を1つで行うローカルサーバー |
| `relay/cloudflare-worker.js` | 同じ中継を Cloudflare Workers で動かす例 |
| `tests/` | 各ステップの動作確認（Playwright） |

`index.html` の中は部品ごとに分かれています：`JV.Encoding`（文字コード判定）・`JV.Parser`（正規化・段落分割・判定単位）・
`JV.StopDetector`（停止検知）・`JV.Schema`（質問定義）・`JV.Adapters`（判定器：`mock` / `remote`）・`JV.Store`（IndexedDB）・
`JV.Judge`（キャッシュ・先読み・中断）・`JV.Director`（絵を替える条件）・`JV.Stage` / `JV.Weather` / `JV.Assets`（合成・素材）・
`JV.SettingsUI`（設定画面）・`JV.App`（全体）。

## 判定の経路

設定画面の「呼び出し経路」で切り替えます。判定器は `judge(state, questions, { signal }) → answers` の形にそろえてあり、
経路ごとの違いは `JV.Adapters.remote` の中だけにあります。

| 経路 | 状態 |
| --- | --- |
| モック | 動作確認済み |
| TypeSafe 直接 | `POST https://api.typesafe.ai/v1/systemone`・Bearer 認証。形式は公式 SDK（`@typesafe-ai/sdk` 0.6.0）のソースで確認。ブラウザからの直接呼び出しは接続できなかった（CORS とみられる）ため、実際には中継サーバー経由で使う |
| OpenRouter 経由 | **未確認**。Jev の指定方法・エンドポイント・CORS が分からないため、TypeSafe と同じ本文を送る仮の実装。接続先URLは設定で変えられます |
| 中継サーバー | 既定はページと同じサーバーの `/v1/systemone`。`relay/local_server.py`（Python 標準ライブラリのみ）か `relay/cloudflare-worker.js` を使い、キーはサーバー側に置きます |

設定画面の「接続テスト」で、実際のブラウザから届くか・CORS で拒否されるか・応答の形式が合うかを確かめられます。
GitHub Pages から TypeSafe 直接で接続テストすると「接続できません」になりました。URL は公式 SDK と同じなので、ブラウザからの直接呼び出しが CORS で拒否されているとみられます（公式 SDK もブラウザでの利用を既定で禁止しています）。その場合は中継サーバーを使います。

### モデル名

TypeSafe で使えるモデル名は、設定画面の「使えるモデルを確認」（`GET /v1/models`）で確かめられます。
現時点で確認できたのは `jev-latest` だけで、これを既定にしています。SPEC の `jev-1.13` は TypeSafe では `Unknown model` になります。
判定の傾向はしきい値に影響するので、版の付いた名前が一覧に出たらそちらに固定してください。

### Netlify に置く（スマホ単体で使う）

リポジトリ直下の `netlify.toml` と `netlify/functions/systemone.mjs` で、ビューアの公開と中継を Netlify 1か所で行います。
ページと中継が同じサイトにあるので CORS はかからず、APIキーは Netlify の環境変数にだけ置かれます。

1. https://app.netlify.com/ に GitHub でログイン
2. **Add new project → Import an existing project → GitHub** で `jev_visualnovel` を選ぶ
3. **Branch to deploy** を使うブランチにする。Build command は空、Publish directory は `netlify.toml` の `viewer` が自動で入る → **Deploy**
4. **Project configuration → Environment variables** で2つ追加
   - `TYPESAFE_API_KEY`：TypeSafe の APIキー
   - `RELAY_PASSPHRASE`：自分で決めた合言葉（長めの文字列）
5. **Deploys → Trigger deploy → Deploy project without cache** で再デプロイ（環境変数は再デプロイ後に効く）
6. スマホで `https://<サイト名>.netlify.app/` を開き、設定で経路を **中継サーバー**、**合言葉** に 4 と同じものを入れて **接続テスト**

URLを知っている人でも、合言葉がなければ中継は使えません（403 を返し、TypeSafe には送りません）。

### 期間限定の一般公開

Netlify の環境変数を足すと、期間中は合言葉なしで誰でも本物の Jev で読めます（持ち主は合言葉でいつでも使える）。

| 環境変数 | 例 | 意味 |
| --- | --- | --- |
| `RELAY_PUBLIC_UNTIL` | `2026-10-10` | 一般公開の最終日（日本時間。この日の 23:59 まで）。未設定なら一般公開しない |
| `RELAY_DAILY_LIMIT` | `2000` | 一般の人が1日に使える判定の回数（全員の合計、日本時間 0 時にリセット）。既定 2000 |

- 経路を自分で選んでいない人は、公開中なら自動で中継（本物の Jev）を使う。期間外・上限・停止中は簡易判定（キーワード）に切り替わり、画面で知らせる
- 緊急停止：設定 → 経路「中継サーバー」→ 合言葉を入れて「公開の管理」の **一般公開を止める**。停止スイッチは Netlify Blobs に置くので、再デプロイ（クレジット）は要らない。**再開する** で戻る
- 1回の場面判定（先読みを含む）ごとに1回と数える。1冊読むと数十〜百回程度

### ローカル中継で使う（アカウント追加なし）

```bash
TYPESAFE_API_KEY=... python3 viewer/relay/local_server.py
# キーは viewer/relay/.env か python/.env に TYPESAFE_API_KEY=... と書いてもよい
```

表示された URL（PC は `http://localhost:8000/`、同じ Wi-Fi のスマホは `http://<PCのIP>:8000/`）でビューアを開き、
設定で経路を「中継サーバー」にします（接続先URL・APIキー欄は空のまま）。キーは PC の中だけにあり、ブラウザには渡りません。
同じネットワークの人は誰でも中継を使えるので、信頼できるネットワークでだけ動かしてください。

## 動作確認

```bash
for i in 1 2 3 4 5 6; do node viewer/tests/step$i.test.mjs; done
node viewer/tests/relay.test.mjs     # ローカル中継（偽の上流サーバーで確認）
node viewer/tests/netlify.test.mjs   # Netlify の中継関数（同上）
node viewer/tests/aozora.test.mjs    # 青空文庫のURL・zip 読込（偽の青空文庫サーバーで確認）
node viewer/tests/reading.test.mjs   # 判定単位の長さ・主人公・挿絵モード
node viewer/tests/public.test.mjs    # 期間限定の一般公開（公開期間・1日の上限・停止スイッチ）
```

グローバルにインストールされた `playwright`（Chromium）を使います。外部 API には接続せず、ステップ5・6の接続先と素材はテスト内の偽サーバーで代用しています。

## MVP チェックリスト

- [x] 1. `index.html` の骨組み、起動画面、.txt／.md 読込、青空文庫記法の除去と段落分割（`samples/`）
- [x] 2. ノベルモードの読書画面、停止検知、デバッグ表示
- [x] 3. モック判定アダプタと、判定結果に応じた5レイヤー合成・フェード（仮素材）
- [x] 4. キャッシュ（メモリ＋IndexedDB）、先読み、リクエスト中断
- [x] 5. 設定画面、実Jevアダプタ（OpenRouter の形式と CORS は未確認。上記参照）
- [x] 6. 実素材への差し替えの仕組み（`assets/manifest.json` 経由）。実素材そのものは未作成

## 仕様から補ったところ

- 判定単位は長さをそろえる：おおむね 160〜400 字。短い段落は束ね、400 字を超える段落は句点で均等に分ける。会話文は直前の地の文と同じ単位に入れ、会話だけの単位は作らない。章と場面区切りはまたがない
- 場面判定の `context_before` は「直前2段落」ではなく、直前の本文 約300字（章はまたがず、なるべく文頭から）。state の長さがそろうので判定が安定し、費用も読みやすい
- 作品判定に `protagonist`（主人公の見た目）を加えた。冒頭約3,000字で判定するので、途中から開いても変わらない。場面判定の state に「主人公：成人女性（一人称の語り手）」のように添え、人物が「不明」や確信度が低いとき（一人称で1人の場面など）は主人公で描く。一人称で2人の場面では片方を語り手にする。設定画面の「この作品」で作品ごとに手動で直せる
- 挿絵モード（SPEC では拡張）を実装：縦持ちのスマホは上4割に絵・下に本文、横向きやPCは左に絵・右に本文。停止検知の中央は「本文が見えている範囲」の中央にする
- 天候の「記述なし」では天候を消さない（雨の場面で雨に触れない段落が来るたびに止まるのを防ぐ）。場所が変わったときは、書かれ直すまで晴れに戻す
- 屋内（和室・洋室・台所・廊下・玄関・教室・店・酒場）では雨雪のパーティクルを出さない
- 章替わりは「最短5秒」より優先して暗転する
- 判定結果のキャッシュは「作品ハッシュ｜経路・モデル・キー形式｜判定単位」をキーにする（経路やモデルを変えたら別のキャッシュ）
- `scene_changed ≥ しきい値` で背景を替えるときも、location の確信度が 0.25 未満なら替えない
