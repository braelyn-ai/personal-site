// Interactive ride maps, built from GPX files.
//
//   <div class="ride-map" data-gpx="../assets/rides/slug/route.gpx"></div>
//     → one route, with stats, an elevation profile, and pins for any
//       <figure data-lat data-lng> photos on the page.
//
//   <div class="ride-map" data-overview="../rides.json" data-base="../"></div>
//     → every ride on one map, each route links to its page.
(function () {
    const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
    // Subresource integrity: the browser refuses the files if the CDN ever serves something else
    const SRI_JS = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
    const SRI_CSS = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
    const ROUTE_COLOR = '#ff5a1f';
    const M_PER_MI = 1609.344;
    const FT_PER_M = 3.28084;

    let leafletPromise;
    function loadLeaflet() {
        if (window.L) return Promise.resolve(window.L);
        if (leafletPromise) return leafletPromise;
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `${LEAFLET}.css`;
        css.integrity = SRI_CSS;
        css.crossOrigin = '';
        document.head.appendChild(css);
        leafletPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = `${LEAFLET}.js`;
            s.integrity = SRI_JS;
            s.crossOrigin = '';
            s.onload = () => resolve(window.L);
            s.onerror = reject;
            document.head.appendChild(s);
        });
        return leafletPromise;
    }

    // ---------- GPX ----------

    // Named <wpt> pins: [{name, lat, lng}]
    function parseWaypoints(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        return [...doc.getElementsByTagNameNS('*', 'wpt')].map((w) => ({
            name: w.getElementsByTagNameNS('*', 'name')[0]?.textContent.trim(),
            lat: parseFloat(w.getAttribute('lat')),
            lng: parseFloat(w.getAttribute('lon')),
        })).filter(w => w.name && isFinite(w.lat) && isFinite(w.lng));
    }

    // Returns an array of segments; each segment is [{lat, lng, ele, time}]
    function parseGpx(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        const read = (pt) => {
            const ele = pt.getElementsByTagNameNS('*', 'ele')[0];
            const time = pt.getElementsByTagNameNS('*', 'time')[0];
            return {
                lat: parseFloat(pt.getAttribute('lat')),
                lng: parseFloat(pt.getAttribute('lon')),
                ele: ele && isFinite(parseFloat(ele.textContent)) ? parseFloat(ele.textContent) : null,
                time: time && isFinite(Date.parse(time.textContent)) ? Date.parse(time.textContent) : null,
            };
        };
        const segments = [];
        for (const seg of doc.getElementsByTagNameNS('*', 'trkseg')) {
            const pts = [...seg.getElementsByTagNameNS('*', 'trkpt')].map(read);
            if (pts.length > 1) segments.push(pts);
        }
        if (!segments.length) {
            for (const rte of doc.getElementsByTagNameNS('*', 'rte')) {
                const pts = [...rte.getElementsByTagNameNS('*', 'rtept')].map(read);
                if (pts.length > 1) segments.push(pts);
            }
        }
        return segments
            .map(s => s.filter(p => isFinite(p.lat) && isFinite(p.lng)))
            .filter(s => s.length > 1);
    }

    function haversine(a, b) {
        const R = 6371000;
        const toRad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * toRad;
        const dLng = (b.lng - a.lng) * toRad;
        const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    // Flattens segments into one list with cumulative distance, and computes stats.
    function analyze(segments) {
        const points = [];
        let dist = 0, moving = 0, gain = 0, high = -Infinity;
        for (const seg of segments) {
            let eleRef = null;
            seg.forEach((p, i) => {
                if (i > 0) {
                    const prev = seg[i - 1];
                    const d = haversine(prev, p);
                    dist += d;
                    if (p.time && prev.time) {
                        const dt = (p.time - prev.time) / 1000;
                        // Count as moving if faster than walking pace and not a recording gap
                        if (dt > 0 && dt < 120 && d / dt > 1.5) moving += dt;
                    }
                }
                if (p.ele != null) {
                    high = Math.max(high, p.ele);
                    // GPS elevation is noisy; only count climbs that clear a 4 m deadband
                    if (eleRef == null) eleRef = p.ele;
                    else if (p.ele - eleRef > 4) { gain += p.ele - eleRef; eleRef = p.ele; }
                    else if (eleRef - p.ele > 4) eleRef = p.ele;
                }
                points.push({ ...p, dist });
            });
        }
        return {
            points,
            distance: dist,
            movingTime: moving,
            gain,
            high: isFinite(high) ? high : null,
            hasEle: points.some(p => p.ele != null),
        };
    }

    // ---------- Formatting ----------

    const fmtMi = (m) => `${(m / M_PER_MI).toFixed(m < 16000 ? 1 : 0)} mi`;
    const fmtFt = (m) => `${Math.round(m * FT_PER_M).toLocaleString()} ft`;
    function fmtDuration(s) {
        const h = Math.floor(s / 3600);
        const m = Math.round((s % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    // ---------- Map setup ----------

    function makeMap(L, el) {
        const mobile = L.Browser.mobile;
        const map = L.map(el, {
            scrollWheelZoom: false,  // don't hijack page scroll
            dragging: !mobile,       // same, for one-finger swipes
        });

        const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
        // Street tiles get a CSS filter in dark mode (see .ride-map-streets in styles.css)
        const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: osmAttr,
            maxZoom: 19,
            className: 'ride-map-streets',
        });
        const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: `${osmAttr}, <a href="https://opentopomap.org">OpenTopoMap</a>`,
            maxZoom: 17,
        });
        // Satellite (the default) gets a place-name overlay so you can tell where you are
        const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services';
        const satellite = L.layerGroup([
            L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
                maxZoom: 19,
            }),
            L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 }),
        ]);
        satellite.addTo(map);
        L.control.layers({ Satellite: satellite, Streets: streets, Terrain: topo }, null, { position: 'topright' }).addTo(map);

        // Click/tap to unlock scroll-zoom and dragging
        const hint = document.createElement('div');
        hint.className = 'ride-map-hint';
        hint.textContent = mobile ? 'Tap to explore the map' : 'Click to zoom with scroll';
        el.appendChild(hint);
        map.once('click', () => {
            map.scrollWheelZoom.enable();
            map.dragging.enable();
            hint.remove();
        });
        return map;
    }

    const dot = (L, cls, size = 14) => L.divIcon({ className: `ride-dot ${cls}`, iconSize: [size, size] });

    // ---------- Single ride ----------

    async function renderRide(el) {
        const [L, text] = await Promise.all([
            loadLeaflet(),
            fetch(el.dataset.gpx).then(r => {
                if (!r.ok) throw new Error(`GPX ${r.status}`);
                return r.text();
            }),
        ]);
        const segments = parseGpx(text);
        if (!segments.length) throw new Error('No track points in GPX');
        const ride = analyze(segments);

        const map = makeMap(L, el);
        const lines = segments.map(seg =>
            L.polyline(seg.map(p => [p.lat, p.lng]), { color: ROUTE_COLOR, weight: 4, opacity: 0.9 }).addTo(map));
        map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [24, 24] });

        const first = segments[0][0];
        const lastSeg = segments[segments.length - 1];
        const last = lastSeg[lastSeg.length - 1];
        L.marker([first.lat, first.lng], { icon: dot(L, 'ride-dot-start'), title: 'Start' }).addTo(map);
        L.marker([last.lat, last.lng], { icon: dot(L, 'ride-dot-end'), title: 'Finish' }).addTo(map);

        for (const w of parseWaypoints(text)) {
            L.marker([w.lat, w.lng], { icon: dot(L, 'ride-dot-wpt', 11), title: w.name, riseOnHover: true })
                .bindTooltip(w.name, { direction: 'top', offset: [0, -6] })
                .addTo(map);
        }

        addPhotoPins(L, map);
        const after = renderStats(el, ride);
        if (ride.hasEle) renderProfile(L, map, after, ride);
    }

    function renderStats(el, ride) {
        const stats = [['Distance', fmtMi(ride.distance)]];
        if (ride.movingTime > 60) stats.push(['Moving time', fmtDuration(ride.movingTime)]);
        if (ride.hasEle) {
            stats.push(['Elevation gain', fmtFt(ride.gain)]);
            stats.push(['High point', fmtFt(ride.high)]);
        }
        const wrap = document.createElement('div');
        wrap.className = 'ride-stats';
        for (const [label, value] of stats) {
            const s = document.createElement('div');
            s.className = 'ride-stat';
            s.innerHTML = `<span class="ride-stat-value"></span><span class="ride-stat-label"></span>`;
            s.children[0].textContent = value;
            s.children[1].textContent = label;
            wrap.appendChild(s);
        }
        const dl = document.createElement('a');
        dl.className = 'ride-gpx-link';
        dl.href = el.dataset.gpx;
        dl.download = '';
        dl.textContent = 'Download GPX';
        wrap.appendChild(dl);
        el.insertAdjacentElement('afterend', wrap);
        return wrap;
    }

    // Elevation profile; hovering it moves a marker along the route.
    function renderProfile(L, map, after, ride) {
        const pts = ride.points.filter(p => p.ele != null);
        const step = Math.max(1, Math.floor(pts.length / 600));
        const sample = pts.filter((_, i) => i % step === 0);
        const W = 1000, H = 120;
        const total = ride.distance || 1;
        const lo = Math.min(...sample.map(p => p.ele));
        const hi = Math.max(...sample.map(p => p.ele));
        const span = Math.max(hi - lo, 30);
        const x = (p) => (p.dist / total) * W;
        const y = (p) => H - 6 - ((p.ele - lo) / span) * (H - 16);

        const line = sample.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join('');
        const wrap = document.createElement('div');
        wrap.className = 'ride-profile';
        wrap.innerHTML = `
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
                <path class="ride-profile-area" d="${line}L${W},${H}L0,${H}Z"/>
                <path class="ride-profile-line" d="${line}" vector-effect="non-scaling-stroke"/>
                <line class="ride-profile-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
            </svg>
            <div class="ride-profile-readout">Elevation · hover to scrub the route</div>`;
        after.insertAdjacentElement('afterend', wrap);

        const svg = wrap.querySelector('svg');
        const cursor = wrap.querySelector('.ride-profile-cursor');
        const readout = wrap.querySelector('.ride-profile-readout');
        const marker = L.circleMarker([0, 0], {
            radius: 7, color: '#fff', weight: 2, fillColor: ROUTE_COLOR, fillOpacity: 1,
        });

        const scrub = (clientX) => {
            const r = svg.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
            const target = frac * total;
            // Binary search for nearest point by distance
            let a = 0, b = pts.length - 1;
            while (a < b) {
                const m = (a + b) >> 1;
                if (pts[m].dist < target) a = m + 1; else b = m;
            }
            const p = pts[a];
            cursor.setAttribute('x1', frac * W);
            cursor.setAttribute('x2', frac * W);
            cursor.style.opacity = 1;
            marker.setLatLng([p.lat, p.lng]);
            if (!map.hasLayer(marker)) marker.addTo(map);
            readout.textContent = `${fmtMi(p.dist)} in · ${fmtFt(p.ele)}`;
        };
        const leave = () => {
            cursor.style.opacity = 0;
            marker.remove();
            readout.textContent = 'Elevation · hover to scrub the route';
        };
        svg.addEventListener('pointermove', (e) => scrub(e.clientX));
        svg.addEventListener('pointerdown', (e) => scrub(e.clientX));
        svg.addEventListener('pointerleave', leave);
    }

    // Pins for <figure data-lat data-lng> photos; clicking scrolls to the photo.
    function addPhotoPins(L, map) {
        document.querySelectorAll('figure[data-lat][data-lng]').forEach((fig) => {
            const lat = parseFloat(fig.dataset.lat);
            const lng = parseFloat(fig.dataset.lng);
            const img = fig.querySelector('img');
            const video = fig.querySelector('video');
            const thumb = img ? img.getAttribute('src') : video?.getAttribute('poster');
            if (!isFinite(lat) || !isFinite(lng) || !thumb) return;
            const icon = L.divIcon({
                className: `ride-photo-pin${video ? ' ride-video-pin' : ''}`,
                html: `<img src="${thumb}" alt="">`,
                iconSize: [36, 36],
            });
            L.marker([lat, lng], { icon, title: (img && img.alt) || (video ? 'Video' : 'Photo') })
                .addTo(map)
                .on('click', () => {
                    fig.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    fig.classList.add('ride-photo-flash');
                    setTimeout(() => fig.classList.remove('ride-photo-flash'), 1200);
                });
        });
    }

    // ---------- Overview of all rides ----------

    async function renderOverview(el) {
        const base = el.dataset.base || '';
        const [L, rides] = await Promise.all([
            loadLeaflet(),
            fetch(el.dataset.overview).then(r => r.json()),
        ]);
        const withGpx = rides.filter(r => r.gpx);
        if (!withGpx.length) { el.remove(); return; }

        const map = makeMap(L, el);
        const group = L.featureGroup().addTo(map);
        await Promise.all(withGpx.map(async (ride) => {
            try {
                const text = await fetch(base + ride.gpx).then(r => r.text());
                for (const seg of parseGpx(text)) {
                    const line = L.polyline(seg.map(p => [p.lat, p.lng]), {
                        color: ROUTE_COLOR, weight: 3, opacity: 0.75,
                    });
                    line.bindTooltip(ride.title, { sticky: true });
                    line.on('mouseover', () => line.setStyle({ weight: 6, opacity: 1 }).bringToFront());
                    line.on('mouseout', () => line.setStyle({ weight: 3, opacity: 0.75 }));
                    line.on('click', () => { location.href = `${base}rides/${ride.slug}.html`; });
                    group.addLayer(line);
                }
            } catch (e) { /* skip a broken GPX rather than the whole map */ }
        }));
        if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [24, 24] });
        else el.remove();
    }

    // ---------- Photo lightbox ----------

    // Gallery rows size each photo by its aspect ratio. new_ride.py writes --ar into
    // the HTML; this covers figures added by hand.
    function setupGallery() {
        document.querySelectorAll('.ride-gallery figure').forEach((fig) => {
            if (fig.style.getPropertyValue('--ar')) return;
            const img = fig.querySelector('img');
            if (!img) return;
            const set = () => {
                if (img.naturalWidth) fig.style.setProperty('--ar', (img.naturalWidth / img.naturalHeight).toFixed(4));
            };
            if (img.complete) set(); else img.addEventListener('load', set, { once: true });
        });
    }

    // Tweet embeds: load X's widget script only once one is near the viewport, match
    // the site theme, and re-render when the theme is toggled.
    function setupTweets() {
        const boxes = [...document.querySelectorAll('.ride-tweet')];
        if (!boxes.length) return;
        boxes.forEach((b) => { b.dataset.src = b.innerHTML; });
        const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
        const render = (b) => {
            b.innerHTML = b.dataset.src;
            b.querySelector('blockquote').setAttribute('data-theme', theme());
            if (window.twttr?.widgets) window.twttr.widgets.load(b);
        };
        let loaded = false;
        const load = () => {
            if (loaded) return;
            loaded = true;
            boxes.forEach((b) => b.querySelector('blockquote').setAttribute('data-theme', theme()));
            const s = document.createElement('script');
            s.src = 'https://platform.twitter.com/widgets.js';
            s.async = true;
            s.charset = 'utf-8';
            document.body.appendChild(s);
        };
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
            }, { rootMargin: '600px' });
            boxes.forEach((b) => io.observe(b));
        } else {
            load();
        }
        new MutationObserver(() => { if (loaded) boxes.forEach(render); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // Videos are big and live in Git LFS, which the blog server's build may not
    // have, so on the live site they stream from the asset bucket (which the
    // GitHub workflow syncs blog/assets/ into). Falls back to the blog server.
    const MEDIA_BASE = 'https://braelyn.t3.storage.dev/blog/';
    function setupVideos() {
        if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
        document.querySelectorAll('.ride-gallery video[src]').forEach((v) => {
            const local = v.getAttribute('src');
            const m = local.match(/(?:^|\/)(assets\/.+)$/);
            if (!m) return;
            v.src = MEDIA_BASE + m[1];
            v.addEventListener('error', () => { if (v.src !== new URL(local, location.href).href) v.src = local; }, { once: true });
        });
    }

    function setupLightbox() {
        const imgs = document.querySelectorAll('.ride-hero img, .ride-gallery img');
        if (!imgs.length) return;
        const box = document.createElement('div');
        box.className = 'ride-lightbox';
        box.innerHTML = '<img alt=""><p></p>';
        document.body.appendChild(box);
        const close = () => box.classList.remove('open');
        box.addEventListener('click', close);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        imgs.forEach((img) => img.addEventListener('click', () => {
            box.querySelector('img').src = img.currentSrc || img.src;
            box.querySelector('img').alt = img.alt;
            const cap = img.closest('figure')?.querySelector('figcaption');
            box.querySelector('p').textContent = cap ? cap.textContent : '';
            box.classList.add('open');
        }));
    }

    function fail(el, err) {
        console.error('ride-map:', err);
        el.classList.add('ride-map-error');
        el.textContent = "Couldn't load the route map.";
    }

    function init() {
        document.querySelectorAll('.ride-map[data-gpx]').forEach(el => renderRide(el).catch(e => fail(el, e)));
        document.querySelectorAll('.ride-map[data-overview]').forEach(el => renderOverview(el).catch(e => fail(el, e)));
        setupGallery();
        setupVideos();
        setupTweets();
        setupLightbox();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
