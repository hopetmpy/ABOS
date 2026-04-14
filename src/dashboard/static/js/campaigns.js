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
});

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
        <div class="campaign-cost">Cost: ${formatCents(c.cost_cents)} &middot; ${c.total_converted > 0 ? `$${(c.cost_cents / c.total_converted / 100).toFixed(2)}/conversion` : 'No conversions yet'}</div>
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
    `;

    document.getElementById('campaign-detail-modal').style.display = 'flex';
  } catch (err) {
    showToast(err.message, 'error');
  }
}
