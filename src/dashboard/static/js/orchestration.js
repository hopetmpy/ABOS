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
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Goals & Tasks</h2>
        <p>What your agent is working toward</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" onclick="openSpawnAgentModal()">Launch Agent</button>
        <button class="btn btn-primary" onclick="openCreateGoalModal()">+ New Goal</button>
      </div>
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
                <div class="child-header">
                  <span class="child-name">${c.name || c.address?.slice(0, 10)}</span>
                  <div style="display:flex; gap:4px; align-items:center;">
                    <span class="health-badge health-${healthy ? 'healthy' : dead ? 'failed' : 'disabled'}">${c.status}</span>
                    ${!dead ? `<button class="btn-micro" onclick="fundAgent('${c.id}')" title="Fund">&#128176;</button><button class="btn-micro" onclick="stopAgent('${c.id}')" title="Stop">&#9632;</button>` : ''}
                  </div>
                </div>
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
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="campaign-status-badge ${statusClass}">${g.status}</span>
            ${g.status === 'active' ? `<button class="btn-micro" onclick="event.stopPropagation(); approveGoal('${g.id}')" title="Execute now">&#9654;</button><button class="btn-micro" onclick="event.stopPropagation(); cancelGoal('${g.id}')" title="Cancel">&#10005;</button>` : ''}
          </div>
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

// ─── Goal Creation ──────────────────────────────────────────

function openCreateGoalModal() {
  if (document.getElementById('create-goal-modal')) {
    document.getElementById('create-goal-modal').style.display = 'flex';
    return;
  }
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="modal-overlay" id="create-goal-modal" style="display:flex" onclick="closeModal('create-goal-modal')">
      <div class="modal" style="max-width:500px" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Create Autonomous Goal</h3><button class="modal-close" onclick="closeModal('create-goal-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">The agent will decompose this into tasks and auto-execute after 5 minutes. You can approve early or cancel.</p>
          <div class="form-group"><label>Goal *</label><input type="text" id="goal-title" placeholder="e.g., Generate 100 qualified leads from healthcare SaaS companies"></div>
          <div class="form-group"><label>Details</label><textarea id="goal-desc" rows="3" placeholder="Any specific requirements, constraints, or context..."></textarea></div>
          <div class="form-row">
            <div class="form-group"><label>Revenue Target ($)</label><input type="number" id="goal-revenue" placeholder="0" min="0"></div>
            <div class="form-group"><label>Deadline</label><input type="date" id="goal-deadline"></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('create-goal-modal')">Cancel</button><button class="btn btn-primary" onclick="submitCreateGoal()">Create Goal</button></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal.firstElementChild);
}

async function submitCreateGoal() {
  const title = document.getElementById('goal-title').value.trim();
  if (!title) { showToast('Goal title required', 'error'); return; }
  try {
    const data = await postAPI('goals', {
      title,
      description: document.getElementById('goal-desc').value.trim() || title,
      expectedRevenueCents: Math.round((parseFloat(document.getElementById('goal-revenue').value) || 0) * 100),
      deadline: document.getElementById('goal-deadline').value || null,
    });
    closeModal('create-goal-modal');
    showToast(`Goal created: ${data.taskCount} tasks planned. Auto-executing in 5 min.`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.orchestration(main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Agent Spawning ─────────────────────────────────────────

function openSpawnAgentModal() {
  if (document.getElementById('spawn-agent-modal')) {
    document.getElementById('spawn-agent-modal').style.display = 'flex';
    return;
  }
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="modal-overlay" id="spawn-agent-modal" style="display:flex" onclick="closeModal('spawn-agent-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Launch Agent</h3><button class="modal-close" onclick="closeModal('spawn-agent-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Role</label>
            <select id="agent-role">
              <option value="researcher">Researcher — finds companies & contacts</option>
              <option value="enricher">Enricher — enriches contacts with data</option>
              <option value="copywriter">Copywriter — generates outreach content</option>
              <option value="outreach_agent">Outreach Agent — sends emails & LinkedIn</option>
              <option value="analyst">Analyst — monitors performance & reports</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Name</label><input type="text" id="agent-name" placeholder="Auto-generated"></div>
            <div class="form-group"><label>Budget (credits $)</label><input type="number" id="agent-budget" value="5" min="1"></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('spawn-agent-modal')">Cancel</button><button class="btn btn-primary" onclick="submitSpawnAgent()">Launch Agent</button></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal.firstElementChild);
}

async function submitSpawnAgent() {
  try {
    const data = await postAPI('agents/spawn', {
      role: document.getElementById('agent-role').value,
      name: document.getElementById('agent-name').value.trim() || undefined,
      budgetCents: Math.round((parseFloat(document.getElementById('agent-budget').value) || 5) * 100),
    });
    closeModal('spawn-agent-modal');
    showToast(`Agent ${data.name} launched (${data.role})`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.orchestration(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function approveGoal(goalId) {
  try {
    await postAPI(`goals/${goalId}/approve`, {});
    showToast('Goal approved for immediate execution', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.orchestration(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function cancelGoal(goalId) {
  if (!confirm('Cancel this goal?')) return;
  try {
    await postAPI(`goals/${goalId}/cancel`, {});
    showToast('Goal cancelled', 'info');
    const main = document.getElementById('main-content');
    await pageRenderers.orchestration(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function stopAgent(agentId) {
  try {
    await postAPI(`agents/${agentId}/stop`, {});
    showToast('Agent stopped', 'info');
    const main = document.getElementById('main-content');
    await pageRenderers.orchestration(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function fundAgent(agentId) {
  const amount = prompt('Amount to fund ($):');
  if (!amount) return;
  try {
    await postAPI(`agents/${agentId}/fund`, { amountCents: Math.round(parseFloat(amount) * 100) });
    showToast('Agent funded', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}
