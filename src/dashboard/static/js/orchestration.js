/**
 * Goals & Tasks Page — Orchestration Monitor
 */

const TASK_STATUS_ICONS = { pending: '&#9711;', assigned: '&#128100;', running: '&#9654;', completed: '&#9989;', failed: '&#10060;', blocked: '&#128274;', cancelled: '&#9723;' };

registerPage('orchestration', async (container) => {
  const [overview, eventsData] = await Promise.all([
    fetchAPI('orchestration/overview'),
    fetchAPI('orchestration/events?limit=15'),
  ]);

  const tc = overview.taskCounts || {};
  const totalTasks = Object.values(tc).reduce((a, b) => a + b, 0);
  const completedTasks = tc.completed || 0;
  const activeChildren = (overview.children || []).filter(c => c.status === 'running' || c.status === 'healthy').length;

  container.innerHTML = `
    <div class="page-header">
      <h2>Goals & Tasks</h2>
      <p>What your agent is working toward</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Active Goals</div><div class="kpi-value">${(overview.goals || []).filter(g => g.status === 'active').length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tasks</div><div class="kpi-value">${completedTasks}/${totalTasks}</div><div class="kpi-detail">${tc.running || 0} running, ${tc.pending || 0} pending</div></div>
      <div class="kpi-card"><div class="kpi-label">Agents Working</div><div class="kpi-value">${activeChildren}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Cost</div><div class="kpi-value">${formatCents(overview.totalCostCents)}</div></div>
    </div>

    <div class="grid-2">
      <div>
        <div class="section-card">
          <h3>Goals</h3>
          ${(overview.goals || []).length === 0 ? '<div class="empty-state"><p>No goals created yet. The agent creates goals from its genesis prompt.</p></div>' :
            overview.goals.map(g => renderGoalAccordion(g)).join('')}
        </div>
      </div>
      <div>
        <div class="section-card">
          <h3>Team Health</h3>
          ${(overview.children || []).length === 0 ? '<div class="empty-state"><p>No child agents spawned yet.</p></div>' :
            overview.children.map(c => {
              const healthy = c.status === 'running' || c.status === 'healthy';
              const dead = c.status === 'dead' || c.status === 'failed';
              return `<div class="child-card" style="margin-bottom:8px;">
                <div class="child-header"><span class="child-name">${c.name || c.address?.slice(0, 10)}</span><span class="health-badge health-${healthy ? 'healthy' : dead ? 'failed' : 'disabled'}">${c.status}</span></div>
                <div class="child-details"><span class="child-role">${capitalize(c.role || 'generalist')}</span><span class="child-funded">${formatCents(c.funded_amount_cents)}</span><span class="cell-muted">${c.last_checked ? timeAgo(c.last_checked) : 'Never checked'}</span></div>
              </div>`;
            }).join('')}
        </div>

        <div class="section-card">
          <h3>Recent Activity</h3>
          ${(eventsData.events || []).length === 0 ? '<div class="empty-state"><p>No orchestration events yet.</p></div>' :
            `<div class="activity-list">${eventsData.events.map(e => `
              <div class="activity-item">
                <div class="activity-dot ${e.type?.includes('completed') ? 'success' : e.type?.includes('failed') ? 'failure' : 'neutral'}"></div>
                <div class="activity-text"><strong>${e.type}</strong> ${(e.content || '').slice(0, 80)}</div>
                <div class="activity-time">${timeAgo(e.created_at)}</div>
              </div>
            `).join('')}</div>`}
        </div>
      </div>
    </div>
  `;

  // Load inbox messages async
  loadInboxMessages();
});

async function loadInboxMessages() {
  try {
    // Inbox messages are in the inbox_messages table — we don't have a dedicated API yet,
    // so we'll show orchestration events as the closest proxy
    // This section is a placeholder that shows agent communication exists
  } catch {}
}

function renderGoalAccordion(g) {
  const statusClass = g.status === 'active' ? 'status-active' : g.status === 'completed' ? 'status-completed' : g.status === 'failed' ? 'status-cancelled' : 'status-paused';
  return `
    <details class="goal-accordion">
      <summary class="goal-summary">
        <div class="goal-title-row">
          <span class="goal-title">${g.title}</span>
          <span class="campaign-status-badge ${statusClass}">${g.status}</span>
        </div>
        ${g.expected_revenue_cents > 0 ? `<div class="cell-muted" style="font-size:0.75rem;">${formatCents(g.actual_revenue_cents)} / ${formatCents(g.expected_revenue_cents)} target</div>` : ''}
        ${g.deadline ? `<div class="cell-muted" style="font-size:0.7rem;">Deadline: ${timeAgo(g.deadline)}</div>` : ''}
      </summary>
      <div class="goal-detail" id="goal-detail-${g.id}">
        <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:8px;">${g.description || ''}</p>
        <button class="btn btn-sm" onclick="loadGoalTasks('${g.id}')">Load Tasks</button>
        <div id="goal-tasks-${g.id}"></div>
      </div>
    </details>
  `;
}

async function loadGoalTasks(goalId) {
  const el = document.getElementById(`goal-tasks-${goalId}`);
  el.innerHTML = '<div class="spinner" style="margin:8px 0;"></div>';
  try {
    const data = await fetchAPI(`orchestration/goals/${goalId}`);
    el.innerHTML = (data.tasks || []).length === 0 ? '<div class="cell-muted">No tasks decomposed yet.</div>' :
      data.tasks.map(t => `
        <div class="task-row">
          <span class="task-status">${TASK_STATUS_ICONS[t.status] || '?'}</span>
          <div class="task-info">
            <span class="task-title">${t.title}</span>
            ${t.assigned_to ? `<span class="cell-muted">&#8594; ${t.agent_role || 'agent'}</span>` : ''}
            ${t.actual_cost_cents > 0 ? `<span class="cell-mono">${formatCents(t.actual_cost_cents)}</span>` : ''}
          </div>
        </div>
      `).join('') +
      `<div class="cell-muted" style="margin-top:8px; font-size:0.7rem;">Cost: ${formatCents(data.costs?.actual || 0)} / ${formatCents(data.costs?.estimated || 0)} estimated</div>`;
  } catch (err) { el.innerHTML = `<div class="cell-muted">${err.message}</div>`; }
}
