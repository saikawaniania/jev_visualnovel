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

- 対応形式：青空文庫形式・プレーンテキスト（.txt）・Markdown（.md）。Shift_JIS / UTF-8 を自動判定
- API キーが未設定ならモック判定（キーワード一致の偽の判定器）で動きます
- `D` キーまたは `?debug=1` でデバッグ表示（判定結果・確率・絵を替えた／替えなかった理由）

## 構成

| 場所 | 中身 |
| --- | --- |
| `index.html` | アプリ本体（HTML・CSS・JS をすべて含む） |
| `samples/` | 動作確認用の短い作品（青空文庫形式 Shift_JIS・Markdown・テキスト。すべて書き下ろし） |
| `assets/` | 素材ライブラリと `manifest.json`。置き方は `assets/README.md` |
| `tools/build-manifest.mjs` | `assets/` の中身から `manifest.json` を作り直す |
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
| TypeSafe 直接 | `POST https://api.typesafe.ai/v1/systemone`・Bearer 認証。形式は公式 SDK（`@typesafe-ai/sdk` 0.6.0）のソースで確認。実 API への疎通とブラウザからの CORS は**未確認** |
| OpenRouter 経由 | **未確認**。Jev の指定方法・エンドポイント・CORS が分からないため、TypeSafe と同じ本文を送る仮の実装。接続先URLは設定で変えられます |
| 中継サーバー | 既定はページと同じサーバーの `/v1/systemone`。`relay/local_server.py`（Python 標準ライブラリのみ）か `relay/cloudflare-worker.js` を使い、キーはサーバー側に置きます |

設定画面の「接続テスト」で、実際のブラウザから届くか・CORS で拒否されるか・応答の形式が合うかを確かめられます。
TypeSafe はブラウザからの直接呼び出しを CORS で拒否することを確認済みです（GitHub Pages から接続テスト）。その場合は中継サーバーを使います。

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
node viewer/tests/relay.test.mjs   # ローカル中継（偽の上流サーバーで確認）
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

- 会話文だけの段落は、続く場合に限らず直前の地の文の判定単位に束ねる（段の先頭なら直後の地の文と）。束ねた単位が 800 字を超えたら分ける
- 天候の「記述なし」では天候を消さない（雨の場面で雨に触れない段落が来るたびに止まるのを防ぐ）。場所が変わったときは、書かれ直すまで晴れに戻す
- 屋内（和室・洋室・台所・廊下・玄関・教室・店・酒場）では雨雪のパーティクルを出さない
- 章替わりは「最短5秒」より優先して暗転する
- 判定結果のキャッシュは「作品ハッシュ｜経路・モデル・キー形式｜判定単位」をキーにする（経路やモデルを変えたら別のキャッシュ）
- `scene_changed ≥ しきい値` で背景を替えるときも、location の確信度が 0.25 未満なら替えない
