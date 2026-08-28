/**
 * Health Page - Agent health monitoring, heartbeat tasks, credits, children
 */

const TIER_LABELS = { normal: 'Normal', low_compute: 'Low Compute', critical: 'Critical', dead: 'Dead' };
const TIER_CLASSES = { normal: 'positive', low_compute: 'warning', critical: 'danger', dead: 'danger' };

registerPage('health', async (container) => {
  const data = await fetchAPI('health');

  const uptimeHrs = Math.floor(data.uptimeMs / 3600000);
  const uptimeMins = Math.floor((data.uptimeMs % 3600000) / 60000);
  const tierClass = TIER_CLASSES[data.survivalTier] || '';

  container.innerHTML = `
    <div class="page-header">
      <h2>Agent Health</h2>
      <p>System status, heartbeat tasks, and resource monitoring</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Agent State</div>
        <div class="kpi-value"><span class="agent-status ${data.agentState}">${data.agentState}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Survival Tier</div>
        <div class="kpi-value ${tierClass}">${TIER_LABELS[data.survivalTier] || data.survivalTier}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Credits</div>
        <div class="kpi-value ${tierClass}">${formatCents(data.creditBalance)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Uptime</div>
        <div class="kpi-value">${uptimeHrs}h ${uptimeMins}m</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="section-card">
        <h3>Heartbeat Tasks (${data.heartbeats.length})</h3>
        ${renderHeartbeatTable(data.heartbeats)}
      </div>
      <div class="section-card">
        <h3>Recent Executions</h3>
        ${renderHeartbeatHistory(data.heartbeatHistory)}
      </div>
    </div>

    ${data.children.length > 0 ? `
      <div class="section-card">
        <h3>Child Agents (${data.children.length})</h3>
        ${renderChildrenTable(data.children)}
      </div>
    ` : ''}

    <div class="section-card">
      <h3>Enrichment Queue</h3>
      <div id="enrichment-queue-section"><div class="spinner"></div></div>
    </div>

    <div class="section-card">
      <h3>System Info</h3>
      <div class="settings-list">
        <div class="setting-row"><span class="setting-label">HTTPS</span><span class="setting-value ${location.protocol === 'https:' ? 'positive' : ''}">${location.protocol === 'https:' ? 'Enabled' : 'Not enabled \u2014 configure SSL at your reverse proxy'}</span></div>
        <div class="setting-row"><span class="setting-label">Dashboard URL</span><span class="setting-value mono">${location.origin}</span></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="section-card">
        <h3>Recent Transactions</h3>
        ${renderTransactions(data.recentTransactions)}
      </div>
      <div class="section-card">
        <h3>Policy Decisions</h3>
        ${renderPolicyDecisions(data.policyDecisions)}
      </div>
    </div>
  `;
});

function renderHeartbeatTable(heartbeats) {
  if (!heartbeats || heartbeats.length === 0) {
    return '<div class="empty-state"><p>No heartbeat tasks configured.</p></div>';
  }

  return `
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Last Run</th>
            <th>Runs</th>
            <th>Fails</th>
          </tr>
        </thead>
        <tbody>
          ${heartbeats.map(h => {
            const enabled = h.enabled === 1;
            const hasFailed = h.last_result === 'failure' || h.last_result === 'timeout';
            const statusClass = !enabled ? 'disabled' : hasFailed ? 'failed' : 'healthy';
            const statusLabel = !enabled ? 'Disabled' : hasFailed ? 'Failed' : 'Healthy';

            return `
              <tr class="heartbeat-row ${statusClass}">
                <td>
                  <div class="cell-name">${h.task_name}</div>
                  <div class="cell-email">${h.cron_expression || '--'}</div>
                </td>
                <td><span class="health-badge health-${statusClass}">${statusLabel}</span></td>
                <td class="cell-muted">${h.last_run_at ? timeAgo(h.last_run_at) : 'Never'}</td>
                <td class="cell-mono">${h.run_count || 0}</td>
                <td class="cell-mono ${h.fail_count > 0 ? 'cell-danger' : ''}">${h.fail_count || 0}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHeartbeatHistory(history) {
  if (!history || history.length === 0) {
    return '<div class="empty-state"><p>No execution history yet.</p></div>';
  }

  return `
    <div class="history-list">
      ${history.map(h => {
        const resultClass = h.result === 'success' ? 'success' : h.result === 'failure' ? 'failure' : h.result === 'timeout' ? 'warning' : 'neutral';
        return `
          <div class="history-item">
            <div class="activity-dot ${resultClass}"></div>
            <div class="history-content">
              <div class="history-task">${h.task_name}</div>
              <div class="history-meta">
                <span class="outcome-badge outcome-${resultClass}">${h.result}</span>
                <span class="cell-muted">${h.duration_ms}ms</span>
                <span class="activity-time">${timeAgo(h.started_at)}</span>
              </div>
              ${h.error ? `<div class="history-error">${h.error}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderChildrenTable(children) {
  return `
    <div class="children-grid">
      ${children.map(c => {
        const statusClass = c.status === 'running' || c.status === 'healthy' ? 'success'
          : c.status === 'sleeping' ? 'info'
          : c.status === 'dead' || c.status === 'failed' ? 'danger' : 'neutral';
        return `
          <div class="child-card">
            <div class="child-header">
              <span class="child-name">${c.name || c.address.slice(0, 10) + '...'}</span>
              <span class="health-badge health-${statusClass === 'success' ? 'healthy' : statusClass === 'danger' ? 'failed' : 'disabled'}">${c.status}</span>
            </div>
            <div class="child-details">
              <span class="child-role">${capitalize(c.role || 'generalist')}</span>
              <span class="child-funded">${formatCents(c.funded_amount_cents)}</span>
              <span class="cell-muted">${c.last_checked ? timeAgo(c.last_checked) : 'Never checked'}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderTransactions(txns) {
  if (!txns || txns.length === 0) {
    return '<div class="empty-state"><p>No transactions yet.</p></div>';
  }

  return `
    <div class="history-list">
      ${txns.map(tx => {
        const isIncome = tx.type === 'topup' || tx.type === 'transfer_in' || tx.type === 'credit_purchase';
        const sign = isIncome ? '+' : '-';
        const colorClass = isIncome ? 'positive' : '';
        return `
          <div class="history-item">
            <div class="activity-dot ${isIncome ? 'success' : 'neutral'}"></div>
            <div class="history-content">
              <div class="history-task">
                <span class="${colorClass}">${sign}${formatCents(Math.abs(tx.amount_cents))}</span>
                <span class="cell-muted" style="margin-left:8px">${tx.type}</span>
              </div>
              <div class="history-meta">
                <span class="cell-muted">${tx.description || '--'}</span>
                <span class="activity-time">${timeAgo(tx.created_at)}</span>
              </div>
            </div>
            <div class="tx-balance">${formatCents(tx.balance_after_cents)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Load enrichment queue
(async function loadEnrichmentQueue() {
  const el = document.getElementById('enrichment-queue-section');
  if (!el) { setTimeout(loadEnrichmentQueue, 500); return; }
  try {
    const data = await fetchAPI('enrichment/queue');
    if (!data.queue || data.queue.length === 0) {
      el.innerHTML = '<div class="cell-muted">No enrichment requests. Use "Enrich" on any prospect to queue one.</div>';
    } else {
      el.innerHTML = data.queue.slice(0, 10).map(q => `
        <div class="history-item">
          <div class="activity-dot ${q.status === 'completed' ? 'success' : q.status === 'failed' ? 'failure' : 'neutral'}"></div>
          <div class="history-content">
            <div class="history-task">${q.prospect_name || q.entity_address} <span class="outcome-badge outcome-${q.status === 'completed' ? 'success' : q.status === 'pending' ? 'neutral' : 'failure'}">${q.status}</span></div>
          </div>
          <div class="activity-time">${timeAgo(q.created_at)}</div>
        </div>
      `).join('');
    }
  } catch { el.innerHTML = '<div class="cell-muted">Could not load enrichment queue.</div>'; }
})();

function renderPolicyDecisions(decisions) {
  if (!decisions || decisions.length === 0) {
    return '<div class="empty-state"><p>No policy decisions recorded.</p></div>';
  }

  return `
    <div class="history-list">
      ${decisions.map(d => {
        const isAllow = d.decision === 'allow';
        return `
          <div class="history-item">
            <div class="activity-dot ${isAllow ? 'success' : 'failure'}"></div>
            <div class="history-content">
              <div class="history-task">
                <code>${d.tool_name}</code>
                <span class="policy-badge policy-${d.decision}">${d.decision}</span>
                <span class="policy-risk risk-${d.risk_level}">${d.risk_level}</span>
              </div>
              ${d.reason ? `<div class="history-meta cell-muted">${d.reason}</div>` : ''}
            </div>
            <div class="activity-time">${timeAgo(d.created_at)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
