/**
 * Competitive Intelligence Page - Market intel, relationships, competitor tracking
 */

registerPage('competitive', async (container) => {
  const data = await fetchAPI('competitive');

  container.innerHTML = `
    <div class="page-header">
      <h2>Competitive Intelligence</h2>
      <p>${data.stats.totalKnowledge} knowledge items &middot; ${data.stats.staleItems} need refresh</p>
    </div>

    ${data.stats.staleItems > 0 ? `
      <div class="section-card" style="border-color: var(--warning); background: rgba(245,158,11,0.03);">
        <h3 style="color: var(--warning);">${data.stats.staleItems} items need verification</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem;">These knowledge items haven't been verified in 7+ days. The agent should refresh them.</p>
      </div>
    ` : ''}

    <div class="grid-2">
      <div class="section-card">
        <h3>Market Intelligence (${data.marketIntel.length})</h3>
        ${renderIntelCards(data.marketIntel)}
      </div>
      <div class="section-card">
        <h3>Social Intelligence (${data.socialIntel.length})</h3>
        ${renderIntelCards(data.socialIntel)}
      </div>
    </div>

    <div class="section-card">
      <h3>Relationship Network (${data.relationships.length})</h3>
      ${renderRelationshipNetwork(data.relationships)}
    </div>

    ${data.competitiveEvents.length > 0 ? `
      <div class="section-card">
        <h3>Strategic Events</h3>
        <div class="activity-list">
          ${data.competitiveEvents.map(e => `
            <div class="activity-item">
              <div class="activity-dot ${e.outcome || 'neutral'}"></div>
              <div class="activity-text">
                <strong>${e.event_type}</strong>: ${e.summary}
              </div>
              <div class="activity-time">${timeAgo(e.created_at)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
});

function renderIntelCards(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-state"><p>No intelligence gathered yet.</p></div>';
  }

  return `
    <div class="intel-list">
      ${items.map(item => {
        const isStale = (Date.now() - new Date(item.last_verified).getTime()) > 7 * 86400000;
        const confidenceClass = item.confidence >= 0.8 ? 'high' : item.confidence >= 0.5 ? 'medium' : 'low';

        return `
          <div class="intel-card ${isStale ? 'stale' : ''}">
            <div class="intel-header">
              <span class="intel-key">${item.key}</span>
              <span class="content-confidence confidence-${confidenceClass}">${Math.round(item.confidence * 100)}%</span>
            </div>
            <div class="intel-content">${item.content.length > 200 ? item.content.slice(0, 200) + '...' : item.content}</div>
            <div class="intel-footer">
              <span class="content-meta">${item.access_count} views</span>
              <span class="content-meta ${isStale ? 'stale-text' : ''}">
                ${isStale ? '&#9888; ' : ''}Verified ${timeAgo(item.last_verified)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRelationshipNetwork(relationships) {
  if (!relationships || relationships.length === 0) {
    return '<div class="empty-state"><p>No relationships tracked yet.</p></div>';
  }

  // Group by type
  const byType = {};
  relationships.forEach(r => {
    const type = r.relationship_type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(r);
  });

  return `
    <div class="relationship-groups">
      ${Object.entries(byType).map(([type, rels]) => `
        <div class="relationship-group">
          <h4 class="subsection-title">${capitalize(type)} (${rels.length})</h4>
          <div class="relationship-list">
            ${rels.map(r => {
              const trustClass = r.trust_score >= 0.7 ? 'hot' : r.trust_score >= 0.4 ? 'warm' : 'cold-trust';
              const trustPct = Math.round(r.trust_score * 100);
              return `
                <div class="relationship-row">
                  <div class="relationship-info">
                    <span class="relationship-name">${r.entity_name || r.entity_address}</span>
                    ${r.notes ? `<span class="relationship-notes">${r.notes}</span>` : ''}
                  </div>
                  <div class="relationship-stats">
                    <div class="trust-bar-container" title="Trust: ${trustPct}%">
                      <div class="trust-bar-fill ${trustClass}" style="width: ${trustPct}%"></div>
                    </div>
                    <span class="trust-badge ${trustClass}">${trustPct}%</span>
                    <span class="relationship-interactions">${r.interaction_count} interactions</span>
                    <span class="content-meta">${r.last_interaction_at ? timeAgo(r.last_interaction_at) : 'Never'}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
