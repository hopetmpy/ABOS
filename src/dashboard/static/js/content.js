/**
 * Content Library - Knowledge store and procedural memory browser
 */

const CONTENT_CATEGORY_LABELS = {
  market: 'Market Intel', technical: 'Technical', social: 'Social',
  financial: 'Financial', operational: 'Operational',
};
const CONTENT_CATEGORY_COLORS = {
  market: '#f59e0b', technical: '#3b82f6', social: '#ec4899',
  financial: '#22c55e', operational: '#64748b',
};

let contentFilter = '';
let contentSearch = '';
let contentPage = 1;

registerPage('content', async (container) => {
  contentFilter = '';
  contentSearch = '';
  contentPage = 1;
  await renderContentPage(container);
});

async function renderContentPage(container) {
  const params = new URLSearchParams();
  if (contentSearch) params.set('search', contentSearch);
  if (contentFilter) params.set('category', contentFilter);
  params.set('page', String(contentPage));
  params.set('limit', '20');

  const data = await fetchAPI(`content?${params}`);

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Content Library</h2>
        <p>Knowledge base, market intel, and learned strategies</p>
      </div>
      <button class="btn btn-primary" onclick="openAddContentModal()">+ Add Content</button>
    </div>

    <div class="content-toolbar">
      <div class="search-box">
        <input type="text" id="content-search" placeholder="Search content..."
               value="${contentSearch}" oninput="debounceContentSearch(this.value)">
      </div>
      <div class="content-category-filters">
        <button class="filter-btn ${contentFilter === '' ? 'active' : ''}" onclick="setContentFilter('', this)">All (${data.pagination.total})</button>
        ${data.categories.map(c => `
          <button class="filter-btn ${contentFilter === c.category ? 'active' : ''}"
                  onclick="setContentFilter('${c.category}', this)">
            ${CONTENT_CATEGORY_LABELS[c.category] || capitalize(c.category)} (${c.count})
          </button>
        `).join('')}
      </div>
    </div>

    ${data.procedures && data.procedures.length > 0 ? `
      <div class="section-card" style="margin-bottom:20px;">
        <h3>Learned Strategies (${data.procedures.length})</h3>
        <div class="procedures-grid">
          ${data.procedures.map(p => renderProcedureCard(p)).join('')}
        </div>
      </div>
    ` : ''}

    <div class="content-grid" id="content-items">
      ${renderContentItems(data.items)}
    </div>

    <div id="content-pagination">
      ${renderContentPagination(data.pagination)}
    </div>

    ${renderAddContentModal()}
    ${renderContentDetailModal()}
  `;
}

function renderContentItems(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-state"><p>No content found. The agent will populate this as it works.</p></div>';
  }

  return items.map(item => {
    const catColor = CONTENT_CATEGORY_COLORS[item.category] || '#64748b';
    const confidenceClass = item.confidence >= 0.8 ? 'high' : item.confidence >= 0.5 ? 'medium' : 'low';

    return `
      <div class="content-card" onclick="openContentDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
        <div class="content-card-header">
          <span class="content-category" style="background:${catColor}20; color:${catColor}">
            ${CONTENT_CATEGORY_LABELS[item.category] || item.category}
          </span>
          <span class="content-confidence confidence-${confidenceClass}" title="Confidence: ${Math.round(item.confidence * 100)}%">
            ${Math.round(item.confidence * 100)}%
          </span>
        </div>
        <div class="content-key">${item.key}</div>
        <div class="content-preview">${truncateContent(item.content, 120)}</div>
        <div class="content-card-footer">
          <span class="content-meta">${timeAgo(item.created_at)}</span>
          <span class="content-meta">${item.access_count} views</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderProcedureCard(p) {
  const total = p.success_count + p.failure_count;
  const successRate = total > 0 ? Math.round((p.success_count / total) * 100) : 0;
  const rateClass = successRate >= 70 ? 'positive' : successRate >= 40 ? 'warning' : 'danger';
  let steps = [];
  try { steps = JSON.parse(p.steps || '[]'); } catch { steps = []; }

  return `
    <div class="procedure-card">
      <div class="procedure-name">${p.name}</div>
      <div class="procedure-desc">${p.description || ''}</div>
      <div class="procedure-stats">
        <span class="procedure-rate ${rateClass}">${successRate}% success</span>
        <span class="procedure-count">${total} uses</span>
        ${p.last_used_at ? `<span class="content-meta">${timeAgo(p.last_used_at)}</span>` : ''}
      </div>
      ${steps.length > 0 ? `
        <div class="procedure-steps">
          ${steps.slice(0, 3).map((s, i) => `<div class="procedure-step">${i + 1}. ${typeof s === 'string' ? s : s.description || JSON.stringify(s)}</div>`).join('')}
          ${steps.length > 3 ? `<div class="procedure-step" style="color:var(--text-muted)">+ ${steps.length - 3} more steps</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function renderContentPagination(pagination) {
  if (pagination.totalPages <= 1) return '';
  return `
    <div class="pagination">
      <button class="btn btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="changeContentPage(${pagination.page - 1})">Previous</button>
      <span class="pagination-info">Page ${pagination.page} of ${pagination.totalPages}</span>
      <button class="btn btn-sm" ${!pagination.hasMore ? 'disabled' : ''} onclick="changeContentPage(${pagination.page + 1})">Next</button>
    </div>
  `;
}

function renderAddContentModal() {
  return `
    <div class="modal-overlay" id="add-content-modal" style="display:none" onclick="closeModal('add-content-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add Content</h3>
          <button class="modal-close" onclick="closeModal('add-content-modal')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>Category *</label>
              <select id="new-content-category">
                <option value="market">Market Intel</option>
                <option value="technical">Technical</option>
                <option value="social">Social</option>
                <option value="financial">Financial</option>
                <option value="operational">Operational</option>
              </select>
            </div>
            <div class="form-group">
              <label>Title/Key *</label>
              <input type="text" id="new-content-key" placeholder="Competitor X pricing update">
            </div>
          </div>
          <div class="form-group">
            <label>Content *</label>
            <textarea id="new-content-body" rows="6" placeholder="Detailed content, notes, intel..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal('add-content-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="submitAddContent()">Add</button>
        </div>
      </div>
    </div>
  `;
}

function renderContentDetailModal() {
  return `
    <div class="modal-overlay" id="content-detail-modal" style="display:none" onclick="closeModal('content-detail-modal')">
      <div class="modal" style="max-width:600px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="content-detail-title">Content</h3>
          <button class="modal-close" onclick="closeModal('content-detail-modal')">&times;</button>
        </div>
        <div class="modal-body" id="content-detail-body"></div>
      </div>
    </div>
  `;
}

// ─── Interactions ───────────────────────────────────────────────

let contentSearchTimeout = null;
function debounceContentSearch(value) {
  clearTimeout(contentSearchTimeout);
  contentSearchTimeout = setTimeout(() => {
    contentSearch = value;
    contentPage = 1;
    refreshContent();
  }, 300);
}

function setContentFilter(category, btn) {
  contentFilter = category;
  contentPage = 1;
  document.querySelectorAll('.content-category-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  refreshContent();
}

function changeContentPage(page) {
  contentPage = page;
  refreshContent();
}

async function refreshContent() {
  const main = document.getElementById('main-content');
  await renderContentPage(main);
}

function openAddContentModal() {
  document.getElementById('add-content-modal').style.display = 'flex';
}

async function submitAddContent() {
  const key = document.getElementById('new-content-key').value.trim();
  const content = document.getElementById('new-content-body').value.trim();
  if (!key || !content) {
    showToast('Title and content are required', 'error');
    return;
  }

  try {
    await postAPI('content', {
      category: document.getElementById('new-content-category').value,
      key,
      content,
    });
    closeModal('add-content-modal');
    showToast('Content added', 'success');
    refreshContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openContentDetail(item) {
  const catColor = CONTENT_CATEGORY_COLORS[item.category] || '#64748b';
  document.getElementById('content-detail-title').textContent = item.key;
  document.getElementById('content-detail-body').innerHTML = `
    <div style="margin-bottom:12px;">
      <span class="content-category" style="background:${catColor}20; color:${catColor}">${CONTENT_CATEGORY_LABELS[item.category] || item.category}</span>
      <span class="content-confidence confidence-${item.confidence >= 0.8 ? 'high' : item.confidence >= 0.5 ? 'medium' : 'low'}">${Math.round(item.confidence * 100)}% confidence</span>
    </div>
    <div class="content-full-text">${item.content}</div>
    <div class="detail-grid" style="margin-top:16px;">
      <div class="detail-item"><span class="detail-label">Source</span><span class="detail-value">${item.source || '--'}</span></div>
      <div class="detail-item"><span class="detail-label">Views</span><span class="detail-value">${item.access_count}</span></div>
      <div class="detail-item"><span class="detail-label">Created</span><span class="detail-value">${timeAgo(item.created_at)}</span></div>
      <div class="detail-item"><span class="detail-label">Last Verified</span><span class="detail-value">${timeAgo(item.last_verified)}</span></div>
    </div>
  `;
  document.getElementById('content-detail-modal').style.display = 'flex';
}

function truncateContent(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}
