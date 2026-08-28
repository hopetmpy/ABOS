/**
 * Campaigns Page - Campaign management with metrics and conversion funnels
 */

const CAMPAIGN_TYPE_LABELS = {
  outreach: 'Outreach', nurture: 'Nurture', content: 'Content',
  event: 'Event', competitive_intel: 'Competitive Intel',
};
const CAMPAIGN_TYPE_COLORS = {
  outreach: '#6366f1', nurture: '#22c55e', content: '#f59e0b',
  event: '#3b82f6', competitive_intel: '#ec4899',
};
const CAMPAIGN_STATUS_LABELS = {
  draft: 'Draft', active: 'Active', paused: 'Paused',
  completed: 'Completed', cancelled: 'Cancelled',
};

let campaignsData = null;

registerPage('campaigns', async (container) => {
  const data = await fetchAPI('campaigns');
  campaignsData = data;

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Campaigns</h2>
        <p>${data.summary.total} campaigns &middot; ${data.summary.active} active &middot; ${data.summary.totalSent} emails sent &middot; ${data.summary.totalConverted} converted</p>
      </div>
      <a href="/api/export/campaigns" class="btn" download="campaigns.csv">Export CSV</a>
      <button class="btn" onclick="launchAutonomousCampaign()">&#129302; Launch Autonomous</button>
      <button class="btn btn-primary" onclick="openCreateCampaignModal()">+ New Campaign</button>
    </div>

    <div class="campaign-filters" id="campaign-filters">
      <button class="filter-btn active" data-filter="all" onclick="filterCampaigns('all', this)">All (${data.summary.total})</button>
      <button class="filter-btn" data-filter="active" onclick="filterCampaigns('active', this)">Active (${data.summary.active})</button>
      <button class="filter-btn" data-filter="draft" onclick="filterCampaigns('draft', this)">Draft (${data.summary.draft})</button>
      <button class="filter-btn" data-filter="completed" onclick="filterCampaigns('completed', this)">Completed</button>
    </div>

    <div class="campaign-list" id="campaign-list">
      ${renderCampaignList(data.campaigns, 'all')}
    </div>

    ${renderCampaignDetailModal()}
    ${renderCreateCampaignModal()}
  `;

  // Load sequence section + analytics async
  loadSequenceSection();
  loadCampaignAnalytics();
});

async function loadSequenceSection() {
  try {
    const [seqData, enrollData] = await Promise.all([
      fetchAPI('sequences'),
      fetchAPI('sequences/enrollments'),
    ]);

    const main = document.getElementById('main-content');
    const seqSection = document.createElement('div');
    seqSection.innerHTML = `
      <div class="section-card" style="margin-top:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3>Email Sequences (${(seqData.sequences || []).length})</h3>
          <button class="btn btn-sm" onclick="executeSequencesNow()">Process Sequences Now</button>
        </div>
        <p class="section-description">Enrollments: ${enrollData.stats.total} total, ${enrollData.stats.active} active, ${enrollData.stats.completed} completed, ${enrollData.stats.replied} replied</p>

        ${(seqData.sequences || []).length === 0 ? '<div class="empty-state"><p>No sequences. Create one via the API or Templates page.</p></div>' :
          seqData.sequences.map(s => {
            let steps = []; try { steps = JSON.parse(s.steps || '[]'); } catch {}
            return `
              <div class="campaign-card" style="margin-bottom:8px;">
                <div class="campaign-card-header">
                  <div>
                    <span class="campaign-name">${s.name}</span>
                    <span class="campaign-status-badge status-${s.status}">${s.status}</span>
                    <span class="cell-muted">${steps.length} steps</span>
                  </div>
                  <button class="btn btn-sm btn-primary" onclick="bulkEnrollInSequence('${s.id}', '${s.name}')">Enroll Prospects</button>
                </div>
                ${steps.length > 0 ? `<div style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);">${steps.map((st, i) => `Step ${i+1} (Day ${st.day}): ${st.subject || st.action || 'send'}`).join(' → ')}</div>` : ''}
              </div>
            `;
          }).join('')}

        ${enrollData.enrollments.length > 0 ? `
          <div style="margin-top:12px;">
            <h4 style="font-size:0.85rem; margin-bottom:8px;">Active Enrollments</h4>
            <div class="table-container" style="max-height:200px; overflow-y:auto;">
              <table class="data-table"><thead><tr><th>Prospect</th><th>Sequence</th><th>Step</th><th>Status</th><th>Next Send</th></tr></thead>
              <tbody>${enrollData.enrollments.slice(0, 20).map(e => `
                <tr>
                  <td class="cell-name">${e.prospect_name || '?'}</td>
                  <td class="cell-muted">${e.sequence_name || '?'}</td>
                  <td class="cell-mono">${e.current_step}</td>
                  <td><span class="campaign-status-badge status-${e.status === 'active' ? 'active' : e.status === 'replied' ? 'completed' : 'paused'}">${e.status}</span></td>
                  <td class="cell-muted">${e.next_send_at ? timeAgo(e.next_send_at) : '--'}</td>
                </tr>
              `).join('')}</tbody></table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
    main.appendChild(seqSection);
  } catch { /* sequences table may not exist */ }
}

async function executeSequencesNow() {
  try {
    const result = await postAPI('sequences/execute', {});
    showToast(`Processed: ${result.processed}, Sent: ${result.sent}, Skipped: ${result.skipped}, Errors: ${result.errors}`, result.errors > 0 ? 'error' : 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function bulkEnrollInSequence(sequenceId, sequenceName) {
  const stage = prompt(`Enroll all prospects from which stage into "${sequenceName}"?\n\nEnter: cold, contacted, engaged, qualified`);
  if (!stage) return;
  try {
    const result = await postAPI(`sequences/${sequenceId}/bulk-enroll`, { stage });
    showToast(`Enrolled ${result.enrolled} prospects (${result.skipped} already enrolled)`, 'success');
    loadSequenceSection(); // Refresh
  } catch (e) { showToast(e.message, 'error'); }
}

function filterCampaigns(status, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const list = document.getElementById('campaign-list');
  list.innerHTML = renderCampaignList(campaignsData.campaigns, status);
}

function renderCampaignList(campaigns, filter) {
  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  if (filtered.length === 0) {
    return '<div class="empty-state"><p>No campaigns match this filter.</p></div>';
  }

  return filtered.map(c => renderCampaignCard(c)).join('');
}

function renderCampaignCard(c) {
  const openRate = c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) : '0.0';
  const clickRate = c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) : '0.0';
  const replyRate = c.total_sent > 0 ? ((c.total_replied / c.total_sent) * 100).toFixed(1) : '0.0';
  const convRate = c.total_sent > 0 ? ((c.total_converted / c.total_sent) * 100).toFixed(1) : '0.0';

  const typeColor = CAMPAIGN_TYPE_COLORS[c.campaign_type] || '#6366f1';

  return `
    <div class="campaign-card" onclick="openCampaignDetail('${c.id}')">
      <div class="campaign-card-header">
        <div>
          <div class="campaign-name">${c.name}</div>
          <div class="campaign-meta">
            <span class="campaign-type-badge" style="background:${typeColor}20; color:${typeColor}">${CAMPAIGN_TYPE_LABELS[c.campaign_type] || c.campaign_type}</span>
            <span class="campaign-status-badge status-${c.status}">${CAMPAIGN_STATUS_LABELS[c.status] || c.status}</span>
            ${c.target_segment ? `<span class="campaign-segment">${c.target_segment}</span>` : ''}
          </div>
        </div>
        <div class="campaign-actions-inline">
          ${c.status === 'draft' ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); changeCampaignStatus('${c.id}', 'active')">Activate</button>` : ''}
          ${c.status === 'active' ? `<button class="btn btn-sm" onclick="event.stopPropagation(); changeCampaignStatus('${c.id}', 'paused')">Pause</button>` : ''}
          ${c.status === 'paused' ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); changeCampaignStatus('${c.id}', 'active')">Resume</button>` : ''}
        </div>
      </div>

      ${c.total_sent > 0 ? `
        <div class="campaign-funnel">
          <div class="funnel-step">
            <div class="funnel-value">${c.total_sent}</div>
            <div class="funnel-label">Sent</div>
          </div>
          <div class="funnel-arrow">&#8594;</div>
          <div class="funnel-step">
            <div class="funnel-value">${c.total_opened} <span class="funnel-rate">${openRate}%</span></div>
            <div class="funnel-label">Opened</div>
          </div>
          <div class="funnel-arrow">&#8594;</div>
          <div class="funnel-step">
            <div class="funnel-value">${c.total_clicked} <span class="funnel-rate">${clickRate}%</span></div>
            <div class="funnel-label">Clicked</div>
          </div>
          <div class="funnel-arrow">&#8594;</div>
          <div class="funnel-step">
            <div class="funnel-value">${c.total_replied} <span class="funnel-rate">${replyRate}%</span></div>
            <div class="funnel-label">Replied</div>
          </div>
          <div class="funnel-arrow">&#8594;</div>
          <div class="funnel-step funnel-highlight">
            <div class="funnel-value">${c.total_converted} <span class="funnel-rate">${convRate}%</span></div>
            <div class="funnel-label">Converted</div>
          </div>
        </div>
        <div class="campaign-cost">
          Cost: ${formatCents(c.cost_cents)} &middot; ${c.total_converted > 0 ? `$${(c.cost_cents / c.total_converted / 100).toFixed(2)}/conversion` : 'No conversions yet'}
          <a href="/api/analytics/export/${c.id}" class="btn-micro" style="margin-left:8px;" download title="Export CSV" onclick="event.stopPropagation()">&#128190; Export</a>
        </div>
      ` : `
        <div class="campaign-no-data">No emails sent yet</div>
      `}
    </div>
  `;
}

function renderCampaignDetailModal() {
  return `
    <div class="modal-overlay" id="campaign-detail-modal" style="display:none" onclick="closeModal('campaign-detail-modal')">
      <div class="modal" style="max-width:600px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="campaign-detail-title">Campaign</h3>
          <button class="modal-close" onclick="closeModal('campaign-detail-modal')">&times;</button>
        </div>
        <div class="modal-body" id="campaign-detail-body"></div>
      </div>
    </div>
  `;
}

function renderCreateCampaignModal() {
  return `
    <div class="modal-overlay" id="create-campaign-modal" style="display:none" onclick="closeModal('create-campaign-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>New Campaign</h3>
          <button class="modal-close" onclick="closeModal('create-campaign-modal')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Campaign Name *</label>
            <input type="text" id="new-campaign-name" placeholder="Q3 B2B SaaS Outreach">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Type</label>
              <select id="new-campaign-type">
                <option value="outreach">Outreach</option>
                <option value="nurture">Nurture</option>
                <option value="content">Content</option>
                <option value="event">Event</option>
                <option value="competitive_intel">Competitive Intel</option>
              </select>
            </div>
            <div class="form-group">
              <label>Target Segment</label>
              <input type="text" id="new-campaign-segment" placeholder="B2B SaaS, VP Engineering">
            </div>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="new-campaign-notes" rows="3" placeholder="Campaign objectives, messaging notes..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal('create-campaign-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="submitCreateCampaign()">Create Campaign</button>
        </div>
      </div>
    </div>
  `;
}

function openCreateCampaignModal() {
  document.getElementById('create-campaign-modal').style.display = 'flex';
}

async function submitCreateCampaign() {
  const name = document.getElementById('new-campaign-name').value.trim();
  if (!name) {
    showToast('Campaign name is required', 'error');
    return;
  }

  try {
    await postAPI('campaigns', {
      name,
      campaignType: document.getElementById('new-campaign-type').value,
      targetSegment: document.getElementById('new-campaign-segment').value.trim() || null,
      notes: document.getElementById('new-campaign-notes').value.trim() || null,
    });

    closeModal('create-campaign-modal');
    showToast(`Campaign "${name}" created`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.campaigns(main);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function changeCampaignStatus(id, newStatus) {
  try {
    await patchAPI(`campaigns/${id}`, { status: newStatus });
    showToast(`Campaign ${newStatus}`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.campaigns(main);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openCampaignDetail(id) {
  try {
    const data = await fetchAPI(`campaigns/${id}`);
    const c = data.campaign;

    document.getElementById('campaign-detail-title').textContent = c.name;

    const openRate = c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) : '0.0';
    const replyRate = c.total_sent > 0 ? ((c.total_replied / c.total_sent) * 100).toFixed(1) : '0.0';
    const convRate = c.total_sent > 0 ? ((c.total_converted / c.total_sent) * 100).toFixed(1) : '0.0';

    document.getElementById('campaign-detail-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Type</span>
          <span class="detail-value">${CAMPAIGN_TYPE_LABELS[c.campaign_type] || c.campaign_type}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Status</span>
          <span class="detail-value"><span class="campaign-status-badge status-${c.status}">${CAMPAIGN_STATUS_LABELS[c.status]}</span></span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Segment</span>
          <span class="detail-value">${c.target_segment || '--'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Created</span>
          <span class="detail-value">${timeAgo(c.created_at)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Open Rate</span>
          <span class="detail-value">${openRate}% (${c.total_opened}/${c.total_sent})</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Reply Rate</span>
          <span class="detail-value">${replyRate}% (${c.total_replied}/${c.total_sent})</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Conversion Rate</span>
          <span class="detail-value">${convRate}% (${c.total_converted}/${c.total_sent})</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Total Cost</span>
          <span class="detail-value">${formatCents(c.cost_cents)}</span>
        </div>
      </div>

      ${c.notes ? `<div style="margin-top:16px;"><strong>Notes:</strong><p style="color:var(--text-secondary);margin-top:4px;">${c.notes}</p></div>` : ''}

      ${data.events && data.events.length > 0 ? `
        <div style="margin-top:20px;">
          <h4 style="margin-bottom:12px;">Related Activity</h4>
          <div class="activity-list">
            ${data.events.slice(0, 10).map(e => `
              <div class="activity-item">
                <div class="activity-dot ${e.outcome || 'neutral'}"></div>
                <div class="activity-text">${e.summary}</div>
                <div class="activity-time">${timeAgo(e.created_at)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div id="campaign-step-analytics" style="margin-top:20px;"><div class="spinner"></div></div>
    `;

    document.getElementById('campaign-detail-modal').style.display = 'flex';

    // Load step analytics async
    loadStepAnalytics(id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Per-Step Analytics in Campaign Detail ──────────────────────

async function loadStepAnalytics(campaignId) {
  const el = document.getElementById('campaign-step-analytics');
  if (!el) return;

  try {
    // Get all sequences and try to find step data
    const seqData = await fetchAPI('sequences');
    const sequences = seqData.sequences || [];

    if (sequences.length === 0) {
      el.innerHTML = '';
      return;
    }

    let html = '<h4 style="margin-bottom:8px;">Step-by-Step Funnel</h4>';
    let hasData = false;

    for (const seq of sequences.slice(0, 3)) {
      try {
        const stepData = await fetchAPI(`analytics/steps/${seq.id}`);
        if (stepData.steps && stepData.steps.length > 0) {
          hasData = true;
          html += `
            <div style="margin-bottom:12px;">
              <strong style="font-size:0.85rem;">${stepData.sequenceName}</strong>
              <div class="table-container" style="margin-top:6px;">
                <table class="data-table">
                  <thead><tr><th>Step</th><th>Day</th><th>Subject</th><th>Reached</th><th>Opens</th><th>Clicks</th><th>Open Rate</th><th>Dropoff</th></tr></thead>
                  <tbody>
                    ${stepData.steps.map(s => `
                      <tr>
                        <td class="cell-mono">${s.step + 1}</td>
                        <td class="cell-mono">${s.day}</td>
                        <td>${s.subject}</td>
                        <td class="cell-mono">${s.reached}</td>
                        <td class="cell-mono">${s.opens}</td>
                        <td class="cell-mono">${s.clicks}</td>
                        <td class="${s.openRate > 30 ? 'positive' : ''} cell-mono">${s.openRate}%</td>
                        <td class="${s.dropoffRate > 50 ? 'danger' : ''} cell-mono">${s.dropoffRate}%</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }
      } catch { /* sequence may not have analytics */ }
    }

    el.innerHTML = hasData ? html : '';
  } catch {
    el.innerHTML = '';
  }
}

// ─── Campaign Analytics ─────────────────────────────────────────

async function loadCampaignAnalytics() {
  try {
    const [trends, sendTime, comparison] = await Promise.all([
      fetchAPI('analytics/reply-trends?days=30'),
      fetchAPI('analytics/send-time'),
      fetchAPI('analytics/sequences'),
    ]);

    const main = document.getElementById('main-content');

    // Reply trends section
    if (trends.timeline && trends.timeline.length > 0) {
      const trendsSection = document.createElement('div');
      trendsSection.className = 'section-card';
      trendsSection.style.marginTop = '20px';
      trendsSection.innerHTML = `
        <h3>Reply Rate Trends (${trends.periodDays}d)</h3>
        <div class="table-container"><table class="data-table"><thead><tr><th>Date</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Open Rate</th><th>Reply Rate</th></tr></thead>
        <tbody>${trends.timeline.slice(-14).map(d => `
          <tr><td class="cell-mono">${d.day.slice(5)}</td><td class="cell-mono">${d.sent}</td><td class="cell-mono">${d.opened}</td><td class="cell-mono">${d.replied}</td>
          <td class="${d.openRate > 30 ? 'positive' : ''}">${d.openRate}%</td><td class="${d.replyRate > 5 ? 'positive' : ''}">${d.replyRate}%</td></tr>
        `).join('')}</tbody></table></div>
      `;
      main.appendChild(trendsSection);
    }

    // Send time + sequence comparison in grid
    const gridSection = document.createElement('div');
    gridSection.className = 'grid-2';
    gridSection.style.marginTop = '16px';
    gridSection.innerHTML = `
      <div class="section-card">
        <h3>Best Send Time</h3>
        <p class="section-description">Best open time: <strong>${sendTime.bestOpenHour}</strong> &middot; Best reply time: <strong>${sendTime.bestReplyHour}</strong></p>
        <div class="stage-bars">
          ${sendTime.weekdays.map(d => `
            <div class="stage-row">
              <span class="stage-label" style="width:40px">${d.name}</span>
              <div class="stage-bar-track">
                <div class="stage-bar-fill contacted" style="width:${sendTime.weekdays.length > 0 ? Math.max((d.opens / Math.max(...sendTime.weekdays.map(w => w.opens), 1)) * 100, 2) : 0}%">${d.opens || ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="section-card">
        <h3>Sequence Comparison</h3>
        ${comparison.sequences.length === 0 ? '<div class="empty-state"><p>No sequences to compare.</p></div>' :
          `<div class="table-container"><table class="data-table"><thead><tr><th>Sequence</th><th>Enrolled</th><th>Replied</th><th>Reply Rate</th></tr></thead>
          <tbody>${comparison.sequences.map(s => `
            <tr><td class="cell-name">${s.name}</td><td class="cell-mono">${s.enrolled}</td><td class="cell-mono">${s.replied}</td>
            <td class="${s.replyRate > 5 ? 'positive' : ''} cell-mono">${s.replyRate}%</td></tr>
          `).join('')}</tbody></table></div>`}
      </div>
    `;
    main.appendChild(gridSection);
  } catch { /* analytics tables may not exist */ }
}

// ─── Autonomous Campaign Launch ─────────────────────────────────

async function launchAutonomousCampaign() {
  const title = prompt('Describe your campaign goal:\n\nExample: "Generate 50 qualified leads from healthcare SaaS companies"\nExample: "Run cold outreach to VP Engineering at Series B startups"');
  if (!title) return;

  const budgetStr = prompt('Budget in dollars (default $500):', '500');
  const budget = Math.round((parseFloat(budgetStr) || 500) * 100);

  const targetStr = prompt('Target number of prospects (default 50):', '50');
  const target = parseInt(targetStr) || 50;

  try {
    showToast('Launching autonomous campaign...', 'info');
    const result = await postAPI('outreach/launch', {
      title,
      description: title,
      budgetCents: budget,
      targetCount: target,
      autoReply: true,
      autoOptimize: true,
    });

    showToast(`Campaign launched! ${result.status.phase}. Auto-executing in 5 min. Track on Goals page.`, 'success');

    const main = document.getElementById('main-content');
    await pageRenderers.campaigns(main);
  } catch (e) { showToast(e.message, 'error'); }
}
