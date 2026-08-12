import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import boto3
from botocore.config import Config
from session_manager import session_manager
from database import SessionLocal
from models import Event

logger = logging.getLogger(__name__)


class ExecuteCommandRequest(BaseModel):
    session_token: str
    command: str


class EndSessionRequest(BaseModel):
    session_token: str


class SlurpEventRequest(BaseModel):
    event_type: str
    event_data: Optional[str] = None


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
async def slurp_event(request: Request, event: SlurpEventRequest):
    """Record an event from the frontend."""
    import logging
    logger = logging.getLogger(__name__)
    
    # Get IP address from request headers (handle proxies)
    ip_address = request.headers.get("x-forwarded-for")
    if ip_address:
        # Take the first IP if there are multiple (client IP)
        ip_address = ip_address.split(",")[0].strip()
    else:
        ip_address = request.client.host if request.client else None
    
    user_agent = request.headers.get("user-agent")
    
    try:
        db = SessionLocal()
        db_event = Event(
            event_type=event.event_type,
            event_data=event.event_data,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(db_event)
        db.commit()
        db.close()
        
        logger.info(f"Event recorded: {event.event_type}")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Failed to record event: {e}")
        raise HTTPException(status_code=500, detail="Failed to record event")


@app.get("/api/hello")
async def hello():
    """Simple hello endpoint"""
    return {"message": "Hello from the API!"}


@app.get("/api/admin/stats")
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
