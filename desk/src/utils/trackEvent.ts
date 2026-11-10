/**
 * Event tracking utility
 * Sends analytics events to the API, which adds location, device and referring site.
 * No cookies: a random visitor id lives in localStorage and a session id in sessionStorage
 * (the same keys the blog uses).
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface TrackEventOptions {
  eventType: string
  eventData?: string
}

function storedId(store: Storage, key: string): string | null {
  try {
    let v = store.getItem(key)
    if (!v) {
      v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)
      store.setItem(key, v)
    }
    return v
  } catch {
    return null
  }
}

const visitorId = storedId(window.localStorage, 'bb_vid')
const sessionId = storedId(window.sessionStorage, 'bb_sid')
const params = new URLSearchParams(location.search)

function context() {
  return {
    path: location.pathname,
    title: document.title,
    referrer: document.referrer || null,
    utm_source: params.get('utm_source') || params.get('ref'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    visitor_id: visitorId,
    session_id: sessionId,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

// Plain text so it can go as a beacon without a CORS preflight
function send(body: object, beacon = false): void {
  const data = JSON.stringify(body)
  if (beacon && navigator.sendBeacon?.(`${API_BASE}/slurp`, new Blob([data], { type: 'text/plain' }))) return
  fetch(`${API_BASE}/slurp`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: data,
    keepalive: true,
  }).catch((error) => {
    // Silently log errors - we don't want tracking to affect user experience
    console.debug('Event tracking failed:', error)
  })
}

let referrerSent = false

/**
 * Track an event by sending it to the API.
 * This is fire-and-forget - errors are logged but not thrown.
 */
export function trackEvent({ eventType, eventData }: TrackEventOptions): void {
  // Track referrer on first event call
  if (!referrerSent) {
    referrerSent = true
    if (document.referrer && !document.referrer.includes(location.hostname)) {
      trackEvent({ eventType: 'referral', eventData: document.referrer })
    }
  }
  send({ ...context(), event_type: eventType, event_data: eventData ?? null })
}

/**
 * Record the page view now, and time on page when the visitor leaves or switches away.
 */
export function trackPageview(): void {
  trackEvent({ eventType: 'pageview' })
  let visibleMs = 0
  let shownAt: number | null = document.visibilityState === 'visible' ? Date.now() : null
  let left = false
  const leave = () => {
    if (shownAt) { visibleMs += Date.now() - shownAt; shownAt = null }
    if (left) return
    left = true
    send({ ...context(), event_type: 'page_leave', duration_s: Math.round(visibleMs / 1000) }, true)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave()
    else if (!shownAt) shownAt = Date.now()
  })
  window.addEventListener('pagehide', leave)
}
