# このリポジトリで作業する Claude へ

## 進め方：お試しページで確かめてから、まとめて合流する

Netlify は main に合流するたびに本番デプロイし、無料プランのクレジット（月 300）を 1 回 15 使う。
`netlify/functions/` を変えると 2 つのサイトが両方デプロイされて 30 使う。使い切ると次の月まで両方のサイトが止まる。
そのため次を徹底する。

1. 修正は作業ブランチに積んでいく。**細かい修正のたびに合流しない**
2. 修正したら、お試しページ（claude.ai の Artifact、モック判定）を更新して、持ち主に確かめてもらう
   - `python3 tools/build-tegaki-artifact.py <スクラッチのフォルダ>` で作り、`tegaki-novel.html` を Artifact で公開する
   - 公開済みのお試しページ：https://claude.ai/artifact/FryzMMXBXbY4eJNVrRJXTg （更新するときは `url` にこれを渡す）
   - 中継が要る機能（本物の Jev・青空文庫の URL）はお試しページでは試せない。そういう修正は、その旨を伝える
3. ある程度まとまって、持ち主がお試しページで良いと言ったら、**1 つのプルリクエストにまとめて**合流する
4. 合流の前に、何のサイトが何回デプロイされるか（クレジットをいくつ使うか）を一言伝える
   - `viewer/` → 旧ビューアのサイト、`tegaki/` → tegaki-novel、`netlify/functions/` → 両方
   - `tools/`・`CLAUDE.md`・テスト・README だけの変更はどちらのサイトもデプロイしない（0）
   - 環境変数を変えたあとの「Trigger deploy」も 1 回 15 使う。まとめて変えてから 1 回だけにしてもらう

## プルリクエストの合流（マージ）

- 持ち主（saikawaniania）から、プルリクエストの合流をこちらで行ってよいと言われている
- 合流してほしいと頼まれたら、GitHub の画面で押す手順を案内するのではなく、GitHub の MCP ツール（`merge_pull_request`、merge_method は `merge`）で合流する
- プルリクエストを作ったら、そのまま合流してよいかを持ち主に一言で確かめる。頼まれていないのに黙って合流はしない
- 合流の前に、テストが通っていることと、合流できる状態（衝突がない）であることを確かめる。合流したら、そのことと Netlify に自動で反映されることを伝える

## テスト

- `viewer/`：`for t in step1 step2 step3 step4 step5 step6 reading relay netlify aozora public; do node viewer/tests/$t.test.mjs; done`
- `tegaki/`：`cd tegaki && for t in step1 step2 step4 step5 reading stage; do node tests/$t.test.mjs; done`

## 返答

- 持ち主への返答は日本語で書く
