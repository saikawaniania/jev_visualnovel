"""ビューアの配信と Jev への中継をまとめて行うローカルサーバー（Python 標準ライブラリだけで動く）。

ブラウザから TypeSafe を直接呼ぶと CORS で拒否されるため、このサーバーが
ビューアのページと同じオリジンで POST /v1/systemone を受け、API キーを付けて TypeSafe に渡す。
キーはこの PC の中だけに置かれ、ブラウザには渡らない。

使い方：
    TYPESAFE_API_KEY=... python3 viewer/relay/local_server.py
    （キーは環境変数、または viewer/relay/.env か python/.env の TYPESAFE_API_KEY=... から読む）

    → PC のブラウザ：   http://localhost:8000/
    → 同じ Wi-Fi のスマホ：起動時に表示される http://<PCのIP>:8000/
    ビューアの「設定」で経路を「中継サーバー」にする（接続先URLは空のままでよい）。

注意：同じネットワークにいる人は誰でもこの中継を使えるため、自宅など信頼できるネットワークでだけ動かすこと。
環境変数 RELAY_PASSPHRASE を設定すると、ビューアの設定で同じ合言葉を入れた人だけが使える。
"""

from __future__ import annotations

import argparse
import hmac
import json
import re
import urllib.parse
import os
import socket
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent
REPO = VIEWER.parent
MAX_BODY = 1_000_000  # 1 回の判定で送るのは数 KB 程度
# /aozora で取りに行けるのは青空文庫の図書カードと zip だけ
AOZORA_PATH = re.compile(r"^cards/\d{6}/(card\d+\.html|files/[A-Za-z0-9_.-]+\.zip)$")


def load_key() -> str:
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if key:
        return key
    for env in (HERE / ".env", REPO / "python" / ".env", Path.cwd() / ".env"):
        if not env.is_file():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "TYPESAFE_API_KEY" and value.strip():
                return value.strip().strip("'\"")
    return ""


def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # 送信はしない。経路の選択だけ
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class Handler(SimpleHTTPRequestHandler):
    upstream = "https://api.typesafe.ai/v1/systemone"
    api_key = ""
    passphrase = ""  # RELAY_PASSPHRASE を設定したときだけ確かめる

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VIEWER), **kwargs)

    def end_headers(self):
        # 開発中に古い index.html が残らないように
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def passphrase_ok(self) -> bool:
        if self.passphrase and not hmac.compare_digest(
            (self.headers.get("X-Relay-Passphrase") or "").encode(), self.passphrase.encode()
        ):
            self.send_json(403, {"error": "relay passphrase is wrong or missing"})
            return False
        return True

    aozora_base = "https://www.aozora.gr.jp"

    def do_GET(self):
        route = self.path.split("?")[0]
        if route == "/aozora":
            self.get_aozora()
            return
        # 使えるモデルの一覧だけ中継し、それ以外はビューアのファイルを返す
        if route != "/v1/models":
            super().do_GET()
            return
        if not self.passphrase_ok():
            return
        base = self.upstream.rsplit("/v1/", 1)[0]
        req = urllib.request.Request(
            f"{base}/v1/models",
            headers={"Accept": "application/json", "Authorization": f"Bearer {self.api_key}", "User-Agent": "jev-viewer-local-relay/1"},
        )
        self.forward(req)

    def get_aozora(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        path = (query.get("path") or [""])[0]
        if not AOZORA_PATH.match(path):
            self.send_json(400, {"error": "path must be cards/NNNNNN/cardNNN.html or cards/NNNNNN/files/*.zip"})
            return
        req = urllib.request.Request(f"{self.aozora_base}/{path}", headers={"User-Agent": "jev-viewer-local-relay/1"})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                data = res.read(15_000_001)
        except urllib.error.HTTPError as err:
            self.send_json(404 if err.code == 404 else 502, {"error": f"aozora returned HTTP {err.code}"})
            return
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            self.send_json(502, {"error": f"aozora unreachable: {err}"})
            return
        if len(data) > 15_000_000:
            self.send_json(413, {"error": "file too large"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/zip" if path.endswith(".zip") else "text/html")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.split("?")[0] != "/v1/systemone":
            self.send_json(404, {"error": "not found"})
            return
        if not self.passphrase_ok():
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_json(400, {"error": "invalid body size"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid json"})
            return
        # 判定に必要な 3 項目だけを渡す
        payload = json.dumps(
            {"model": body.get("model") or "jev-latest", "state": body.get("state"), "questions": body.get("questions")}
        ).encode("utf-8")
        req = urllib.request.Request(
            self.upstream,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "jev-viewer-local-relay/1",
            },
        )
        self.forward(req)

    def forward(self, req: urllib.request.Request):
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                self.send_raw(res.status, res.read())
        except urllib.error.HTTPError as err:
            self.send_raw(err.code, err.read())
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            self.send_json(502, {"error": f"upstream unreachable: {err}"})

    def send_raw(self, status: int, data: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status: int, obj: dict):
        self.send_raw(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def log_message(self, fmt, *args):
        # 判定の中継だけを表示する（静的ファイルの行は省く）
        if self.command == "POST" or self.path.startswith("/v1/"):
            sys.stderr.write(f"[relay] {self.address_string()} {fmt % args}\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="ビューアの配信と Jev への中継")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0", help="スマホから使わないなら 127.0.0.1")
    args = ap.parse_args()

    key = load_key()
    if not key:
        sys.exit("TYPESAFE_API_KEY が見つかりません。環境変数か viewer/relay/.env に書いてください。")
    Handler.api_key = key
    Handler.passphrase = os.environ.get("RELAY_PASSPHRASE", "").strip()
    aozora = os.environ.get("AOZORA_BASE_URL", "").strip().rstrip("/")
    if aozora:
        Handler.aozora_base = aozora
    base = os.environ.get("TYPESAFE_BASE_URL", "").strip().rstrip("/")
    if base:
        Handler.upstream = f"{base}/v1/systemone"

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ビューア：http://localhost:{args.port}/")
    if args.host == "0.0.0.0":
        print(f"スマホ（同じ Wi-Fi）：http://{lan_ip()}:{args.port}/")
    print(f"中継先：{Handler.upstream}（Ctrl+C で終了）")
    print("ビューアの「設定」で経路を「中継サーバー」にしてください（接続先URLは空でよい）。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
