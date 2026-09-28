# 素材の作り方（画像生成AI向け）

MVP に必要なのは **背景15枚・シルエット30枚・群衆2枚**（すべて「近代日本」＝明治〜昭和初期）。
できた画像を下のファイル名で `bg/` と `sil/` に入れて GitHub にアップロードすれば、Netlify が `manifest.json` を作り直して反映します。

## 共通のコツ

- **同じ画風で揃える**：最初の1枚が気に入ったら、その画像を参考画像として渡すか、同じ文体のプロンプトを使い回す
- 人物・文字・看板の文字は入れない（背景）。生成された文字は崩れやすく、読書の邪魔になる
- 夜・夕方の絵は不要。昼の絵に色調を重ねて夜や夕方にする（余力があれば `_night` などを追加）

---

## 背景（15枚）

**仕様**：横長 16:9（1920×1080 程度）・人物なし・**低彩度**・輪郭を少しぼかす・明るすぎない中間の明るさ（上に白文字が乗るため）。
形式は `.webp` 推奨（`.png` `.jpg` も可）。ファイル名は `bg/bg_modern_{場所}_day.webp`。

共通の書き出し（各プロンプトの前に付ける）：

> Muted, low-saturation painterly background for a Japanese visual novel, Meiji–Taisho era Japan (1900s–1920s), daytime, soft diffuse light, slightly blurred details, no people, no text, 16:9

| ファイル名 | 場所 | 典型的な場面（プロンプト例） |
| --- | --- | --- |
| `bg_modern_washitsu_day` | 和室 | tatami room with sliding shoji screens and fusuma, a tokonoma alcove with a hanging scroll, a low wooden table, soft light through paper screens |
| `bg_modern_yoshitsu_day` | 洋室 | Western-style parlor of a Taisho-era house, wooden floor, a sofa and armchair, a fireplace, lace curtains, a gas lamp |
| `bg_modern_kitchen_day` | 台所 | old Japanese kitchen with an earthen floor (doma), a clay kamado stove, wooden sink, hanging pots, a small window |
| `bg_modern_genkan_day` | 廊下・玄関 | entrance hall of an old Japanese house, stone step (agarikamachi), wooden sliding door, a long polished wooden corridor |
| `bg_modern_classroom_day` | 教室 | Meiji-era school classroom, wooden desks in rows, a blackboard, tall windows, a teacher's platform |
| `bg_modern_shop_day` | 店・酒場 | interior of a Taisho-era café or small shop, wooden counter, shelves with bottles and books, noren curtain at the doorway |
| `bg_modern_station_day` | 駅・車内 | small railway station platform in the Taisho era, wooden roof, benches, a waiting room, railway tracks, a distant steam locomotive |
| `bg_modern_street_day` | 街路 | main street of a Meiji-era Japanese town, wooden two-story shops, rickshaw tracks, telegraph poles, a wide dirt road |
| `bg_modern_alley_day` | 路地 | narrow back alley between old wooden houses, potted plants, laundry poles, a stone-paved path |
| `bg_modern_garden_day` | 庭 | Japanese house garden seen from the veranda (engawa), stone lantern, pine tree, small pond, moss |
| `bg_modern_field_day` | 田畑・野原 | countryside rice paddies and fields, a dirt path between them, distant low hills, a thatched farmhouse far away |
| `bg_modern_forest_day` | 森・山道 | mountain path through a quiet cedar forest, stone steps, ferns, dappled light |
| `bg_modern_river_day` | 川・水辺 | riverbank with willow trees, a wooden bridge, grassy embankment (dote), calm water |
| `bg_modern_seaside_day` | 海辺 | quiet sandy beach with gentle waves, a few fishing boats pulled up on the sand, pine trees along the shore |
| `bg_modern_nightsky_day` | 夜空の見える屋外 | open hilltop meadow with a wide sky and a low horizon (the sky will be tinted to night by the viewer, so keep the sky large and plain) |

`不明` の背景は不要です（場所が分からないときは絵を替えないため）。

---

## シルエット（30枚）

**仕様**：

- **黒一色・背景は透明**の PNG（`.png`）。ファイル名は `sil/sil_{体型}_{ポーズ}.png`
- **全部同じキャンバス**（例 1024×1024 の正方形）で作る。表示では全員が同じ高さに拡大されるので、**大人と子供の身長差はキャンバスの中の大きさで表す**
  - 大人：頭がキャンバスの上端近く（上に 5% ほど余白）、**足はキャンバスの下端にぴったり**
  - 少年・少女：大人の 7 割くらいの背丈（上に 30% ほど余白）
  - 老人：大人の 9 割くらい、少し前かがみ
  - 横たわる：キャンバスの下の方に横向きで
- 人物は**画面の左を向く**（横向きか斜め左向き）。主人物は画面右に置かれ、左の相手と向かい合う形になる
- 顔や服の細部は不要。輪郭で体型とポーズが分かれば十分

プロンプトの型：

> Solid pure black silhouette of {人物}, {ポーズ}, full body, facing left, Meiji–Taisho era Japanese clothing, feet touching the bottom edge, centered horizontally, plain white background, no shading, no ground, no shadow

| 体型 `{体型}` | {人物} の例 |
| --- | --- |
| `man` 成人男性 | an adult man in a kimono with a hakama, or a suit and bowler hat |
| `woman` 成人女性 | an adult woman in a kimono with her hair in a bun |
| `boy` 少年 | a boy about ten years old in a school uniform and cap |
| `girl` 少女 | a girl about ten years old in a kimono, hair tied with a ribbon |
| `old` 老人 | an elderly person, slightly hunched, holding a walking cane |
| `unknown` 不明 | a person in a long hooded cloak whose age and gender cannot be told |

| ポーズ `{ポーズ}` | {ポーズ} の例 |
| --- | --- |
| `stand` 立っている | standing still, arms relaxed |
| `sit` 座っている | sitting on a low bench, seen from the side |
| `walk` 歩く・走る | walking briskly, mid-stride |
| `lie` 倒れる・横たわる | lying on the ground on their side (keep the figure low in the frame) |
| `talk` 向き合って話す | standing and gesturing with one hand as if talking to someone |

### 白背景で出てきた場合

多くの生成AIは本当の透明にならず、白背景や「透明っぽい市松模様」を描いてしまいます。

- 白背景なら、背景除去ツール（スマホの写真アプリの「被写体を切り抜く」、remove.bg など）で透過 PNG にする
- 市松模様が描かれている場合は使えないので、「plain white background」で作り直してから切り抜く
- 切り抜き後に**キャンバスの大きさと足元の位置**が崩れていないか確認する

---

## 群衆（2枚）

**仕様**：横長（2048×640 など）・黒一色・透明背景の PNG。ファイル名は `sil/crowd_1.png`・`sil/crowd_2.png`。
3人以上の場面で、主人物の後ろの中景に置かれます。

> Solid pure black silhouette of a crowd of 6–8 people standing and walking in a row, Meiji–Taisho era Japanese clothing (kimono, hakama, bowler hats, parasols), mixed heights including a child, feet on the bottom edge, wide horizontal composition, plain white background, no ground, no shadow

2枚目は人の並びや服装を変えて作ってください。

---

## アップロードのしかた（スマホでも可）

1. GitHub のリポジトリで、ブランチを `claude/sequential-implementation-fil0d4` に切り替える
2. `viewer/assets/bg/`（またはシルエットなら `viewer/assets/sil/`）フォルダを開く
3. **Add file → Upload files** で画像を選び、**Commit changes**
4. Netlify が自動で再公開する（`manifest.json` はデプロイ時に自動で作り直される）
5. ビューアを再読み込みする。デバッグ表示の「素材: 背景 N・シルエット N」で読み込まれた数を確認できる

名前の規則に合わないファイルは無視されます（デプロイログに「名前の規則に合わないため除外」と出ます）。
