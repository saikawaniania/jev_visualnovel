# jev_visualnovel

[Jev](https://docs.typesafe.ai)(TypeSafe の System One モデル)を、Colab なしで Web アプリから使うための最小構成。
Python 版と Node.js/TypeScript 版の両方を用意しています。どちらを使うか、または両方使うかは自由です。

## 構成

- `viewer/` — 青空文庫サウンドノベル化ビューア（単一 HTML）。スクロールを止めた箇所の場面を Jev で判定し、背景と人物シルエットを差し替える。詳しくは `viewer/README.md`
- `python/` — Python 版。`typesafe-sdk` を使用。CLI サンプル(`example.py`)と FastAPI サーバ(`server.py`)
- `node/` — Node.js/TypeScript 版。`@typesafe-ai/sdk` を使用。CLI サンプル(`src/example.ts`)と Express サーバ(`src/server.ts`)

どちらも「フロントエンドは TypeSafe の API キーを直接持たず、自分のサーバ経由で Jev を呼ぶ」構成にしてあります
(API キーはサーバ側の環境変数だけに置き、ブラウザには渡しません)。

## 共通の準備

1. [console.typesafe.ai/keys](https://console.typesafe.ai/keys) で API キーを取得
2. 使う方(`python/` または `node/`)の `.env.example` を `.env` にコピーし、`TYPESAFE_API_KEY=...` を設定

## Python 版

```bash
cd python
pip install -e .
cp .env.example .env   # .env を編集してキーを設定

python example.py                 # CLIで試す(サンプルのサポートチケットを判定)
uvicorn server:app --reload        # Webサーバとして起動(POST /judge)
```

## Node.js/TypeScript 版

```bash
cd node
npm install
cp .env.example .env   # .env を編集してキーを設定

npm run example    # CLIで試す(サンプルのサポートチケットを判定)
npm run dev         # Webサーバとして起動(POST /judge)
```

## Jev の基本(3つの質問タイプ)

`state`(自然言語の状況・文章、または JSON)に対して、型付きの `questions` を渡すと、テキスト生成ではなく
構造化された判定結果(選択肢・スコア・確率・確信度)が返ってきます。

- **Choice** — 決まった選択肢から1つ選ばせる(例: どのチームが対応すべきか)
- **Score** — 順序のある段階で度合いを判定させる(例: 苛立ちの強さ)
- **Noul** — Yes/No の確率を返す(例: 緊急かどうか、0〜1)

`example.py` / `src/example.ts` は同じサンプル(サポートチケットの3項目判定)を Python 版・Node 版それぞれで
実装したものです。`server.py` / `src/server.ts` は別の例(メッセージの種類・強さ・緊急性判定)を Web API として
公開する形にしたものです。実際のアプリでは、questions の中身(instructions・criteria の文言)をアプリの
ドメインに合わせて書き換えて使ってください。

## 覚えておくこと

- **API キーはサーバ側だけに置く**(`dangerouslyAllowBrowser` のような明示的な許可なしにブラウザへ渡さない)
- **独立した質問は1リクエストにまとめる**(Choice/Score/Noul を同時に渡すと並列評価され、レスポンスも1回で済む)
- クライアントには標準でリトライ(既定 2 回)とタイムアウトが入っている。挙動を変えたい場合は
  Python なら `RetryPolicy`/`timeout`、Node なら `TypeSafeClientConfig` の `retry`/`timeout` を渡す

## 参考

- [TypeSafe Docs](https://docs.typesafe.ai)
- [Python SDK](https://docs.typesafe.ai/sdk/python)
- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Primitives (Choice / Score / Noul)](https://docs.typesafe.ai/primitives)

## ライセンス

- **コード**（下記の画像以外のすべて。サンプルの文章を含む）：[MIT License](LICENSE)　© 2026 斉川ニア
- **画像**（`viewer/assets/bg/` の背景、`viewer/assets/sil/` のシルエット・群衆）：**MIT ライセンスの対象外**です。
  このビューアで表示するために同梱しています。再配布・転用はしないでください。
  自分で使う場合は `viewer/assets/PROMPTS.md` を参考に、ご自身で素材を用意してください（素材がなくても仮素材で動きます）。
