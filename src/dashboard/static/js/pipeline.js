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
      <div style="display:flex; gap:4px; margin-top:4px;">
        <button class="btn-micro" onclick="event.stopPropagation(); pipelineEnrich('${p.id}')" title="Enrich">&#128269;</button>
        <button class="btn-micro" onclick="event.stopPropagation(); pipelineLinkedIn('${p.id}')" title="LinkedIn DM">&#128172;</button>
        ${p.email ? `<button class="btn-micro" onclick="event.stopPropagation(); pipelineEmail('${p.id}')" title="Send Email">&#9993;</button>` : ''}
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

async function openProspectDetail(id) {
  const p = pipelineData?.prospects.find(x => x.id === id);
  if (!p) return;

  currentProspectId = id;
  document.getElementById('modal-prospect-name').textContent = p.prospect_name || p.entity_address;
  document.getElementById('modal-prospect-body').innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  document.getElementById('prospect-modal').style.display = 'flex';

  const trustLabel = p.trustScore != null ? `${Math.round(p.trustScore * 100)}%` : 'N/A';
  const trustClass = p.trustScore >= 0.7 ? 'hot' : p.trustScore >= 0.4 ? 'warm' : 'cold-trust';

  // Fetch lead score and timeline
  let scoreData = null, timelineData = null;
  try { scoreData = await fetchAPI(`prospects/${id}/score`); } catch {}
  try { timelineData = await fetchAPI(`prospects/${id}/timeline`); } catch {}

  const scoreDisplay = scoreData ? `<span style="font-weight:700">${scoreData.score}</span><span class="cell-muted">/${scoreData.maxPossible}</span>` : '<span class="cell-muted">--</span>';

  document.getElementById('modal-prospect-body').innerHTML = `
    <div class="prospect-detail-actions" style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
      <button class="btn btn-sm btn-primary" onclick="pipelineEnrich('${id}')">Enrich</button>
      <button class="btn btn-sm" onclick="pipelineLinkedIn('${id}')">LinkedIn DM</button>
      ${p.email ? `<button class="btn btn-sm" onclick="pipelineEmail('${id}')">Send Email</button>` : ''}
      <button class="btn btn-sm" onclick="addToSequence('${id}')">Add to Sequence</button>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">Company</span><span class="detail-value">${p.company || '--'}</span></div>
      <div class="detail-item"><span class="detail-label">Title</span><span class="detail-value">${p.title || '--'}</span></div>
      <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${p.email || '--'}</span></div>
      <div class="detail-item"><span class="detail-label">Trust</span><span class="detail-value"><span class="trust-badge ${trustClass}">${trustLabel}</span></span></div>
      <div class="detail-item"><span class="detail-label">Lead Score</span><span class="detail-value">${scoreDisplay}</span></div>
      <div class="detail-item"><span class="detail-label">Interactions</span><span class="detail-value">${p.interactionCount || 0}</span></div>
    </div>
    ${scoreData && scoreData.breakdown ? `<details style="margin-top:6px;"><summary style="font-size:0.7rem; color:var(--text-muted); cursor:pointer;">Score breakdown</summary><div style="margin-top:4px;">${scoreData.breakdown.map(b => `<div style="font-size:0.65rem; color:${b.matched ? 'var(--success)' : 'var(--text-muted)'};">${b.matched ? '&#10003;' : '&#10007;'} ${b.rule} (${b.points}pts)</div>`).join('')}</div></details>` : ''}
    <div class="form-row" style="margin-top: 12px;">
      <div class="form-group"><label>Stage</label><select id="edit-stage">${PIPELINE_STAGES.map(s => `<option value="${s}" ${s === p.stage ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}</select></div>
      <div class="form-group"><label>Deal Value ($)</label><input type="number" id="edit-value" value="${(p.deal_value_cents / 100).toFixed(0)}" min="0" step="100"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="edit-notes" rows="2">${p.notes || ''}</textarea></div>
    ${timelineData && timelineData.timeline && timelineData.timeline.length > 0 ? `
      <div style="margin-top:12px;"><h4 style="font-size:0.8rem; margin-bottom:6px;">Timeline (${timelineData.timeline.length})</h4>
      <div class="activity-list" style="max-height:180px; overflow-y:auto;">
        ${timelineData.timeline.slice(0, 10).map(e => `<div class="activity-item"><div class="activity-dot ${e.type.includes('sent') ? 'success' : e.type.includes('fail') ? 'failure' : 'neutral'}"></div><div class="activity-text" style="font-size:0.75rem;">${e.description}</div><div class="activity-time">${timeAgo(e.created_at)}</div></div>`).join('')}
      </div></div>
    ` : ''}
  `;

  document.getElementById('modal-save-btn').onclick = () => saveProspectChanges(id);
  document.getElementById('modal-delete-btn').onclick = () => deleteProspect(id);
}

async function pipelineEnrich(id) {
  try { await postAPI(`prospects/${id}/enrich`, {}); showToast('Enrichment queued', 'success'); } catch (e) { showToast(e.message, 'error'); }
}
async function pipelineLinkedIn(id) {
  try { const d = await postAPI(`linkedin/generate/${id}`, {}); showToast(`LinkedIn DM generated (DISC: ${d.discType || '?'})`, 'success'); } catch (e) { showToast(e.message, 'error'); }
}
async function pipelineEmail(id) {
  const subject = prompt('Email subject:'); if (!subject) return;
  const body = prompt('Email body:'); if (!body) return;
  try { const d = await postAPI(`email/send/prospect/${id}`, { subject, body }); showToast(d.sent ? 'Email sent!' : 'Failed', d.sent ? 'success' : 'error'); } catch (e) { showToast(e.message, 'error'); }
}

async function addToSequence(prospectId) {
  try {
    const seqData = await fetchAPI('sequences');
    const sequences = seqData.sequences || [];
    if (sequences.length === 0) { showToast('No sequences created yet. Create one in Campaigns.', 'error'); return; }
    const options = sequences.map(s => `${s.name} (${s.status})`).join('\n');
    const choice = prompt(`Select sequence (enter number):\n${sequences.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= sequences.length) { showToast('Invalid selection', 'error'); return; }
    const result = await postAPI(`sequences/${sequences[idx].id}/enroll`, { prospectId });
    if (result.id) {
      showToast(`Enrolled in "${sequences[idx].name}". First send: ${result.nextSendAt?.slice(0, 16) || 'soon'}`, 'success');
    }
  } catch (e) { showToast(e.message, 'error'); }
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
