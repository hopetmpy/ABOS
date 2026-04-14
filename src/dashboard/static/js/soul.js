/**
 * Agent Identity Page — Soul Inspector
 */

registerPage('soul', async (container) => {
  const [soulData, historyData] = await Promise.all([
    fetchAPI('soul'),
    fetchAPI('soul/history?limit=20'),
  ]);

  const s = soulData.soul;
  if (!s) {
    container.innerHTML = `<div class="page-header"><h2>Agent Identity</h2></div><div class="empty-state"><p>No identity data yet. The agent creates its SOUL.md on first run.</p></div>`;
    return;
  }

  const alignment = Math.round((soulData.alignment || 0) * 100);
  const alignClass = alignment >= 70 ? 'positive' : alignment >= 40 ? 'warning' : 'danger';

  container.innerHTML = `
    <div class="page-header">
      <h2>Agent Identity</h2>
      <p>Who your agent is and how it's evolving</p>
    </div>

    <div class="soul-hero">
      <div class="soul-hero-left">
        <div class="soul-name">${s.name || 'Automaton'}</div>
        <div class="soul-purpose">${s.corePurpose || 'No purpose defined'}</div>
        <div class="soul-meta">
          ${s.bornAt ? `<span>Born: ${new Date(s.bornAt).toLocaleDateString()}</span>` : ''}
          ${s.creator ? `<span>Creator: ${s.creator.slice(0, 8)}...</span>` : ''}
          <span>Version: v${s.version || 1}</span>
        </div>
      </div>
      <div class="soul-alignment">
        <div class="alignment-label">Mission Alignment</div>
        <div class="alignment-bar"><div class="alignment-fill ${alignClass}" style="width:${alignment}%"></div></div>
        <div class="alignment-value ${alignClass}">${alignment}%</div>
      </div>
    </div>

    <div class="memory-tabs" style="margin-top:16px;">
      <button class="filter-btn active" onclick="switchSoulTab('character', this)">Character</button>
      <button class="filter-btn" onclick="switchSoulTab('values', this)">Values & Rules</button>
      <button class="filter-btn" onclick="switchSoulTab('auto', this)">Auto-Updates</button>
      <button class="filter-btn" onclick="switchSoulTab('history', this)">Evolution History</button>
    </div>

    <div class="section-card" id="soul-content"></div>
  `;

  switchSoulTab('character', document.querySelector('.memory-tabs .filter-btn'));

  // Store data for tabs
  window._soulData = s;
  window._soulHistory = historyData.history || [];
});

function switchSoulTab(tab, btn) {
  document.querySelectorAll('.memory-tabs .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('soul-content');
  const s = window._soulData;

  switch (tab) {
    case 'character':
      el.innerHTML = `
        ${s.personality ? `<div class="soul-section"><h4>Personality</h4><blockquote class="soul-quote">${s.personality}</blockquote></div>` : ''}
        ${s.strategy ? `<div class="soul-section"><h4>Strategy</h4><p class="soul-text">${s.strategy}</p></div>` : ''}
        ${s.boundaries && s.boundaries.length > 0 ? `<div class="soul-section"><h4>Boundaries</h4><ol class="soul-list">${s.boundaries.map(b => `<li>${b}</li>`).join('')}</ol></div>` : ''}
      `;
      break;
    case 'values':
      el.innerHTML = `
        ${s.values && s.values.length > 0 ? `<div class="soul-section"><h4>Values</h4><ul class="soul-list">${s.values.map(v => `<li>&#9733; ${v}</li>`).join('')}</ul></div>` : '<div class="empty-state"><p>No values defined.</p></div>'}
      `;
      break;
    case 'auto':
      el.innerHTML = `
        <p class="section-description">These sections are automatically updated by the agent based on its behavior.</p>
        <div class="soul-section"><h4>What It Can Do (Capabilities)</h4><p class="soul-text">${s.capabilities || 'Not yet tracked'}</p></div>
        <div class="soul-section"><h4>Who It Knows (Relationships)</h4><p class="soul-text">${s.relationships || 'No relationships tracked'}</p></div>
        <div class="soul-section"><h4>Financial Behavior</h4><p class="soul-text">${s.financialCharacter || 'No financial history'}</p></div>
      `;
      break;
    case 'history':
      const history = window._soulHistory;
      el.innerHTML = history.length === 0 ? '<div class="empty-state"><p>No version history yet.</p></div>' : `
        <div class="soul-timeline">
          ${history.map(h => {
            const srcColors = { agent: '#8b5cf6', human: '#3b82f6', system: '#64748b', genesis: '#22c55e', reflection: '#f59e0b' };
            const color = srcColors[h.change_source] || '#64748b';
            return `
              <div class="soul-timeline-entry">
                <div class="soul-version">v${h.version}</div>
                <div class="soul-timeline-dot" style="background:${color}"></div>
                <div class="soul-timeline-content">
                  <span class="classification-badge" style="background:${color}20; color:${color}">${h.change_source}</span>
                  <span class="activity-time">${timeAgo(h.created_at)}</span>
                  ${h.change_reason ? `<div class="cell-muted" style="margin-top:4px;">${h.change_reason}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      break;
  }
}
