/**
 * Agent Memory Page — 6-tab memory browser
 */

const MEMORY_TABS = [
  { id: 'focus', label: 'Current Focus', icon: '&#128161;' },
  { id: 'events', label: 'Event History', icon: '&#128197;' },
  { id: 'knowledge', label: 'Knowledge', icon: '&#128218;' },
  { id: 'skills', label: 'Learned Skills', icon: '&#9889;' },
  { id: 'contacts', label: 'Contacts', icon: '&#128101;' },
  { id: 'facts', label: 'Facts', icon: '&#128300;' },
];

let memoryTab = 'focus';
let episodicPage = 1;
let episodicClassification = '';
let episodicOutcome = '';

registerPage('memory', async (container) => {
  const overview = await fetchAPI('memory/overview');

  container.innerHTML = `
    <div class="page-header">
      <h2>Agent Memory</h2>
      <p>Everything your agent has learned and remembers</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Memories</div><div class="kpi-value">${overview.totalMemories}</div></div>
      <div class="kpi-card"><div class="kpi-label">Token Usage</div><div class="kpi-value">${(overview.totalTokens / 1000).toFixed(1)}k</div></div>
      <div class="kpi-card"><div class="kpi-label">Learned Skills</div><div class="kpi-value">${overview.counts.procedural}</div></div>
      <div class="kpi-card"><div class="kpi-label">Contacts</div><div class="kpi-value">${overview.counts.relationship}</div></div>
    </div>

    <div class="memory-tabs">
      ${MEMORY_TABS.map(t => `<button class="filter-btn ${memoryTab === t.id ? 'active' : ''}" onclick="switchMemoryTab('${t.id}', this)">${t.icon} ${t.label}</button>`).join('')}
    </div>

    <div class="section-card" id="memory-content"><div class="spinner"></div></div>
  `;

  await loadMemoryTab(memoryTab);
});

function switchMemoryTab(tab, btn) {
  memoryTab = tab;
  document.querySelectorAll('.memory-tabs .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadMemoryTab(tab);
}

async function loadMemoryTab(tab) {
  const el = document.getElementById('memory-content');
  el.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  try {
    switch (tab) {
      case 'focus': {
        const data = await fetchAPI('memory/working');
        const byType = {};
        (data.items || []).forEach(i => { if (!byType[i.content_type]) byType[i.content_type] = []; byType[i.content_type].push(i); });
        const TYPE_LABELS = { goal: 'Goals', plan: 'Plans', observation: 'Observations', decision: 'Decisions', task: 'Tasks', note: 'Notes', reflection: 'Reflections', summary: 'Summaries' };
        el.innerHTML = data.items.length === 0 ? '<div class="empty-state"><p>No active working memory. The agent populates this during its turns.</p></div>' :
          Object.entries(byType).map(([type, items]) => `
            <h4 style="margin:12px 0 8px;">${TYPE_LABELS[type] || capitalize(type)} (${items.length})</h4>
            ${items.map(i => `<div class="memory-item"><div class="memory-priority" style="background:${i.priority > 0.7 ? 'var(--success)' : i.priority > 0.4 ? 'var(--warning)' : 'var(--text-muted)'}"></div><div class="memory-text">${i.content}</div><div class="activity-time">${timeAgo(i.created_at)}</div></div>`).join('')}
          `).join('');
        break;
      }
      case 'events': {
        const data = await fetchAPI(`memory/episodic?page=${episodicPage}&limit=20${episodicClassification ? '&classification=' + episodicClassification : ''}${episodicOutcome ? '&outcome=' + episodicOutcome : ''}`);
        el.innerHTML = `
          <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
            ${['','strategic','productive','communication','maintenance','error'].map(c => `<button class="filter-btn ${episodicClassification === c ? 'active' : ''}" onclick="filterEpisodic('${c}')">${c || 'All'}</button>`).join('')}
          </div>
          ${(data.events || []).length === 0 ? '<div class="empty-state"><p>No events yet.</p></div>' :
            `<div class="activity-list-full">${data.events.map(e => `
              <div class="activity-item-full">
                <div class="activity-item-left"><div class="activity-dot ${e.outcome || 'neutral'}"></div><div class="activity-line"></div></div>
                <div class="activity-item-content">
                  <div class="activity-item-header"><span class="activity-event-type">${e.event_type}</span><span class="activity-time">${timeAgo(e.created_at)}</span></div>
                  <div class="activity-item-summary">${e.summary || ''}</div>
                  <div class="activity-item-meta">
                    ${e.outcome ? `<span class="outcome-badge outcome-${e.outcome}">${e.outcome}</span>` : ''}
                    ${e.classification ? `<span class="classification-badge">${e.classification}</span>` : ''}
                    ${e.importance > 0.7 ? '<span class="importance-badge">High Priority</span>' : ''}
                  </div>
                </div>
              </div>
            `).join('')}</div>`}
          ${data.pagination.totalPages > 1 ? `<div class="pagination"><button class="btn btn-sm" ${data.pagination.page <= 1 ? 'disabled' : ''} onclick="episodicPage=${data.pagination.page-1}; loadMemoryTab('events')">Prev</button><span class="pagination-info">Page ${data.pagination.page}/${data.pagination.totalPages}</span><button class="btn btn-sm" ${!data.pagination.hasMore ? 'disabled' : ''} onclick="episodicPage=${data.pagination.page+1}; loadMemoryTab('events')">Next</button></div>` : ''}
        `;
        break;
      }
      case 'knowledge': {
        const data = await fetchAPI('memory/overview');
        el.innerHTML = `<div class="empty-state"><p>${data.counts.knowledge} knowledge items. Browse them on the <a href="#/content" style="color:var(--accent)">Content Library</a> page.</p></div>`;
        break;
      }
      case 'skills': {
        const data = await fetchAPI('memory/procedural');
        el.innerHTML = (data.procedures || []).length === 0 ? '<div class="empty-state"><p>No learned skills yet. The agent creates these as it discovers patterns.</p></div>' :
          data.procedures.map(p => {
            const total = p.success_count + p.failure_count;
            const rate = total > 0 ? Math.round((p.success_count / total) * 100) : 0;
            let steps = []; try { steps = JSON.parse(p.steps || '[]'); } catch {}
            return `<div class="procedure-card" style="margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="procedure-name">${p.name}</div>
                <span class="procedure-rate ${rate >= 70 ? 'positive' : rate >= 40 ? 'warning' : 'danger'}">${rate}% success (${total} uses)</span>
              </div>
              <div class="procedure-desc">${p.description || ''}</div>
              ${steps.length > 0 ? `<div class="procedure-steps">${steps.map((s, i) => `<div class="procedure-step">${i+1}. ${typeof s === 'string' ? s : s.description || JSON.stringify(s)}</div>`).join('')}</div>` : ''}
              <div class="cell-muted" style="font-size:0.7rem; margin-top:4px;">Last used: ${p.last_used_at ? timeAgo(p.last_used_at) : 'Never'}</div>
            </div>`;
          }).join('');
        break;
      }
      case 'contacts': {
        const data = await fetchAPI('memory/relationships');
        el.innerHTML = (data.relationships || []).length === 0 ? '<div class="empty-state"><p>No relationships tracked yet.</p></div>' :
          data.relationships.map(r => `
            <div class="relationship-row" style="margin-bottom:6px;">
              <div class="relationship-info">
                <span class="relationship-name">${r.entity_name || r.entity_address}</span>
                <span class="relationship-notes">${r.relationship_type}${r.notes ? ' — ' + r.notes : ''}</span>
              </div>
              <div class="relationship-stats">
                <div class="trust-bar-container"><div class="trust-bar-fill ${r.trust_score >= 0.7 ? 'hot' : r.trust_score >= 0.4 ? 'warm' : 'cold-trust'}" style="width:${Math.round(r.trust_score*100)}%"></div></div>
                <span class="trust-badge ${r.trust_score >= 0.7 ? 'hot' : r.trust_score >= 0.4 ? 'warm' : 'cold-trust'}">${Math.round(r.trust_score*100)}%</span>
                <span class="relationship-interactions">${r.interaction_count} interactions</span>
              </div>
            </div>
          `).join('');
        break;
      }
      case 'facts': {
        const data = await fetchAPI('memory/semantic');
        el.innerHTML = (data.facts || []).length === 0 ? '<div class="empty-state"><p>No facts stored yet.</p></div>' : `
          <div style="display:flex; gap:6px; margin-bottom:12px;">${(data.categories || []).map(c => `<span class="report-tag">${c.category} (${c.count})</span>`).join('')}</div>
          <div class="table-container"><table class="data-table"><thead><tr><th>Category</th><th>Key</th><th>Value</th><th>Confidence</th></tr></thead><tbody>
          ${data.facts.map(f => `<tr><td><span class="stage-pill">${f.category}</span></td><td class="cell-name">${f.key}</td><td class="cell-muted">${(f.value || '').slice(0, 100)}</td><td><span class="content-confidence confidence-${f.confidence >= 0.8 ? 'high' : f.confidence >= 0.5 ? 'medium' : 'low'}">${Math.round(f.confidence * 100)}%</span></td></tr>`).join('')}
          </tbody></table></div>`;
        break;
      }
    }
  } catch (err) { el.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`; }
}

function filterEpisodic(classification) {
  episodicClassification = classification;
  episodicPage = 1;
  loadMemoryTab('events');
}
