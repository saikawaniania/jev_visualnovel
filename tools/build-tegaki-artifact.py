#!/usr/bin/env python3
"""手描き挿絵文庫（tegaki/）の「お試しページ」を作る。

claude.ai の Artifact（非公開のページ）に載せて、Netlify に出す前にモック判定で動作を確かめるためのもの。
Netlify の本番デプロイはクレジットを使うので、細かい修正はここで確かめてから、まとめて main に合流する。

使い方（リポジトリ直下で）:
    python3 tools/build-tegaki-artifact.py <出力フォルダ>

出力フォルダにできるもの:
    tegaki-novel.html   ページ本体（Artifact の file_path に渡す）
    tegaki.js, draw.js  描画
    sample-sjis.js      Shift_JIS のサンプル（Artifact は UTF-8 以外の .txt を置けないので base64 で埋め込む）
    samples/*.txt|md    UTF-8 のサンプル

元の tegaki/index.html から変えるところ:
    - <!doctype>〜<body> を外す（Artifact が自分で付ける）
    - 履歴（pushState / replaceState）を try で囲む（埋め込み表示では使えないことがある）
    - Shift_JIS のサンプルを sample-sjis.js から読む
    - 呼び出し経路はモックだけ（お試しページには中継がない。前に保存した経路があっても使わない）
"""
import base64
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'tegaki'
SJIS_SAMPLE = 'ame_no_teishaba.txt'


def main(out_dir: str) -> None:
    out = pathlib.Path(out_dir)
    (out / 'samples').mkdir(parents=True, exist_ok=True)
    s = (ROOT / 'index.html').read_text(encoding='utf-8')
    s = re.sub(r'^<!doctype html>\s*<html lang="ja">\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', s, flags=re.I)
    s = s.replace('</head>\n<body>\n', '\n', 1)
    s = re.sub(r'</body>\s*</html>\s*$', '', s)

    def rep(a: str, b: str) -> None:
        nonlocal s
        if s.count(a) != 1:
            sys.exit(f'置き換え元が見つからない（index.html が変わった？）: {a[:60]!r}')
        s = s.replace(a, b)

    rep("if (location.hash !== '#read') history.pushState(null, '', '#read');",
        "try { if (location.hash !== '#read') history.pushState(null, '', '#read'); } catch (_) { /* 埋め込み表示では履歴を使えない */ }")
    rep("if (location.hash) history.replaceState(null, '', location.pathname + location.search);",
        "try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* 同上 */ }")
    rep(f"{{ file: 'samples/{SJIS_SAMPLE}',", f"{{ file: 'sjis', name: '{SJIS_SAMPLE}',")
    rep("this.openText(JV.Encoding.decode(buf), s.file.split('/').pop());",
        "this.openText(JV.Encoding.decode(buf), s.name || s.file.split('/').pop());")
    rep("""      const res = await fetch(s.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();""", """      let buf;
      if (s.file === 'sjis' && window.SJIS_SAMPLE) buf = Uint8Array.from(atob(window.SJIS_SAMPLE), (c) => c.charCodeAt(0)).buffer;
      else { const res = await fetch(s.file); if (!res.ok) throw new Error(`HTTP ${res.status}`); buf = await res.arrayBuffer(); }""")
    rep('<script src="draw.js"></script>', '<script src="draw.js"></script>\n<script src="sample-sjis.js"></script>')
    rep('''          <option value="openrouter">OpenRouter 経由</option>
          <option value="typesafe">TypeSafe 直接</option>
          <option value="relay">中継サーバー（Cloudflare Workers 等）</option>
        </select>''', '''        </select>
        <small>このお試しページには中継サーバーがないので、本物の Jev は使えません。Netlify に置いたサイトで選べます。</small>''')
    rep("    if (!this.get('routeChosen') && stored === 'mock' && pub && pub.open) return 'relay';\n    return stored;",
        "    return 'mock'; // お試しページには中継がない（前に保存した経路があっても使わない）")
    if not s.lstrip().startswith('<title>'):
        sys.exit('ページの先頭が <title> になっていない')
    (out / 'tegaki-novel.html').write_text(s, encoding='utf-8')

    for f in ('tegaki.js', 'draw.js'):
        shutil.copy(ROOT / f, out / f)
    for f in sorted((ROOT / 'samples').iterdir()):
        if f.name == SJIS_SAMPLE:
            (out / 'sample-sjis.js').write_text(f'window.SJIS_SAMPLE = "{base64.b64encode(f.read_bytes()).decode()}";\n', encoding='utf-8')
        elif f.suffix in ('.txt', '.md'):
            shutil.copy(f, out / 'samples' / f.name)
    print(f'{out}/tegaki-novel.html を作りました（{len(s)} 文字）')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
