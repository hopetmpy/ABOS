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
      <div style="display:flex; gap:8px;">
        <button class="btn" onclick="openResearchModal()">Research Prospects</button>
        <button class="btn" onclick="openPipelineModal()">LinkedIn &rarr; Email</button>
        <button class="btn" onclick="openWarmLeadsModal()">Add Warm Leads</button>
        <button class="btn" onclick="openCampaignLaunchModal()">Launch Campaign</button>
        <button class="btn btn-primary" onclick="openBulkGenerateModal()">Generate Messages</button>
      </div>
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
          ${item.status === 'sent' ? `
            <button class="btn btn-sm" style="background:var(--color-success);color:#fff" onclick="recordManualSend('${item.id}','accepted')">Accepted</button>
            <button class="btn btn-sm btn-primary" onclick="recordManualSend('${item.id}','replied')">Got Reply</button>
            <button class="btn btn-sm" onclick="recordManualSend('${item.id}','ignored')">Ignored</button>
          ` : ''}
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

// ─── Manual Send Learning ──────────────────────────────────

async function recordManualSend(id, action) {
  try {
    const result = await postAPI(`linkedin/manual-send/${id}`, { action });
    showToast(`Recorded: ${action} (DISC: ${result.discType || 'unknown'})`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.linkedin(main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Campaign Launch Modal ─────────────────────────────────

function openCampaignLaunchModal() {
  const html = `
    <div class="modal-overlay" id="campaign-launch-modal" style="display:flex" onclick="closeModal('campaign-launch-modal')">
      <div class="modal" style="max-width:500px" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Launch LinkedIn Campaign</h3><button class="modal-close" onclick="closeModal('campaign-launch-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">One goal → full autonomous pipeline: research → DISC profile → email discovery → sequence enroll → send → monitor</p>
          <div class="form-group"><label>Campaign Title *</label><input type="text" id="campaign-title" placeholder="Q2 VP Eng Outreach"></div>
          <div class="form-group"><label>ICP Job Titles * (comma-separated)</label><input type="text" id="campaign-icp-titles" placeholder="VP Engineering, CTO, Head of Engineering"></div>
          <div class="form-row">
            <div class="form-group"><label>Budget ($)</label><input type="number" id="campaign-budget" value="500"></div>
            <div class="form-group"><label>Target Count</label><input type="number" id="campaign-target" value="50"></div>
          </div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="campaign-auto-reply" checked>
            <label for="campaign-auto-reply" style="margin:0">Auto-reply to responses</label>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('campaign-launch-modal')">Cancel</button><button class="btn btn-primary" onclick="submitCampaignLaunch()">Launch Campaign</button></div>
      </div>
    </div>`;
  if (!document.getElementById('campaign-launch-modal')) { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstElementChild); }
  else document.getElementById('campaign-launch-modal').style.display = 'flex';
}

async function submitCampaignLaunch() {
  const title = document.getElementById('campaign-title').value.trim();
  const titles = document.getElementById('campaign-icp-titles').value.split(',').map(t => t.trim()).filter(Boolean);
  if (!title) { showToast('Campaign title required', 'error'); return; }
  if (titles.length === 0) { showToast('At least one ICP job title required', 'error'); return; }
  showToast('Launching campaign...', 'info');
  try {
    const result = await postAPI('linkedin/campaign/launch', {
      title,
      icp: { titles },
      budget: parseInt(document.getElementById('campaign-budget').value) || 500,
      targetCount: parseInt(document.getElementById('campaign-target').value) || 50,
      autoReply: document.getElementById('campaign-auto-reply').checked,
    });
    closeModal('campaign-launch-modal');
    showToast(`Campaign launched! Goal: ${result.goalId?.slice(0, 12) || 'created'}... Campaign: ${result.campaignId?.slice(0, 12) || 'created'}...`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.linkedin(main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Research Modal ─────────────────────────────────────────

function openResearchModal() {
  const html = `
    <div class="modal-overlay" id="research-modal" style="display:flex" onclick="closeModal('research-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Research Prospects (Apollo + Apify)</h3><button class="modal-close" onclick="closeModal('research-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">Find prospects matching your ICP. Uses Apollo for company/people search and optionally Apify for LinkedIn profile enrichment.</p>
          <div class="form-group"><label>Job Titles * (comma-separated)</label><input type="text" id="research-titles" placeholder="VP Engineering, CTO, Head of Engineering"></div>
          <div class="form-row">
            <div class="form-group"><label>Industries</label><input type="text" id="research-industries" placeholder="Healthcare, SaaS, FinTech"></div>
            <div class="form-group"><label>Location</label><input type="text" id="research-location" placeholder="US, San Francisco"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Company Size</label><input type="text" id="research-size" placeholder="50-500"></div>
            <div class="form-group"><label>Max Results</label><input type="number" id="research-limit" value="50"></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('research-modal')">Cancel</button><button class="btn btn-primary" onclick="submitResearch()">Research</button></div>
      </div>
    </div>`;
  if (!document.getElementById('research-modal')) { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstElementChild); }
  else document.getElementById('research-modal').style.display = 'flex';
}

async function submitResearch() {
  const titles = document.getElementById('research-titles').value.split(',').map(t => t.trim()).filter(Boolean);
  if (titles.length === 0) { showToast('Enter at least one job title', 'error'); return; }
  showToast('Researching prospects...', 'info');
  try {
    const result = await postAPI('linkedin/research', {
      titles,
      industries: document.getElementById('research-industries').value.split(',').map(t => t.trim()).filter(Boolean),
      location: document.getElementById('research-location').value.trim() || undefined,
      companySize: document.getElementById('research-size').value.trim() || undefined,
      limit: parseInt(document.getElementById('research-limit').value) || 50,
      useApify: true,
    });
    closeModal('research-modal');
    showToast(`Found ${result.total} prospects (${result.enriched} DISC profiled, ${result.errors} errors)`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.linkedin(main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Pipeline Modal (LinkedIn URLs → Email Campaign) ────────

function openPipelineModal() {
  const html = `
    <div class="modal-overlay" id="pipeline-modal" style="display:flex" onclick="closeModal('pipeline-modal')">
      <div class="modal" style="max-width:500px" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>LinkedIn → Email Campaign</h3><button class="modal-close" onclick="closeModal('pipeline-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">Paste LinkedIn profile URLs. The system will auto-profile (Humantic DISC), discover emails (Apollo), and launch an email campaign.</p>
          <div class="form-group"><label>LinkedIn URLs (one per line)</label><textarea id="pipeline-urls" rows="8" placeholder="https://linkedin.com/in/jane-smith&#10;https://linkedin.com/in/bob-johnson&#10;..."></textarea></div>
          <div class="form-group"><label>Campaign Name</label><input type="text" id="pipeline-name" placeholder="Auto-generated"></div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('pipeline-modal')">Cancel</button><button class="btn btn-primary" onclick="submitPipeline()">Launch Pipeline</button></div>
      </div>
    </div>`;
  if (!document.getElementById('pipeline-modal')) { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstElementChild); }
  else document.getElementById('pipeline-modal').style.display = 'flex';
}

async function submitPipeline() {
  const urls = document.getElementById('pipeline-urls').value.split('\n').map(u => u.trim()).filter(u => u.includes('linkedin.com'));
  if (urls.length === 0) { showToast('Enter at least one LinkedIn URL', 'error'); return; }
  showToast(`Processing ${urls.length} LinkedIn profiles...`, 'info');
  try {
    const result = await postAPI('linkedin/pipeline', {
      linkedinUrls: urls,
      campaignName: document.getElementById('pipeline-name').value.trim() || undefined,
    });
    closeModal('pipeline-modal');
    showToast(`Pipeline complete: ${result.processed} processed, ${result.enrolled} enrolled. Campaign: ${result.campaignId.slice(0, 12)}...`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.linkedin(main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Warm Leads Modal ───────────────────────────────────────

function openWarmLeadsModal() {
  const html = `
    <div class="modal-overlay" id="warm-modal" style="display:flex" onclick="closeModal('warm-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Add Warm LinkedIn Leads</h3><button class="modal-close" onclick="closeModal('warm-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">Paste LinkedIn URLs of people who engaged with your posts (liked, commented). They get higher priority in outreach.</p>
          <div class="form-group"><label>LinkedIn URLs (one per line)</label><textarea id="warm-urls" rows="6" placeholder="https://linkedin.com/in/prospect-who-liked-your-post"></textarea></div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('warm-modal')">Cancel</button><button class="btn btn-primary" onclick="submitWarmLeads()">Add Warm Leads</button></div>
      </div>
    </div>`;
  if (!document.getElementById('warm-modal')) { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstElementChild); }
  else document.getElementById('warm-modal').style.display = 'flex';
}

async function submitWarmLeads() {
  const urls = document.getElementById('warm-urls').value.split('\n').map(u => u.trim()).filter(u => u.includes('linkedin.com'));
  if (urls.length === 0) { showToast('Enter LinkedIn URLs', 'error'); return; }
  try {
    const result = await postAPI('linkedin/warm-leads', { linkedinUrls: urls });
    closeModal('warm-modal');
    showToast(`${result.processed} warm leads added with elevated priority`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── DISC Effectiveness + Attribution (auto-load) ───────────

(async function loadDiscAndAttribution() {
  // Wait for page to render
  await new Promise(r => setTimeout(r, 500));
  const main = document.getElementById('main-content');
  if (!main || currentPage !== 'linkedin') return;

  try {
    const [discData, attrData] = await Promise.all([
      fetchAPI('linkedin/disc-effectiveness').catch(() => ({ types: {} })),
      fetchAPI('linkedin/attribution').catch(() => ({ sources: [] })),
    ]);

    // DISC Effectiveness section
    if (Object.keys(discData.types || {}).length > 0) {
      const discEntries = Object.entries(discData.types);
      const section = document.createElement('div');
      section.className = 'section-card';
      section.style.marginTop = '16px';
      section.innerHTML = `
        <h3>DISC Effectiveness (Email Outreach)</h3>
        <p class="section-description">Which personality types respond best to your outreach</p>
        <div class="kpi-grid">
          ${discEntries.map(([type, data]) => `
            <div class="kpi-card">
              <div class="kpi-label"><span class="disc-badge disc-${type}">${type}</span> Type</div>
              <div class="kpi-value">${data.openRate}%</div>
              <div class="kpi-detail">Open rate (${data.sent} sent, ${data.replied} replied, ${data.replyRate}% reply)</div>
            </div>
          `).join('')}
        </div>
        <div style="max-width:500px;margin:16px auto 0"><canvas id="disc-effectiveness-chart" height="220"></canvas></div>
      `;
      main.appendChild(section);

      // Render Chart.js bar chart
      if (typeof Chart !== 'undefined') {
        new Chart(document.getElementById('disc-effectiveness-chart'), {
          type: 'bar',
          data: {
            labels: discEntries.map(([t]) => t + ' Type'),
            datasets: [
              { label: 'Open Rate %', data: discEntries.map(([, d]) => d.openRate), backgroundColor: 'rgba(99,102,241,0.7)' },
              { label: 'Reply Rate %', data: discEntries.map(([, d]) => d.replyRate), backgroundColor: 'rgba(16,185,129,0.7)' },
            ],
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } },
        });
      }
    }

    // Attribution section
    if (attrData.sources && attrData.sources.length > 0) {
      const section = document.createElement('div');
      section.className = 'section-card';
      section.style.marginTop = '12px';
      section.innerHTML = `
        <h3>Source Attribution</h3>
        <p class="section-description">How different lead sources compare</p>
        <div class="table-container"><table class="data-table"><thead><tr><th>Source</th><th>Prospects</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Open Rate</th><th>Reply Rate</th></tr></thead>
        <tbody>${attrData.sources.map(s => `
          <tr><td class="cell-name">${s.source}</td><td class="cell-mono">${s.count}</td><td class="cell-mono">${s.sent}</td><td class="cell-mono">${s.opened}</td><td class="cell-mono">${s.replied}</td>
          <td class="${s.openRate > 25 ? 'positive' : ''} cell-mono">${s.openRate}%</td><td class="${s.replyRate > 5 ? 'positive' : ''} cell-mono">${s.replyRate}%</td></tr>
        `).join('')}</tbody></table></div>
        <div style="max-width:600px;margin:16px auto 0"><canvas id="attribution-chart" height="200"></canvas></div>
      `;
      main.appendChild(section);

      // Render Chart.js horizontal bar chart
      if (typeof Chart !== 'undefined') {
        new Chart(document.getElementById('attribution-chart'), {
          type: 'bar',
          data: {
            labels: attrData.sources.map(s => s.source),
            datasets: [
              { label: 'Open Rate %', data: attrData.sources.map(s => s.openRate), backgroundColor: 'rgba(99,102,241,0.7)' },
              { label: 'Reply Rate %', data: attrData.sources.map(s => s.replyRate), backgroundColor: 'rgba(16,185,129,0.7)' },
            ],
          },
          options: { indexAxis: 'y', responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } },
        });
      }
    }
  } catch {}
})();
