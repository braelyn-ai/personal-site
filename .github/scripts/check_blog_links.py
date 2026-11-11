#!/usr/bin/env python3
"""Fail if any blog page links to a local file that doesn't exist (images, videos, scripts, pages)."""
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

BLOG = Path(sys.argv[1] if len(sys.argv) > 1 else "blog").resolve()
ATTR = re.compile(r'\b(?:src|href|poster|data-gpx)="([^"]+)"')
SKIP = ("http:", "https:", "mailto:", "tel:", "data:", "javascript:", "#", "//")

missing = []
pages = [p for p in BLOG.rglob("*.html") if ".private" not in p.parts and not p.name.startswith("_")]
for page in pages:
    for ref in ATTR.findall(page.read_text(encoding="utf-8")):
        if ref.startswith(SKIP) or "${" in ref or "{{" in ref:
            continue
        path = unquote(urlsplit(ref).path)
        if not path:
            continue
        target = (BLOG / path.lstrip("/")) if path.startswith("/") else (page.parent / path)
        if path.endswith("/"):
            target = target / "index.html"
        if not target.exists():
            missing.append(f"{page.relative_to(BLOG)}: {ref}")

print(f"Checked {len(pages)} pages")
if missing:
    print(f"{len(missing)} broken local links:")
    print("\n".join("  " + m for m in missing))
    sys.exit(1)
print("No broken local links")
