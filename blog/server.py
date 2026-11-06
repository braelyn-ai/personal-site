#!/usr/bin/env python3
"""Simple HTTP server with CORS support for braelyn.ai"""

import http.server
import os
import re

ALLOWED_ORIGIN = "https://braelyn.ai"


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        # Don't expose directory listings (e.g. unlinked ride assets)
        self.send_error(404)
        return None

    def send_head(self):
        self._range_left = None
        if self.path.split("?")[0].endswith("/_template.html"):
            self.send_error(404)
            return None
        # Byte ranges: Safari/iOS won't play <video> from a server without them
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
        path = self.translate_path(self.path)
        if m and os.path.isfile(path) and (m.group(1) or m.group(2)):
            size = os.path.getsize(path)
            first, last = m.groups()
            if first:
                start, end = int(first), min(int(last), size - 1) if last else size - 1
            else:
                start, end = max(0, size - int(last)), size - 1
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            f = open(path, "rb")
            f.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
            self.end_headers()
            self._range_left = end - start + 1
            return f
        return super().send_head()

    def copyfile(self, source, outputfile):
        left = getattr(self, "_range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(64 * 1024, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def end_headers(self):
        if self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            # Pages, CSS and JS: always check for a newer version (cheap 304 if unchanged)
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 8000))
    with http.server.ThreadingHTTPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"Serving on port {PORT} with CORS enabled for {ALLOWED_ORIGIN}")
        httpd.serve_forever()
