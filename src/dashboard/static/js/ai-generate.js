/**
 * AI Content Generation Page — Hybrid prompt (structured + freeform)
 */

registerPage('ai-generate', async (container) => {
  const [providersData, historyData] = await Promise.all([
    fetchAPI('ai/providers'),
    fetchAPI('ai/history?limit=10'),
  ]);

  const hasProviders = providersData.providers.filter(p => p.enabled).length > 0;

  container.innerHTML = `
    <div class="page-header">
      <h2>AI Content Generator</h2>
      <p>Generate personalized content for email, LinkedIn, social, and more</p>
    </div>

    ${!hasProviders ? `
      <div class="section-card" style="border-color:var(--warning); background:rgba(245,158,11,0.03); margin-bottom:20px;">
        <h3 style="color:var(--warning);">No AI Provider Connected</h3>
        <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:12px;">Add an API key to start generating content.</p>
        <div class="form-row">
          <select id="quick-provider"><option value="openai">OpenAI</option><option value="anthropic">Claude</option><option value="google">Gemini</option><option value="xai">Grok</option></select>
          <input type="password" id="quick-api-key" placeholder="Paste API key here" style="flex:2">
          <button class="btn btn-primary" onclick="quickAddProvider()">Connect</button>
        </div>
      </div>
    ` : ''}

    <div class="grid-2">
      <div class="section-card">
        <h3>Generate Content</h3>
        <div class="form-group">
          <label>Content Type *</label>
          <select id="gen-type">
            <option value="email_subject">Email Subject Line</option>
            <option value="email_body" selected>Email Body</option>
            <option value="linkedin_message">LinkedIn Message</option>
            <option value="whatsapp_message">WhatsApp Message</option>
            <option value="social_post">Social Media Post</option>
            <option value="ad_copy">Ad Copy</option>
            <option value="landing_page">Landing Page Copy</option>
            <option value="blog_outline">Blog Outline</option>
            <option value="image">Image (DALL-E / Grok)</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Channel</label>
            <select id="gen-channel"><option value="">Auto</option><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="whatsapp">WhatsApp</option><option value="social">Social</option><option value="web">Website</option></select>
          </div>
          <div class="form-group">
            <label>Tone</label>
            <select id="gen-tone"><option value="">Default</option><option value="professional">Professional</option><option value="casual">Casual</option><option value="friendly">Friendly</option><option value="urgent">Urgent</option><option value="formal">Formal</option><option value="witty">Witty</option></select>
          </div>
          <div class="form-group">
            <label>Length</label>
            <select id="gen-length"><option value="">Default</option><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>AI Provider</label>
            <select id="gen-provider"><option value="">Default</option>${providersData.providers.filter(p=>p.enabled).map(p=>`<option value="${p.provider}">${capitalize(p.provider)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>For Prospect (optional)</label>
            <input type="text" id="gen-prospect-id" placeholder="Prospect ID (auto-injects personality)">
          </div>
        </div>
        <div class="form-group">
          <label>Prompt / Instructions *</label>
          <textarea id="gen-prompt" rows="4" placeholder="Describe what you want to generate. Be specific about the audience, goal, and key messages.&#10;&#10;Example: Write a cold email to a VP of Engineering at a Series B SaaS company. Focus on how we reduce deployment time by 60%. Include a soft CTA for a 15-minute call."></textarea>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="submitGenerate()" id="gen-submit-btn">Generate Content</button>
      </div>

      <div class="section-card">
        <h3>Output</h3>
        <div id="gen-output" class="gen-output-area">
          <div class="empty-state"><p>Generated content will appear here</p></div>
        </div>
      </div>
    </div>

    <div class="section-card">
      <h3>Generation History</h3>
      ${historyData.items.length === 0 ? '<div class="empty-state"><p>No content generated yet.</p></div>' :
        `<div class="history-list">${historyData.items.map(h => `
          <div class="history-item">
            <div class="activity-dot success"></div>
            <div class="history-content">
              <div class="history-task"><span class="stage-pill">${h.content_type}</span> via ${h.provider}/${h.model}</div>
              <div class="history-meta">${h.output.slice(0, 100)}... ${h.brand_context_used ? '<span class="stage-pill status-active">Brand</span>' : ''} ${h.disc_type ? `<span class="disc-badge disc-${h.disc_type}">${h.disc_type}</span>` : ''}</div>
            </div>
            <div class="activity-time">${timeAgo(h.created_at)}</div>
          </div>
        `).join('')}</div>`}
    </div>

    <div class="section-card">
      <h3>Connected Providers</h3>
      ${providersData.providers.length === 0 ? '<div class="empty-state"><p>No providers configured.</p></div>' :
        providersData.providers.map(p => `
          <div class="setting-row">
            <span class="setting-label">${capitalize(p.provider)}</span>
            <span class="setting-value"><span class="health-badge health-${p.enabled ? 'healthy' : 'disabled'}">${p.enabled ? 'Active' : 'Disabled'}</span> <span class="mono">${p.api_key}</span></span>
          </div>
        `).join('')}
    </div>
  `;
});

async function quickAddProvider() {
  const provider = document.getElementById('quick-provider').value;
  const apiKey = document.getElementById('quick-api-key').value.trim();
  if (!apiKey) { showToast('Enter an API key', 'error'); return; }
  try {
    await postAPI('ai/providers', { provider, apiKey });
    showToast(`${capitalize(provider)} connected!`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['ai-generate'](main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitGenerate() {
  const btn = document.getElementById('gen-submit-btn');
  btn.textContent = 'Generating...';
  btn.disabled = true;

  const payload = {
    contentType: document.getElementById('gen-type').value,
    channel: document.getElementById('gen-channel').value || undefined,
    tone: document.getElementById('gen-tone').value || undefined,
    length: document.getElementById('gen-length').value || undefined,
    provider: document.getElementById('gen-provider').value || undefined,
    prospectId: document.getElementById('gen-prospect-id').value.trim() || undefined,
    customPrompt: document.getElementById('gen-prompt').value.trim(),
  };

  if (payload.contentType === 'image') payload.imagePrompt = payload.customPrompt;

  try {
    const result = await postAPI('ai/generate', payload);
    const outputDiv = document.getElementById('gen-output');

    if (payload.contentType === 'image') {
      outputDiv.innerHTML = `
        <img src="${result.output}" alt="Generated image" style="max-width:100%; border-radius:var(--radius);">
        <div class="gen-meta">Provider: ${result.provider} | Model: ${result.model} ${result.brandContextUsed ? '| Brand context: Yes' : ''}</div>
      `;
    } else {
      outputDiv.innerHTML = `
        <div class="gen-text">${result.output.replace(/\n/g, '<br>')}</div>
        <div class="gen-meta">Provider: ${result.provider} | Model: ${result.model} ${result.brandContextUsed ? '| Brand context injected' : ''} ${result.discType ? `| DISC: ${result.discType}` : ''}</div>
        <div class="gen-actions">
          <button class="btn btn-sm" onclick="copyGenerated()">Copy</button>
          <button class="btn btn-sm" onclick="saveAsTemplate('${result.id}')">Save as Template</button>
        </div>
      `;
    }
  } catch (e) {
    document.getElementById('gen-output').innerHTML = `<div class="empty-state" style="color:var(--danger)"><p>${e.message}</p></div>`;
  }

  btn.textContent = 'Generate Content';
  btn.disabled = false;
}

async function copyGenerated() {
  const text = document.querySelector('.gen-text')?.textContent;
  if (text) { await navigator.clipboard.writeText(text); showToast('Copied!', 'success'); }
}

async function saveAsTemplate(id) {
  try {
    await postAPI(`ai/history/${id}/save`, {});
    showToast('Saved as template', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}
