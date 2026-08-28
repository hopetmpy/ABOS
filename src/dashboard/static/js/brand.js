/**
 * Brand Voice / Knowledge Base Page
 */

const BRAND_CATEGORIES = {
  company: { label: 'Company Info', icon: '&#127970;' },
  product: { label: 'Product & Features', icon: '&#128230;' },
  pricing: { label: 'Pricing', icon: '&#128176;' },
  icp: { label: 'Ideal Customer Profile', icon: '&#127919;' },
  voice: { label: 'Brand Voice & Tone', icon: '&#128227;' },
  case_study: { label: 'Case Studies', icon: '&#128200;' },
  competitor: { label: 'Competitive Positioning', icon: '&#9878;' },
  faq: { label: 'FAQ & Objections', icon: '&#10067;' },
};

registerPage('brand', async (container) => {
  const [brandData, previewData] = await Promise.all([
    fetchAPI('brand'),
    fetchAPI('brand/preview'),
  ]);

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Brand Voice & Knowledge Base</h2>
        <p>${brandData.entries.length} entries &middot; ${previewData.tokenEstimate} tokens injected into every AI prompt</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" onclick="openBrandImportModal()">Bulk Import</button>
        <button class="btn btn-primary" onclick="openAddBrandModal()">+ Add Entry</button>
      </div>
    </div>

    <div class="brand-categories">
      ${Object.entries(BRAND_CATEGORIES).map(([key, cat]) => {
        const count = brandData.categories.find(c => c.category === key)?.count || 0;
        return `
          <div class="brand-category-card ${count > 0 ? 'has-content' : 'empty-cat'}" onclick="scrollToBrandCategory('${key}')">
            <span class="brand-cat-icon">${cat.icon}</span>
            <span class="brand-cat-label">${cat.label}</span>
            <span class="brand-cat-count">${count}</span>
          </div>
        `;
      }).join('')}
    </div>

    ${Object.entries(BRAND_CATEGORIES).map(([key, cat]) => {
      const entries = brandData.entries.filter(e => e.category === key);
      return `
        <div class="section-card" id="brand-section-${key}">
          <h3>${cat.icon} ${cat.label} (${entries.length})</h3>
          ${entries.length === 0 ? `<div class="empty-state"><p>No ${cat.label.toLowerCase()} entries yet. Add one to improve AI-generated content.</p></div>` :
            entries.map(e => `
              <div class="brand-entry">
                <div class="brand-entry-header">
                  <strong>${e.title}</strong>
                  <div>
                    ${e.enabled ? '' : '<span class="stage-pill status-paused">Disabled</span>'}
                    <button class="btn btn-sm" onclick="editBrandEntry('${e.id}', ${JSON.stringify(e).replace(/'/g, "\\'").replace(/"/g, '&quot;')})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteBrandEntry('${e.id}', '${e.title.replace(/'/g, "\\'")}')">Delete</button>
                  </div>
                </div>
                <div class="brand-entry-content">${e.content}</div>
              </div>
            `).join('')}
        </div>
      `;
    }).join('')}

    <div class="section-card">
      <h3>AI Prompt Context Preview</h3>
      <p class="section-description">This is what gets injected into every AI generation call:</p>
      <pre class="brand-preview">${previewData.context || '(empty — add brand entries above)'}</pre>
      <div class="cell-muted" style="margin-top:8px;">${previewData.length} characters &middot; ~${previewData.tokenEstimate} tokens</div>
    </div>

    ${renderAddBrandModal()}
    ${renderBrandImportModal()}
    ${renderEditBrandModal()}
  `;
});

function renderAddBrandModal() {
  return `
    <div class="modal-overlay" id="add-brand-modal" style="display:none" onclick="closeModal('add-brand-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Add Brand Entry</h3><button class="modal-close" onclick="closeModal('add-brand-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Category *</label><select id="brand-add-cat">${Object.entries(BRAND_CATEGORIES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
          <div class="form-group"><label>Title *</label><input type="text" id="brand-add-title" placeholder="e.g., Company Overview, Key Feature, Pricing Tier 1"></div>
          <div class="form-group"><label>Content *</label><textarea id="brand-add-content" rows="5" placeholder="Enter the information you want the AI to know about..."></textarea></div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('add-brand-modal')">Cancel</button><button class="btn btn-primary" onclick="submitAddBrand()">Add</button></div>
      </div>
    </div>
  `;
}

function renderBrandImportModal() {
  return `
    <div class="modal-overlay" id="brand-import-modal" style="display:none" onclick="closeModal('brand-import-modal')">
      <div class="modal" style="max-width:600px" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Bulk Import Brand Content</h3><button class="modal-close" onclick="closeModal('brand-import-modal')">&times;</button></div>
        <div class="modal-body">
          <p class="section-description">Paste your website copy, pitch deck text, product documentation, or any brand content. The system will split it into entries automatically.</p>
          <div class="form-group"><label>Category</label><select id="brand-import-cat">${Object.entries(BRAND_CATEGORIES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
          <div class="form-group"><label>Content (separate entries with blank lines)</label><textarea id="brand-import-text" rows="10" placeholder="Paste your brand content here...&#10;&#10;Each paragraph separated by a blank line becomes a separate entry."></textarea></div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('brand-import-modal')">Cancel</button><button class="btn btn-primary" onclick="submitBrandImport()">Import</button></div>
      </div>
    </div>
  `;
}

function renderEditBrandModal() {
  return `
    <div class="modal-overlay" id="edit-brand-modal" style="display:none" onclick="closeModal('edit-brand-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Edit Brand Entry</h3><button class="modal-close" onclick="closeModal('edit-brand-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Title</label><input type="text" id="brand-edit-title"></div>
          <div class="form-group"><label>Content</label><textarea id="brand-edit-content" rows="5"></textarea></div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px;"><label class="toggle-switch"><input type="checkbox" id="brand-edit-enabled" checked><span class="toggle-slider"></span></label><span>Enabled (included in AI prompts)</span></div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('edit-brand-modal')">Cancel</button><button class="btn btn-primary" id="brand-edit-save-btn">Save</button></div>
      </div>
    </div>
  `;
}

function openAddBrandModal() { document.getElementById('add-brand-modal').style.display = 'flex'; }
function openBrandImportModal() { document.getElementById('brand-import-modal').style.display = 'flex'; }
function scrollToBrandCategory(cat) { document.getElementById(`brand-section-${cat}`)?.scrollIntoView({ behavior: 'smooth' }); }

async function submitAddBrand() {
  const cat = document.getElementById('brand-add-cat').value;
  const title = document.getElementById('brand-add-title').value.trim();
  const content = document.getElementById('brand-add-content').value.trim();
  if (!title || !content) { showToast('Title and content required', 'error'); return; }
  try {
    await postAPI('brand', { category: cat, title, content });
    closeModal('add-brand-modal');
    showToast('Brand entry added', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.brand(main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitBrandImport() {
  const cat = document.getElementById('brand-import-cat').value;
  const text = document.getElementById('brand-import-text').value.trim();
  if (!text) { showToast('Paste some content to import', 'error'); return; }
  try {
    const data = await postAPI('brand/import', { category: cat, text });
    closeModal('brand-import-modal');
    showToast(`Imported ${data.imported} entries`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.brand(main);
  } catch (e) { showToast(e.message, 'error'); }
}

function editBrandEntry(id, entry) {
  document.getElementById('brand-edit-title').value = entry.title;
  document.getElementById('brand-edit-content').value = entry.content;
  document.getElementById('brand-edit-enabled').checked = entry.enabled !== 0;
  document.getElementById('brand-edit-save-btn').onclick = async () => {
    try {
      await patchAPI(`brand/${id}`, {
        title: document.getElementById('brand-edit-title').value.trim(),
        content: document.getElementById('brand-edit-content').value.trim(),
        enabled: document.getElementById('brand-edit-enabled').checked ? 1 : 0,
      });
      closeModal('edit-brand-modal');
      showToast('Updated', 'success');
      const main = document.getElementById('main-content');
      await pageRenderers.brand(main);
    } catch (e) { showToast(e.message, 'error'); }
  };
  document.getElementById('edit-brand-modal').style.display = 'flex';
}

async function deleteBrandEntry(id, title) {
  if (!confirm(`Delete "${title}"?`)) return;
  try {
    const res = await fetch(`/api/brand/${id}`, { method: 'DELETE' });
    showToast('Deleted', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers.brand(main);
  } catch (e) { showToast(e.message, 'error'); }
}
