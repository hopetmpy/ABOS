/**
 * Tool Logs Page — Execution history, available tools, policy decisions, costs
 */

let toolFilter = '';
let toolStatus = '';
let toolPage = 1;

registerPage('tools', async (container) => {
  const [overview, available, policyData] = await Promise.all([
    fetchAPI('tools/overview'),
    fetchAPI('tools/available'),
    fetchAPI('tools/policy?limit=10'),
  ]);

  const successRate = overview.totalCalls > 0 ? Math.round((overview.successCount / overview.totalCalls) * 100) : 0;

  container.innerHTML = `
    <div class="page-header">
      <h2>Tool Logs</h2>
      <p>What your agent did, when, and how much it cost</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Calls</div><div class="kpi-value">${overview.totalCalls}</div></div>
      <div class="kpi-card"><div class="kpi-label">Success Rate</div><div class="kpi-value ${successRate >= 90 ? 'positive' : successRate >= 70 ? 'warning' : 'danger'}">${successRate}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Duration</div><div class="kpi-value">${overview.avgDurationMs}ms</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Cost</div><div class="kpi-value">${formatCents(overview.totalCostCents)}</div></div>
    </div>

    <div class="section-card">
      <h3>Available Tools (${available.tools.length})</h3>
      <p class="section-description">All tools the agent can use, grouped by category</p>
      <div class="tools-grid">
        ${Object.entries(groupBy(available.tools, 'category')).map(([cat, tools]) => `
          <div class="tool-category">
            <h4 class="subsection-title">${capitalize(cat)} (${tools.length})</h4>
            ${tools.map(t => `
              <div class="tool-item">
                <div class="tool-item-header">
                  <code class="tool-name">${t.name}</code>
                  <span class="policy-risk risk-${t.riskLevel}">${t.riskLevel}</span>
                </div>
                <div class="tool-desc">${t.description}</div>
                <div class="tool-usage">${t.usageCount > 0 ? `Used ${t.usageCount} times` : 'Never used'}</div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section-card">
      <h3>Execution Log</h3>
      <div class="prospects-toolbar" style="margin-bottom:12px;">
        <select onchange="toolFilter=this.value; toolPage=1; loadToolCalls()">
          <option value="">All Tools</option>
          ${overview.distinctTools.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <select onchange="toolStatus=this.value; toolPage=1; loadToolCalls()">
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div id="tool-calls-list"><div class="spinner"></div></div>
    </div>

    ${policyData.decisions.length > 0 ? `
      <div class="section-card">
        <h3>Security Decisions</h3>
        <div class="history-list">
          ${policyData.decisions.map(d => `
            <div class="history-item">
              <div class="activity-dot ${d.decision === 'allow' ? 'success' : 'failure'}"></div>
              <div class="history-content">
                <div class="history-task"><code>${d.tool_name}</code> <span class="policy-badge policy-${d.decision}">${d.decision}</span> <span class="policy-risk risk-${d.risk_level}">${d.risk_level}</span></div>
                ${d.reason ? `<div class="history-meta">${d.reason}</div>` : ''}
              </div>
              <div class="activity-time">${timeAgo(d.created_at)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${overview.topTools.length > 0 ? `
      <div class="section-card">
        <h3>Most Used Tools</h3>
        <div class="stage-bars">
          ${overview.topTools.slice(0, 10).map(t => {
            const maxCount = overview.topTools[0].count;
            const pct = Math.max((t.count / maxCount) * 100, 5);
            return `<div class="stage-row"><span class="stage-label" style="width:150px"><code>${t.name}</code></span><div class="stage-bar-track"><div class="stage-bar-fill contacted" style="width:${pct}%">${t.count}</div></div></div>`;
          }).join('')}
        </div>
      </div>
    ` : ''}
  `;

  loadToolCalls();
});

async function loadToolCalls() {
  const el = document.getElementById('tool-calls-list');
  if (!el) return;
  el.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  const params = new URLSearchParams();
  if (toolFilter) params.set('tool', toolFilter);
  if (toolStatus) params.set('status', toolStatus);
  params.set('page', String(toolPage));
  params.set('limit', '20');

  const data = await fetchAPI(`tools/calls?${params}`);
  el.innerHTML = (data.calls || []).length === 0 ? '<div class="empty-state"><p>No tool calls recorded yet.</p></div>' : `
    <div class="table-container"><table class="data-table"><thead><tr><th>Tool</th><th>Status</th><th>Duration</th><th>When</th></tr></thead><tbody>
    ${data.calls.map(c => `
      <tr onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'table-row':'none'" style="cursor:pointer">
        <td><code>${c.name}</code></td>
        <td><span class="health-badge health-${c.error ? 'failed' : 'healthy'}">${c.error ? 'Error' : 'OK'}</span></td>
        <td class="cell-mono">${c.duration_ms}ms</td>
        <td class="cell-muted">${timeAgo(c.created_at)}</td>
      </tr>
      <tr style="display:none"><td colspan="4" style="padding:12px; background:var(--bg-primary);">
        <div style="font-size:0.75rem;">
          <strong>Arguments:</strong><pre style="margin:4px 0; overflow-x:auto; max-height:120px;">${formatJson(c.arguments)}</pre>
          <strong>Result:</strong><div class="cell-muted" style="max-height:80px; overflow-y:auto;">${(c.result || '').slice(0, 500)}</div>
          ${c.error ? `<div style="color:var(--danger); margin-top:4px;"><strong>Error:</strong> ${c.error}</div>` : ''}
          ${c.turn_thinking ? `<div style="margin-top:4px;"><strong>Agent reasoning:</strong> <span class="cell-muted">${c.turn_thinking.slice(0, 200)}...</span></div>` : ''}
        </div>
      </td></tr>
    `).join('')}
    </tbody></table></div>
    ${data.pagination.totalPages > 1 ? `<div class="pagination"><button class="btn btn-sm" ${data.pagination.page <= 1 ? 'disabled' : ''} onclick="toolPage=${data.pagination.page-1}; loadToolCalls()">Prev</button><span class="pagination-info">Page ${data.pagination.page}/${data.pagination.totalPages} (${data.pagination.total})</span><button class="btn btn-sm" ${!data.pagination.hasMore ? 'disabled' : ''} onclick="toolPage=${data.pagination.page+1}; loadToolCalls()">Next</button></div>` : ''}
  `;
}

function formatJson(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str || '{}'; }
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => { (acc[item[key]] = acc[item[key]] || []).push(item); return acc; }, {});
}
