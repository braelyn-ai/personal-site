#!/usr/bin/env python3
"""Build the generated parts of the blog from posts.json, rides.json and urbex.json:

- feed.xml     RSS feed
- sitemap.xml  for search engines (robots.txt points at it)
- the post list in index.html, and the ride and urbex lists in rides/index.html
  and urbex/index.html, written as
  plain HTML between <!-- posts:start --> / <!-- posts:end --> style markers so
  crawlers and link previews see them without running JavaScript

Run it after editing posts.json (new_ride.py and new_urbex.py run it for you).
"""

import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

BLOG_URL = "https://blog.braelyn.ai"
ROOT = Path(__file__).parent
DESCRIPTION = (
    "Braelyn Boynton on AI and codegen, startups, creative coding, "
    "and motorcycle trips around the world."
)


def load_section(name):
    path = ROOT / f"{name}.json"
    if not path.exists():
        return []
    with open(path) as f:
        entries = [{**e, "section": name} for e in json.load(f)]
    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


def load_entries():
    with open(ROOT / "posts.json") as f:
        posts = [{**p, "section": "posts"} for p in json.load(f)]
    return posts, load_section("rides"), load_section("urbex")


def url_for(entry):
    return f"{BLOG_URL}/{entry['section']}/{entry['slug']}.html"


def generate_feed(entries):
    rss = ET.Element("rss", version="2.0", attrib={
        "xmlns:atom": "http://www.w3.org/2005/Atom",
    })
    channel = ET.SubElement(rss, "channel")

    ET.SubElement(channel, "title").text = "Braelyn's Blog"
    ET.SubElement(channel, "link").text = BLOG_URL
    ET.SubElement(channel, "description").text = DESCRIPTION
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "lastBuildDate").text = (
        datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    )

    atom_link = ET.SubElement(channel, "atom:link")
    atom_link.set("href", f"{BLOG_URL}/feed.xml")
    atom_link.set("rel", "self")
    atom_link.set("type", "application/rss+xml")

    for post in entries:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = post["title"]
        url = url_for(post)
        ET.SubElement(item, "link").text = url
        ET.SubElement(item, "description").text = post.get("description", "")
        ET.SubElement(item, "guid", isPermaLink="true").text = url

        pub_date = datetime.strptime(post["date"], "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )
        ET.SubElement(item, "pubDate").text = pub_date.strftime(
            "%a, %d %b %Y %H:%M:%S +0000"
        )

        default_tags = {"rides": ["Rides"], "urbex": ["Urban Exploration"]}
        tags = post.get("tags") or default_tags.get(post["section"], [])
        for tag in tags:
            ET.SubElement(item, "category").text = tag

    tree = ET.ElementTree(rss)
    ET.indent(tree, space="  ")
    tree.write(ROOT / "feed.xml", xml_declaration=True, encoding="utf-8")


def modified_date(entry):
    """dateModified from the page's JSON-LD if it has one, else the publish date."""
    page = ROOT / entry["section"] / f"{entry['slug']}.html"
    if page.exists():
        m = re.search(r'"dateModified":\s*"(\d{4}-\d{2}-\d{2})', page.read_text())
        if m:
            return max(m.group(1), entry["date"])
    return entry["date"]


def generate_sitemap(posts, rides, urbex):
    ns = "http://www.sitemaps.org/schemas/sitemap/0.9"
    urlset = ET.Element("urlset", xmlns=ns)

    def add(loc, lastmod):
        url = ET.SubElement(urlset, "url")
        ET.SubElement(url, "loc").text = loc
        ET.SubElement(url, "lastmod").text = lastmod

    dated = [(e, modified_date(e)) for e in posts + rides + urbex]
    latest = max((d for _, d in dated), default=None)
    add(f"{BLOG_URL}/", latest)
    if rides:
        add(f"{BLOG_URL}/rides/", max(modified_date(r) for r in rides))
    if urbex:
        add(f"{BLOG_URL}/urbex/", max(modified_date(u) for u in urbex))
    for entry, lastmod in sorted(dated, key=lambda x: x[0]["date"], reverse=True):
        add(url_for(entry), lastmod)

    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")
    tree.write(ROOT / "sitemap.xml", xml_declaration=True, encoding="utf-8")


# ---------------- Static lists in the HTML ----------------

def pretty_date(iso):
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d:%b} {d.day}, {d.year}"


def post_html(post, indent):
    e = lambda s: html.escape(s, quote=True)
    pad = " " * indent
    return (
        f'{pad}<article class="post-item">\n'
        f'{pad}    <a href="posts/{e(post["slug"])}.html" class="post-link" data-slug="{e(post["slug"])}">\n'
        f'{pad}        <span class="post-title">{e(post["title"])}</span>\n'
        f'{pad}        <span class="post-desc">{e(post.get("description", ""))}</span>\n'
        f'{pad}        <span class="post-meta"><time datetime="{post["date"]}">{pretty_date(post["date"])}</time>'
        f' · {e(post.get("readTime", ""))}</span>\n'
        f'{pad}    </a>\n'
        f'{pad}</article>'
    )


def ride_html(ride, base, indent):
    e = lambda s: html.escape(s, quote=True)
    pad = " " * indent
    lines = [f'{pad}<a class="ride-item" href="{base}rides/{e(ride["slug"])}.html" data-slug="{e(ride["slug"])}">']
    if ride.get("cover"):
        lines.append(f'{pad}    <img class="ride-thumb" src="{base}{e(ride["cover"])}" alt="" loading="lazy">')
    lines.append(f'{pad}    <div>')
    lines.append(f'{pad}        <span class="post-title">{e(ride["title"])}</span>')
    if ride.get("description"):
        lines.append(f'{pad}        <span class="post-desc">{e(ride["description"])}</span>')
    extras = []
    if ride.get("distanceMi"):
        extras.append(f"{int(ride['distanceMi'] + 0.5)} mi")
    if ride.get("bike"):
        extras.append(e(ride["bike"]))
    meta = f'<time datetime="{ride["date"]}">{pretty_date(ride["date"])}</time>'
    if extras:
        meta += " · " + " · ".join(extras)
    lines.append(f'{pad}        <span class="post-meta">{meta}</span>')
    lines.append(f'{pad}    </div>')
    lines.append(f'{pad}</a>')
    return "\n".join(lines)


def urbex_html(spot, base, indent):
    e = lambda s: html.escape(s, quote=True)
    pad = " " * indent
    lines = [f'{pad}<a class="ride-item urbex-item" href="{base}urbex/{e(spot["slug"])}.html" data-slug="{e(spot["slug"])}">']
    if spot.get("cover"):
        lines.append(f'{pad}    <img class="ride-thumb" src="{base}{e(spot["cover"])}" alt="" loading="lazy">')
    lines.append(f'{pad}    <div>')
    lines.append(f'{pad}        <span class="post-title">{e(spot["title"])}</span>')
    if spot.get("description"):
        lines.append(f'{pad}        <span class="post-desc">{e(spot["description"])}</span>')
    meta = f'<time datetime="{spot["date"]}">{pretty_date(spot["date"])}</time>'
    if spot.get("area"):
        meta += f' · {e(spot["area"])}'
    lines.append(f'{pad}        <span class="post-meta">{meta}</span>')
    lines.append(f'{pad}    </div>')
    lines.append(f'{pad}</a>')
    return "\n".join(lines)


def urbex_tile(spot, base, indent):
    """A cover-photo tile for the homepage gallery."""
    e = lambda s: html.escape(s, quote=True)
    pad = " " * indent
    lines = [f'{pad}<a class="urbex-tile" href="{base}urbex/{e(spot["slug"])}.html" data-slug="{e(spot["slug"])}">']
    if spot.get("cover"):
        lines.append(f'{pad}    <img src="{base}{e(spot["cover"])}" alt="" loading="lazy">')
    for flag in BADGES:
        if spot.get(flag):
            lines.append(f'{pad}    <span class="urbex-badge urbex-{flag}">{flag}</span>')
    lines.append(f'{pad}    <span class="urbex-tile-text"><span class="urbex-tile-title">{e(spot["title"])}</span>'
                 f'<span class="urbex-tile-meta">{pretty_date(spot["date"])}</span></span>')
    lines.append(f'{pad}</a>')
    return "\n".join(lines)


def by_region(urbex):
    """[(region, spots)] with the region of the newest spot first."""
    groups = {}
    for u in urbex:  # already newest first
        groups.setdefault(u.get("region") or u.get("area", "").split(",")[-1].strip() or "Elsewhere", []).append(u)
    return list(groups.items())


def urbex_grouped(urbex, render, base, indent, wrap_cls):
    e = lambda s: html.escape(s, quote=True)
    pad = " " * indent
    out = []
    for region, spots in by_region(urbex):
        out.append(f'{pad}<h3 class="urbex-region">{e(region)}</h3>')
        out.append(f'{pad}<div class="{wrap_cls}">')
        out += [render(u, base, indent + 4) for u in spots]
        out.append(f'{pad}</div>')
    return "\n".join(out)


def fill(text, name, body):
    """Replace what's between <!-- name:start --> and <!-- name:end -->."""
    pattern = re.compile(rf"(<!-- {name}:start -->)(.*?)([ \t]*<!-- {name}:end -->)", re.S)
    if not pattern.search(text):
        raise SystemExit(f"Missing <!-- {name}:start/end --> markers")
    return pattern.sub(lambda m: f"{m.group(1)}\n{body}\n{m.group(3)}", text, count=1)


BADGES = ("demolished", "commercialized")


def sync_urbex_badges(urbex):
    """Labels next to the date on posts flagged e.g. "demolished": true or "commercialized": true."""
    for spot in urbex:
        page = ROOT / "urbex" / f"{spot['slug']}.html"
        if not page.exists():
            continue
        text = page.read_text()
        new = re.sub(r' <span class="urbex-(?:badge urbex-)?(?:demolished|commercialized)">[^<]*</span>', "", text)
        tags = "".join(f' <span class="urbex-badge urbex-{f}">{f}</span>' for f in BADGES if spot.get(f))
        if tags:
            new = re.sub(r'(<p class="ride-meta"><time[^>]*>[^<]*</time>)', lambda m: m.group(1) + tags, new, count=1)
        if new != text:
            page.write_text(new)


def render_lists(posts, rides, urbex):
    index = ROOT / "index.html"
    text = index.read_text()
    text = fill(text, "posts", "\n".join(post_html(p, 12) for p in posts))
    index.write_text(text)

    rides_index = ROOT / "rides" / "index.html"
    text = rides_index.read_text()
    body = "\n".join(ride_html(r, "../", 12) for r in rides) or \
        "            <p>No rides posted yet. The bike is probably in the shop.</p>"
    rides_index.write_text(fill(text, "rides", body))

    urbex_index = ROOT / "urbex" / "index.html"
    text = urbex_index.read_text()
    body = urbex_grouped(urbex, urbex_tile, "../", 12, "urbex-grid") or \
        "            <p>Nothing posted yet. Still looking for a way in.</p>"
    urbex_index.write_text(fill(text, "urbex", body))


if __name__ == "__main__":
    posts, rides, urbex = load_entries()
    everything = sorted(posts + rides + urbex, key=lambda p: p["date"], reverse=True)
    generate_feed(everything)
    generate_sitemap(posts, rides, urbex)
    render_lists(posts, rides, urbex)
    sync_urbex_badges(urbex)
    print("Generated feed.xml, sitemap.xml and the lists in index.html, rides/index.html + urbex/index.html")
