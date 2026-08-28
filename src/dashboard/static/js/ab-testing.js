/**
 * A/B Testing Page — Create tests, track variants, view analytics
 */

registerPage('ab-testing', async (container) => {
  const data = await fetchAPI('ab-tests');

  const running = data.tests.filter(t => t.status === 'running');
  const completed = data.tests.filter(t => t.status === 'completed');
  const drafts = data.tests.filter(t => t.status === 'draft');

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>A/B Testing</h2>
        <p>${running.length} running &middot; ${completed.length} completed &middot; ${drafts.length} drafts</p>
      </div>
      <button class="btn btn-primary" onclick="openCreateABTestModal()">+ New A/B Test</button>
    </div>

    ${running.length > 0 ? `
      <div class="section-card">
        <h3>Running Tests</h3>
        ${running.map(t => renderABTestCard(t)).join('')}
      </div>
    ` : ''}

    ${drafts.length > 0 ? `
      <div class="section-card">
        <h3>Draft Tests</h3>
        ${drafts.map(t => renderABTestCard(t)).join('')}
      </div>
    ` : ''}

    ${completed.length > 0 ? `
      <div class="section-card">
        <h3>Completed Tests</h3>
        ${completed.map(t => renderABTestCard(t)).join('')}
      </div>
    ` : ''}

    ${data.tests.length === 0 ? '<div class="empty-state"><p>No A/B tests yet. Create one to start optimizing your outreach.</p></div>' : ''}

    ${renderCreateABTestModal()}
  `;
});

function renderABTestCard(t) {
  const rateA = t.variant_a_sent > 0 ? ((t.variant_a_replies / t.variant_a_sent) * 100).toFixed(1) : '0.0';
  const rateB = t.variant_b_sent > 0 ? ((t.variant_b_replies / t.variant_b_sent) * 100).toFixed(1) : '0.0';
  const leader = parseFloat(rateA) > parseFloat(rateB) ? 'A' : parseFloat(rateB) > parseFloat(rateA) ? 'B' : 'Tied';
  const progress = Math.min(100, Math.round(((t.variant_a_sent + t.variant_b_sent) / (t.min_sample_size * 2)) * 100));

  return `
    <div class="ab-test-card">
      <div class="ab-test-header">
        <div>
          <span class="ab-test-name">${t.name}</span>
          <span class="stage-pill">${t.channel}</span>
          <span class="stage-pill">${t.test_field}</span>
          <span class="campaign-status-badge status-${t.status}">${t.status}</span>
        </div>
        <div>
          ${t.status === 'draft' ? `<button class="btn btn-primary btn-sm" onclick="startABTest('${t.id}')">Start Test</button>` : ''}
          ${t.winner ? `<span class="ab-winner">Winner: Variant ${t.winner}</span>` : ''}
        </div>
      </div>

      <div class="ab-variants">
        <div class="ab-variant ${leader === 'A' ? 'ab-leading' : ''} ${t.winner === 'A' ? 'ab-winner-variant' : ''}">
          <div class="ab-variant-label">Variant ${t.variant_a_label || 'A'}</div>
          <div class="ab-variant-content">${t.variant_a_content.slice(0, 100)}${t.variant_a_content.length > 100 ? '...' : ''}</div>
          <div class="ab-variant-stats">
            <span class="ab-stat">${t.variant_a_sent} sent</span>
            <span class="ab-stat">${t.variant_a_replies} replies</span>
            <span class="ab-rate ${parseFloat(rateA) >= parseFloat(rateB) ? 'positive' : ''}">${rateA}%</span>
          </div>
        </div>
        <div class="ab-vs">VS</div>
        <div class="ab-variant ${leader === 'B' ? 'ab-leading' : ''} ${t.winner === 'B' ? 'ab-winner-variant' : ''}">
          <div class="ab-variant-label">Variant ${t.variant_b_label || 'B'}</div>
          <div class="ab-variant-content">${t.variant_b_content.slice(0, 100)}${t.variant_b_content.length > 100 ? '...' : ''}</div>
          <div class="ab-variant-stats">
            <span class="ab-stat">${t.variant_b_sent} sent</span>
            <span class="ab-stat">${t.variant_b_replies} replies</span>
            <span class="ab-rate ${parseFloat(rateB) >= parseFloat(rateA) ? 'positive' : ''}">${rateB}%</span>
          </div>
        </div>
      </div>

      ${t.status === 'running' ? `
        <div class="ab-progress">
          <div class="ab-progress-bar" style="width:${progress}%"></div>
        </div>
        <div class="cell-muted" style="font-size:0.7rem; margin-top:4px;">
          ${progress}% to min sample (${t.min_sample_size}/variant) &middot; Auto-declares after ${t.auto_declare_after_hours}h
          ${t.started_at ? ` &middot; Started ${timeAgo(t.started_at)}` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function renderCreateABTestModal() {
  return `
    <div class="modal-overlay" id="create-ab-modal" style="display:none" onclick="closeModal('create-ab-modal')">
      <div class="modal" style="max-width:600px" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>New A/B Test</h3><button class="modal-close" onclick="closeModal('create-ab-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Test Name *</label><input type="text" id="ab-name" placeholder="e.g., Email Subject Test - Q2 SaaS"></div>
          <div class="form-row">
            <div class="form-group"><label>Channel *</label><select id="ab-channel"><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="whatsapp">WhatsApp</option></select></div>
            <div class="form-group"><label>What to Test *</label><select id="ab-field"><option value="subject">Subject Line</option><option value="body">Body Copy</option><option value="full_message">Full Message</option></select></div>
          </div>
          <div class="form-group"><label>Variant A *</label><textarea id="ab-variant-a" rows="3" placeholder="Enter the first version of your content"></textarea></div>
          <div class="form-group">
            <label>Variant B * <button class="btn-link" onclick="aiGenerateVariantB()" style="font-size:0.75rem;">Generate with AI</button></label>
            <textarea id="ab-variant-b" rows="3" placeholder="Enter the second version (or click 'Generate with AI')"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Min Sample Size (per variant)</label><input type="number" id="ab-sample" value="200"></div>
            <div class="form-group"><label>Auto-declare after (hours)</label><input type="number" id="ab-hours" value="48"></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" onclick="closeModal('create-ab-modal')">Cancel</button><button class="btn btn-primary" onclick="submitCreateABTest()">Create Test</button></div>
      </div>
    </div>
  `;
}

function openCreateABTestModal() { document.getElementById('create-ab-modal').style.display = 'flex'; }

async function submitCreateABTest() {
  const name = document.getElementById('ab-name').value.trim();
  const varA = document.getElementById('ab-variant-a').value.trim();
  const varB = document.getElementById('ab-variant-b').value.trim();
  if (!name || !varA || !varB) { showToast('Name and both variants required', 'error'); return; }

  try {
    await postAPI('ab-tests', {
      name,
      channel: document.getElementById('ab-channel').value,
      testField: document.getElementById('ab-field').value,
      variantAContent: varA,
      variantBContent: varB,
      minSampleSize: parseInt(document.getElementById('ab-sample').value) || 200,
      autoDeclareAfterHours: parseInt(document.getElementById('ab-hours').value) || 48,
    });
    closeModal('create-ab-modal');
    showToast('A/B test created', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['ab-testing'](main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function startABTest(id) {
  try {
    await postAPI(`ab-tests/${id}/start`, {});
    showToast('Test started!', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['ab-testing'](main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function aiGenerateVariantB() {
  const varA = document.getElementById('ab-variant-a').value.trim();
  if (!varA) { showToast('Write Variant A first, then generate B', 'error'); return; }
  try {
    const result = await postAPI('ai/generate', {
      contentType: 'custom',
      customPrompt: `Rewrite the following content to be meaningfully different for A/B testing. Keep the same goal but change the approach, tone, or angle.\n\nOriginal:\n${varA}\n\nGenerate a different version:`,
    });
    document.getElementById('ab-variant-b').value = result.output;
    showToast('Variant B generated by AI', 'success');
  } catch (e) { showToast(e.message || 'AI generation failed. Connect an AI provider first.', 'error'); }
}
