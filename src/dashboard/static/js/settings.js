/**
 * Settings Page - Agent configuration, heartbeat toggles, treasury policy
 */

const MODE_LABELS = {
  general: 'General Purpose',
  sales: 'Sales Operations',
  marketing: 'Marketing Operations',
  content: 'Content Creation',
  sales_marketing: 'Sales + Marketing',
};

registerPage('settings', async (container) => {
  let data;
  try {
    data = await fetchAPI('settings');
  } catch {
    data = { agentName: '--', agentMode: 'general', heartbeats: [], treasuryPolicy: {}, modelStrategy: {} };
  }

  const shortAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '--';

  container.innerHTML = `
    <div class="page-header">
      <h2>Settings</h2>
      <p>Agent configuration and preferences</p>
    </div>

    <div class="grid-2">
      <div class="section-card">
        <h3>Agent Identity</h3>
        <div class="settings-list">
          <div class="setting-row">
            <span class="setting-label">Name</span>
            <span class="setting-value">${data.agentName}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Mode</span>
            <span class="setting-value"><span class="mode-badge">${MODE_LABELS[data.agentMode] || data.agentMode}</span></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Version</span>
            <span class="setting-value mono">${data.version}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Chain</span>
            <span class="setting-value">${data.chainType === 'solana' ? 'Solana' : 'EVM (Base)'}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Wallet</span>
            <span class="setting-value mono">${shortAddr(data.walletAddress)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Creator</span>
            <span class="setting-value mono">${shortAddr(data.creatorAddress)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Inference Model</span>
            <span class="setting-value mono">${data.inferenceModel}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Max Children</span>
            <span class="setting-value">${data.maxChildren}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Base URL</span>
            <span class="setting-value" style="display:flex;gap:6px;align-items:center">
              <input type="text" id="base-url-input" value="${data.baseUrl || ''}" placeholder="https://your-domain.com" style="width:220px;font-size:13px;padding:4px 8px">
              <button class="btn btn-sm" onclick="saveBaseUrl()">Save</button>
            </span>
          </div>
        </div>
      </div>

      <div class="section-card">
        <h3>Treasury Policy</h3>
        <div class="settings-list">
          <div class="setting-row">
            <span class="setting-label">Max Single Transfer</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.maxSingleTransferCents)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Max Daily Transfers</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.maxDailyTransferCents)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Minimum Reserve</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.minimumReserveCents)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Max x402 Payment</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.maxX402PaymentCents)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Max Daily Inference</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.maxInferenceDailyCents)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Confirm Above</span>
            <span class="setting-value mono">${formatCents(data.treasuryPolicy.requireConfirmationAboveCents)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-card">
      <h3>Heartbeat Tasks</h3>
      <p class="section-description">Toggle heartbeat tasks on or off. Changes take effect on the next heartbeat cycle.</p>
      <div class="heartbeat-toggles">
        ${data.heartbeats.map(h => `
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-name">${h.task_name}</span>
              <span class="toggle-schedule">${h.cron_expression || '--'}</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" ${h.enabled ? 'checked' : ''} onchange="toggleHeartbeat('${h.task_name}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section-card">
      <h3>Lead Scoring Rules</h3>
      <p class="section-description">Configure how prospects are scored. Points are awarded when a rule matches.</p>
      <div id="scoring-rules-list"><div class="spinner"></div></div>
      <div style="margin-top:12px;">
        <h4 style="font-size:0.8rem; margin-bottom:8px;">Add Rule</h4>
        <div class="form-row">
          <div class="form-group"><label>Field</label><select id="sr-field"><option value="company">Company</option><option value="title">Title</option><option value="deal_value_cents">Deal Value</option><option value="trust_score">Trust Score</option><option value="email">Email</option><option value="source">Source</option><option value="segment">Segment</option><option value="interaction_count">Interactions</option></select></div>
          <div class="form-group"><label>Operator</label><select id="sr-op"><option value="not_empty">Exists</option><option value="equals">Equals</option><option value="contains">Contains</option><option value="greater_than">Greater Than</option><option value="less_than">Less Than</option></select></div>
          <div class="form-group"><label>Value</label><input type="text" id="sr-value" placeholder="(optional)"></div>
          <div class="form-group"><label>Points</label><input type="number" id="sr-points" value="10" min="-50" max="100"></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="addScoringRule()">Add Rule</button>
      </div>
    </div>

    <div class="section-card">
      <h3>Dashboard Preferences</h3>
      <div class="settings-list">
        <div class="setting-row">
          <span class="setting-label">Theme</span>
          <span class="setting-value">
            <button class="btn btn-sm" onclick="toggleTheme()">
              ${document.documentElement.dataset.theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
            </button>
          </span>
        </div>
        <div class="setting-row">
          <span class="setting-label">Auto-refresh Interval</span>
          <span class="setting-value">
            <select onchange="changeRefreshInterval(this.value)" class="setting-select">
              <option value="15000" ${REFRESH_MS === 15000 ? 'selected' : ''}>15 seconds</option>
              <option value="30000" ${REFRESH_MS === 30000 ? 'selected' : ''}>30 seconds</option>
              <option value="60000" ${REFRESH_MS === 60000 ? 'selected' : ''}>60 seconds</option>
              <option value="0">Off</option>
            </select>
          </span>
        </div>
      </div>
    </div>
  `;
});

async function toggleHeartbeat(taskName, enabled) {
  try {
    await patchAPI('settings', {
      heartbeatToggles: { [taskName]: enabled },
    });
    showToast(`${taskName} ${enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    // Revert the toggle
    const main = document.getElementById('main-content');
    await pageRenderers.settings(main);
  }
}

async function saveBaseUrl() {
  const url = document.getElementById('base-url-input').value.trim();
  try {
    await patchAPI('settings', { baseUrl: url });
    showToast('Base URL saved', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('dashboard-theme', next);
  // Re-render to update button text
  const main = document.getElementById('main-content');
  pageRenderers.settings(main);
}

function changeRefreshInterval(ms) {
  const val = parseInt(ms, 10);
  REFRESH_MS = val;
  localStorage.setItem('dashboard-refresh', String(val));
  if (val > 0) {
    startAutoRefresh();
    showToast(`Auto-refresh set to ${val / 1000}s`, 'info');
  } else {
    stopAutoRefresh();
    showToast('Auto-refresh disabled', 'info');
  }
}

// ─── Lead Scoring Rules ─────────────────────────────────────
async function loadScoringRules() {
  const el = document.getElementById('scoring-rules-list');
  if (!el) return;
  try {
    const data = await fetchAPI('lead-scoring/config');
    if (!data.rules || data.rules.length === 0) {
      el.innerHTML = '<div class="cell-muted" style="padding:8px 0;">No scoring rules configured. Add one below.</div>';
      return;
    }
    el.innerHTML = data.rules.map(r => `
      <div class="setting-row">
        <span class="setting-label"><code>${r.field}</code> ${r.operator} ${r.value || ''} = <strong>${r.points}pts</strong></span>
        <span class="setting-value">
          <span class="health-badge health-${r.enabled ? 'healthy' : 'disabled'}">${r.enabled ? 'Active' : 'Off'}</span>
          <button class="btn-micro" onclick="deleteScoringRule('${r.id}')" title="Delete">&#10005;</button>
        </span>
      </div>
    `).join('');
  } catch { el.innerHTML = '<div class="cell-muted">Failed to load rules.</div>'; }
}

async function addScoringRule() {
  const field = document.getElementById('sr-field').value;
  const operator = document.getElementById('sr-op').value;
  const value = document.getElementById('sr-value').value.trim() || null;
  const points = parseInt(document.getElementById('sr-points').value) || 10;
  try {
    await postAPI('lead-scoring/rules', { field, operator, value, points });
    showToast('Scoring rule added', 'success');
    loadScoringRules();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteScoringRule(id) {
  try {
    await fetch(`/api/lead-scoring/rules/${id}`, { method: 'DELETE' });
    showToast('Rule deleted', 'success');
    loadScoringRules();
  } catch (e) { showToast(e.message, 'error'); }
}

// Auto-load scoring rules when settings page renders
setTimeout(() => { if (currentPage === 'settings') loadScoringRules(); }, 100);

// Load saved preferences on startup
(function loadPreferences() {
  const savedTheme = localStorage.getItem('dashboard-theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  const savedRefresh = localStorage.getItem('dashboard-refresh');
  if (savedRefresh) {
    const val = parseInt(savedRefresh, 10);
    if (!isNaN(val)) REFRESH_MS = val;
  }
})();
