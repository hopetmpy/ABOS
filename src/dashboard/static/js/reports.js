/**
 * Reports Page - Charts and analytics with Chart.js
 */

const CHART_COLORS = {
  cold: '#64748b', contacted: '#3b82f6', engaged: '#8b5cf6', qualified: '#06b6d4',
  negotiating: '#f59e0b', won: '#22c55e', lost: '#ef4444', nurture: '#ec4899',
};
const OUTCOME_COLORS = {
  success: '#22c55e', failure: '#ef4444', partial: '#f59e0b', neutral: '#64748b', unknown: '#94a3b8',
};
const CLASS_COLORS = {
  strategic: '#8b5cf6', productive: '#22c55e', communication: '#3b82f6',
  maintenance: '#64748b', idle: '#94a3b8', error: '#ef4444', unknown: '#475569',
};

let reportDays = 30;
let chartInstances = [];

registerPage('reports', async (container) => {
  destroyCharts();
  await renderReportsPage(container);
});

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];
}

async function renderReportsPage(container) {
  // Fetch all report data in parallel
  const [pipeline, campaigns, revenue, costs, activity, weekly] = await Promise.all([
    fetchAPI('reports/pipeline'),
    fetchAPI('reports/campaigns'),
    fetchAPI('reports/revenue'),
    fetchAPI(`reports/costs?days=${reportDays}`),
    fetchAPI(`reports/activity?days=${reportDays}`),
    fetchAPI('reports/weekly'),
  ]);

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Reports & Analytics</h2>
        <p>Performance insights and trends</p>
      </div>
      <div class="report-period-selector">
        <button class="filter-btn ${reportDays === 7 ? 'active' : ''}" onclick="changeReportPeriod(7)">7d</button>
        <button class="filter-btn ${reportDays === 30 ? 'active' : ''}" onclick="changeReportPeriod(30)">30d</button>
        <button class="filter-btn ${reportDays === 90 ? 'active' : ''}" onclick="changeReportPeriod(90)">90d</button>
      </div>
    </div>

    ${renderWeeklySummary(weekly)}

    <div class="grid-2">
      <div class="section-card">
        <h3>Pipeline Funnel</h3>
        <div class="chart-container"><canvas id="chart-pipeline"></canvas></div>
      </div>
      <div class="section-card">
        <h3>Activity Distribution</h3>
        <div class="chart-container chart-sm"><canvas id="chart-activity-dist"></canvas></div>
      </div>
    </div>

    <div class="section-card">
      <h3>Campaign Comparison</h3>
      ${campaigns.campaigns.length > 0
        ? '<div class="chart-container"><canvas id="chart-campaigns"></canvas></div>'
        : '<div class="empty-state"><p>No campaigns with sent data yet.</p></div>'}
    </div>

    <div class="grid-2">
      <div class="section-card">
        <h3>Revenue: Expected vs Actual</h3>
        ${revenue.goals.length > 0
          ? '<div class="chart-container"><canvas id="chart-revenue"></canvas></div>'
          : `<div class="report-kpi-row">
              <div class="report-kpi"><span class="report-kpi-label">Won Revenue</span><span class="report-kpi-value positive">${formatCents(revenue.wonRevenueCents)}</span></div>
              <div class="report-kpi"><span class="report-kpi-label">Active Pipeline</span><span class="report-kpi-value">${formatCents(revenue.activePipelineCents)}</span></div>
            </div>`}
      </div>
      <div class="section-card">
        <h3>Inference Costs (${reportDays}d)</h3>
        ${costs.dailyCosts.length > 0
          ? '<div class="chart-container"><canvas id="chart-costs"></canvas></div>'
          : `<div class="report-kpi-row">
              <div class="report-kpi"><span class="report-kpi-label">Total Spend</span><span class="report-kpi-value">${formatCents(costs.totalSpendCents)}</span></div>
            </div>`}
      </div>
    </div>

    ${costs.byModel.length > 0 ? `
      <div class="section-card">
        <h3>Cost Breakdown</h3>
        <div class="grid-2">
          <div>
            <h4 class="subsection-title">By Model</h4>
            <div class="breakdown-list">
              ${costs.byModel.map(m => `
                <div class="breakdown-row">
                  <span class="breakdown-label">${m.model}</span>
                  <span class="breakdown-value">${formatCents(m.total_cost)} (${m.total_calls} calls)</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div>
            <h4 class="subsection-title">By Task Type</h4>
            <div class="breakdown-list">
              ${costs.byTask.map(t => `
                <div class="breakdown-row">
                  <span class="breakdown-label">${capitalize(t.task_type)}</span>
                  <span class="breakdown-value">${formatCents(t.total_cost)} (${t.total_calls} calls)</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Load learnings async
  loadLearnings();

  // Render charts after DOM is ready
  setTimeout(() => {
    renderPipelineChart(pipeline);
    renderActivityDistChart(activity);
    if (campaigns.campaigns.length > 0) renderCampaignChart(campaigns);
    if (revenue.goals.length > 0) renderRevenueChart(revenue);
    if (costs.dailyCosts.length > 0) renderCostsChart(costs);
  }, 50);
}

function renderWeeklySummary(w) {
  const openRate = w.campaignMetrics.total_sent > 0
    ? ((w.campaignMetrics.total_opened / w.campaignMetrics.total_sent) * 100).toFixed(1) : '0';
  const replyRate = w.campaignMetrics.total_sent > 0
    ? ((w.campaignMetrics.total_replied / w.campaignMetrics.total_sent) * 100).toFixed(1) : '0';

  return `
    <div class="section-card weekly-summary">
      <h3>This Week's Summary</h3>
      <div class="kpi-grid" style="margin-top:12px;">
        <div class="kpi-card">
          <div class="kpi-label">New Prospects</div>
          <div class="kpi-value">${w.newProspects}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Stage Changes</div>
          <div class="kpi-value">${w.stageChanges}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Emails Sent</div>
          <div class="kpi-value">${w.campaignMetrics.total_sent}</div>
          <div class="kpi-detail">${openRate}% open &middot; ${replyRate}% reply</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Conversions</div>
          <div class="kpi-value positive">${w.campaignMetrics.total_converted}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Agent Events</div>
          <div class="kpi-value">${w.eventCount}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Inference Spend</div>
          <div class="kpi-value">${formatCents(w.weeklySpendCents)}</div>
        </div>
      </div>
      ${w.topEvents.length > 0 ? `
        <div style="margin-top:12px;">
          <span class="subsection-title">Top Event Types:</span>
          ${w.topEvents.map(e => `<span class="report-tag">${e.event_type} (${e.count})</span>`).join(' ')}
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Chart Renderers ────────────────────────────────────────────

function renderPipelineChart(data) {
  const canvas = document.getElementById('chart-pipeline');
  if (!canvas) return;
  const ordered = ['cold','contacted','engaged','qualified','negotiating','won','lost','nurture'];
  const stageData = {};
  data.stages.forEach(s => { stageData[s.stage] = s; });

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ordered.map(s => capitalize(s)),
      datasets: [{
        label: 'Prospects',
        data: ordered.map(s => stageData[s]?.count || 0),
        backgroundColor: ordered.map(s => CHART_COLORS[s] || '#64748b'),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, color: '#8b8fa3' }, grid: { color: '#2a2d3a' } },
        x: { ticks: { color: '#8b8fa3' }, grid: { display: false } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderActivityDistChart(data) {
  const canvas = document.getElementById('chart-activity-dist');
  if (!canvas) return;
  const labels = data.byClassification.map(c => capitalize(c.classification));
  const values = data.byClassification.map(c => c.count);
  const colors = data.byClassification.map(c => CLASS_COLORS[c.classification] || '#64748b');

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#8b8fa3', padding: 12, font: { size: 11 } } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderCampaignChart(data) {
  const canvas = document.getElementById('chart-campaigns');
  if (!canvas) return;
  const names = data.campaigns.map(c => c.name.length > 20 ? c.name.slice(0, 18) + '..' : c.name);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: names,
      datasets: [
        { label: 'Sent', data: data.campaigns.map(c => c.total_sent), backgroundColor: '#64748b', borderRadius: 2 },
        { label: 'Opened', data: data.campaigns.map(c => c.total_opened), backgroundColor: '#3b82f6', borderRadius: 2 },
        { label: 'Replied', data: data.campaigns.map(c => c.total_replied), backgroundColor: '#f59e0b', borderRadius: 2 },
        { label: 'Converted', data: data.campaigns.map(c => c.total_converted), backgroundColor: '#22c55e', borderRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b8fa3', font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8b8fa3' }, grid: { color: '#2a2d3a' } },
        x: { ticks: { color: '#8b8fa3' }, grid: { display: false } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderRevenueChart(data) {
  const canvas = document.getElementById('chart-revenue');
  if (!canvas) return;
  const labels = data.goals.map(g => g.title.length > 20 ? g.title.slice(0, 18) + '..' : g.title);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Expected', data: data.goals.map(g => g.expected_revenue_cents / 100), backgroundColor: '#3b82f680', borderRadius: 2 },
        { label: 'Actual', data: data.goals.map(g => g.actual_revenue_cents / 100), backgroundColor: '#22c55e', borderRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b8fa3', font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8b8fa3', callback: v => '$' + v }, grid: { color: '#2a2d3a' } },
        x: { ticks: { color: '#8b8fa3' }, grid: { display: false } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderCostsChart(data) {
  const canvas = document.getElementById('chart-costs');
  if (!canvas) return;

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.dailyCosts.map(d => d.day.slice(5)), // MM-DD
      datasets: [{
        label: 'Daily Cost',
        data: data.dailyCosts.map(d => d.total_cost / 100),
        borderColor: '#6366f1',
        backgroundColor: '#6366f120',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8b8fa3', callback: v => '$' + v.toFixed(2) }, grid: { color: '#2a2d3a' } },
        x: { ticks: { color: '#8b8fa3', maxTicksLimit: 10 }, grid: { display: false } },
      },
    },
  });
  chartInstances.push(chart);
}

// ─── Period Selector ────────────────────────────────────────────

async function loadLearnings() {
  try {
    const data = await fetchAPI('learnings');
    if (data.totalLearnings > 0 || data.allProcedures?.length > 0) {
      // Find insertion point — after the last section-card
      const main = document.getElementById('main-content');
      const card = document.createElement('div');
      card.className = 'section-card';
      card.innerHTML = `
        <h3>What the Agent Has Learned (${data.totalLearnings} from A/B tests, ${data.allProcedures?.length || 0} total skills)</h3>
        ${(data.abLearnings || []).slice(0, 5).map(l => {
          let steps = []; try { steps = JSON.parse(l.steps || '[]'); } catch {}
          return `<div class="procedure-card" style="margin-bottom:6px;">
            <div class="procedure-name">${l.name}</div>
            <div class="procedure-desc">${l.description || ''}</div>
            ${steps.length > 0 ? `<div class="procedure-steps">${steps.slice(0, 2).map(s => `<div class="procedure-step">${typeof s === 'string' ? s : JSON.stringify(s)}</div>`).join('')}</div>` : ''}
          </div>`;
        }).join('') || '<div class="cell-muted">No A/B test learnings yet. Run tests to start learning.</div>'}
      `;
      main.appendChild(card);
    }
  } catch {}
}

async function changeReportPeriod(days) {
  reportDays = days;
  destroyCharts();
  const main = document.getElementById('main-content');
  await renderReportsPage(main);
}
