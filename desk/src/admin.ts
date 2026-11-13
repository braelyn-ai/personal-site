import './admin.css';

// Two endpoints feed this page:
//   /api/admin/traffic: page views (with visitor, source, place, device), filtered by range
//   /api/admin/stats:   the older event counters (link clicks, raw events), all time

interface Row { key: string; views: number; visitors: number; avg_seconds?: number | null; avg_scroll?: number | null }

interface Traffic {
  days: number;
  totals: { views: number; visitors: number; sessions: number; avg_seconds: number; bot_views_excluded: number };
  daily: { date: string; views: number; visitors: number }[];
  pages: Row[];
  sources: Row[];
  page_sources: { path: string; source: string; views: number }[];
  campaigns: Row[];
  countries: Row[];
  places: Row[];
  devices: Row[];
  browsers: Row[];
  os: Row[];
  recent: { time: string | null; path: string | null; title: string | null; source: string; place: string | null; device: string | null; browser: string | null; visitor: string }[];
}

interface Stats {
  total_events: number;
  events_by_type: { type: string; count: number }[];
  social_clicks_by_type: { type: string; count: number }[];
  recent_events: { id: number; event_type: string; event_data: string | null; ip_address: string | null; user_agent: string | null; created_at: string | null }[];
}

const API_URL = import.meta.env.PROD ? 'https://api.braelyn.ai' : 'http://localhost:8000';
const TOKEN_KEY = 'admin_token';
const THEME_KEY = 'admin_theme';

// Light or dark: follows the system until you pick one, then remembers it
function theme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch { /* storage blocked: just follow the system */ }
const RANGES: [number, string][] = [[0, 'All time'], [365, '1 year'], [90, '90 days'], [30, '30 days'], [7, '7 days']];
// OnlyFans clicks that came through the old zaap.bio link page, before this site tracked them
const ZAAP_ONLYFANS_CLICKS = 4329;

let traffic: Traffic | null = null;
let stats: Stats | null = null;
let days = 0; // 0 = all time
let state: 'loading' | 'locked' | 'ready' | 'error' = 'loading';
let message = '';
let updated: Date | null = null;
const shown = new Set<string>(); // tables expanded past their first rows; kept across refreshes

function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function setToken(v: string): void {
  try { localStorage.setItem(TOKEN_KEY, v); } catch { /* private mode: lasts for this page only */ }
  memToken = v;
}
let memToken = getToken();

// Everything below comes from visitors (paths, referrers, user agents), so it's escaped on the way into HTML
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const num = (n: number) => n.toLocaleString('en-US');

function duration(s: number | null | undefined): string {
  if (s == null) return '–';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function when(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function load(): Promise<void> {
  if (!memToken) { state = 'locked'; render(); return; }
  const headers = { Authorization: `Bearer ${memToken}` };
  try {
    const [t, s] = await Promise.all([
      fetch(`${API_URL}/api/admin/traffic?days=${days}`, { headers }),
      fetch(`${API_URL}/api/admin/stats`, { headers }),
    ]);
    if (t.status === 401 || s.status === 401) {
      state = 'locked'; message = "That token didn't work."; render(); return;
    }
    if (t.status === 503) throw new Error('ADMIN_TOKEN isn’t set on the API service yet.');
    if (!t.ok) throw new Error(`The API returned ${t.status}.`);
    traffic = await t.json();
    stats = s.ok ? await s.json() : null;
    state = 'ready'; message = ''; updated = new Date();
  } catch (e) {
    state = 'error';
    message = e instanceof TypeError ? 'Couldn’t reach the API.' : (e as Error).message;
  }
  render();
}

// ---- pieces ----

/** A ranked list: label on the left, numbers on the right, a faint bar behind each row. */
function table(id: string, title: string, rows: { label: string; value: number; cols?: string[]; detail?: string; note?: string }[],
               opts: { head?: string[]; limit?: number; empty?: string; phoneHides?: number[] } = {}): string {
  const limit = opts.limit ?? 8;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const all = shown.has(id);
  const visible = all ? rows : rows.slice(0, limit);
  const head = opts.head ?? ['Views'];
  // Columns (by index into head) that are dropped on narrow screens
  const cls = (i: number) => (opts.phoneHides?.includes(i) ? 'col opt' : 'col');
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>${title}</h2>
        ${head.map((h, i) => `<span class="${cls(i)}">${h}</span>`).join('')}
      </div>
      ${rows.length === 0 ? `<p class="empty">${opts.empty ?? 'Nothing yet.'}</p>` : ''}
      <ol class="rows">
        ${visible.map((r) => {
          const line = `
            <span class="bar" style="width:${(r.value / max) * 100}%"></span>
            <span class="label" title="${r.label.replace(/<[^>]+>/g, '')}">${r.label}${r.note ? ` <span class="muted">${r.note}</span>` : ''}</span>
            ${(r.cols ?? []).map((c, i) => `<span class="${cls(i)}">${c}</span>`).join('')}
            <span class="col">${num(r.value)}</span>`;
          return r.detail
            ? `<li><details><summary class="row">${line}</summary>${r.detail}</details></li>`
            : `<li class="row">${line}</li>`;
        }).join('')}
      </ol>
      ${rows.length > limit ? `<button class="more" data-toggle="${id}">${all ? 'Show less' : `Show all ${rows.length}`}</button>` : ''}
    </section>`;
}

function rowsOf(list: Row[], label = (r: Row) => r.key) {
  return list.map((r) => ({ label: esc(label(r)), value: r.views, cols: [num(r.visitors)] }));
}

function chart(t: Traffic): string {
  if (!t.daily.length) return '';
  // The API skips days with no views; fill them in so the bars line up with the calendar
  const DAY = 86400000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const byDate = new Map(t.daily.map((d) => [d.date, d]));
  const end = Date.parse(iso(Date.now()) + 'T00:00:00Z');
  const start = t.days ? end - (t.days - 1) * DAY : Date.parse(t.daily[0].date + 'T00:00:00Z');
  const filled: { date: string; views: number; visitors: number }[] = [];
  for (let ms = start; ms <= end; ms += DAY) filled.push(byDate.get(iso(ms)) ?? { date: iso(ms), views: 0, visitors: 0 });

  // Past ~4 months, daily bars get too thin to read, so add them up by month
  const monthly = filled.length > 120;
  const bars: { key: string; label: string; views: number; visitors?: number }[] = [];
  for (const d of filled) {
    const key = monthly ? d.date.slice(0, 7) : d.date;
    const last = bars[bars.length - 1];
    if (last?.key === key) last.views += d.views;
    else bars.push({ key, label: '', views: d.views, visitors: monthly ? undefined : d.visitors });
  }
  const fmt = (key: string) => new Date((monthly ? key + '-01' : key) + 'T00:00:00Z').toLocaleDateString('en-US',
    monthly ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const max = Math.max(1, ...bars.map((d) => d.views));
  const unit = monthly ? 'month' : 'day';
  return `
    <section class="chart" aria-label="Views per ${unit}">
      <div class="chart-top"><span>Views per ${unit}</span><span>peak ${num(max)}</span></div>
      <div class="bars">
        ${bars.map((d) => `<span class="day" title="${fmt(d.key)}: ${num(d.views)} views${d.visitors != null ? `, ${num(d.visitors)} visitors` : ''}"><i style="height:${(d.views / max) * 100}%"></i></span>`).join('')}
      </div>
      <div class="chart-axis"><span>${fmt(bars[0].key)}</span><span>${fmt(bars[bars.length - 1].key)}</span></div>
    </section>`;
}

/** "blog.braelyn.ai/posts/x.html" -> site in grey, then the path */
function pageLabel(key: string): string {
  const i = key.indexOf('/');
  return i > 0 ? `<span class="site">${esc(key.slice(0, i))}</span>${esc(key.slice(i))}` : esc(key);
}

function pageSources(t: Traffic, path: string): string {
  const rows = t.page_sources.filter((r) => r.path === path);
  if (!rows.length) return '';
  return `<ul class="sub">${rows.map((r) => `<li><span>${esc(r.source)}</span><span class="col">${num(r.views)}</span></li>`).join('')}</ul>`;
}

function clicks(): string {
  if (!stats?.social_clicks_by_type.length) return '';
  const rows = stats.social_clicks_by_type
    .map((r) => {
      const extra = r.type === 'social_onlyfans' ? ZAAP_ONLYFANS_CLICKS : 0;
      const name = esc(r.type.replace(/^social_/, ''));
      return { label: name, value: r.count + extra, note: extra ? `incl. ${num(extra)} from zaap.bio` : undefined };
    })
    .sort((a, b) => b.value - a.value);
  return table('clicks', 'Link clicks', rows, { head: ['Clicks'] });
}

function raw(): string {
  if (!stats) return '';
  const types = [...stats.events_by_type].sort((a, b) => b.count - a.count);
  return `
    <details class="raw">
      <summary>Raw events <span class="muted">${num(stats.total_events)} all time</span></summary>
      <table class="grid">
        <thead><tr><th>Type</th><th class="n">Count</th></tr></thead>
        <tbody>${types.map((r) => `<tr><td>${esc(r.type)}</td><td class="n">${num(r.count)}</td></tr>`).join('')}</tbody>
      </table>
      <h3>Latest 50</h3>
      <div class="scroll"><table class="grid">
        <thead><tr><th>When</th><th>Type</th><th>Data</th><th>IP</th><th>User agent</th></tr></thead>
        <tbody>${stats.recent_events.map((e) => `<tr>
          <td class="nowrap">${when(e.created_at)}</td><td>${esc(e.event_type)}</td><td>${esc(e.event_data ?? '')}</td>
          <td class="mono">${esc(e.ip_address ?? '')}</td><td class="clip" title="${esc(e.user_agent)}">${esc(e.user_agent ?? '')}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
}

function dashboard(t: Traffic): string {
  const place = (r: Row) => r.key.replace(/\?, /g, '').replace(/, \?$/, '');
  return `
    <section class="totals">
      <div><b>${num(t.totals.views)}</b><span>Page views</span></div>
      <div><b>${num(t.totals.visitors)}</b><span>Visitors</span></div>
      <div><b>${num(t.totals.sessions)}</b><span>Visits</span></div>
      <div><b>${duration(t.totals.avg_seconds)}</b><span>Avg. time on page</span></div>
    </section>
    ${chart(t)}
    ${table('pages', 'Pages', t.pages.map((r) => ({
      label: pageLabel(r.key), value: r.views,
      cols: [num(r.visitors), duration(r.avg_seconds), r.avg_scroll == null ? '–' : `${r.avg_scroll}%`],
      detail: pageSources(t, r.key),
    })), { head: ['Visitors', 'Time', 'Scroll', 'Views'], limit: 10, phoneHides: [1, 2] })}
    <div class="two">
      ${table('sources', 'Sources', rowsOf(t.sources), { head: ['Visitors', 'Views'] })}
      ${table('countries', 'Countries', rowsOf(t.countries), { head: ['Visitors', 'Views'] })}
    </div>
    <div class="two">
      ${table('places', 'Cities', rowsOf(t.places, place), { head: ['Visitors', 'Views'] })}
      ${table('devices', 'Devices', rowsOf(t.devices), { head: ['Visitors', 'Views'] })}
    </div>
    <div class="two">
      ${table('browsers', 'Browsers', rowsOf(t.browsers), { head: ['Visitors', 'Views'], limit: 5 })}
      ${table('os', 'Operating systems', rowsOf(t.os), { head: ['Visitors', 'Views'], limit: 5 })}
    </div>
    ${t.campaigns.length ? table('campaigns', 'Campaigns', rowsOf(t.campaigns), { head: ['Visitors', 'Views'] }) : ''}
    ${clicks()}
    <section class="panel">
      <div class="panel-head"><h2>Latest visits</h2></div>
      <div class="scroll"><table class="grid">
        <thead><tr><th>When</th><th>Page</th><th>From</th><th>Where</th><th>Device</th></tr></thead>
        <tbody>${t.recent.slice(0, shown.has('recent') ? 50 : 15).map((r) => `<tr>
          <td class="nowrap">${when(r.time)}</td>
          <td title="${esc(r.title)}">${pageLabel(r.path ?? '')}</td>
          <td>${esc(r.source)}</td>
          <td>${esc(r.place ?? '–')}</td>
          <td class="nowrap">${esc([r.device, r.browser].filter(Boolean).join(', '))}</td></tr>`).join('')}</tbody>
      </table></div>
      ${t.recent.length > 15 ? `<button class="more" data-toggle="recent">${shown.has('recent') ? 'Show less' : `Show ${t.recent.length}`}</button>` : ''}
    </section>
    ${t.totals.bot_views_excluded ? `<p class="footnote">${num(t.totals.bot_views_excluded)} bot views left out.</p>` : ''}
    ${raw()}`;
}

function render(): void {
  const app = document.getElementById('admin-app');
  if (!app) return;
  // Keep expanded rows and the raw-events section open across refreshes
  const open = new Set([...app.querySelectorAll('details[open]')].map((d) => d.getAttribute('data-k')));

  let body = '';
  if (state === 'locked') {
    body = `
      <form class="lock" id="lock">
        <label for="token">Admin token</label>
        <input id="token" type="password" autocomplete="current-password" autofocus>
        <button type="submit">Unlock</button>
        ${message ? `<p class="err">${esc(message)}</p>` : '<p class="muted">The <code>ADMIN_TOKEN</code> set on the API service.</p>'}
      </form>`;
  } else if (state === 'error' && !traffic) {
    body = `<p class="err">${esc(message)} <button class="link" data-act="refresh">Try again</button></p>`;
  } else if (traffic) {
    body = dashboard(traffic);
  } else {
    body = '<p class="muted">Loading…</p>';
  }

  app.innerHTML = `
    <main>
      <header>
        <h1>Analytics</h1>
        <button class="link theme" data-act="theme">${theme() === 'dark' ? 'Light mode' : 'Dark mode'}</button>
        ${state === 'locked' ? '' : `
        <nav class="range">${RANGES.map(([d, l]) => `<button data-days="${d}" ${d === days ? 'aria-current="true"' : ''}>${l}</button>`).join('')}</nav>
        <span class="status">${state === 'error' ? `<span class="err">${esc(message)}</span>` : updated ? `Updated ${updated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
          <button class="link" data-act="refresh">Refresh</button></span>`}
      </header>
      ${body}
    </main>`;

  // Tag each <details> with a stable key, then reopen the ones that were open
  app.querySelectorAll('details').forEach((d, i) => {
    const k = d.classList.contains('raw') ? 'raw' : d.querySelector('.label')?.textContent ?? String(i);
    d.setAttribute('data-k', k);
    if (open.has(k)) d.open = true;
  });
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button');
  if (!el) return;
  if (el.dataset.days) { days = Number(el.dataset.days); load(); render(); }
  else if (el.dataset.toggle) { const k = el.dataset.toggle; shown.has(k) ? shown.delete(k) : shown.add(k); render(); }
  else if (el.dataset.act === 'refresh') load();
  else if (el.dataset.act === 'theme') {
    const next = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* lasts for this page only */ }
    render();
  }
});

document.addEventListener('submit', (e) => {
  if ((e.target as HTMLElement).id !== 'lock') return;
  e.preventDefault();
  setToken((document.getElementById('token') as HTMLInputElement).value.trim());
  message = ''; state = 'loading'; render(); load();
});

// Keep the toggle's label right if the system theme flips while you're here
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

// Refresh when you come back to the tab, and every 2 minutes while it's open
document.addEventListener('visibilitychange', () => { if (!document.hidden && state === 'ready') load(); });
setInterval(() => { if (!document.hidden && state === 'ready') load(); }, 120000);

render();
load();
