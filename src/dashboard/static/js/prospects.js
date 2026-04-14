/**
 * Prospects Page - Searchable, sortable contact database table
 */

let prospectsData = null;
let prospectSort = 'updated_at';
let prospectOrder = 'desc';
let prospectSearch = '';
let prospectStageFilter = '';
let prospectSegmentFilter = '';
let prospectPage = 1;

registerPage('prospects', async (container) => {
  prospectPage = 1;
  prospectSearch = '';
  prospectStageFilter = '';
  prospectSegmentFilter = '';
  await renderProspectsPage(container);
});

async function renderProspectsPage(container) {
  const query = buildProspectQuery();
  const data = await fetchAPI(`prospects?${query}`);
  prospectsData = data;

  container.innerHTML = `
    <div class="page-header">
      <h2>Prospects</h2>
      <p>${data.pagination.total} contacts in database</p>
    </div>

    <div class="prospects-toolbar">
      <div class="search-box">
        <input type="text" id="prospect-search" placeholder="Search name, company, email..."
               value="${prospectSearch}" oninput="debounceProspectSearch(this.value)">
      </div>
      <div class="toolbar-filters">
        <select id="prospect-stage-filter" onchange="prospectStageFilter=this.value; prospectPage=1; refreshProspects()">
          <option value="">All Stages</option>
          ${PIPELINE_STAGES.map(s => `<option value="${s}" ${prospectStageFilter === s ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
        </select>
        <select id="prospect-segment-filter" onchange="prospectSegmentFilter=this.value; prospectPage=1; refreshProspects()">
          <option value="">All Segments</option>
          ${(data.segments || []).map(s => `<option value="${s}" ${prospectSegmentFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="prospects-table">
        <thead>
          <tr>
            ${renderSortHeader('prospect_name', 'Name')}
            ${renderSortHeader('company', 'Company')}
            <th>Title</th>
            ${renderSortHeader('stage', 'Stage')}
            ${renderSortHeader('trust_score', 'Trust')}
            ${renderSortHeader('deal_value_cents', 'Deal Value')}
            <th>Last Contact</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${renderProspectRows(data.prospects)}
        </tbody>
      </table>
    </div>

    ${renderProspectPagination(data.pagination)}
    ${renderProspectDetailModal()}
  `;
}

function buildProspectQuery() {
  const params = new URLSearchParams();
  if (prospectSearch) params.set('search', prospectSearch);
  if (prospectStageFilter) params.set('stage', prospectStageFilter);
  if (prospectSegmentFilter) params.set('segment', prospectSegmentFilter);
  params.set('sort', prospectSort);
  params.set('order', prospectOrder);
  params.set('page', String(prospectPage));
  params.set('limit', '50');
  return params.toString();
}

function renderSortHeader(field, label) {
  const isActive = prospectSort === field;
  const arrow = isActive ? (prospectOrder === 'asc' ? ' &#9650;' : ' &#9660;') : '';
  return `<th class="sortable ${isActive ? 'sorted' : ''}" onclick="toggleProspectSort('${field}')">${label}${arrow}</th>`;
}

function renderProspectRows(prospects) {
  if (!prospects || prospects.length === 0) {
    return '<tr><td colspan="8" class="table-empty">No prospects found</td></tr>';
  }

  return prospects.map(p => {
    const trust = p.trust_score;
    const trustClass = trust >= 0.7 ? 'hot' : trust >= 0.4 ? 'warm' : 'cold-trust';
    const trustLabel = trust != null ? `${Math.round(trust * 100)}%` : '--';

    return `
      <tr class="prospect-row" onclick="openProspectInfo('${p.id}')">
        <td>
          <div class="cell-name">${p.prospect_name || '--'}</div>
          <div class="cell-email">${p.email || ''}</div>
        </td>
        <td>${p.company || '--'}</td>
        <td class="cell-muted">${p.title || '--'}</td>
        <td><span class="stage-pill stage-${p.stage}">${capitalize(p.stage)}</span></td>
        <td><span class="trust-badge ${trustClass}">${trustLabel}</span></td>
        <td class="cell-mono">${p.deal_value_cents > 0 ? formatCents(p.deal_value_cents) : '--'}</td>
        <td class="cell-muted">${p.last_interaction_at ? timeAgo(p.last_interaction_at) : 'Never'}</td>
        <td>
          <button class="btn btn-sm" onclick="event.stopPropagation(); openProspectInfo('${p.id}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProspectPagination(pagination) {
  if (pagination.totalPages <= 1) return '';
  return `
    <div class="pagination">
      <button class="btn btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="changeProspectPage(${pagination.page - 1})">Previous</button>
      <span class="pagination-info">Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)</span>
      <button class="btn btn-sm" ${!pagination.hasMore ? 'disabled' : ''} onclick="changeProspectPage(${pagination.page + 1})">Next</button>
    </div>
  `;
}

function renderProspectDetailModal() {
  return `
    <div class="modal-overlay" id="prospect-info-modal" style="display:none" onclick="closeModal('prospect-info-modal')">
      <div class="modal" style="max-width:600px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="prospect-info-title">Prospect</h3>
          <button class="modal-close" onclick="closeModal('prospect-info-modal')">&times;</button>
        </div>
        <div class="modal-body" id="prospect-info-body"><div class="spinner"></div></div>
        <div class="modal-footer">
          <button class="btn btn-danger" id="prospect-info-delete">Delete</button>
          <button class="btn btn-primary" id="prospect-info-save">Save Changes</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Interactions ───────────────────────────────────────────────

let searchTimeout = null;
function debounceProspectSearch(value) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    prospectSearch = value;
    prospectPage = 1;
    refreshProspects();
  }, 300);
}

function toggleProspectSort(field) {
  if (prospectSort === field) {
    prospectOrder = prospectOrder === 'asc' ? 'desc' : 'asc';
  } else {
    prospectSort = field;
    prospectOrder = 'desc';
  }
  prospectPage = 1;
  refreshProspects();
}

function changeProspectPage(page) {
  prospectPage = page;
  refreshProspects();
}

async function refreshProspects() {
  const main = document.getElementById('main-content');
  await renderProspectsPage(main);
}

async function openProspectInfo(id) {
  document.getElementById('prospect-info-modal').style.display = 'flex';
  document.getElementById('prospect-info-body').innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  try {
    const data = await fetchAPI(`prospects/${id}`);
    const p = data.prospect;
    const rel = data.relationship;

    document.getElementById('prospect-info-title').textContent = p.prospect_name || p.entity_address;

    const trustLabel = rel?.trust_score != null ? `${Math.round(rel.trust_score * 100)}%` : 'N/A';
    const trustClass = rel?.trust_score >= 0.7 ? 'hot' : rel?.trust_score >= 0.4 ? 'warm' : 'cold-trust';

    document.getElementById('prospect-info-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><span class="detail-label">Company</span><span class="detail-value">${p.company || '--'}</span></div>
        <div class="detail-item"><span class="detail-label">Title</span><span class="detail-value">${p.title || '--'}</span></div>
        <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${p.email || '--'}</span></div>
        <div class="detail-item"><span class="detail-label">Source</span><span class="detail-value">${p.source || '--'}</span></div>
        <div class="detail-item"><span class="detail-label">Trust</span><span class="detail-value"><span class="trust-badge ${trustClass}">${trustLabel}</span></span></div>
        <div class="detail-item"><span class="detail-label">Interactions</span><span class="detail-value">${rel?.interaction_count || 0}</span></div>
        <div class="detail-item"><span class="detail-label">Last Contact</span><span class="detail-value">${rel?.last_interaction_at ? timeAgo(rel.last_interaction_at) : 'Never'}</span></div>
        <div class="detail-item"><span class="detail-label">Added</span><span class="detail-value">${timeAgo(p.created_at)}</span></div>
      </div>

      <div class="form-row" style="margin-top:16px;">
        <div class="form-group">
          <label>Stage</label>
          <select id="pi-stage">${PIPELINE_STAGES.map(s => `<option value="${s}" ${s === p.stage ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label>Deal Value ($)</label>
          <input type="number" id="pi-value" value="${(p.deal_value_cents / 100).toFixed(0)}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>Segment</label>
        <input type="text" id="pi-segment" value="${p.segment || ''}">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="pi-notes" rows="2">${p.notes || ''}</textarea>
      </div>

      ${data.interactions && data.interactions.length > 0 ? `
        <div style="margin-top:16px;">
          <h4 style="margin-bottom:8px; font-size:0.85rem;">Interaction History</h4>
          <div class="activity-list">
            ${data.interactions.map(i => `
              <div class="activity-item">
                <div class="activity-dot ${i.outcome || 'neutral'}"></div>
                <div class="activity-text">${i.summary}</div>
                <div class="activity-time">${timeAgo(i.created_at)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    document.getElementById('prospect-info-save').onclick = async () => {
      try {
        await patchAPI(`prospects/${id}`, {
          stage: document.getElementById('pi-stage').value,
          dealValueCents: Math.round((parseFloat(document.getElementById('pi-value').value) || 0) * 100),
          segment: document.getElementById('pi-segment').value.trim() || null,
          notes: document.getElementById('pi-notes').value.trim() || null,
        });
        closeModal('prospect-info-modal');
        showToast('Prospect updated', 'success');
        refreshProspects();
      } catch (err) { showToast(err.message, 'error'); }
    };

    document.getElementById('prospect-info-delete').onclick = async () => {
      if (!confirm('Delete this prospect?')) return;
      try {
        await fetch(`/api/prospects/${id}`, { method: 'DELETE' });
        closeModal('prospect-info-modal');
        showToast('Prospect deleted', 'success');
        refreshProspects();
      } catch (err) { showToast(err.message, 'error'); }
    };
  } catch (err) {
    document.getElementById('prospect-info-body').innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
  }
}
