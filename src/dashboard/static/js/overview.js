/**
 * Overview Page - Dashboard home with KPI cards and pipeline breakdown
 */

const STAGE_ORDER = ['cold', 'contacted', 'engaged', 'qualified', 'negotiating', 'won', 'lost', 'nurture'];
const STAGE_COLORS = {
  cold: '#64748b', contacted: '#3b82f6', engaged: '#8b5cf6', qualified: '#06b6d4',
  negotiating: '#f59e0b', won: '#22c55e', lost: '#ef4444', nurture: '#ec4899',
};

registerPage('overview', async (container) => {
  const data = await fetchAPI('overview');

  const hotLeads = (data.lastPipelineReview?.hotLeads) || 0;
  const warmLeads = (data.lastPipelineReview?.warmLeads) || 0;
  const staleLeads = (data.lastPipelineReview?.staleLeads) || 0;

  // Onboarding check (#9)
  const isFirstRun = data.totalProspects === 0 && data.activeCampaigns === 0 && data.totalTurns === 0;
  if (isFirstRun) {
    container.innerHTML = `
      <div class="page-header"><h2>Welcome to Automaton</h2><p>Let's get your sales & marketing agent up and running</p></div>
      <div class="onboarding-grid">
        <a href="#/brand" class="onboard-card"><span class="onboard-step">1</span><strong>Set Up Brand Voice</strong><p>Add your company info, product features, pricing, and messaging guidelines</p></a>
        <a href="#/pipeline" class="onboard-card"><span class="onboard-step">2</span><strong>Add Prospects</strong><p>Import your leads via CSV or add them manually to the pipeline</p></a>
        <a href="#/email-settings" class="onboard-card"><span class="onboard-step">3</span><strong>Connect Email</strong><p>Add your Gmail, Outlook, or SMTP server to start sending</p></a>
        <a href="#/ai-generate" class="onboard-card"><span class="onboard-step">4</span><strong>Connect AI Provider</strong><p>Add your OpenAI, Claude, Gemini, or Grok API key for content generation</p></a>
        <a href="#/campaigns" class="onboard-card"><span class="onboard-step">5</span><strong>Create a Campaign</strong><p>Set up your first outreach campaign with A/B tested messaging</p></a>
        <a href="#/settings" class="onboard-card"><span class="onboard-step">6</span><strong>Configure Settings</strong><p>Set up lead scoring rules, heartbeat tasks, and preferences</p></a>
      </div>
    `;
    return;
  }

  // Determine credit health class
  const creditClass = data.creditBalance > 500 ? 'positive'
    : data.creditBalance > 100 ? 'warning' : 'danger';

  container.innerHTML = `
    <div class="page-header">
      <h2>Dashboard Overview</h2>
      <p>Real-time view of your sales and marketing operations</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Prospects</div>
        <div class="kpi-value">${data.totalProspects}</div>
        <div class="kpi-detail">${hotLeads} hot, ${warmLeads} warm</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Pipeline Value</div>
        <div class="kpi-value">${formatLargeCents(data.pipelineValue)}</div>
        <div class="kpi-detail">Across all active stages</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active Campaigns</div>
        <div class="kpi-value">${data.activeCampaigns}</div>
        <div class="kpi-detail">${data.lastCampaignSnapshot ? `${data.lastCampaignSnapshot.conversionRate || 0}% conversion` : 'No data yet'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Credits</div>
        <div class="kpi-value ${creditClass}">${formatCents(data.creditBalance)}</div>
        <div class="kpi-detail">${data.totalTurns} total agent turns</div>
      </div>
    </div>

    ${staleLeads > 0 ? `
      <div class="section-card" style="border-color: var(--warning); background: rgba(245,158,11,0.05);">
        <h3 style="color: var(--warning);">Attention: ${staleLeads} lead(s) need follow-up</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem;">
          These warm/hot prospects haven't been contacted in 3+ days. Check the Pipeline view.
        </p>
      </div>
    ` : ''}

    <div class="grid-2">
      <div class="section-card">
        <h3>Pipeline Breakdown</h3>
        ${renderStageBreakdown(data.prospectsByStage, data.totalProspects)}
      </div>
      <div class="section-card">
        <h3>Recent Activity</h3>
        ${renderRecentActivity(data.recentActivity)}
      </div>
    </div>
  `;
});

function renderStageBreakdown(byStage, total) {
  if (!byStage || total === 0) {
    return '<div class="empty-state"><p>No prospects yet. Add some via the Pipeline page.</p></div>';
  }

  const maxCount = Math.max(...STAGE_ORDER.map(s => byStage[s] || 0), 1);

  return `<div class="stage-bars">
    ${STAGE_ORDER.map(stage => {
      const count = byStage[stage] || 0;
      const pct = Math.max((count / maxCount) * 100, 0);
      return `
        <div class="stage-row">
          <span class="stage-label">${capitalize(stage)}</span>
          <div class="stage-bar-track">
            <div class="stage-bar-fill ${stage}" style="width: ${pct}%">
              ${count > 0 ? count : ''}
            </div>
          </div>
          <span class="stage-count">${count}</span>
        </div>
      `;
    }).join('')}
  </div>`;
}

function renderRecentActivity(activities) {
  if (!activities || activities.length === 0) {
    return '<div class="empty-state"><p>No activity yet. The agent will log events here.</p></div>';
  }

  return `<div class="activity-list">
    ${activities.map(a => `
      <div class="activity-item">
        <div class="activity-dot ${a.outcome || 'neutral'}"></div>
        <div class="activity-text">
          <strong>${a.event_type || 'event'}</strong>: ${a.summary || 'No details'}
        </div>
        <div class="activity-time">${timeAgo(a.created_at)}</div>
      </div>
    `).join('')}
  </div>`;
}
