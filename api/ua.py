"""Tiny user-agent parser: device type, browser, OS, and whether it's a bot."""
import re
from typing import Optional

BOT = re.compile(
    r"bot|crawl|spider|slurp|scrape|headless|lighthouse|preview|fetch|monitor|uptime|python|curl|wget|httpx|"
    r"facebookexternalhit|embedly|whatsapp|telegram|discord|slack|vercel|pingdom|gtmetrix|semrush|ahrefs",
    re.I,
)


def parse(ua: Optional[str]) -> dict:
    ua = ua or ""
    if not ua or BOT.search(ua):
        return {"device": "bot", "browser": None, "os": None, "is_bot": True}
    if re.search(r"iPad|Tablet|Nexus (7|9|10)|SM-T", ua) or ("Android" in ua and "Mobile" not in ua):
        device = "tablet"
    elif re.search(r"Mobi|iPhone|Android", ua):
        device = "mobile"
    else:
        device = "desktop"
    browser = next((n for n, p in (
        ("Edge", r"Edg/"), ("Opera", r"OPR/|Opera"), ("Samsung Internet", r"SamsungBrowser"),
        ("Arc", r"Arc/"), ("Firefox", r"Firefox|FxiOS"), ("Chrome", r"Chrome|CriOS"), ("Safari", r"Safari"),
    ) if re.search(p, ua)), "Other")
    os_ = next((n for n, p in (
        ("iOS", r"iPhone|iPad|iPod"), ("Android", r"Android"), ("Windows", r"Windows"),
        ("macOS", r"Mac OS X|Macintosh"), ("ChromeOS", r"CrOS"), ("Linux", r"Linux"),
    ) if re.search(p, ua)), "Other")
    return {"device": device, "browser": browser, "os": os_, "is_bot": False}
