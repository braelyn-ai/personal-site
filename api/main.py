import asyncio
import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta
from urllib.parse import urlparse
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import boto3
from botocore.config import Config
from session_manager import session_manager
from database import SessionLocal
from models import Event
import geo
import ua as ua_parser

logger = logging.getLogger(__name__)


class ExecuteCommandRequest(BaseModel):
    session_token: str
    command: str


class EndSessionRequest(BaseModel):
    session_token: str


class SlurpEventRequest(BaseModel):
    event_type: str
    event_data: Optional[str] = None
    # Optional page-view context
    path: Optional[str] = None
    title: Optional[str] = None
    referrer: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    visitor_id: Optional[str] = None
    session_id: Optional[str] = None
    screen: Optional[str] = None
    language: Optional[str] = None
    timezone: Optional[str] = None
    duration_s: Optional[int] = None
    scroll_pct: Optional[int] = None


# Our own sites: a referrer from one of these is internal navigation, not a source
OWN_HOSTS = ("braelyn.ai",)


# Friendly names for sites that send traffic under several hostnames
SOURCE_NAMES = {
    "t.co": "x", "x.com": "x", "twitter.com": "x", "instagram.com": "instagram",
    "facebook.com": "facebook", "fb.com": "facebook", "linkedin.com": "linkedin", "lnkd.in": "linkedin",
    "news.ycombinator.com": "hacker news", "reddit.com": "reddit", "youtube.com": "youtube",
    "threads.net": "threads", "bsky.app": "bluesky", "tiktok.com": "tiktok", "bing.com": "bing",
    "duckduckgo.com": "duckduckgo", "chatgpt.com": "chatgpt", "perplexity.ai": "perplexity",
}


def source_name(name: Optional[str]) -> Optional[str]:
    """Normalize a hostname or utm_source so the same site always groups together."""
    if not name:
        return None
    name = name.strip().lower().removeprefix("www.")
    for prefix in ("l.", "lm.", "m.", "mobile.", "old.", "out."):
        if name.startswith(prefix) and name[len(prefix):] in SOURCE_NAMES:
            name = name[len(prefix):]
    if name.startswith("google.") or ".google." in name:
        return "google"
    return SOURCE_NAMES.get(name, name)


def referrer_host(referrer: Optional[str]) -> Optional[str]:
    """Where an external visit came from (e.g. "google", "x", "example.com"), or None for direct/internal."""
    if not referrer:
        return None
    host = (urlparse(referrer).hostname or "").lower().removeprefix("www.")
    if not host or any(host == h or host.endswith("." + h) for h in OWN_HOSTS):
        return None
    return source_name(host)


def require_admin(request: Request) -> None:
    """Admin endpoints need `Authorization: Bearer $ADMIN_TOKEN`. Closed if the token isn't set."""
    token = os.getenv("ADMIN_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="ADMIN_TOKEN not configured")
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not secrets.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def cleanup_task():
    """Background task to clean up expired sessions every minute."""
    while True:
        await asyncio.sleep(60)  # Run every minute
        await session_manager.cleanup_expired()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan events."""
    # Startup: Start background cleanup task
    cleanup_job = asyncio.create_task(cleanup_task())
    # Load the GeoIP database in the background so startup isn't blocked by the download
    threading.Thread(target=geo.load, daemon=True).start()
    yield
    # Shutdown: Cancel cleanup task
    cleanup_job.cancel()


app = FastAPI(title="Personal Site API", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://braelyn.ai",
        "https://www.braelyn.ai",
        "https://blog.braelyn.ai",
        "http://localhost:4200",  # Angular dev server
        "http://localhost:5173",  # Vite dev server
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Welcome to Personal Site API"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/slurp")
async def slurp_event(request: Request):
    """Record an event from the frontend.

    Accepts JSON with any content type, because navigator.sendBeacon (used when a
    page closes) can only send text/plain without a CORS preflight.
    """
    try:
        event = SlurpEventRequest.model_validate_json(await request.body())
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid event")

    # Client IP (first hop when behind a proxy)
    ip_address = request.headers.get("x-forwarded-for")
    if ip_address:
        ip_address = ip_address.split(",")[0].strip()
    else:
        ip_address = request.client.host if request.client else None

    user_agent = request.headers.get("user-agent")
    agent = ua_parser.parse(user_agent)
    country, region, city = geo.lookup(ip_address)
    clip = lambda v, n=500: v[:n] if isinstance(v, str) else v

    try:
        db = SessionLocal()
        db.add(Event(
            event_type=clip(event.event_type, 100),
            event_data=clip(event.event_data),
            ip_address=ip_address,
            user_agent=clip(user_agent),
            path=clip(event.path),
            title=clip(event.title, 300),
            referrer=clip(event.referrer, 1000),
            referrer_host=referrer_host(event.referrer),
            utm_source=clip(source_name(event.utm_source), 100),
            utm_medium=clip(event.utm_medium, 100),
            utm_campaign=clip(event.utm_campaign, 100),
            visitor_id=clip(event.visitor_id, 64),
            session_id=clip(event.session_id, 64),
            screen=clip(event.screen, 20),
            language=clip(event.language, 20),
            timezone=clip(event.timezone, 64),
            duration_s=max(0, min(event.duration_s, 86400)) if event.duration_s is not None else None,
            scroll_pct=max(0, min(event.scroll_pct, 100)) if event.scroll_pct is not None else None,
            country=country, region=region, city=city,
            device=agent["device"], browser=agent["browser"], os=agent["os"], is_bot=agent["is_bot"],
        ))
        db.commit()
        db.close()
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Failed to record event: {e}")
        raise HTTPException(status_code=500, detail="Failed to record event")


@app.get("/api/hello")
async def hello():
    """Simple hello endpoint"""
    return {"message": "Hello from the API!"}


@app.get("/api/admin/stats", dependencies=[Depends(require_admin)])
async def get_admin_stats():
    """Get statistics for the admin dashboard."""
    from sqlalchemy import func as sql_func
    from datetime import datetime, timedelta
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        db = SessionLocal()
        
        # Total events
        total_events = db.query(Event).count()
        
        # Events by type
        events_by_type = db.query(
            Event.event_type,
            sql_func.count(Event.id).label('count')
        ).group_by(Event.event_type).all()
        
        # Events in last 24 hours
        yesterday = datetime.now() - timedelta(days=1)
        events_last_24h = db.query(Event).filter(Event.created_at >= yesterday).count()
        
        # Events in last 7 days
        last_week = datetime.now() - timedelta(days=7)
        events_last_7d = db.query(Event).filter(Event.created_at >= last_week).count()
        
        # Unique IPs
        unique_ips = db.query(sql_func.count(sql_func.distinct(Event.ip_address))).scalar()
        
        # Events by day (last 30 days)
        last_30_days = datetime.now() - timedelta(days=30)
        events_by_day = db.query(
            sql_func.date(Event.created_at).label('date'),
            sql_func.count(Event.id).label('count')
        ).filter(Event.created_at >= last_30_days).group_by(
            sql_func.date(Event.created_at)
        ).order_by(sql_func.date(Event.created_at)).all()
        
        # Social clicks by type
        social_clicks = db.query(
            Event.event_data,
            sql_func.count(Event.id).label('count')
        ).filter(Event.event_type == 'social_click').group_by(Event.event_data).all()

        # Blog post views (blog_post_click events grouped by event_data)
        blog_post_views = db.query(
            Event.event_data,
            sql_func.count(Event.id).label('count')
        ).filter(
            Event.event_type == 'blog_post_click',
            Event.event_data.isnot(None)
        ).group_by(Event.event_data).order_by(sql_func.count(Event.id).desc()).all()

        # Blog post visits (blog_post_read events grouped by event_data)
        blog_post_visits = db.query(
            Event.event_data,
            sql_func.count(Event.id).label('count')
        ).filter(
            Event.event_type == 'blog_post_read',
            Event.event_data.isnot(None)
        ).group_by(Event.event_data).order_by(sql_func.count(Event.id).desc()).all()

        # Top referrers (referral events grouped by event_data)
        top_referrers = db.query(
            Event.event_data,
            sql_func.count(Event.id).label('count')
        ).filter(
            Event.event_type == 'referral',
            Event.event_data.isnot(None)
        ).group_by(Event.event_data).order_by(sql_func.count(Event.id).desc()).limit(20).all()

        # Recent events (last 50)
        recent_events = db.query(Event).order_by(Event.created_at.desc()).limit(50).all()

        db.close()

        return {
            "total_events": total_events,
            "events_by_type": [{"type": t, "count": c} for t, c in events_by_type],
            "events_last_24h": events_last_24h,
            "events_last_7d": events_last_7d,
            "unique_ips": unique_ips,
            "events_by_day": [{"date": str(d), "count": c} for d, c in events_by_day],
            "social_clicks_by_type": [{"type": t or "unknown", "count": c} for t, c in social_clicks],
            "blog_post_views": [{"slug": slug, "count": c} for slug, c in blog_post_views],
            "blog_post_visits": [{"slug": slug, "count": c} for slug, c in blog_post_visits],
            "top_referrers": [{"url": url, "count": c} for url, c in top_referrers],
            "recent_events": [
                {
                    "id": e.id,
                    "event_type": e.event_type,
                    "event_data": e.event_data,
                    "ip_address": e.ip_address,
                    "user_agent": e.user_agent[:100] + "..." if e.user_agent and len(e.user_agent) > 100 else e.user_agent,
                    "created_at": e.created_at.isoformat() if e.created_at else None
                }
                for e in recent_events
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get admin stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get stats")


@app.get("/api/admin/traffic", dependencies=[Depends(require_admin)])
async def get_admin_traffic(days: int = 30):
    """Page views: which pages, from where (sites, places, devices), over the last `days` days (0 = all time)."""
    from sqlalchemy import case, distinct, func as f

    days = max(0, min(days, 3650))
    # No date filter at all for all time
    window = [Event.created_at >= datetime.now() - timedelta(days=days)] if days else []
    db = SessionLocal()
    try:
        views = db.query(Event).filter(
            Event.event_type == "pageview", *window, Event.is_bot.isnot(True))
        leaves = db.query(Event).filter(
            Event.event_type == "page_leave", *window, Event.is_bot.isnot(True))
        source = f.coalesce(Event.utm_source, Event.referrer_host, "direct")

        def top(col, n=20, q=views, label=None):
            rows = q.with_entities(col.label("k"), f.count(Event.id), f.count(distinct(Event.visitor_id))) \
                .group_by(col).order_by(f.count(Event.id).desc()).limit(n).all()
            return [{"key": k or "Unknown", "views": v, "visitors": u} for k, v, u in rows]

        # Time on page and scroll depth come from the page_leave event
        engagement = {p: (round(s or 0), round(sc or 0)) for p, s, sc in leaves.with_entities(
            Event.path, f.avg(Event.duration_s), f.avg(Event.scroll_pct)).group_by(Event.path).all()}
        pages = top(Event.path, 50)
        for p in pages:
            p["avg_seconds"], p["avg_scroll"] = engagement.get(p["key"], (None, None))

        place = f.coalesce(Event.city, "?") + ", " + f.coalesce(Event.region, "?") + ", " + f.coalesce(Event.country, "?")
        pairs = views.with_entities(Event.path, source, f.count(Event.id)).group_by(Event.path, source) \
            .order_by(f.count(Event.id).desc()).limit(50).all()
        daily = views.with_entities(f.date(Event.created_at), f.count(Event.id), f.count(distinct(Event.visitor_id))) \
            .group_by(f.date(Event.created_at)).order_by(f.date(Event.created_at)).all()
        recent = views.order_by(Event.created_at.desc()).limit(50).all()
        bots = db.query(f.count(Event.id)).filter(
            Event.event_type == "pageview", *window, Event.is_bot.is_(True)).scalar()

        return {
            "days": days,
            "totals": {
                "views": views.count(),
                "visitors": views.with_entities(f.count(distinct(Event.visitor_id))).scalar(),
                "sessions": views.with_entities(f.count(distinct(Event.session_id))).scalar(),
                "avg_seconds": round(leaves.with_entities(f.avg(Event.duration_s)).scalar() or 0),
                "bot_views_excluded": bots,
            },
            "daily": [{"date": str(d), "views": v, "visitors": u} for d, v, u in daily],
            "pages": pages,
            "sources": top(source),
            "page_sources": [{"path": p, "source": s, "views": v} for p, s, v in pairs],
            "campaigns": top(Event.utm_campaign, 20, views.filter(Event.utm_campaign.isnot(None))),
            "countries": top(Event.country),
            "places": top(place, 30, views.filter(Event.country.isnot(None))),
            "devices": top(Event.device, 10),
            "browsers": top(Event.browser, 10),
            "os": top(Event.os, 10),
            "recent": [{
                "time": e.created_at.isoformat() if e.created_at else None,
                "path": e.path, "title": e.title,
                "source": e.utm_source or e.referrer_host or "direct",
                "place": ", ".join(x for x in (e.city, e.country) if x) or None,
                "device": e.device, "browser": e.browser, "visitor": (e.visitor_id or "")[:6],
            } for e in recent],
        }
    except Exception as e:
        logger.error(f"Failed to get traffic: {e}")
        raise HTTPException(status_code=500, detail="Failed to get traffic")
    finally:
        db.close()


@app.get("/api/lastfm/now-playing")
async def get_lastfm_now_playing():
    """Get the last scrobbled track from Last.fm."""
    import logging
    logger = logging.getLogger(__name__)
    
    api_key = os.getenv("LAST_FM_API_KEY")
    username = os.getenv("LAST_FM_USERNAME", "braelinux")
    
    if not api_key:
        logger.error("LAST_FM_API_KEY not configured")
        raise HTTPException(status_code=500, detail="LAST_FM_API_KEY not configured")
    
    url = "https://ws.audioscrobbler.com/2.0/"
    params = {
        "method": "user.getrecenttracks",
        "user": username,
        "api_key": api_key,
        "format": "json",
        "limit": 1,
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
            
            if response.status_code != 200:
                logger.error(f"Last.fm API returned {response.status_code}: {response.text}")
                raise HTTPException(status_code=502, detail="Failed to fetch from Last.fm")
            
            data = response.json()
            
            track = data["recenttracks"]["track"][0]
            now_playing = track.get("@attr", {}).get("nowplaying", "false") == "true"
            
            return {
                "artist": track["artist"]["#text"],
                "track": track["name"],
                "album": track["album"]["#text"],
                "now_playing": now_playing,
                "url": track["url"],
                "image": track["image"][-1]["#text"] if track["image"] else None,
            }
    except HTTPException:
        raise
    except (KeyError, IndexError) as e:
        logger.error(f"Failed to parse Last.fm response: {e}")
        raise HTTPException(status_code=404, detail="No recent tracks found")
    except Exception as e:
        logger.error(f"Unexpected error in lastfm endpoint: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# S3 client for presigned URLs
def get_s3_client():
    return boto3.client(
        's3',
        endpoint_url=os.getenv('BUCKET_ENDPOINT'),
        aws_access_key_id=os.getenv('BUCKET_ACCESS_KEY'),
        aws_secret_access_key=os.getenv('BUCKET_SECRET_ACCESS_KEY'),
        config=Config(signature_version='s3v4'),
        region_name='auto'
    )


@app.get("/api/assets/{path:path}")
async def get_asset(path: str):
    """Proxy an asset from S3 storage."""
    import logging
    logger = logging.getLogger(__name__)
    
    bucket_name = os.getenv('BUCKET_NAME')
    if not bucket_name:
        logger.error("BUCKET_NAME not configured")
        raise HTTPException(status_code=500, detail="Storage not configured")
    
    try:
        s3 = get_s3_client()
        # Assets are stored under desk/ prefix in the bucket
        key = f"desk/{path}"
        
        response = s3.get_object(Bucket=bucket_name, Key=key)
        
        # Determine content type from file extension
        content_type = "application/octet-stream"
        if path.endswith('.glb'):
            content_type = "model/gltf-binary"
        elif path.endswith('.gltf'):
            content_type = "model/gltf+json"
        elif path.endswith('.mp3'):
            content_type = "audio/mpeg"
        elif path.endswith('.bin'):
            content_type = "application/octet-stream"
        elif path.endswith('.jpg') or path.endswith('.jpeg'):
            content_type = "image/jpeg"
        elif path.endswith('.png'):
            content_type = "image/png"
        
        def iterfile():
            for chunk in response['Body'].iter_chunks(chunk_size=64 * 1024):
                yield chunk
        
        return StreamingResponse(
            iterfile(),
            media_type=content_type,
            headers={
                "Content-Length": str(response['ContentLength']),
                "Cache-Control": "public, max-age=31536000",  # 1 year cache
            }
        )
    except Exception as e:
        logger.error(f"Failed to fetch asset {path}: {e}")
        raise HTTPException(status_code=404, detail="Asset not found")


@app.post("/api/terminal/session/start")
async def start_terminal_session():
    """Start a new E2B terminal session."""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info("Starting new terminal session...")
        result = await session_manager.start_session()
        logger.info(f"Session started successfully: {result['session_token']}")
        return result
    except Exception as e:
        logger.error(f"Failed to start session: {type(e).__name__}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")

@app.post("/api/terminal/session/execute")
async def execute_terminal_command(request: ExecuteCommandRequest):
    """Execute a command in an active terminal session."""
    result = await session_manager.execute_command(request.session_token, request.command)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.delete("/api/terminal/session/end")
async def end_terminal_session(request: EndSessionRequest):
    """End a terminal session."""
    session_manager.close_session(request.session_token)
    return {"status": "session closed"}


@app.websocket("/api/terminal/ws/{session_token}")
async def terminal_websocket(websocket: WebSocket, session_token: str):
    """WebSocket endpoint for interactive PTY terminal sessions.
    
    Protocol:
    - Client sends: {"type": "input", "data": "..."} for keyboard input
    - Client sends: {"type": "resize", "rows": N, "cols": M} for terminal resize
    - Server sends: {"type": "output", "data": "..."} for PTY output
    - Server sends: {"type": "error", "message": "..."} for errors
    """
    await websocket.accept()
    logger.info(f"WebSocket connection accepted for session: {session_token}")
    
    # Verify session exists
    session = session_manager.get_session(session_token)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found or expired"})
        await websocket.close(code=4001)
        return
    
    # PTY output arrives from a background thread; hand it to the event loop
    # via call_soon_threadsafe so the sender task can await instead of polling
    loop = asyncio.get_running_loop()
    output_queue: asyncio.Queue[str] = asyncio.Queue()

    def on_pty_output(data: str):
        """Callback when PTY produces output (called from background thread)."""
        try:
            loop.call_soon_threadsafe(output_queue.put_nowait, data)
        except RuntimeError:
            # Event loop already closed (connection torn down)
            pass

    # Set up the output callback
    session_manager.set_output_callback(session_token, on_pty_output)

    async def send_output():
        """Task to send PTY output to WebSocket."""
        try:
            while True:
                data = await output_queue.get()
                await websocket.send_json({"type": "output", "data": data})
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error sending output: {e}")
    
    # Start output sender task
    output_task = asyncio.create_task(send_output())
    
    try:
        while True:
            # Receive messages from client
            raw_message = await websocket.receive_text()
            
            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue
            
            msg_type = message.get("type")
            
            if msg_type == "input":
                # Send input to PTY
                data = message.get("data", "")
                if data:
                    success = session_manager.send_input(session_token, data)
                    if not success:
                        await websocket.send_json({"type": "error", "message": "Failed to send input"})
            
            elif msg_type == "resize":
                # Resize PTY
                rows = message.get("rows", 24)
                cols = message.get("cols", 80)
                session_manager.resize_pty(session_token, rows, cols)
            
            else:
                await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session: {session_token}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Clean up
        output_task.cancel()
        try:
            await output_task
        except asyncio.CancelledError:
            pass
        # Clear the callback
        session_manager.set_output_callback(session_token, lambda _: None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
