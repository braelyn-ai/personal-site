// Blog analytics. Sends events to api.braelyn.ai/slurp, which adds the visitor's
// location, device and referring site. No cookies: a random visitor id lives in
// localStorage and a session id in sessionStorage.
(function () {
    const API = 'https://api.braelyn.ai/slurp';
    // Don't count local previews
    const enabled = !/^(localhost|127\.0\.0\.1|\[::1\])$|\.local$/.test(location.hostname);

    function stored(store, key) {
        try {
            let v = store.getItem(key);
            if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); store.setItem(key, v); }
            return v;
        } catch (e) { return null; }
    }
    const visitorId = stored(window.localStorage, 'bb_vid');
    const sessionId = stored(window.sessionStorage, 'bb_sid');
    const params = new URLSearchParams(location.search);

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
        };
    }

    // Plain text so it can go as a beacon without a CORS preflight
    function send(body, beacon) {
        if (!enabled) return;
        const data = JSON.stringify(body);
        if (beacon && navigator.sendBeacon && navigator.sendBeacon(API, new Blob([data], { type: 'text/plain' }))) return;
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: data, keepalive: true }).catch(() => {});
    }

    function slurp(eventType, eventData) {
        send(Object.assign(context(), { event_type: eventType, event_data: eventData == null ? null : String(eventData) }));
    }
    window.slurp = slurp;

    // Page view
    slurp('pageview');

    // Older per-section events, kept so the existing dashboard charts keep working
    const m = location.pathname.match(/\/(posts|rides|urbex)\/([^/]*?)(\.html)?$/);
    if (m) {
        const [, section, slug] = m;
        if (section === 'posts' && slug) slurp('blog_post_read', slug);
        else if (section === 'rides') slurp(slug && slug !== 'index' ? 'blog_ride_read' : 'blog_rides_view', slug || undefined);
        else if (section === 'urbex') slurp(slug && slug !== 'index' ? 'blog_urbex_read' : 'blog_urbex_view', slug || undefined);
    }
    if (document.referrer && !document.referrer.includes(location.hostname)) slurp('referral', document.referrer);

    // Time on page (only while the tab is visible) and how far down they scrolled,
    // sent once when they leave or switch away
    let visibleMs = 0, shownAt = document.visibilityState === 'visible' ? Date.now() : null, maxScroll = 0, left = false;
    function trackScroll() {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const pct = h > 0 ? Math.round((window.scrollY / h) * 100) : 100;
        if (pct > maxScroll) maxScroll = Math.min(100, pct);
    }
    window.addEventListener('scroll', trackScroll, { passive: true });
    trackScroll();
    function leave() {
        if (shownAt) { visibleMs += Date.now() - shownAt; shownAt = null; }
        if (left) return;
        left = true;
        send(Object.assign(context(), { event_type: 'page_leave', duration_s: Math.round(visibleMs / 1000), scroll_pct: maxScroll }), true);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') leave();
        else if (!shownAt) shownAt = Date.now();
    });
    window.addEventListener('pagehide', leave);
})();
