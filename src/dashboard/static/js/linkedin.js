/**
 * LinkedIn Outreach Page — Personality-driven messaging queue
 */

registerPage('linkedin', async (container) => {
  const [queueData, guidesData] = await Promise.all([
    fetchAPI('linkedin/queue'),
    fetchAPI('linkedin/disc-guides'),
  ]);

  const readyCount = queueData.stats.find(s => s.status === 'ready')?.count || 0;
  const sentCount = queueData.stats.find(s => s.status === 'sent')?.count || 0;

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>LinkedIn Outreach</h2>
        <p>${readyCount} messages ready to send &middot; ${sentCount} sent</p>
      </div>
      <button class="btn btn-primary" onclick="openBulkGenerateModal()">Bulk Generate Messages</button>
    </div>

    <div class="section-card" style="margin-bottom:20px;">
      <h3>DISC Personality Guide</h3>
      <p class="section-description">Messages are personalized based on each prospect's communication style</p>
      <div class="disc-guide-grid">
        ${Object.entries(guidesData.guides).map(([key, g]) => `
          <div class="disc-card disc-${key}">
            <div class="disc-letter">${key}</div>
            <div class="disc-info">
              <strong>${g.label}</strong>
              <span class="disc-tone">${g.tone}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="campaign-filters">
      <button class="filter-btn active" onclick="filterLinkedInQueue('', this)">All (${queueData.queue.length})</button>
      <button class="filter-btn" onclick="filterLinkedInQueue('ready', this)">Ready (${readyCount})</button>
      <button class="filter-btn" onclick="filterLinkedInQueue('sent', this)">Sent (${sentCount})</button>
    </div>

    <div class="linkedin-queue" id="linkedin-queue">
      ${renderLinkedInQueue(queueData.queue)}
    </div>

    ${renderBulkGenerateModal()}
  `;
});

function renderLinkedInQueue(queue) {
  if (!queue || queue.length === 0) {
    return '<div class="empty-state"><p>No LinkedIn messages in queue. Use "Bulk Generate" or generate for individual prospects.</p></div>';
  }

  return queue.map(item => `
    <div class="linkedin-msg-card ${item.status === 'sent' ? 'msg-sent' : ''}">
      <div class="msg-header">
        <div>
          <span class="msg-name">${item.prospect_name || 'Unknown'}</span>
          <span class="msg-company">${item.company || ''} ${item.title ? '· ' + item.title : ''}</span>
        </div>
        <div class="msg-meta">
          ${item.disc_type ? `<span class="disc-badge disc-${item.disc_type}">${item.disc_type}</span>` : ''}
          <span class="stage-pill status-${item.status}">${item.status}</span>
        </div>
      </div>
      <div class="msg-body">${item.message}</div>
      ${item.personality_context ? `<div class="msg-personality">${item.personality_context}</div>` : ''}
      <div class="msg-actions">
        ${item.status === 'ready' ? `
          <button class="btn btn-primary btn-sm" onclick="copyLinkedInMsg('${item.id}', this)">Copy Message</button>
          <button class="btn btn-sm" onclick="markLinkedInSent('${item.id}')">Mark as Sent</button>
          <button class="btn btn-sm" onclick="skipLinkedInMsg('${item.id}')">Skip</button>
        ` : `
          <span class="msg-sent-at">${item.sent_at ? 'Sent ' + timeAgo(item.sent_at) : ''}</span>
        `}
        ${item.linkedin_url ? `<a href="${item.linkedin_url}" target="_blank" class="btn btn-sm">Open LinkedIn</a>` : ''}
      </div>
    </div>
  `).join('');
}

function renderBulkGenerateModal() {
  return `
    <div class="modal-overlay" id="bulk-generate-modal" style="display:none" onclick="closeModal('bulk-generate-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Bulk Generate LinkedIn Messages</h3><button class="modal-close" onclick="closeModal('bulk-generate-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group">
            <label>Target Stage</label>
            <select id="bulk-stage">
              <option value="cold">Cold</option>
              <option value="contacted">Contacted</option>
              <option value="engaged">Engaged</option>
              <option value="qualified">Qualified</option>
            </select>
          </div>
          <div class="form-group">
            <label>Value Proposition</label>
            <textarea id="bulk-value-prop" rows="2" placeholder="What value do you offer? e.g., We help teams ship 3x faster"></textarea>
          </div>
          <div class="form-group">
            <label>Social Proof</label>
            <textarea id="bulk-social-proof" rows="2" placeholder="e.g., Companies like Stripe and Notion use us"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal('bulk-generate-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="submitBulkGenerate()">Generate Messages</button>
        </div>
      </div>
    </div>
  `;
}

function openBulkGenerateModal() { document.getElementById('bulk-generate-modal').style.display = 'flex'; }

async function submitBulkGenerate() {
  const stage = document.getElementById('bulk-stage').value;
  const vp = document.getElementById('bulk-value-prop').value.trim();
  const sp = document.getElementById('bulk-social-proof').value.trim();
  try {
    const data = await postAPI('linkedin/bulk-generate', { stage, valueProposition: vp || undefined, socialProof: sp || undefined });
    closeModal('bulk-generate-modal');
    showToast(`Generated ${data.generated} LinkedIn messages`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.linkedin(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function copyLinkedInMsg(id, btn) {
  const item = document.querySelector(`.linkedin-msg-card .msg-body`);
  // Find the specific card
  const cards = document.querySelectorAll('.linkedin-msg-card');
  for (const card of cards) {
    if (card.querySelector(`[onclick*="${id}"]`)) {
      const msg = card.querySelector('.msg-body').textContent;
      await navigator.clipboard.writeText(msg);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Message'; }, 2000);
      await patchAPI(`linkedin/queue/${id}`, { status: 'copied' });
      return;
    }
  }
}

async function markLinkedInSent(id) {
  await patchAPI(`linkedin/queue/${id}`, { status: 'sent' });
  showToast('Marked as sent', 'success');
  const main = document.getElementById('main-content');
  await pageRenderers.linkedin(main);
}

async function skipLinkedInMsg(id) {
  await patchAPI(`linkedin/queue/${id}`, { status: 'skipped' });
  showToast('Skipped', 'info');
  const main = document.getElementById('main-content');
  await pageRenderers.linkedin(main);
}

async function filterLinkedInQueue(status, btn) {
  document.querySelectorAll('.campaign-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const data = await fetchAPI(`linkedin/queue${status ? '?status=' + status : ''}`);
  document.getElementById('linkedin-queue').innerHTML = renderLinkedInQueue(data.queue);
}
