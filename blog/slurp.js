const API_BASE = 'https://api.braelyn.ai';

function slurp(eventType, eventData) {
    fetch(`${API_BASE}/slurp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, event_data: eventData }),
    }).catch(() => {});
}

// Track page view with the slug derived from the URL
(function () {
    const m = window.location.pathname.match(/\/(posts|rides|urbex)\/([^/]*?)(\.html)?$/);
    if (!m) return;
    const [, section, slug] = m;
    if (section === 'posts' && slug) slurp('blog_post_read', slug);
    else if (section === 'rides') slurp(slug && slug !== 'index' ? 'blog_ride_read' : 'blog_rides_view', slug || undefined);
    else if (section === 'urbex') slurp(slug && slug !== 'index' ? 'blog_urbex_read' : 'blog_urbex_view', slug || undefined);
})();

// Track referrer
if (document.referrer && !document.referrer.includes(location.hostname)) {
    slurp('referral', document.referrer);
}
