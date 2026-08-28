/**
 * Activity Feed - Chronological log of agent actions
 */

const CLASSIFICATION_LABELS = {
  all: 'All',
  strategic: 'Strategic',
  productive: 'Productive',
  communication: 'Communication',
  maintenance: 'Maintenance',
  idle: 'Idle',
  error: 'Error',
};
const CLASSIFICATION_COLORS = {
  strategic: '#8b5cf6',
  productive: '#22c55e',
  communication: '#3b82f6',
  maintenance: '#64748b',
  idle: '#94a3b8',
  error: '#ef4444',
};

let activityFilter = 'all';
let activityPage = 1;
let activityData = null;

registerPage('activity', async (container) => {
  activityPage = 1;
  activityFilter = 'all';
  await renderActivityPage(container);
});

async function renderActivityPage(container) {
  const data = await fetchAPI(`activity?page=${activityPage}&limit=20&type=${activityFilter}`);
  activityData = data;

  // Only do full render on first load
  if (activityPage === 1) {
    container.innerHTML = `
      <div class="page-header">
        <h2>Activity Feed</h2>
        <p>Everything your agent has been doing</p>
      </div>

      <div class="activity-filters" id="activity-filters">
        ${Object.entries(CLASSIFICATION_LABELS).map(([key, label]) => `
          <button class="filter-btn ${key === activityFilter ? 'active' : ''}"
                  onclick="changeActivityFilter('${key}', this)">${label}</button>
        `).join('')}
      </div>

      ${data.recentTurns && data.recentTurns.length > 0 ? `
        <div class="section-card" style="margin-bottom:20px;">
          <h3>Agent Turns (Latest Reasoning)</h3>
          <div class="turns-list">
            ${data.recentTurns.slice(0, 5).map(t => `
              <div class="turn-item">
                <div class="turn-header">
                  <span class="turn-state state-${t.state}">${t.state}</span>
                  <span class="activity-time">${timeAgo(t.timestamp)}</span>
                  ${t.cost_cents > 0 ? `<span class="turn-cost">${formatCents(t.cost_cents)}</span>` : ''}
                </div>
                <div class="turn-thinking">${truncate(t.thinking || 'No reasoning recorded', 200)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="section-card">
        <h3>Event Log</h3>
        <div id="activity-events-list">
          ${renderActivityEvents(data.events)}
        </div>
        <div id="activity-pagination">
          ${renderPagination(data.pagination)}
        </div>
      </div>
    `;
  }
}

function renderActivityEvents(events) {
  if (!events || events.length === 0) {
    return '<div class="empty-state"><p>No activity events yet.</p></div>';
  }

  return `<div class="activity-list-full">
    ${events.map(e => {
      const color = CLASSIFICATION_COLORS[e.classification] || '#64748b';
      return `
        <div class="activity-item-full">
          <div class="activity-item-left">
            <div class="activity-dot ${e.outcome || 'neutral'}"></div>
            <div class="activity-line"></div>
          </div>
          <div class="activity-item-content">
            <div class="activity-item-header">
              <span class="activity-event-type" style="color:${color}">${e.event_type}</span>
              <span class="activity-time">${timeAgo(e.created_at)}</span>
            </div>
            <div class="activity-item-summary">${e.summary}</div>
            ${e.detail ? `<div class="activity-item-detail">${truncate(e.detail, 300)}</div>` : ''}
            <div class="activity-item-meta">
              ${e.outcome ? `<span class="outcome-badge outcome-${e.outcome}">${e.outcome}</span>` : ''}
              ${e.classification ? `<span class="classification-badge" style="background:${color}20; color:${color}">${e.classification}</span>` : ''}
              ${e.importance > 0.7 ? '<span class="importance-badge">High Priority</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

function renderPagination(pagination) {
  if (!pagination || pagination.totalPages <= 1) return '';

  return `
    <div class="pagination">
      <button class="btn btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="loadActivityPage(${pagination.page - 1})">Previous</button>
      <span class="pagination-info">Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} events)</span>
      <button class="btn btn-sm" ${!pagination.hasMore ? 'disabled' : ''} onclick="loadActivityPage(${pagination.page + 1})">Next</button>
    </div>
  `;
}

async function changeActivityFilter(filter, btn) {
  activityFilter = filter;
  activityPage = 1;
  document.querySelectorAll('#activity-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const data = await fetchAPI(`activity?page=1&limit=20&type=${filter}`);
  document.getElementById('activity-events-list').innerHTML = renderActivityEvents(data.events);
  document.getElementById('activity-pagination').innerHTML = renderPagination(data.pagination);
}

async function loadActivityPage(page) {
  activityPage = page;
  const data = await fetchAPI(`activity?page=${page}&limit=20&type=${activityFilter}`);
  document.getElementById('activity-events-list').innerHTML = renderActivityEvents(data.events);
  document.getElementById('activity-pagination').innerHTML = renderPagination(data.pagination);
  // Scroll to top of events
  document.getElementById('activity-events-list').scrollIntoView({ behavior: 'smooth' });
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
