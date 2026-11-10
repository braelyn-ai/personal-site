#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "pillow-heif>=0.16"]
# ///
"""Create or update an urban exploration post from a folder of photos.

New spot:
    uv run new_urbex.py new --title "Soviet barracks in Wittstock" --area "Wittstock, Brandenburg, Germany" \\
        --near 53.16,12.48 --photos ~/Desktop/wittstock

Add photos, pick a cover, or change the area later (never touches the story you wrote):
    uv run new_urbex.py update soviet-barracks-in-wittstock --photos ~/Desktop/more --cover 04.jpg

Urbex etiquette: exact locations are never published.
  - There's no GPX, no route and no photo pins.
  - --near is rounded to 2 decimals (about 1 km) and the page shows a ~3 km
    circle around it, never a pin. Use the town's coordinates, not the spot's.
  - Photos and videos are re-encoded with all EXIF/GPS/metadata stripped.
"""

import argparse
import html
import re
import shutil
import sys
import tempfile
from datetime import date as Date, datetime
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
import new_ride as nr  # noqa: E402

ROOT = nr.ROOT
SECTION = "urbex"
DATA = ROOT / "urbex.json"
AREA_RADIUS_M = 3000
AREA_RE = re.compile(r"<!-- area -->.*?<!-- /area -->", re.S)
PLACE_RE = re.compile(r'<span class="urbex-area">.*?</span>', re.S)


def parse_near(s):
    try:
        lat, lon = (float(x) for x in s.split(","))
    except ValueError:
        sys.exit("--near takes LAT,LON, e.g. --near 53.16,12.48")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        sys.exit("--near is out of range.")
    return round(lat, 2), round(lon, 2)


def area_html(lat, lon):
    if lat is None:
        return "<!-- area --><!-- /area -->"
    return ("<!-- area -->\n"
            f'            <div class="ride-map urbex-area-map" data-area-lat="{lat:.2f}" data-area-lng="{lon:.2f}" '
            f'data-area-radius="{AREA_RADIUS_M}"></div>\n'
            '            <p class="urbex-area-note">Approximate area only. Exact locations aren\'t shared.</p>\n'
            "            <!-- /area -->")


def place_html(area):
    return f'<span class="urbex-area">{" · " + html.escape(area) if area else ""}</span>'


def load_photos(photo_dir):
    """Photos with no location at all: GPS in the EXIF is ignored and stripped on save."""
    photos = []
    for f in nr.photo_files(photo_dir):
        r = nr.read_photo(f)
        if r:
            img, icc, _, _, local_t, _ = r
            photos.append({"img": img, "icc": icc, "lat": None, "lon": None, "local": local_t,
                           "name": f.name, "how": "not pinned"})
    return nr.sort_photos(photos)


def add_media(photo_dir, out_dir, slug, photo_start, video_start):
    print("Photos:")
    photos = load_photos(photo_dir)
    nr.save_photos(photos, out_dir, slug, photo_start, SECTION)
    videos = nr.process_videos(photo_dir, None, [], None, 0, out_dir, slug, video_start, SECTION)
    return photos, videos


def load_entries():
    return nr.json.loads(DATA.read_text()) if DATA.exists() else []


def save_entries(entries):
    entries.sort(key=lambda r: r["date"], reverse=True)
    DATA.write_text(nr.json.dumps(entries, indent=4, ensure_ascii=False) + "\n")
    nr.subprocess.run([sys.executable, str(ROOT / "generate_feed.py")], check=False)


def cmd_new(args):
    slug = nr.slugify(args.slug or args.title)
    if not slug:
        sys.exit("Couldn't make a slug from that title; pass --slug.")
    page = ROOT / SECTION / f"{slug}.html"
    asset_dir = ROOT / "assets" / SECTION / slug
    if page.exists() or asset_dir.exists():
        sys.exit(f"Spot '{slug}' already exists. Use `update {slug}` to add photos.")
    lat, lon = parse_near(args.near) if args.near else (None, None)

    # Build in a temp dir first so a crash leaves nothing half-written
    photos, videos = [], []
    if args.photos:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            photos, videos = add_media(args.photos, tmp, slug, 1, 1)
            asset_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(tmp, asset_dir)
            asset_dir.chmod(0o755)  # temp dirs are 0700

    date = args.date
    if not date:
        if any(p["local"] for p in photos):
            date = min(p["local"] for p in photos if p["local"]).date().isoformat()
        else:
            sys.exit("No date in the photos; pass --date YYYY-MM-DD.")

    cover = nr.resolve_cover(args.cover, slug, photos, SECTION) if args.cover else (photos[0]["src"] if photos else "assets/me.jpg")
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    esc = lambda s: html.escape(s, quote=True)
    place = (f'\n          "contentLocation": {{ "@type": "Place", "name": "{nr.json_str(args.area)}" }},'
             if args.area else "")
    out = (ROOT / SECTION / "_template.html").read_text()
    for key, val in {
        "TITLE_JSON": nr.json_str(args.title),
        "DESCRIPTION_JSON": nr.json_str(args.description),
        "PLACE_JSONLD": place,
        "TITLE": esc(args.title),
        "DESCRIPTION": esc(args.description),
        # The template already lists these
        "KEYWORDS": esc(", ".join(t for t in tags if t.lower() not in ("urbex", "urban exploration", "abandoned"))),
        "SLUG": slug,
        "DATE": date,
        "DATE_PRETTY": datetime.fromisoformat(date).strftime("%B %-d, %Y"),
        "AREA_META": place_html(args.area),
        "AREA_MAP": area_html(lat, lon),
        "COVER": cover,
        "GALLERY": nr.gallery_html([p for p in photos if p["src"] != cover] + videos),
    }.items():
        out = out.replace("{{" + key + "}}", val)
    if photos:
        out = out.replace("{{HERO}}", "\n" + nr.figure_html(cover, 12, "ride-hero") + "\n            ")
    else:
        out = out.replace("{{HERO}}", "")
    page.parent.mkdir(exist_ok=True)
    page.write_text(out)

    entries = [e for e in load_entries() if e["slug"] != slug]
    entry = {"title": args.title, "slug": slug, "date": date, "description": args.description}
    if args.area:
        entry["area"] = args.area
    if lat is not None:
        entry["lat"], entry["lon"] = lat, lon
    if photos:
        entry["cover"] = cover
    entry["tags"] = tags
    entries.append(entry)
    save_entries(entries)

    print(f"\nCreated {SECTION}/{slug}.html. Go write the story.")
    if lat is None:
        print("No --near, so there's no map. Add one with `update --near LAT,LON`.")


def cmd_update(args):
    slug = args.slug
    page = ROOT / SECTION / f"{slug}.html"
    asset_dir = ROOT / "assets" / SECTION / slug
    entries = load_entries()
    entry = next((e for e in entries if e["slug"] == slug), None)
    if not page.exists() or not entry:
        sys.exit(f"No spot '{slug}'. Create it with `new` first.")
    if not (args.photos or args.cover or args.near or args.area is not None):
        sys.exit("Nothing to do: pass --photos, --cover, --near and/or --area.")
    text = page.read_text()

    if args.near:
        entry["lat"], entry["lon"] = parse_near(args.near)
        if not AREA_RE.search(text):
            sys.exit("Can't find the <!-- area --> marker in the page.")
        text = AREA_RE.sub(lambda _: area_html(entry["lat"], entry["lon"]), text, count=1)
    if args.area is not None:
        entry["area"] = args.area
        text = PLACE_RE.sub(lambda _: place_html(args.area), text, count=1)
        name = nr.json_str(args.area)
        text = re.sub(r'("contentLocation": \{ "@type": "Place", "name": ")[^"]*(")', lambda m: m.group(1) + name + m.group(2), text)

    photos = []
    if args.photos:
        if nr.GALLERY_END not in text:
            sys.exit(f"Can't find '{nr.GALLERY_END}' in {page.name}; put it where new photos should go.")
        asset_dir.mkdir(parents=True, exist_ok=True)
        nums = [int(m.group(1)) for f in asset_dir.glob("*.jpg") if (m := re.fullmatch(r"(\d+)\.jpg", f.name))]
        vnums = [int(m.group(1)) for f in asset_dir.glob("v*.mp4") if (m := re.fullmatch(r"v(\d+)\.mp4", f.name))]
        photos, videos = add_media(args.photos, asset_dir, slug, max(nums, default=0) + 1, max(vnums, default=0) + 1)
        if photos or videos:
            text = text.replace(nr.GALLERY_END, nr.gallery_html(photos + videos) + "\n                " + nr.GALLERY_END, 1)
    if args.cover or (photos and "cover" not in entry):
        entry["cover"] = nr.resolve_cover(args.cover, slug, photos, SECTION) if args.cover else photos[0]["src"]
        text = nr.set_cover(text, entry["cover"])
        print(f"Cover: {entry['cover']}")
    page.write_text(text)

    save_entries(entries)
    print(f"\nUpdated {slug}. Your story wasn't touched; new photos are at the end of the gallery.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("new", help="create an urbex post")
    n.add_argument("--title", required=True)
    n.add_argument("--area", default="", help='shown under the title, e.g. "Wittstock, Brandenburg, Germany"')
    n.add_argument("--near", help="LAT,LON of the nearest town (rounded to ~1 km; shown as a ~3 km circle)")
    n.add_argument("--photos", type=Path, help="folder of photos (jpg/png/heic/tif) and videos (mp4/mov; needs ffmpeg)")
    n.add_argument("--date", help="YYYY-MM-DD (default: first photo's date)")
    n.add_argument("--slug")
    n.add_argument("--cover", help="photo for the hero, thumbnail and social cards (original filename; default: the first photo)")
    n.add_argument("--description", default="", help="one-liner for the list and social cards")
    n.add_argument("--tags", default="", help="comma separated")

    u = sub.add_parser("update", help="add photos, change the cover or the area of an existing post")
    u.add_argument("slug")
    u.add_argument("--photos", type=Path, help="folder of photos and videos to append to the gallery")
    u.add_argument("--cover", help="a published name like 04.jpg, or an original filename from --photos")
    u.add_argument("--near", help="new LAT,LON for the area circle")
    u.add_argument("--area", help="new area text")

    args = ap.parse_args()
    if getattr(args, "date", None):
        try:
            Date.fromisoformat(args.date)
        except ValueError:
            sys.exit("--date must be YYYY-MM-DD.")
    {"new": cmd_new, "update": cmd_update}[args.cmd](args)


if __name__ == "__main__":
    main()
