"""IP -> country/region/city using the free DB-IP City Lite database (CC BY 4.0, https://db-ip.com).

The database (~130MB) is downloaded on startup and refreshed monthly. Lookups return
None until it's ready, so tracking never blocks on it.
"""
import gzip
import logging
import os
import shutil
import threading
from datetime import date, timedelta
from typing import Optional, Tuple

import httpx
import maxminddb

logger = logging.getLogger(__name__)

GEO_DIR = os.getenv("GEO_DIR", "/tmp/geo")
_reader = None
_lock = threading.Lock()


def _db_url(d: date) -> str:
    return f"https://download.db-ip.com/free/dbip-city-lite-{d:%Y-%m}.mmdb.gz"


def _download(path: str) -> bool:
    today = date.today()
    # This month's file may not be published yet on the 1st; fall back to last month's
    last_month = today.replace(day=1) - timedelta(days=1)
    for d in (today, last_month):
        try:
            with httpx.stream("GET", _db_url(d), timeout=120, follow_redirects=True) as r:
                if r.status_code != 200:
                    continue
                tmp = path + ".gz.part"
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
            with gzip.open(tmp, "rb") as src, open(path + ".part", "wb") as dst:
                shutil.copyfileobj(src, dst)
            os.replace(path + ".part", path)
            os.remove(tmp)
            return True
        except Exception as e:  # network hiccups shouldn't take the API down
            logger.warning(f"GeoIP download failed for {d:%Y-%m}: {e}")
    return False


def load() -> None:
    """Download (if needed) and open the database. Safe to call from a background thread."""
    global _reader
    os.makedirs(GEO_DIR, exist_ok=True)
    path = os.path.join(GEO_DIR, f"dbip-city-lite-{date.today():%Y-%m}.mmdb")
    if not os.path.exists(path) and not _download(path):
        # Use whatever older copy is lying around
        old = sorted(f for f in os.listdir(GEO_DIR) if f.endswith(".mmdb"))
        if not old:
            logger.warning("GeoIP database unavailable; locations won't be recorded")
            return
        path = os.path.join(GEO_DIR, old[-1])
    with _lock:
        _reader = maxminddb.open_database(path)
    logger.info(f"GeoIP database loaded: {path}")


def lookup(ip: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(country, region, city) for an IP, or Nones."""
    if not ip or _reader is None:
        return None, None, None
    try:
        with _lock:
            rec = _reader.get(ip)
    except Exception:
        return None, None, None
    if not rec:
        return None, None, None
    name = lambda o: (o or {}).get("names", {}).get("en")
    subs = rec.get("subdivisions") or [{}]
    return name(rec.get("country")), name(subs[0]), name(rec.get("city"))
