#!/usr/bin/env python3
"""Generate RSS feed (feed.xml) from posts.json and rides.json"""

import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

BLOG_URL = "https://blog.braelyn.ai"

def generate_feed():
    root = Path(__file__).parent
    with open(root / "posts.json") as f:
        posts = [{**p, "section": "posts"} for p in json.load(f)]
    rides_path = root / "rides.json"
    if rides_path.exists():
        with open(rides_path) as f:
            posts += [{**r, "section": "rides", "tags": r.get("tags") or ["Rides"]}
                      for r in json.load(f)]
    posts.sort(key=lambda p: p["date"], reverse=True)

    rss = ET.Element("rss", version="2.0", attrib={
        "xmlns:atom": "http://www.w3.org/2005/Atom",
    })
    channel = ET.SubElement(rss, "channel")

    ET.SubElement(channel, "title").text = "Braelyn's Blog"
    ET.SubElement(channel, "link").text = BLOG_URL
    ET.SubElement(channel, "description").text = (
        "A personal blog exploring technology, creativity, "
        "and the art of building meaningful things."
    )
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "lastBuildDate").text = (
        datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    )

    atom_link = ET.SubElement(channel, "atom:link")
    atom_link.set("href", f"{BLOG_URL}/feed.xml")
    atom_link.set("rel", "self")
    atom_link.set("type", "application/rss+xml")

    for post in posts:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = post["title"]
        url = f"{BLOG_URL}/{post['section']}/{post['slug']}.html"
        ET.SubElement(item, "link").text = url
        ET.SubElement(item, "description").text = post.get("description", "")
        ET.SubElement(item, "guid", isPermaLink="true").text = url

        pub_date = datetime.strptime(post["date"], "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )
        ET.SubElement(item, "pubDate").text = pub_date.strftime(
            "%a, %d %b %Y %H:%M:%S +0000"
        )

        for tag in post.get("tags", []):
            ET.SubElement(item, "category").text = tag

    tree = ET.ElementTree(rss)
    ET.indent(tree, space="  ")

    feed_path = Path(__file__).parent / "feed.xml"
    tree.write(feed_path, xml_declaration=True, encoding="utf-8")
    print(f"Generated {feed_path}")


if __name__ == "__main__":
    generate_feed()
