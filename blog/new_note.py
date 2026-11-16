#!/usr/bin/env python3
"""Put a note on the wall: a short, dated thought that shows on the homepage and on /wall/.

    python3 blog/new_note.py --title "fear of failure" "Thought goes here"
    python3 blog/new_note.py --title "fear of failure"     # type or paste it, then Ctrl+D
    python3 blog/new_note.py --title "..." --date 2026-11-01 "Backdated thought"

The title shows above the note as "on: <title>" and names its page.

Blank lines make paragraphs. Bare URLs and [label](https://...) become links.
Notes live in notes.json (newest first); edit that file to fix or delete one.
"""

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NOTES = ROOT / "notes.json"


def main():
    ap = argparse.ArgumentParser(description="Put a note on the blog's wall.")
    ap.add_argument("text", nargs="?", help="the note (omit to read it from stdin)")
    ap.add_argument("--title", required=True, help='shown as "on: <title>", e.g. "fear of failure"')
    ap.add_argument("--date", default=date.today().isoformat(), help="YYYY-MM-DD (default: today)")
    args = ap.parse_args()

    date.fromisoformat(args.date)  # fail early on a bad date
    if args.text is None and sys.stdin.isatty():
        print("Type the note, then Ctrl+D on an empty line:", file=sys.stderr)
    text = (args.text if args.text is not None else sys.stdin.read()).strip()
    if not text:
        sys.exit("Empty note, nothing added.")
    title = args.title.strip()
    title = title[3:].strip() if title.lower().startswith("on:") else title  # "on:" is added for you
    if not title:
        sys.exit("Empty title, nothing added.")

    notes = json.loads(NOTES.read_text()) if NOTES.exists() else []
    notes.insert(0, {"date": args.date, "title": title, "text": text})
    NOTES.write_text(json.dumps(notes, indent=2, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(ROOT / "generate_feed.py")], check=True)
    print(f"Added a note to the wall for {args.date}. Review with `git diff`, then commit.")


if __name__ == "__main__":
    main()
