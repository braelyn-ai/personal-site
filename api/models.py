from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from database import Base


class TerminalSession(Base):
    __tablename__ = "terminal_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, index=True, nullable=False)
    event_data = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Page view context (sent by the page)
    path = Column(String, nullable=True, index=True)
    title = Column(String, nullable=True)
    referrer = Column(String, nullable=True)
    utm_source = Column(String, nullable=True)
    utm_medium = Column(String, nullable=True)
    utm_campaign = Column(String, nullable=True)
    visitor_id = Column(String, nullable=True, index=True)  # random id in localStorage, no cookies
    session_id = Column(String, nullable=True)  # random id per tab session
    screen = Column(String, nullable=True)
    language = Column(String, nullable=True)
    timezone = Column(String, nullable=True)
    duration_s = Column(Integer, nullable=True)  # time on page (page_leave)
    scroll_pct = Column(Integer, nullable=True)  # deepest scroll (page_leave)

    # Derived on the server
    referrer_host = Column(String, nullable=True)
    country = Column(String, nullable=True, index=True)
    region = Column(String, nullable=True)
    city = Column(String, nullable=True)
    device = Column(String, nullable=True)
    browser = Column(String, nullable=True)
    os = Column(String, nullable=True)
    is_bot = Column(Boolean, nullable=True)
