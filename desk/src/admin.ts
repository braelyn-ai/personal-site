import './admin.css';

interface EventsByType {
  type: string;
  count: number;
}

interface EventsByDay {
  date: string;
  count: number;
}

interface RecentEvent {
  id: number;
  event_type: string;
  event_data: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
}

interface SocialClickByType {
  type: string;
  count: number;
}

interface BlogPostView {
  slug: string;
  count: number;
}

interface BlogPostVisit {
  slug: string;
  count: number;
}

interface Referrer {
  url: string;
  count: number;
}

interface AdminStats {
  total_events: number;
  events_by_type: EventsByType[];
  events_last_24h: number;
  events_last_7d: number;
  unique_ips: number;
  events_by_day: EventsByDay[];
  social_clicks_by_type: SocialClickByType[];
  blog_post_views: BlogPostView[];
  blog_post_visits: BlogPostVisit[];
  top_referrers: Referrer[];
  recent_events: RecentEvent[];
}

const API_URL = import.meta.env.PROD 
  ? 'https://api.braelyn.ai' 
  : 'http://localhost:8000';

let stats: AdminStats | null = null;
let loading = true;
let error: string | null = null;
let lastUpdated: Date | null = null;

function getEventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    'page_view': '#4ecdc4',
    'click': '#ff6b6b',
    'scroll': '#ffd93d',
    'interaction': '#95e1d3',
    'error': '#ff4757',
    'navigation': '#5f27cd',
    'terminal_start': '#00d2d3',
    'terminal_command': '#54a0ff',
  };
  return colors[type.toLowerCase()] || '#6c5ce7';
}

function getEventTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    'page_view': '👁️',
    'click': '👆',
    'scroll': '📜',
    'interaction': '🤝',
    'error': '⚠️',
    'navigation': '🧭',
    'terminal_start': '💻',
    'terminal_command': '⌨️',
  };
  return emojis[type.toLowerCase()] || '📊';
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getMaxDayCount(): number {
  if (!stats?.events_by_day.length) return 1;
  return Math.max(...stats.events_by_day.map(d => d.count));
}

function getBarHeight(count: number): number {
  const max = getMaxDayCount();
  return max > 0 ? (count / max) * 100 : 0;
}

function getTotalTypeCount(): number {
  if (!stats?.events_by_type.length) return 0;
  return stats.events_by_type.reduce((sum, t) => sum + t.count, 0);
}

function getTypePercentage(count: number): number {
  const total = getTotalTypeCount();
  return total > 0 ? (count / total) * 100 : 0;
}

async function loadStats(): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/admin/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    stats = await response.json();
    loading = false;
    error = null;
    lastUpdated = new Date();
    render();
  } catch (err) {
    console.error('Failed to load stats:', err);
    error = 'Failed to load statistics';
    loading = false;
    render();
  }
}

function renderLoadingState(): string {
  return `
    <div class="loading-state">
      <div class="loader"></div>
      <p>Loading analytics...</p>
    </div>
  `;
}

function renderErrorState(): string {
  return `
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <p>${error}</p>
      <button class="retry-btn" onclick="window.retryLoad()">Try Again</button>
    </div>
  `;
}

function renderMetrics(): string {
  if (!stats) return '';
  return `
    <section class="metrics-grid">
      <div class="metric-card total">
        <div class="metric-icon">📈</div>
        <div class="metric-content">
          <span class="metric-value">${formatNumber(stats.total_events)}</span>
          <span class="metric-label">Total Events</span>
        </div>
      </div>
      
      <div class="metric-card recent">
        <div class="metric-icon">⚡</div>
        <div class="metric-content">
          <span class="metric-value">${formatNumber(stats.events_last_24h)}</span>
          <span class="metric-label">Last 24 Hours</span>
        </div>
      </div>
      
      <div class="metric-card weekly">
        <div class="metric-icon">📅</div>
        <div class="metric-content">
          <span class="metric-value">${formatNumber(stats.events_last_7d)}</span>
          <span class="metric-label">Last 7 Days</span>
        </div>
      </div>
      
      <div class="metric-card unique">
        <div class="metric-icon">🌐</div>
        <div class="metric-content">
          <span class="metric-value">${formatNumber(stats.unique_ips)}</span>
          <span class="metric-label">Unique Visitors</span>
        </div>
      </div>
    </section>
  `;
}

function renderTypesChart(): string {
  if (!stats) return '';
  return `
    <div class="chart-card types-chart">
      <h2 class="chart-title">Events by Type</h2>
      <div class="type-bars">
        ${stats.events_by_type.map(item => `
          <div class="type-bar-item">
            <div class="type-info">
              <span class="type-emoji">${getEventTypeEmoji(item.type)}</span>
              <span class="type-name">${item.type}</span>
              <span class="type-count">${formatNumber(item.count)}</span>
            </div>
            <div class="type-bar-container">
              <div 
                class="type-bar" 
                style="width: ${getTypePercentage(item.count)}%; background-color: ${getEventTypeColor(item.type)};"
              ></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderTimelineChart(): string {
  if (!stats) return '';
  return `
    <div class="chart-card timeline-chart">
      <h2 class="chart-title">30-Day Timeline</h2>
      <div class="timeline-container">
        <div class="timeline-bars">
          ${stats.events_by_day.map(day => `
            <div 
              class="timeline-bar-wrapper"
              title="${formatDate(day.date)}: ${day.count} events"
            >
              <div 
                class="timeline-bar" 
                style="height: ${getBarHeight(day.count)}%;"
              ></div>
              <span class="timeline-label">${formatDate(day.date)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function getSocialClickColor(type: string): string {
  const colors: Record<string, string> = {
    'social_twitter': '#1da1f2',
    'social_github': '#333333',
    'social_linkedin': '#0077b5',
    'social_email': '#ea4335',
    'social_website': '#4ecdc4',
    'social_bluesky': '#0085ff',
  };
  return colors[type.toLowerCase()] || '#6c5ce7';
}

function getSocialClickEmoji(type: string): string {
  const emojis: Record<string, string> = {
    'social_twitter': '🐦',
    'social_github': '🐙',
    'social_linkedin': '💼',
    'social_email': '📧',
    'social_website': '🌐',
    'social_bluesky': '🦋',
  };
  return emojis[type.toLowerCase()] || '🔗';
}

function getSocialClickPercentage(count: number): number {
  if (!stats?.social_clicks_by_type.length) return 0;
  const max = Math.max(...stats.social_clicks_by_type.map(s => s.count));
  return max > 0 ? (count / max) * 100 : 0;
}

function renderSocialClicksChart(): string {
  if (!stats?.social_clicks_by_type.length) return '';
  return `
    <section class="social-clicks-section">
      <div class="chart-card social-clicks-chart">
        <h2 class="chart-title">Social Clicks by Type</h2>
        <div class="type-bars">
          ${stats.social_clicks_by_type.map(item => `
            <div class="type-bar-item">
              <div class="type-info">
                <span class="type-emoji">${getSocialClickEmoji(item.type)}</span>
                <span class="type-name">${item.type.replace('social_', '')}</span>
                <span class="type-count">${formatNumber(item.count)}</span>
                ${item.type === 'social_onlyfans' ? '<span class="type-count-extra" title="from zaap.bio">+4329</span>' : ''}
              </div>
              <div class="type-bar-container">
                <div
                  class="type-bar"
                  style="width: ${getSocialClickPercentage(item.count)}%; background-color: ${getSocialClickColor(item.type)};"
                ></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function renderBlogPostViews(): string {
  if (!stats) return '';
  const views = stats.blog_post_views ?? [];
  const maxCount = views.length > 0 ? Math.max(...views.map(v => v.count)) : 1;

  return `
    <section class="blog-views-section">
      <h2 class="section-title">Blog Post Views</h2>
      ${views.length === 0
        ? '<p class="no-data-msg">No blog post clicks recorded yet.</p>'
        : `<div class="blog-views-list">
          ${views.map(post => `
            <div class="blog-view-item">
              <div class="blog-view-info">
                <span class="blog-view-title">${slugToTitle(post.slug)}</span>
                <span class="blog-view-slug">${post.slug}</span>
              </div>
              <div class="blog-view-bar-container">
                <div
                  class="blog-view-bar"
                  style="width: ${maxCount > 0 ? (post.count / maxCount) * 100 : 0}%;"
                ></div>
              </div>
              <span class="blog-view-count">${formatNumber(post.count)}</span>
            </div>
          `).join('')}
        </div>`
      }
    </section>
  `;
}

function renderBlogPostVisits(): string {
  if (!stats) return '';
  const visits = stats.blog_post_visits ?? [];
  const maxCount = visits.length > 0 ? Math.max(...visits.map(v => v.count)) : 1;

  return `
    <section class="blog-views-section">
      <h2 class="section-title">Blog Post Visits</h2>
      ${visits.length === 0
        ? '<p class="no-data-msg">No blog post visits recorded yet.</p>'
        : `<div class="blog-views-list">
          ${visits.map(post => `
            <div class="blog-view-item">
              <div class="blog-view-info">
                <span class="blog-view-title">${slugToTitle(post.slug)}</span>
                <span class="blog-view-slug">${post.slug}</span>
              </div>
              <div class="blog-view-bar-container">
                <div
                  class="blog-view-bar blog-visit-bar"
                  style="width: ${maxCount > 0 ? (post.count / maxCount) * 100 : 0}%;"
                ></div>
              </div>
              <span class="blog-view-count">${formatNumber(post.count)}</span>
            </div>
          `).join('')}
        </div>`
      }
    </section>
  `;
}

function formatReferrerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

function renderTopReferrers(): string {
  if (!stats) return '';
  const referrers = stats.top_referrers ?? [];
  const maxCount = referrers.length > 0 ? Math.max(...referrers.map(r => r.count)) : 1;

  return `
    <section class="blog-views-section">
      <h2 class="section-title">Top Referrers</h2>
      ${referrers.length === 0
        ? '<p class="no-data-msg">No referrals recorded yet.</p>'
        : `<div class="blog-views-list">
          ${referrers.map(ref => `
            <div class="blog-view-item">
              <div class="blog-view-info">
                <span class="blog-view-title">${formatReferrerUrl(ref.url)}</span>
                <span class="blog-view-slug">${ref.url}</span>
              </div>
              <div class="blog-view-bar-container">
                <div
                  class="blog-view-bar referrer-bar"
                  style="width: ${maxCount > 0 ? (ref.count / maxCount) * 100 : 0}%;"
                ></div>
              </div>
              <span class="blog-view-count">${formatNumber(ref.count)}</span>
            </div>
          `).join('')}
        </div>`
      }
    </section>
  `;
}

function renderRecentEvents(): string {
  if (!stats) return '';
  return `
    <section class="recent-events-section">
      <h2 class="section-title">Recent Events</h2>
      <div class="events-table-container">
        <table class="events-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Data</th>
              <th>IP</th>
              <th>User Agent</th>
            </tr>
          </thead>
          <tbody>
            ${stats.recent_events.map(event => `
              <tr class="event-row">
                <td class="time-cell">${formatDateTime(event.created_at)}</td>
                <td class="type-cell">
                  <span 
                    class="type-badge"
                    style="background-color: ${getEventTypeColor(event.event_type)};"
                  >
                    ${getEventTypeEmoji(event.event_type)} ${event.event_type}
                  </span>
                </td>
                <td class="data-cell">
                  ${event.event_data 
                    ? `<span class="data-value">${event.event_data}</span>` 
                    : '<span class="no-data">—</span>'}
                </td>
                <td class="ip-cell">
                  <code class="ip-address">${event.ip_address || '—'}</code>
                </td>
                <td class="ua-cell">
                  <span class="ua-text" title="${event.user_agent || ''}">
                    ${event.user_agent || '—'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDashboard(): string {
  return `
    ${renderMetrics()}
    <section class="charts-row">
      ${renderTypesChart()}
      ${renderTimelineChart()}
    </section>
    ${renderSocialClicksChart()}
    ${renderBlogPostViews()}
    ${renderBlogPostVisits()}
    ${renderTopReferrers()}
    ${renderRecentEvents()}
  `;
}

function render(): void {
  const app = document.getElementById('admin-app');
  if (!app) return;

  const lastUpdatedStr = lastUpdated ? formatTime(lastUpdated) : '';
  
  app.innerHTML = `
    <div class="admin-container">
      <header class="admin-header">
        <div class="header-content">
          <h1 class="title">📊 Slurp Analytics</h1>
          <p class="subtitle">Real-time event tracking dashboard</p>
        </div>
        <div class="header-actions">
          ${lastUpdated ? `<span class="last-updated">Updated ${lastUpdatedStr}</span>` : ''}
          <button class="refresh-btn ${loading ? 'loading' : ''}" onclick="window.retryLoad()" ${loading ? 'disabled' : ''}>
            <span class="refresh-icon ${loading ? 'spinning' : ''}">⟳</span>
            Refresh
          </button>
        </div>
      </header>
      
      <div class="dashboard">
        ${loading && !stats ? renderLoadingState() : ''}
        ${error && !stats ? renderErrorState() : ''}
        ${stats ? renderDashboard() : ''}
      </div>
    </div>
  `;
}

// Expose retry function globally
(window as any).retryLoad = loadStats;

// Initial load
render();
loadStats();

// Auto-refresh every 30 seconds
setInterval(loadStats, 30000);
