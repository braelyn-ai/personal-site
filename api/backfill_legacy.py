"""Turn the old analytics events into page views, so the admin page's traffic covers all time.

Before page-view tracking (Nov 2026), the sites only sent one-off events:
  blog:      blog_page_view (homepage), blog_post_read / blog_ride_read / blog_urbex_read (slug),
             blog_rides_view, blog_urbex_view, referral (the referring URL), and clicks
  main site: clicks only (social_click, door_enter, ipod_click, ...) and referral

This adds one `pageview` row per old page event (and one per main-site visit, from its first
click), with what can be recovered: site and path, time, visitor (a hash of IP + user agent), visit
(30-minute gap), location (IP), device/browser/OS (user agent), bot flag and referring site
(the referral event from the same visitor within a minute). Time on page and scroll weren't
recorded back then.

It only inserts. Old rows are untouched, each new row is marked event_data = "legacy:<old id>",
and running it again skips what's already done.

    python backfill_legacy.py           # dry run: prints what it would add
    python backfill_legacy.py --apply   # add the rows (one transaction)
    python backfill_legacy.py --undo    # delete every row this added
"""
import hashlib
import sys
from collections import Counter
from datetime import timedelta

from sqlalchemy import func, or_, text

import geo
import ua as ua_parser
from database import SessionLocal
from models import Event
from main import referrer_host

MARK = "legacy:"
SESSION_GAP = timedelta(minutes=30)
REFERRAL_WINDOW = timedelta(seconds=60)

# Old blog events that were themselves a page being opened
BLOG_PAGES = {
    "blog_page_view": lambda slug: "/",
    "blog_post_read": lambda slug: f"/posts/{slug}.html" if slug else None,
    "blog_ride_read": lambda slug: f"/rides/{slug}.html" if slug else None,
    "blog_urbex_read": lambda slug: f"/urbex/{slug}.html" if slug else None,
    "blog_rides_view": lambda slug: "/rides/",
    "blog_urbex_view": lambda slug: "/urbex/",
}
# Not visits on their own: page_leave pairs with a pageview, referral attaches to one
SKIP = {"pageview", "page_leave", "referral"}


def h(*parts):
    return hashlib.sha256("|".join(p or "" for p in parts).encode()).hexdigest()[:16]


def main():
    mode = "--apply" if "--apply" in sys.argv else "--undo" if "--undo" in sys.argv else "dry-run"
    db = SessionLocal()
    if mode == "--undo":
        n = db.execute(text("delete from events where event_type = 'pageview' and event_data like :m"),
                       {"m": MARK + "%"}).rowcount
        db.commit()
        print(f"Deleted {n} backfilled page views.")
        return

    geo.load()
    # Only events from before the new tracking started, so nothing gets counted twice
    legacy = Event.event_data.like(MARK + "%")
    # (page views without a path came from the old API, which dropped the new fields; they don't count)
    cutoff = db.query(func.min(Event.created_at)).filter(
        Event.event_type == "pageview", Event.path.isnot(None), or_(Event.event_data.is_(None), ~legacy)).scalar()
    done = {int(d[len(MARK):]) for (d,) in db.query(Event.event_data).filter(Event.event_type == "pageview", legacy)}
    q = db.query(Event.id, Event.event_type, Event.event_data, Event.ip_address, Event.user_agent, Event.created_at) \
        .filter(Event.event_type.notin_(["pageview", "page_leave"]), Event.created_at.isnot(None))
    if cutoff:
        q = q.filter(Event.created_at < cutoff)
    rows = q.order_by(Event.created_at, Event.id).all()

    types = Counter(r.event_type for r in rows)
    referrals = {}  # visitor -> [(time, url)]
    sessions = {}   # visitor -> (last event time, session id)
    main_visits = set()  # sessions that already got their main-site homepage view
    new = []

    for r in rows:
        visitor = "legacy-" + h(r.ip_address, r.user_agent)
        last = sessions.get(visitor)
        if not last or r.created_at - last[0] > SESSION_GAP:
            sid = "legacy-" + h(visitor, r.created_at.isoformat())
        else:
            sid = last[1]
        sessions[visitor] = (r.created_at, sid)

        if r.event_type == "referral":
            referrals.setdefault(visitor, []).append((r.created_at, r.event_data))
            continue
        if r.event_type in BLOG_PAGES:
            slug = (r.event_data or "").strip()
            # Some old events carried the whole path ("/rides/x.html") instead of a slug
            path = slug if slug.startswith("/") else BLOG_PAGES[r.event_type](slug)
            if path and not path.endswith(("/", ".html")):
                path += ".html"  # same page whether or not the old link had the extension
            site = "blog.braelyn.ai"
        elif r.event_type.startswith("blog_") or r.event_type in SKIP:
            continue  # clicks on the blog: the page they happened on was already counted
        elif sid not in main_visits:
            main_visits.add(sid)
            path = "/"  # main site: the first click of a visit stands in for the page load
            site = "braelyn.ai"
        else:
            continue
        if not path or r.id in done:
            continue
        new.append((r, visitor, sid, site, path))

    out = []
    for r, visitor, sid, site, path in new:
        # The closest unused referral from this visitor within a minute: it credits one view, not every page after it
        near = [x for x in referrals.get(visitor, []) if abs(x[0] - r.created_at) <= REFERRAL_WINDOW]
        hit = min(near, key=lambda x: abs(x[0] - r.created_at), default=None)
        ref = hit and hit[1]
        if hit:
            referrals[visitor].remove(hit)
        agent = ua_parser.parse(r.user_agent)
        country, region, city = geo.lookup(r.ip_address)
        out.append({
            "event_type": "pageview", "event_data": f"{MARK}{r.id}", "created_at": r.created_at,
            "ip_address": r.ip_address, "user_agent": r.user_agent, "site": site, "path": path,
            "visitor_id": visitor, "session_id": sid,
            "referrer": (ref or None) and ref[:1000], "referrer_host": referrer_host(ref),
            "country": country, "region": region, "city": city,
            "device": agent["device"], "browser": agent["browser"], "os": agent["os"], "is_bot": agent["is_bot"],
        })

    humans = [o for o in out if not o["is_bot"]]
    print(f"Old events before {cutoff or 'now'}: {sum(types.values())}  (already backfilled: {len(done)})")
    for t, n in types.most_common():
        print(f"  {n:7}  {t}")
    print(f"\nWould add {len(out)} page views ({len(out) - len(humans)} from bots, hidden on the admin page)")
    if out:
        print(f"  {out[0]['created_at']:%Y-%m-%d} to {out[-1]['created_at']:%Y-%m-%d}")
        print(f"  visitors {len({o['visitor_id'] for o in humans})}, visits {len({o['session_id'] for o in humans})}")
        print(f"  with location {sum(1 for o in humans if o['country'])}/{len(humans)}, "
              f"with a source {sum(1 for o in humans if o['referrer_host'])}/{len(humans)}")
        print("  top pages:")
        for p, n in Counter(o["site"] + o["path"] for o in humans).most_common(15):
            print(f"    {n:7}  {p}")

    if mode != "--apply":
        print("\nDry run. Nothing written. Run with --apply to add them.")
        return
    db.add_all(Event(**o) for o in out)
    db.commit()
    print(f"\nAdded {len(out)} page views.")


if __name__ == "__main__":
    main()
