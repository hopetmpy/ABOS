/**
 * Pipeline Kanban Board - Drag-and-drop prospect management
 */

const PIPELINE_STAGES = ['cold', 'contacted', 'engaged', 'qualified', 'negotiating', 'won', 'lost', 'nurture'];
const STAGE_LABELS = {
  cold: 'Cold', contacted: 'Contacted', engaged: 'Engaged', qualified: 'Qualified',
  negotiating: 'Negotiating', won: 'Won', lost: 'Lost', nurture: 'Nurture',
};
const STAGE_EMOJI = {
  cold: '&#10052;', contacted: '&#9993;', engaged: '&#128172;', qualified: '&#9989;',
  negotiating: '&#129309;', won: '&#127942;', lost: '&#10060;', nurture: '&#127793;',
};

let pipelineData = null;

registerPage('pipeline', async (container) => {
  const data = await fetchAPI('pipeline');
  pipelineData = data;

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Sales Pipeline</h2>
        <p>${data.totalCount} prospects &middot; ${formatCents(data.totalValue)} total value</p>
      </div>
      <button class="btn btn-primary" onclick="openAddProspectModal()">+ Add Prospect</button>
    </div>
    <div class="kanban-board" id="kanban-board">
      ${PIPELINE_STAGES.map(stage => renderKanbanColumn(stage, data)).join('')}
    </div>
    ${renderProspectModal()}
    ${renderAddProspectModal()}
  `;

  initDragAndDrop();
});

function renderKanbanColumn(stage, data) {
  const prospects = data.prospects.filter(p => p.stage === stage);
  const stageInfo = data.summary[stage] || { count: 0, value: 0 };

  return `
    <div class="kanban-column" data-stage="${stage}">
      <div class="kanban-column-header">
        <div class="kanban-stage-title">
          <span class="stage-emoji">${STAGE_EMOJI[stage]}</span>
          ${STAGE_LABELS[stage]}
          <span class="kanban-count">${stageInfo.count}</span>
        </div>
        <div class="kanban-stage-value">${formatCents(stageInfo.value)}</div>
      </div>
      <div class="kanban-cards" data-stage="${stage}">
        ${prospects.map(p => renderProspectCard(p)).join('')}
        ${prospects.length === 0 ? '<div class="kanban-empty">No prospects</div>' : ''}
      </div>
    </div>
  `;
}

function renderProspectCard(p) {
  const trustClass = p.trustScore >= 0.7 ? 'hot' : p.trustScore >= 0.4 ? 'warm' : 'cold-trust';
  const trustLabel = p.trustScore != null ? `${Math.round(p.trustScore * 100)}%` : '--';
  const daysSince = p.lastInteractionAt
    ? Math.floor((Date.now() - new Date(p.lastInteractionAt).getTime()) / 86400000)
    : null;
  const staleClass = daysSince !== null && daysSince > 3 ? 'stale' : '';

  return `
    <div class="kanban-card ${staleClass}" draggable="true" data-id="${p.id}" onclick="openProspectDetail('${p.id}')">
      <div class="card-header-row">
        <span class="card-name">${p.prospect_name || p.entity_address}</span>
        <span class="trust-badge ${trustClass}" title="Trust: ${trustLabel}">${trustLabel}</span>
      </div>
      <div class="card-company">${p.company || 'Unknown company'}</div>
      ${p.title ? `<div class="card-title-role">${p.title}</div>` : ''}
      <div class="card-footer">
        <span class="card-value">${p.deal_value_cents > 0 ? formatCents(p.deal_value_cents) : '--'}</span>
        ${daysSince !== null ? `<span class="card-days ${staleClass}" title="Days since last contact">${daysSince}d ago</span>` : ''}
      </div>
    </div>
  `;
}

function renderProspectModal() {
  return `
    <div class="modal-overlay" id="prospect-modal" style="display:none" onclick="closeModal('prospect-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="modal-prospect-name">Prospect</h3>
          <button class="modal-close" onclick="closeModal('prospect-modal')">&times;</button>
        </div>
        <div class="modal-body" id="modal-prospect-body"></div>
        <div class="modal-footer">
          <button class="btn btn-danger" id="modal-delete-btn">Delete</button>
          <button class="btn btn-primary" id="modal-save-btn">Save Changes</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddProspectModal() {
  return `
    <div class="modal-overlay" id="add-prospect-modal" style="display:none" onclick="closeModal('add-prospect-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add Prospect</h3>
          <button class="modal-close" onclick="closeModal('add-prospect-modal')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name *</label>
            <input type="text" id="add-name" placeholder="Jane Smith">
          </div>
          <div class="form-group">
            <label>Email *</label>
            <input type="email" id="add-email" placeholder="jane@company.com">
          </div>
          <div class="form-group">
            <label>Company</label>
            <input type="text" id="add-company" placeholder="Acme Corp">
          </div>
          <div class="form-group">
            <label>Title</label>
            <input type="text" id="add-title" placeholder="VP Engineering">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Stage</label>
              <select id="add-stage">
                ${PIPELINE_STAGES.map(s => `<option value="${s}" ${s === 'cold' ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Deal Value ($)</label>
              <input type="number" id="add-value" placeholder="5000" min="0" step="100">
            </div>
          </div>
          <div class="form-group">
            <label>Source</label>
            <input type="text" id="add-source" placeholder="apollo, referral, manual">
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="add-notes" rows="3" placeholder="Any context about this prospect..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal('add-prospect-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="submitAddProspect()">Add Prospect</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Modal Logic ────────────────────────────────────────────────

function openAddProspectModal() {
  document.getElementById('add-prospect-modal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function submitAddProspect() {
  const name = document.getElementById('add-name').value.trim();
  const email = document.getElementById('add-email').value.trim();

  if (!name || !email) {
    showToast('Name and email are required', 'error');
    return;
  }

  try {
    await postAPI('pipeline', {
      prospectName: name,
      email: email,
      entityAddress: email,
      company: document.getElementById('add-company').value.trim() || null,
      title: document.getElementById('add-title').value.trim() || null,
      stage: document.getElementById('add-stage').value,
      dealValueCents: Math.round((parseFloat(document.getElementById('add-value').value) || 0) * 100),
      source: document.getElementById('add-source').value.trim() || null,
      notes: document.getElementById('add-notes').value.trim() || null,
    });

    closeModal('add-prospect-modal');
    showToast(`${name} added to pipeline`, 'success');

    // Refresh the page
    const main = document.getElementById('main-content');
    await pageRenderers.pipeline(main);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

let currentProspectId = null;

function openProspectDetail(id) {
  const p = pipelineData?.prospects.find(x => x.id === id);
  if (!p) return;

  currentProspectId = id;
  document.getElementById('modal-prospect-name').textContent = p.prospect_name || p.entity_address;

  const trustLabel = p.trustScore != null ? `${Math.round(p.trustScore * 100)}%` : 'N/A';
  const trustClass = p.trustScore >= 0.7 ? 'hot' : p.trustScore >= 0.4 ? 'warm' : 'cold-trust';

  document.getElementById('modal-prospect-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-label">Company</span>
        <span class="detail-value">${p.company || '--'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Title</span>
        <span class="detail-value">${p.title || '--'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Email</span>
        <span class="detail-value">${p.email || '--'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Trust Score</span>
        <span class="detail-value"><span class="trust-badge ${trustClass}">${trustLabel}</span></span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Interactions</span>
        <span class="detail-value">${p.interactionCount || 0}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Last Contact</span>
        <span class="detail-value">${p.lastInteractionAt ? timeAgo(p.lastInteractionAt) : 'Never'}</span>
      </div>
    </div>
    <div class="form-row" style="margin-top: 16px;">
      <div class="form-group">
        <label>Stage</label>
        <select id="edit-stage">
          ${PIPELINE_STAGES.map(s => `<option value="${s}" ${s === p.stage ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Deal Value ($)</label>
        <input type="number" id="edit-value" value="${(p.deal_value_cents / 100).toFixed(0)}" min="0" step="100">
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="edit-notes" rows="3">${p.notes || ''}</textarea>
    </div>
  `;

  document.getElementById('modal-save-btn').onclick = () => saveProspectChanges(id);
  document.getElementById('modal-delete-btn').onclick = () => deleteProspect(id);
  document.getElementById('prospect-modal').style.display = 'flex';
}

async function saveProspectChanges(id) {
  try {
    await patchAPI(`pipeline/${id}`, {
      stage: document.getElementById('edit-stage').value,
      dealValueCents: Math.round((parseFloat(document.getElementById('edit-value').value) || 0) * 100),
      notes: document.getElementById('edit-notes').value.trim() || null,
    });

    closeModal('prospect-modal');
    showToast('Prospect updated', 'success');

    const main = document.getElementById('main-content');
    await pageRenderers.pipeline(main);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProspect(id) {
  if (!confirm('Delete this prospect? This cannot be undone.')) return;

  try {
    const res = await fetch(`/api/pipeline/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');

    closeModal('prospect-modal');
    showToast('Prospect deleted', 'success');

    const main = document.getElementById('main-content');
    await pageRenderers.pipeline(main);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Drag and Drop ──────────────────────────────────────────────

function initDragAndDrop() {
  const cards = document.querySelectorAll('.kanban-card');
  const columns = document.querySelectorAll('.kanban-cards');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      card.classList.add('dragging');
      // Slight delay so the drag image captures the card
      setTimeout(() => card.style.opacity = '0.4', 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '1';
      document.querySelectorAll('.kanban-cards').forEach(col => col.classList.remove('drag-over'));
    });
  });

  columns.forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');

      const id = e.dataTransfer.getData('text/plain');
      const newStage = col.dataset.stage;
      if (!id || !newStage) return;

      // Find the prospect to check if stage actually changed
      const prospect = pipelineData?.prospects.find(p => p.id === id);
      if (!prospect || prospect.stage === newStage) return;

      try {
        await patchAPI(`pipeline/${id}`, { stage: newStage });
        showToast(`Moved to ${STAGE_LABELS[newStage]}`, 'success');

        // Refresh
        const main = document.getElementById('main-content');
        await pageRenderers.pipeline(main);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}
