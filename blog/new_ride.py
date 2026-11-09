#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "pillow-heif>=0.16"]
# ///
"""Create or update a ride post from a GPX file and a folder of photos.

New ride:
    uv run new_ride.py new --title "PCH to Big Sur" --gpx ~/Downloads/ride.gpx --photos ~/Desktop/bigsur

Add photos and/or swap in a refined GPX later (never touches the story you wrote):
    uv run new_ride.py update pch-to-big-sur --photos ~/Desktop/more-pics --gpx ~/Downloads/fixed.gpx

Privacy, applied to every GPX and photo:
  - The published GPX is rebuilt from scratch: track points only (lat, lon,
    elevation, time). Waypoints, planned routes, names, device info, heart rate
    and other extensions are dropped.
  - Points inside any private zone in .private/zones.json are removed anywhere
    on the route, not just at the ends. Each zone's radius is randomized per
    ride so the gap can't be triangulated across rides. Example file:
        [{"name": "home", "lat": 37.76, "lon": -122.43, "radius": 500}]
  - On top of that, --privacy meters (default 400, randomized up to +60%) are
    trimmed off the start and finish. Use --privacy 0 for rides between public places.
  - Waypoints are dropped unless you pass --keep-waypoints; even then only
    their names are kept, and ones in a private zone or near the start/finish go.
  - Photos are re-encoded with no EXIF/GPS/comments. A photo is only pinned if
    it's near the published route and outside every private zone.
"""

import argparse
import html
import json
import math
import random
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageOps
from PIL.ExifTags import GPSTAGS, IFD

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).parent
ZONES_FILE = ROOT / ".private" / "zones.json"
PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v"}
MAX_VIDEO_PX = 1920  # long side
MAX_PHOTO_PX = 2000
TIME_MATCH_WINDOW = timedelta(minutes=10)
PIN_MAX_DIST_M = 1000
GALLERY_END = "<!-- /gallery -->"


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def parse_time(s):
    try:
        t = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    # The GPX spec says times are UTC; some apps just forget the Z
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def local(tag):
    return tag.rsplit("}", 1)[-1]


# ---------------- GPX ----------------

class Pt:
    __slots__ = ("lat", "lon", "ele", "time")

    def __init__(self, lat, lon, ele, time):
        self.lat, self.lon, self.ele, self.time = lat, lon, ele, time

    @property
    def ll(self):
        return (self.lat, self.lon)


def read_gpx(path):
    """Returns a list of segments of Pt. Tracks only; routes are used only if there are no tracks."""
    root = ET.parse(path).getroot()

    def read_pt(el):
        try:
            lat, lon = float(el.get("lat")), float(el.get("lon"))
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(lat) and math.isfinite(lon)):
            return None
        ele = t = None
        for c in el:
            if local(c.tag) == "ele":
                try:
                    ele = float(c.text)
                    ele = ele if math.isfinite(ele) else None
                except (TypeError, ValueError):
                    pass
            elif local(c.tag) == "time" and c.text:
                t = parse_time(c.text)
        return Pt(lat, lon, ele, t)

    segments = []
    for trkseg in (e for e in root.iter() if local(e.tag) == "trkseg"):
        pts = [p for p in (read_pt(e) for e in trkseg if local(e.tag) == "trkpt") if p]
        if pts:
            segments.append(pts)
    if not segments:
        for rte in (e for e in root.iter() if local(e.tag) == "rte"):
            pts = [p for p in (read_pt(e) for e in rte if local(e.tag) == "rtept") if p]
            if pts:
                segments.append(pts)
    if not segments:
        sys.exit(f"No track points found in {path}")
    return segments


def read_waypoints(path):
    """Named <wpt>s as (name, lat, lon). Only used with --keep-waypoints."""
    out = []
    for w in (e for e in ET.parse(path).getroot() if local(e.tag) == "wpt"):
        try:
            lat, lon = float(w.get("lat")), float(w.get("lon"))
        except (TypeError, ValueError):
            continue
        name = next((c.text for c in w if local(c.tag) == "name" and c.text), None)
        if name and math.isfinite(lat) and math.isfinite(lon):
            out.append((name.strip(), lat, lon))
    return out


def filter_waypoints(wpts, raw, zones, end_trim_m):
    start, end = raw[0][0].ll, raw[-1][-1].ll
    kept = []
    for name, lat, lon in wpts:
        ll = (lat, lon)
        if any(haversine(ll, c) <= r for c, r, _ in zones):
            print(f"  waypoint '{name}' is in a private zone, dropped")
        elif end_trim_m > 0 and min(haversine(ll, start), haversine(ll, end)) <= end_trim_m * 1.6:
            print(f"  waypoint '{name}' is near the start/finish, dropped")
        else:
            kept.append((name, lat, lon))
    return kept


def load_zones():
    if not ZONES_FILE.exists():
        return []
    zones = json.loads(ZONES_FILE.read_text())
    # Randomize each radius per run so the edge of the gap isn't a fixed circle
    return [((z["lat"], z["lon"]), z.get("radius", 500) * random.uniform(1.0, 1.6), z.get("name", "zone"))
            for z in zones]


def apply_privacy(segments, zones, end_trim_m):
    """Drops points in private zones (splitting segments there) and trims the start and finish."""
    out = []
    for seg in segments:
        cur = []
        for p in seg:
            if any(haversine(p.ll, c) <= r for c, r, _ in zones):
                if len(cur) > 1:
                    out.append(cur)
                cur = []
            else:
                cur.append(p)
        if len(cur) > 1:
            out.append(cur)

    if end_trim_m > 0 and out:
        r = end_trim_m * random.uniform(1.0, 1.6)
        start, end = segments[0][0].ll, segments[-1][-1].ll
        first = out[0]
        while first and haversine(first[0].ll, start) <= r:
            first.pop(0)
        last = out[-1]
        while last and haversine(last[-1].ll, end) <= r:
            last.pop()
        out = [s for s in out if len(s) > 1]
    if not out:
        sys.exit("Privacy settings removed the whole route. Lower --privacy or check .private/zones.json.")
    return out


def write_gpx(segments, dest, strip_times, waypoints=()):
    ns = "http://www.topografix.com/GPX/1/1"
    ET.register_namespace("", ns)
    gpx = ET.Element(f"{{{ns}}}gpx", version="1.1", creator="blog.braelyn.ai")
    for name, lat, lon in waypoints:
        w = ET.SubElement(gpx, f"{{{ns}}}wpt", lat=f"{lat:.6f}", lon=f"{lon:.6f}")
        ET.SubElement(w, f"{{{ns}}}name").text = name
    trk = ET.SubElement(gpx, f"{{{ns}}}trk")
    for seg in segments:
        s = ET.SubElement(trk, f"{{{ns}}}trkseg")
        for p in seg:
            e = ET.SubElement(s, f"{{{ns}}}trkpt", lat=f"{p.lat:.6f}", lon=f"{p.lon:.6f}")
            if p.ele is not None:
                ET.SubElement(e, f"{{{ns}}}ele").text = f"{p.ele:.1f}"
            if p.time and not strip_times:
                ET.SubElement(e, f"{{{ns}}}time").text = p.time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ET.ElementTree(gpx).write(dest, xml_declaration=True, encoding="UTF-8")


def route_distance(segments):
    return sum(haversine(a.ll, b.ll) for seg in segments for a, b in zip(seg, seg[1:]))


def process_gpx(src, dest, zones, end_trim_m, strip_times, keep_waypoints=False):
    raw = read_gpx(src)
    kept = apply_privacy(raw, zones, end_trim_m)
    wpts = filter_waypoints(read_waypoints(src), raw, zones, end_trim_m) if keep_waypoints else []
    write_gpx(kept, dest, strip_times, wpts)
    if wpts:
        print(f"GPX: kept {len(wpts)} waypoint(s)")
    n_raw, n_kept = sum(map(len, raw)), sum(map(len, kept))
    dist = route_distance(kept)
    print(f"GPX: kept {n_kept}/{n_raw} points in {len(kept)} segment(s), {dist / 1609.344:.1f} mi")
    return raw, kept, dist


# ---------------- Photos ----------------

def dms_to_deg(dms, ref):
    deg = float(dms[0]) + float(dms[1]) / 60 + float(dms[2]) / 3600
    return -deg if ref in ("S", "W") else deg


def photo_info(img):
    """Returns (lat, lon, taken_local_naive, taken_utc_or_None) from EXIF."""
    exif = img.getexif()
    lat = lon = None
    try:
        gps = {GPSTAGS.get(k, k): v for k, v in exif.get_ifd(IFD.GPSInfo).items()}
        if "GPSLatitude" in gps and "GPSLongitude" in gps:
            lat = dms_to_deg(gps["GPSLatitude"], gps.get("GPSLatitudeRef", "N"))
            lon = dms_to_deg(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
    except Exception:
        pass

    local_t = utc_t = None
    try:
        sub = exif.get_ifd(IFD.Exif)
        raw = sub.get(36867) or exif.get(306)  # DateTimeOriginal, DateTime
        if raw:
            local_t = datetime.strptime(raw.strip(), "%Y:%m:%d %H:%M:%S")
            offset = sub.get(36881)  # OffsetTimeOriginal, e.g. "+09:00"
            if offset:
                utc_t = datetime.fromisoformat(local_t.isoformat() + offset.strip()).astimezone(timezone.utc)
    except Exception:
        pass
    return lat, lon, local_t, utc_t


def locate_by_time(taken_utc, track):
    if taken_utc is None:
        return None  # without a UTC offset the match would be off by hours
    best = min((p for p in track if p.time), key=lambda p: abs(p.time - taken_utc), default=None)
    if best and abs(best.time - taken_utc) <= TIME_MATCH_WINDOW:
        return best.lat, best.lon
    return None


def check_pin(lat, lon, how, zones, start, end, end_trim_m, track):
    """Drop a location that's in a private zone, near the start/finish, or off the route."""
    if lat is None:
        return None, None, how
    ll = (lat, lon)
    if any(haversine(ll, c) <= r for c, r, _ in zones) or (end_trim_m > 0 and min(haversine(ll, start), haversine(ll, end)) <= end_trim_m * 1.6):
        return None, None, "inside a private zone, not pinned"
    if track and min(haversine(ll, p.ll) for p in track[::5] or track) > PIN_MAX_DIST_M:
        return None, None, "too far from the route, not pinned"
    return lat, lon, how


def read_photo(f):
    """Opens a photo: (upright resized RGB image, icc, exif lat, lon, local time, utc time), or None."""
    try:
        img = Image.open(f)
        img.load()
    except Exception as e:
        print(f"  skip {f.name}: {e}")
        return None
    lat, lon, local_t, utc_t = photo_info(img)
    icc = img.info.get("icc_profile")
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((MAX_PHOTO_PX, MAX_PHOTO_PX))
    return img, icc, lat, lon, local_t, utc_t


def photo_files(photo_dir):
    return sorted(p for p in Path(photo_dir).expanduser().iterdir() if p.suffix.lower() in PHOTO_EXTS)


def sort_photos(photos):
    # Chronological by the camera's wall-clock time when every photo has one
    if photos and all(p["local"] for p in photos):
        photos.sort(key=lambda p: p["local"])
    return photos


def load_photos(photo_dir, kept, zones, raw, end_trim_m):
    track = [p for seg in kept for p in seg]
    start, end = raw[0][0].ll, raw[-1][-1].ll
    photos = []
    for f in photo_files(photo_dir):
        r = read_photo(f)
        if not r:
            continue
        img, icc, lat, lon, local_t, utc_t = r
        how = "exif gps"
        if lat is None:
            loc = locate_by_time(utc_t, track)
            lat, lon = loc if loc else (None, None)
            how = "matched by time" if loc else "no location"
        lat, lon, how = check_pin(lat, lon, how, zones, start, end, end_trim_m, track)
        photos.append({"img": img, "icc": icc, "lat": lat, "lon": lon, "local": local_t, "name": f.name, "how": how})
    return sort_photos(photos)


def save_photos(photos, out_dir, slug, start_index, section="rides"):
    for i, p in enumerate(photos, start_index):
        name = f"{i:02d}.jpg"
        # No exif= and no comment → no GPS, camera or owner metadata. ICC is kept so
        # iPhone (Display P3) photos don't look washed out.
        kwargs = {"quality": 82, "optimize": True, "progressive": True}
        if p["icc"]:
            kwargs["icc_profile"] = p["icc"]
        p["img"].info.pop("comment", None)
        p["img"].save(out_dir / name, "JPEG", **kwargs)
        p["src"] = f"assets/{section}/{slug}/{name}"
        print(f"  {p['name']} → {name} ({p['how']})")


def _probe(f):
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(f)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def process_videos(photo_dir, kept, zones, raw, end_trim_m, out_dir, slug, start_index, section="rides"):
    """Transcode videos in the folder to web-friendly 1080p H.264 with all metadata
    (including the GPS iPhones embed) stripped, plus a poster frame.
    With raw=None (no route) videos are never located or pinned."""
    files = sorted(p for p in Path(photo_dir).expanduser().iterdir() if p.suffix.lower() in VIDEO_EXTS)
    if not files:
        return []
    if not shutil.which("ffmpeg"):
        sys.exit("Found videos but no ffmpeg. Install it (brew install ffmpeg) or move the videos out.")
    track = [p for seg in kept for p in seg] if raw else []
    start, end = (raw[0][0].ll, raw[-1][-1].ll) if raw else (None, None)
    videos = []
    print("Videos:")
    for i, f in enumerate(files, start_index):
        info = _probe(f)
        vs = next(s for s in info["streams"] if s["codec_type"] == "video")
        has_audio = any(s["codec_type"] == "audio" and s.get("codec_name") not in (None, "unknown") for s in info["streams"])
        tags = info["format"].get("tags", {})
        lat = lon = None
        how = "no location"
        m = re.match(r"([+-]\d+\.\d+)([+-]\d+\.\d+)", tags.get("com.apple.quicktime.location.ISO6709") or tags.get("location") or "")
        if raw is None:
            how = "not pinned"
        else:
            if m:
                lat, lon, how = float(m.group(1)), float(m.group(2)), "video gps"
            lat, lon, how = check_pin(lat, lon, how, zones, start, end, end_trim_m, track)

        name = f"v{i:02d}"
        mp4, poster = out_dir / f"{name}.mp4", out_dir / f"{name}.jpg"
        scale = (f"scale=w='if(gte(iw,ih),min(iw,{MAX_VIDEO_PX}),-2)':h='if(gte(iw,ih),-2,min(ih,{MAX_VIDEO_PX}))'")
        vf = [scale]
        if vs.get("color_transfer") in ("arib-std-b67", "smpte2084"):
            # HDR (HLG/PQ) → SDR so it doesn't look washed out in browsers
            vf += ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709",
                   "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv"]
        vf.append("format=yuv420p")
        cmd = ["ffmpeg", "-v", "error", "-stats", "-y", "-i", str(f), "-map", "0:v:0"]
        if has_audio:
            cmd += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        cmd += ["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
                "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                "-maxrate", "5M", "-bufsize", "10M", "-profile:v", "high",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                "-fflags", "+bitexact", "-movflags", "+faststart", str(mp4)]
        print(f"  {f.name}: transcoding...")
        subprocess.run(cmd, check=True)
        out = _probe(mp4)
        ov = next(s for s in out["streams"] if s["codec_type"] == "video")
        dur = float(out["format"]["duration"])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{min(1.0, dur / 3) if dur < 20 else dur * 0.2:.2f}",
                        "-i", str(mp4), "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", str(poster)], check=True)
        src = f"assets/{section}/{slug}/{mp4.name}"
        videos.append({"kind": "video", "src": src, "poster": f"assets/{section}/{slug}/{poster.name}",
                       "w": ov["width"], "h": ov["height"], "lat": lat, "lon": lon, "name": f.name})
        print(f"  {f.name} → {mp4.name} ({mp4.stat().st_size / 1e6:.1f} MB, {dur:.0f}s, {how})")
    return videos


def video_html(v, indent=16, caption=""):
    pad = " " * indent
    attrs = f' data-lat="{v["lat"]:.5f}" data-lng="{v["lon"]:.5f}"' if v["lat"] is not None else ""
    return (f'{pad}<figure class="ride-clip"{attrs} style="--ar: {v["w"] / v["h"]:.4f}">\n'
            f'{pad}    <video src="../{v["src"]}" poster="../{v["poster"]}" width="{v["w"]}" height="{v["h"]}" '
            f'controls playsinline preload="none"></video>\n'
            f'{pad}    <figcaption>{caption}</figcaption>\n'
            f'{pad}</figure>')


def figure_html(src, indent, cls="", lat=None, lon=None, caption="", alt=""):
    """A <figure> that keeps the photo's own aspect ratio (no cropping)."""
    with Image.open(ROOT / src) as im:
        w, h = im.size
    pad = " " * indent
    lazy = "" if cls == "ride-hero" else ' loading="lazy"'
    attrs = f' class="{cls}"' if cls else ""
    if lat is not None:
        attrs += f' data-lat="{float(lat):.5f}" data-lng="{float(lon):.5f}"'
    if cls != "ride-hero":
        attrs += f' style="--ar: {w / h:.4f}"'
    return (f'{pad}<figure{attrs}>\n'
            f'{pad}    <img src="../{src}" alt="{html.escape(alt, quote=True)}" width="{w}" height="{h}"{lazy}>\n'
            f'{pad}    <figcaption>{caption}</figcaption>\n'
            f'{pad}</figure>')


def gallery_html(items):
    return "\n".join(video_html(p) if p.get("kind") == "video" else figure_html(p["src"], 16, lat=p["lat"], lon=p["lon"])
                     for p in items)


HERO_RE = re.compile(r"<!-- hero -->.*?<!-- /hero -->", re.S)


def _figure_re(src):
    return re.compile(r'[ \t]*<figure([^>]*)>\s*<img src="\.\./' + re.escape(src) +
                      r'"[^>]*>\s*(?:<figcaption>(.*?)</figcaption>\s*)?</figure>\n?', re.S)


def _pin(attrs):
    lat = re.search(r'data-lat="([-\d.]+)"', attrs or "")
    lon = re.search(r'data-lng="([-\d.]+)"', attrs or "")
    return (lat.group(1), lon.group(1)) if lat and lon else (None, None)


def set_cover(text, src):
    """Make `src` the hero photo and social-card image. The photo moves out of the
    gallery (keeping its pin and caption); any previous hero goes back into it."""
    old = HERO_RE.search(text)
    old_fig = re.search(r'<figure([^>]*)>\s*<img src="\.\./([^"]+)"[^>]*>\s*(?:<figcaption>(.*?)</figcaption>)?', old.group(0), re.S) if old else None
    if old_fig and old_fig.group(2) == src:
        return text
    lat = lon = None
    caption = ""
    m = _figure_re(src).search(text)
    if m:
        lat, lon = _pin(m.group(1))
        caption = m.group(2) or ""
        text = text[:m.start()] + text[m.end():]
    hero = "<!-- hero -->\n" + figure_html(src, 12, "ride-hero", lat, lon, caption) + "\n            <!-- /hero -->"
    if old:
        text = HERO_RE.sub(lambda _: hero, text, count=1)
        if old_fig:
            plat, plon = _pin(old_fig.group(1))
            back = figure_html(old_fig.group(2), 16, lat=plat, lon=plon, caption=old_fig.group(3) or "")
            text = text.replace(GALLERY_END, back.lstrip() + "\n                " + GALLERY_END, 1)
    else:
        anchor = "<!-- The map, stats"
        if anchor not in text:
            anchor = '<div class="ride-map"'
        if anchor not in text:
            sys.exit("Can't find where to put the hero photo (no ride map in the page).")
        text = text.replace(anchor, hero + "\n\n            " + anchor, 1)
    url = f"https://blog.braelyn.ai/{src}"
    text = re.sub(r'(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*"', rf'\g<1>{url}"', text)
    # Only the BlogPosting image (trailing comma); the author's Person image stays me.jpg
    text = re.sub(r'"image": "https://blog\.braelyn\.ai/[^"]*",', f'"image": "{url}",', text, count=1)
    return text


def resolve_cover(name, slug, photos=(), section="rides"):
    """--cover takes a published name (07.jpg) or the original filename from this run."""
    for p in photos:
        if p["name"] == name:
            return p["src"]
    src = f"assets/{section}/{slug}/{name}"
    if (ROOT / src).is_file():
        return src
    sys.exit(f"No photo '{name}' in this run or in assets/{section}/{slug}/.")


# ---------------- rides.json / feed ----------------

def load_rides():
    path = ROOT / "rides.json"
    return json.loads(path.read_text()) if path.exists() else []


def save_rides(rides):
    rides.sort(key=lambda r: r["date"], reverse=True)
    (ROOT / "rides.json").write_text(json.dumps(rides, indent=4, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(ROOT / "generate_feed.py")], check=False)


def json_str(s):
    """For text inside <script type="application/ld+json">: JSON-escaped, and no '</script>'."""
    return json.dumps(s, ensure_ascii=False)[1:-1].replace("<", "\\u003c")


# ---------------- Commands ----------------

def cmd_new(args):
    slug = slugify(args.slug or args.title)
    if not slug:
        sys.exit("Couldn't make a slug from that title; pass --slug.")
    page = ROOT / "rides" / f"{slug}.html"
    asset_dir = ROOT / "assets" / "rides" / slug
    if page.exists() or asset_dir.exists():
        sys.exit(f"Ride '{slug}' already exists. Use `update {slug}` to add photos or replace the GPX.")

    zones = load_zones()
    if not zones and args.privacy == 0:
        print("Note: no .private/zones.json and --privacy 0, so the route is published untrimmed.")

    # Build everything in a temp dir first so a crash leaves nothing half-written
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        raw, kept, dist = process_gpx(args.gpx.expanduser(), tmp / "route.gpx", zones, args.privacy, args.strip_times, args.keep_waypoints)
        photos, videos = [], []
        if args.photos:
            print("Photos:")
            photos = load_photos(args.photos, kept, zones, raw, args.privacy)
            save_photos(photos, tmp, slug, 1)
            videos = process_videos(args.photos, kept, zones, raw, args.privacy, tmp, slug, 1)
        asset_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(tmp, asset_dir)
        asset_dir.chmod(0o755)  # temp dirs are 0700

    date = args.date
    if not date:
        if photos and photos[0]["local"]:
            date = min(p["local"] for p in photos if p["local"]).date().isoformat()
        else:
            first = next((p.time for seg in raw for p in seg if p.time), None)
            if not first:
                sys.exit("No date in the GPX or photos; pass --date YYYY-MM-DD.")
            # Machine-local date; pass --date if you rode in another timezone
            date = first.astimezone().date().isoformat()

    gpx_rel = f"assets/rides/{slug}/route.gpx"
    cover = resolve_cover(args.cover, slug, photos) if args.cover else (photos[0]["src"] if photos else "assets/me.jpg")
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    esc = lambda s: html.escape(s, quote=True)
    out = (ROOT / "rides" / "_template.html").read_text()
    for key, val in {
        "TITLE_JSON": json_str(args.title),
        "DESCRIPTION_JSON": json_str(args.description),
        "TITLE": esc(args.title),
        "DESCRIPTION": esc(args.description),
        # The template already lists "motorcycle, ride, route"
        "KEYWORDS": esc(", ".join(t for t in tags if t.lower() not in ("motorcycle", "ride", "route"))),
        "SLUG": slug,
        "DATE": date,
        "DATE_PRETTY": datetime.fromisoformat(date).strftime("%B %-d, %Y"),
        "BIKE_META": f" · {esc(args.bike)}" if args.bike else "",
        "COVER": cover,
        "GPX": gpx_rel,
        "GALLERY": gallery_html([p for p in photos if p["src"] != cover] + videos),
    }.items():
        out = out.replace("{{" + key + "}}", val)
    if photos:
        hero = next(p for p in photos if p["src"] == cover) if args.cover else photos[0]
        fig = figure_html(cover, 12, "ride-hero", hero["lat"], hero["lon"])
        out = out.replace("{{HERO}}", "\n" + fig + "\n            ")
    else:
        out = out.replace("{{HERO}}", "")
    page.write_text(out)

    rides = [r for r in load_rides() if r["slug"] != slug]
    entry = {
        "title": args.title,
        "slug": slug,
        "date": date,
        "description": args.description,
        "distanceMi": round(dist / 1609.344, 1),
        "gpx": gpx_rel,
        "tags": tags,
    }
    if photos:
        entry["cover"] = cover
    if args.bike:
        entry["bike"] = args.bike
    rides.append(entry)
    save_rides(rides)

    print(f"\nCreated rides/{slug}.html. Go write the story.")
    print(f"Check assets/rides/{slug}/route.gpx before committing: the repo and bucket are public.")


def cmd_update(args):
    slug = args.slug
    page = ROOT / "rides" / f"{slug}.html"
    asset_dir = ROOT / "assets" / "rides" / slug
    rides = load_rides()
    entry = next((r for r in rides if r["slug"] == slug), None)
    if not page.exists() or not entry:
        sys.exit(f"No ride '{slug}'. Create it with `new` first.")
    if not args.gpx and not args.photos and not args.cover:
        sys.exit("Nothing to do: pass --gpx, --photos and/or --cover.")

    zones = load_zones()
    html_text = page.read_text()

    if args.gpx:
        tmp = asset_dir / "route.gpx.tmp"
        raw, kept, dist = process_gpx(args.gpx.expanduser(), tmp, zones, args.privacy, args.strip_times, args.keep_waypoints)
        tmp.replace(asset_dir / "route.gpx")
        entry["distanceMi"] = round(dist / 1609.344, 1)
    else:
        raw = kept = read_gpx(asset_dir / "route.gpx")  # already privacy-filtered

    photos = []
    if args.photos:
        if GALLERY_END not in html_text:
            sys.exit(f"Can't find '{GALLERY_END}' in {page.name}; put it where new photos should go.")
        existing = [int(m.group(1)) for f in asset_dir.glob("*.jpg") if (m := re.fullmatch(r"(\d+)\.jpg", f.name))]
        print("Photos:")
        photos = load_photos(args.photos, kept, zones, raw, args.privacy)
        save_photos(photos, asset_dir, slug, max(existing, default=0) + 1)
        existing_v = [int(m.group(1)) for f in asset_dir.glob("v*.mp4") if (m := re.fullmatch(r"v(\d+)\.mp4", f.name))]
        videos = process_videos(args.photos, kept, zones, raw, args.privacy, asset_dir, slug, max(existing_v, default=0) + 1)
        if photos or videos:
            html_text = html_text.replace(GALLERY_END, gallery_html(photos + videos) + "\n                " + GALLERY_END, 1)
    if args.cover or (photos and "cover" not in entry):
        entry["cover"] = resolve_cover(args.cover, slug, photos) if args.cover else photos[0]["src"]
        html_text = set_cover(html_text, entry["cover"])
        print(f"Cover: {entry['cover']}")
    page.write_text(html_text)

    save_rides(rides)
    print(f"\nUpdated {slug}. Your story wasn't touched; new photos are at the end of the gallery.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def privacy_args(p):
        p.add_argument("--privacy", type=int, default=400,
                       help="meters to trim around the start and finish, randomized up to +60%% (default 400, 0 = off)")
        p.add_argument("--strip-times", action="store_true",
                       help="drop timestamps from the published GPX (hides when you left; disables moving time)")
        p.add_argument("--keep-waypoints", action="store_true",
                       help="publish named <wpt> pins (name + position only) and show them on the map")

    n = sub.add_parser("new", help="create a ride")
    n.add_argument("--title", required=True)
    n.add_argument("--gpx", required=True, type=Path)
    n.add_argument("--photos", type=Path, help="folder of photos (jpg/png/heic/tif) and videos (mp4/mov; needs ffmpeg)")
    n.add_argument("--date", help="YYYY-MM-DD (default: first photo's date, else the GPX's)")
    n.add_argument("--slug")
    n.add_argument("--cover", help="photo for the hero, thumbnail and social cards (original filename; default: the first photo)")
    n.add_argument("--bike", help='e.g. "Yamaha R1"')
    n.add_argument("--description", default="", help="one-liner for the list and social cards")
    n.add_argument("--tags", default="", help="comma separated")
    privacy_args(n)

    u = sub.add_parser("update", help="add photos and/or replace the GPX of an existing ride")
    u.add_argument("slug")
    u.add_argument("--gpx", type=Path, help="replacement GPX (e.g. after refining the route)")
    u.add_argument("--photos", type=Path, help="folder of photos and videos to append to the gallery")
    u.add_argument("--cover", help="photo for the hero, thumbnail and social cards: a published name like 07.jpg, or an original filename from --photos")
    privacy_args(u)

    args = ap.parse_args()
    {"new": cmd_new, "update": cmd_update}[args.cmd](args)


if __name__ == "__main__":
    main()
