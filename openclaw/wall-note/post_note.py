#!/usr/bin/env python3
"""Put a note on Braelyn's blog wall (https://blog.braelyn.ai/wall/).

    python3 post_note.py "The note"
    python3 post_note.py < note.txt             # longer notes from stdin
    python3 post_note.py --date 2026-11-01 "Backdated note"

Triggers the repo's "Add a note to the wall" GitHub Action, which adds the
note, pushes to main and redeploys the blog. Needs BRAELYN_WALL_TOKEN: a
fine-grained GitHub token for braelyn-ai/personal-site with only
"Actions: Read and write". Standard library only.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

REPO = "braelyn-ai/personal-site"
WORKFLOW = "add-note.yml"
MAX_CHARS = 5000


def main():
    ap = argparse.ArgumentParser(description="Put a note on Braelyn's blog wall.")
    ap.add_argument("text", nargs="?", help="the note (omit to read it from stdin)")
    ap.add_argument("--date", help="YYYY-MM-DD (default: today in San Francisco)")
    args = ap.parse_args()

    token = os.environ.get("BRAELYN_WALL_TOKEN", "").strip()
    if not token:
        sys.exit("BRAELYN_WALL_TOKEN isn't set.")
    text = (args.text if args.text is not None else sys.stdin.read()).strip()
    if not text:
        sys.exit("Empty note, nothing posted.")
    if len(text) > MAX_CHARS:
        sys.exit(f"The note is {len(text)} characters; the limit is {MAX_CHARS}.")
    inputs = {"text": text}
    if args.date:
        date.fromisoformat(args.date)  # fail here instead of in the Action
        inputs["date"] = args.date

    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches",
        data=json.dumps({"ref": "main", "inputs": inputs}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "openclaw-wall-note",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        hint = {401: " (token is wrong or expired)", 403: " (token lacks Actions: write on the repo)",
                404: " (token can't see the repo, or the workflow isn't on main)"}.get(e.code, "")
        sys.exit(f"GitHub said {e.code}{hint}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Couldn't reach GitHub: {e.reason}")

    print("Posted. It shows at https://blog.braelyn.ai/wall/ in about a minute.")
    print(f"Progress: https://github.com/{REPO}/actions/workflows/{WORKFLOW}")


if __name__ == "__main__":
    main()
