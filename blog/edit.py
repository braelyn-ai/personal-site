#!/usr/bin/env python3
"""Local WYSIWYG editor for blog posts.

    python3 blog/edit.py          # then open http://localhost:8001

Every post page gets an edit toolbar: click into the text to edit, drag photos
to reorder, hover a photo to delete it, then Save (or Cmd+S). Saving rewrites
only what's inside <article> in the .html file, so review with `git diff`.

Local only: it listens on 127.0.0.1 and is never deployed.
"""

import difflib
import hashlib
import html
import io
import json
import os
import re
import sys
import webbrowser

BLOG = os.path.dirname(os.path.abspath(__file__))
os.chdir(BLOG)
sys.path.insert(0, BLOG)

import http.server  # noqa: E402

from server import CORSRequestHandler  # noqa: E402

# Scripts that rewrite the page at runtime (map, stats, lightbox, tracking).
# Left out in edit mode so the editable page is exactly what's in the file.
SKIP_SCRIPTS = re.compile(r'\s*<script[^>]*src="[^"]*(?:ride-map|slurp)\.js[^"]*"[^>]*></script>')
ARTICLE_OPEN = re.compile(r"<article\b[^>]*>")
BOOLEAN_ATTRS = re.compile(r'\s(controls|playsinline|muted|loop|autoplay|allowfullscreen|hidden|defer|async)=""')


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def article_bounds(src):
    m = ARTICLE_OPEN.search(src)
    end = src.rfind("</article>")
    if not m or end < m.end():
        return None
    return m.end(), end


def canonical(line):
    """How a line reads once a browser has parsed it (&mdash; vs —, <img /> vs <img>, controls="")."""
    return html.unescape(BOOLEAN_ATTRS.sub(r" \1", re.sub(r"\s*/>", ">", line)))


def merge(old, new):
    """Keep the file's own spelling for every line the edit didn't really change, so the
    diff only shows lines you edited, not the browser's way of writing the same HTML."""
    a, b = old.split("\n"), new.split("\n")
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out += a[i1:i2]
        elif op == "replace" and i2 - i1 == j2 - j1:
            out += [o if canonical(o) == canonical(n) else n for o, n in zip(a[i1:i2], b[j1:j2])]
        else:
            out += b[j1:j2]
    return "\n".join(out)


class EditServer(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # The browser cancels image/video downloads when you leave a page; not worth a traceback
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


class EditHandler(CORSRequestHandler):
    def post_file(self, url_path):
        """The .html file behind a URL path, if it's an editable post."""
        path = self.translate_path(url_path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        real = os.path.realpath(path)
        if not real.startswith(BLOG + os.sep) or not real.endswith(".html") or not os.path.isfile(real):
            return None
        if os.path.basename(real) == "_template.html":
            return None
        return real

    def send_head(self):
        url_path = self.path.split("?")[0]
        real = self.post_file(url_path)
        if not real:
            return super().send_head()
        src = open(real, encoding="utf-8").read()
        if not article_bounds(src):
            return super().send_head()  # list pages: browse them normally
        page = SKIP_SCRIPTS.sub("", src)
        config = json.dumps({"path": url_path, "hash": digest(src)})
        inject = (
            f'<link rel="stylesheet" href="/editor/editor.css">\n'
            f"<script>window.__EDIT = {config};</script>\n"
            f'<script src="/editor/editor.js"></script>\n'
        )
        page = page.replace("</body>", inject + "</body>", 1)
        body = page.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def do_POST(self):
        if self.path != "/__save":
            return self.send_error(404)
        # Block other websites from posting here (they can't send JSON without a preflight we refuse)
        origin = self.headers.get("Origin", "")
        if self.headers.get("Content-Type") != "application/json" or (
            origin and origin != f"http://{self.headers.get('Host')}"
        ):
            return self.send_error(403)
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            real = self.post_file(req["path"])
            src = open(real, encoding="utf-8").read() if real else None
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {"error": "Bad request"})
        bounds = src and article_bounds(src)
        if not bounds:
            return self.reply(404, {"error": "Not an editable post"})
        if digest(src) != req.get("hash"):
            return self.reply(409, {"error": "The file changed on disk since you opened it. Reload to get the new version (your edits here will be lost)."})
        start, end = bounds
        new = src[:start] + merge(src[start:end], req["html"]) + src[end:]
        with open(real, "w", encoding="utf-8") as f:
            f.write(new)
        rel = os.path.relpath(real, os.path.dirname(BLOG))
        print(f"saved {rel}")
        return self.reply(200, {"hash": digest(new), "file": rel})

    def reply(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8001)
    with EditServer(("127.0.0.1", port), EditHandler) as httpd:
        url = f"http://localhost:{port}/"
        print(f"Editing the blog at {url}  (Ctrl+C to stop)")
        if "--no-open" not in sys.argv:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
