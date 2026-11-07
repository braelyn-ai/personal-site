#!/usr/bin/env python3
"""Build the generated parts of the blog from posts.json and rides.json:

- feed.xml     RSS feed
- sitemap.xml  for search engines (robots.txt points at it)
- the post and ride lists inside index.html and rides/index.html, written as
  plain HTML between <!-- posts:start --> / <!-- posts:end --> style markers so
  crawlers and link previews see them without running JavaScript

Run it after editing posts.json (new_ride.py runs it for rides).
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


def load_entries():
    with open(ROOT / "posts.json") as f:
        posts = [{**p, "section": "posts"} for p in json.load(f)]
    rides = []
    rides_path = ROOT / "rides.json"
    if rides_path.exists():
        with open(rides_path) as f:
            rides = [{**r, "section": "rides"} for r in json.load(f)]
    rides.sort(key=lambda r: r["date"], reverse=True)
    return posts, rides


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

        tags = post.get("tags") or (["Rides"] if post["section"] == "rides" else [])
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


def generate_sitemap(posts, rides):
    ns = "http://www.sitemaps.org/schemas/sitemap/0.9"
    urlset = ET.Element("urlset", xmlns=ns)

    def add(loc, lastmod):
        url = ET.SubElement(urlset, "url")
        ET.SubElement(url, "loc").text = loc
        ET.SubElement(url, "lastmod").text = lastmod

    dated = [(e, modified_date(e)) for e in posts + rides]
    latest = max((d for _, d in dated), default=None)
    add(f"{BLOG_URL}/", latest)
    if rides:
        add(f"{BLOG_URL}/rides/", max(modified_date(r) for r in rides))
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


def fill(text, name, body):
    """Replace what's between <!-- name:start --> and <!-- name:end -->."""
    pattern = re.compile(rf"(<!-- {name}:start -->)(.*?)([ \t]*<!-- {name}:end -->)", re.S)
    if not pattern.search(text):
        raise SystemExit(f"Missing <!-- {name}:start/end --> markers")
    return pattern.sub(lambda m: f"{m.group(1)}\n{body}\n{m.group(3)}", text, count=1)


def render_lists(posts, rides):
    index = ROOT / "index.html"
    text = index.read_text()
    text = fill(text, "posts", "\n".join(post_html(p, 12) for p in posts))
    text = fill(text, "rides", "\n".join(ride_html(r, "", 12) for r in rides[:3]))
    # The homepage rides section only shows once there's a ride
    text = re.sub(r'<section id="rides-section"( hidden)?>',
                  '<section id="rides-section">' if rides else '<section id="rides-section" hidden>', text)
    index.write_text(text)

    rides_index = ROOT / "rides" / "index.html"
    text = rides_index.read_text()
    body = "\n".join(ride_html(r, "../", 12) for r in rides) or \
        "            <p>No rides posted yet. The bike is probably in the shop.</p>"
    rides_index.write_text(fill(text, "rides", body))


if __name__ == "__main__":
    posts, rides = load_entries()
    everything = sorted(posts + rides, key=lambda p: p["date"], reverse=True)
    generate_feed(everything)
    generate_sitemap(posts, rides)
    render_lists(posts, rides)
    print("Generated feed.xml, sitemap.xml and the lists in index.html + rides/index.html")
