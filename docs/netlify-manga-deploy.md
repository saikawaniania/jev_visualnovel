# 作業手順書：手描き漫画文庫（`manga/`）を Netlify に出す（CLI）

このファイルは、Netlify CLI で作業する AI（または人）にそのまま渡すための手順書です。
上から順に実行してください。**書いていない操作はしないでください**（特に、今ある 2 つのサイトの設定・デプロイには触らない）。

---

## 0. 全体の流れとクレジット

リポジトリ `saikawaniania/jev_visualnovel` には、Netlify のサイトが 2 つあります。

| サイト | Base directory | 中身 |
|---|---|---|
| 旧ビューア | （リポジトリ直下） | `viewer/` |
| tegaki-novel（手描き挿絵文庫） | `tegaki` | `tegaki/` |

ここに **3 つ目のサイト「手描き漫画文庫」（Base directory `manga`）** を足します。
中継関数（`netlify/functions/`：Jev の中継と青空文庫の取得）は、ビルドのときに `manga/build.mjs` がコピーして使います。

Netlify は無料プランで、本番デプロイ 1 回につきクレジットを 15 使います（月 300）。この手順で使うのは **最初のデプロイ 1 回分（15）だけ** にします。

| 手順 | クレジット |
|---|---|
| サイトを作る（`sites:create`） | 0 |
| 環境変数を入れる（秘密の 2 つは持ち主が画面で） | 0 |
| ビルドの設定（Base directory など） | 0 |
| GitHub のリポジトリとつなぐ | 0（つないだだけではビルドしない。ビルドが始まったら手順 6 は飛ばす） |
| 最初のデプロイ | **15** |

**環境変数は、必ず最初のデプロイより前に入れてください。** 後から入れると、反映のための再デプロイでさらに 15 使います。

## 1. 前提

- `manga/` を含む変更が **main に合流済み** であること。まだなら作業を止めて、持ち主に伝えてください（Netlify は main からビルドします）。
  - 確かめ方：`git fetch origin main && git ls-tree origin/main manga/netlify.toml` で、ファイルが表示されれば合流済み
- Node.js 18 以上
- 持ち主の Netlify アカウントにログインできること（ブラウザでの確認が 1 回要ります）

## 2. CLI の準備とログイン

```bash
npm install -g netlify-cli
netlify --version
netlify login          # ブラウザが開くので、持ち主が許可する
netlify status         # ログインしているアカウント（チーム）が持ち主のものか確かめる
```

ブラウザを開けない環境では、持ち主に Netlify の画面（User settings → Applications → Personal access tokens）でトークンを作ってもらい、環境変数 `NETLIFY_AUTH_TOKEN` に入れて使います。**トークンはチャットやファイルに書かないでください。**

## 3. 今あるサイトを確かめる（読むだけ）

```bash
netlify sites:list --json > /tmp/sites.json
# 名前・ID・URL・Base directory だけを見る
node -e 'for (const s of require("/tmp/sites.json")) console.log(s.name, s.id, s.ssl_url || s.url, "base=" + ((s.build_settings || {}).base || ""))'
```

- `base=tegaki` のサイトが **手描き挿絵文庫**。この ID を `TEGAKI_ID` として控えます（環境変数の写し元）
- `base=manga` のサイトがすでにあれば、作り直さず、そのサイトで手順 5 以降を続けます
- チームの slug（`account_slug`）も控えます：

```bash
node -e 'const s=require("/tmp/sites.json"); console.log([...new Set(s.map(x=>x.account_slug))])'
```

```bash
export TEGAKI_ID=（手描き挿絵文庫のサイト ID）
export TEAM=（チームの slug）
```

## 4. 新しいサイトを作る（デプロイはしない）

```bash
netlify sites:create --name tegaki-manga --account-slug "$TEAM" --disable-linking
```

- 名前 `tegaki-manga` が使われていたら、`tegaki-manga-bunko` など別の名前にしてください（URL は `https://<名前>.netlify.app/` になります）
- 表示された **Site ID** を控えます：

```bash
export MANGA_ID=（表示された Site ID）
netlify api getSite --data "{\"site_id\":\"$MANGA_ID\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);console.log(s.name,s.ssl_url)})'
```

## 5. 環境変数を入れる（手描き挿絵文庫と同じ値）

> **注意：秘密の値は写せない。** 手描き挿絵文庫の `TYPESAFE_API_KEY` と `RELAY_PASSPHRASE` は「秘密の値（secret）」になっています。
> 秘密の値は、`netlify env:clone`・`netlify env:get`・API のどれで読んでも本当の値が返らず、**伏せ字や空の値がそのまま写ります**。
> 実際に、伏せ字が写ったまま最初のデプロイをして、次の 2 つが起きました。
> - Jev の判定が「HTTP 401 authentication_error」で失敗した（伏せ字のキーを TypeSafe に渡していた）
> - 合言葉が伏せ字の文字列になった（本当の合言葉が通らず、伏せ字と同じ文字を入れた人が持ち主として扱われる）
>
> **この 2 つは、持ち主に Netlify の画面で入れてもらいます。** 値をチャット・ファイル・コマンドに書かないでください。

### 5-1. 秘密でない 2 つだけ CLI で写す

`RELAY_PUBLIC_UNTIL`（一般公開の最終日）と `RELAY_DAILY_LIMIT`（1 日の上限）は秘密の値ではないので、CLI で写せます。
`env:clone` は全部を写してしまうので使わず、1 つずつ入れます。

```bash
# 挿絵文庫の値を読む（秘密でないので読める。日付と数字だけ）
netlify api getEnvVars --data "{\"account_id\":\"$TEAM\",\"site_id\":\"$TEGAKI_ID\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const v of JSON.parse(d)) if(["RELAY_PUBLIC_UNTIL","RELAY_DAILY_LIMIT"].includes(v.key)) console.log(v.key, (v.values.find(x=>x.context==="production"||x.context==="all")||{}).value)})'
# 読めた値を入れる（例）
netlify env:set RELAY_PUBLIC_UNTIL 2026-11-30 --site "$MANGA_ID"
netlify env:set RELAY_DAILY_LIMIT 2000 --site "$MANGA_ID"
```

- `getEnvVars` が通らない版の CLI なら、持ち主に挿絵文庫の画面でこの 2 つの値（日付と数字）を読んでもらってください
- 挿絵文庫に入っていなければ、入れなくてかまいません（一般公開しない・上限は既定の 2000）

### 5-2. 秘密の 2 つは持ち主が画面で入れる

持ち主に、次をお願いしてください（クレジットは使いません）。

1. Netlify の画面で、新しいサイト（`tegaki-manga`）の **Project configuration → Environment variables → Add a variable**
2. `TYPESAFE_API_KEY`：TypeSafe の API キーそのもの（前に「Bearer」を付けない・引用符や空白を入れない）
3. `RELAY_PASSPHRASE`：挿絵文庫と同じ合言葉
4. どちらも **Scopes に Functions を含める**（既定の「All scopes」でよい）。「Contains secret values」にしてよい

### 5-3. 入ったことを確かめる（値は表示しない）

名前がそろっているか：

```bash
netlify env:list --site "$MANGA_ID" --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(Object.keys(JSON.parse(d))))'
```

| 名前 | 中身 | 必須 |
|---|---|---|
| `TYPESAFE_API_KEY` | TypeSafe の API キー | 必須 |
| `RELAY_PASSPHRASE` | 中継の合言葉（持ち主だけが知っている） | 必須 |
| `RELAY_PUBLIC_UNTIL` | 一般公開の終わりの日付 | 任意（一般公開するときだけ） |
| `RELAY_DAILY_LIMIT` | 一般公開の 1 日の上限回数 | 任意 |

- 秘密の値は CLI からは中身を確かめられません。中身が正しいかは、手順 8 の接続テスト（合言葉を入れて「接続テスト」）で確かめます
- 名前がそろうまで、手順 7（最初のデプロイ）に進まないでください。**中継の関数は、デプロイしたときの値を使います**。デプロイのあとで値を直したら、反映に再デプロイ（15）が要ります
- **値を自分で調べたり、`env:list` の値をそのまま出力したりしないでください。**
- 一般公開の 1 日の回数は、サイトごとに別々に数えます（手描き挿絵文庫とは別枠）。

## 6. ビルドの設定と GitHub リポジトリとのつなぎ

### 6-1. リポジトリとつなぐ

リポジトリの直下（`jev_visualnovel/`）で：

```bash
netlify link --id "$MANGA_ID"
netlify init
```

`netlify init` の質問には次のように答えます（CLI の版で文言が少し違うことがあります）。

| 質問 | 答え |
|---|---|
| 既存のサイトにつなぐか／新しく作るか | いまリンクしたサイト（`tegaki-manga`）をそのまま使う |
| Git のリモート・ブランチ | `origin` の `main`（本番のブランチ） |
| Base directory | `manga` |
| Build command | `node build.mjs`（`manga/netlify.toml` と同じ） |
| Publish directory | `manga/public`（Base からなら `public`） |
| Functions directory | `manga/netlify/functions`（Base からなら `netlify/functions`） |
| `netlify.toml` を作るか・書き換えるか | **作らない・書き換えない**（`manga/netlify.toml` がすでにある） |

- GitHub の認証を求められたら、持ち主にブラウザで許可してもらいます。Netlify の GitHub アプリは、今ある 2 つのサイトのためにこのリポジトリへのアクセスをすでに持っているはずです。
- `netlify init` がファイルを作ったり変えたりしたら（`.netlify/` 以外）、**コミットしないで** 元に戻してください：`git status` → `git checkout -- <ファイル>`
- `.netlify/`（リンクの情報）はコミットしません。

### 6-2. Base directory を確かめる（必要なら API で直す）

```bash
netlify api getSite --data "{\"site_id\":\"$MANGA_ID\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const b=JSON.parse(d).build_settings||{};console.log({repo:b.repo_url,branch:b.repo_branch,base:b.base,cmd:b.cmd,dir:b.dir})})'
```

`repo` が `saikawaniania/jev_visualnovel`、`branch` が `main`、`base` が `manga` になっていれば OK。`base` が違うときだけ：

```bash
netlify api updateSite --data "{\"site_id\":\"$MANGA_ID\",\"body\":{\"build_settings\":{\"base\":\"manga\",\"cmd\":\"node build.mjs\",\"dir\":\"manga/public\",\"functions_dir\":\"manga/netlify/functions\"}}}"
```

### 6-3. うまくいかないとき

`netlify init` でリポジトリをつなげないときは、無理をせず、持ち主に Netlify の画面で次だけしてもらいます（クレジットは使いません）：
**Site configuration → Build & deploy → Continuous deployment → Link repository** → GitHub → `jev_visualnovel`、Branch `main`、Base directory `manga`。

画面でつなぐと、その場で最初のデプロイが始まることがあります。始まったら、手順 7 のビルドは **しないで**、手順 8 の確認に進んでください。

## 7. 最初のデプロイ（ここで 15 使う）

デプロイがまだ一度も走っていないことを確かめてから、1 回だけ走らせます。

```bash
netlify api listSiteDeploys --data "{\"site_id\":\"$MANGA_ID\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).map(x=>[x.state,x.created_at])))'
# 空（[]）なら：
netlify api createSiteBuild --data "{\"site_id\":\"$MANGA_ID\"}"
```

- **`netlify deploy --prod` は使わないでください。** 手元からの直接デプロイになり、GitHub の main と食い違う原因になります。
- 状態を見る：`netlify watch --site "$MANGA_ID"`（または `listSiteDeploys` を何度か）。`ready` になれば成功、`error` なら手順 9。

## 8. 動作の確認（クレジットは使わない）

```bash
export URL=https://tegaki-manga.netlify.app   # 手順 4 の名前に合わせる
curl -sI "$URL/" | head -1                      # HTTP/2 200
curl -s "$URL/v1/relay-status"                  # {"open":true|false,...} の JSON が返れば中継が動いている
curl -s -o /dev/null -w "%{http_code}\n" "$URL/manga.js"   # 200
```

ブラウザで次も確かめて、持ち主に URL を伝えてください。

- 起動画面に「手描き漫画文庫」の題と、漫画のページの見本が出る
- 「試しに読む」から作品を開き、スクロールを止めるとページが出る
- 設定画面の下の表示が「判定：Jev（一般公開中…）」か「判定：簡易（キーワード）」になっている（一般公開の設定による）
- 合言葉を設定画面に入れて「接続テスト」を押すと成功する（キーと合言葉の両方が正しいことの確認。HTTP 401 `authentication_error` ならキーが違う、「合言葉が違います」なら合言葉が違う → 手順 5-2 で入れ直して再デプロイ）

## 9. 失敗したとき

| 症状 | 見るところ・やること |
|---|---|
| ビルドが `error` | `netlify logs:deploy --site "$MANGA_ID"` か画面の Deploy log。`node build.mjs` が失敗していれば Base directory が `manga` になっているか（手順 6-2） |
| `relay-status` が 404 | 関数が入っていない。Functions directory が `manga/netlify/functions` か。ビルドの log に「public/ と netlify/functions/ を作りました」が出ているか |
| `relay-status` が 500 | 環境変数（手順 5）。名前が足りなければ持ち主に伝える |
| 接続テストが HTTP 401 `authentication_error` | キーが伏せ字か違う値。持ち主に手順 5-2 で入れ直してもらい、再デプロイ（15） |
| 接続テストで「合言葉が違います」 | 合言葉が伏せ字か違う値。同上 |
| 判定が「簡易（キーワード）」のまま | 一般公開をしていない（`RELAY_PUBLIC_UNTIL` がない・過ぎている）なら正常。合言葉を入れれば本物の Jev になる |

**直すために再デプロイが必要なときは、1 回につき 15 使います。** 再デプロイの前に持ち主に一言伝えてください。

## 10. 終わったら持ち主に伝えること

- 新しいサイトの名前と URL
- 使ったクレジット（デプロイの回数 × 15）
- 今後の動き：
  - `manga/` を変えて main に合流すると、このサイトだけがデプロイされる（15）
  - `netlify/functions/` を変えると、3 つのサイトすべてがデプロイされる（45）
  - `docs/`・`tools/`・テスト・README だけの変更では、どのサイトもデプロイされない
