/**
 * Email Settings Page — SMTP accounts, send queue, deliverability
 */

registerPage('email-settings', async (container) => {
  const [accountsData, presetsData, queueData, delivData] = await Promise.all([
    fetchAPI('email/accounts'),
    fetchAPI('email/presets'),
    fetchAPI('email/queue'),
    fetchAPI('deliverability'),
  ]);

  const rates = delivData.rates || {};

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Email Settings</h2>
        <p>${accountsData.accounts.length} accounts connected</p>
      </div>
      <button class="btn btn-primary" onclick="openAddEmailAccountModal()">+ Connect Email Account</button>
    </div>

    <div class="kpi-grid" style="margin-bottom:20px;">
      <div class="kpi-card"><div class="kpi-label">Delivery Rate</div><div class="kpi-value positive">${rates.deliveryRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Bounce Rate</div><div class="kpi-value ${parseFloat(rates.bounceRate||0) > 5 ? 'danger' : ''}">${rates.bounceRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Open Rate</div><div class="kpi-value">${rates.openRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Complaint Rate</div><div class="kpi-value ${parseFloat(rates.complaintRate||0) > 0.1 ? 'danger' : ''}">${rates.complaintRate || 0}%</div></div>
    </div>

    <div class="grid-2">
      <div class="section-card">
        <h3>Connected Accounts</h3>
        ${accountsData.accounts.length === 0 ? '<div class="empty-state"><p>No email accounts connected yet.</p></div>' :
          accountsData.accounts.map(a => `
            <div class="email-account-row">
              <div class="email-account-info">
                <span class="email-account-name">${a.name}</span>
                <span class="email-account-addr">${a.email_address}</span>
                <span class="cell-muted">${a.smtp_host}:${a.smtp_port}</span>
              </div>
              <div class="email-account-meta">
                <span class="health-badge health-${a.status === 'active' ? 'healthy' : 'failed'}">${a.status}</span>
                <span class="cell-muted">${a.sent_today}/${a.daily_limit} today</span>
                ${a.is_default ? '<span class="stage-pill status-active">Default</span>' : ''}
              </div>
            </div>
          `).join('')}
      </div>

      <div class="section-card">
        <h3>Send Queue</h3>
        ${queueData.queue.length === 0 ? '<div class="empty-state"><p>No emails in queue.</p></div>' :
          queueData.queue.slice(0, 10).map(q => `
            <div class="history-item">
              <div class="activity-dot ${q.status === 'sent' ? 'success' : q.status === 'failed' ? 'failure' : 'neutral'}"></div>
              <div class="history-content">
                <div class="history-task">${q.to_email} — ${q.subject.slice(0, 40)}</div>
                <div class="history-meta"><span class="outcome-badge outcome-${q.status === 'sent' ? 'success' : q.status === 'failed' ? 'failure' : 'neutral'}">${q.status}</span> ${timeAgo(q.created_at)}</div>
              </div>
            </div>
          `).join('')}
        ${queueData.stats.length > 0 ? `<div style="margin-top:8px; font-size:0.75rem; color:var(--text-muted)">Stats: ${queueData.stats.map(s => `${s.status}: ${s.count}`).join(', ')}</div>` : ''}
      </div>
    </div>

    <div class="section-card">
      <h3>Recent Email Events</h3>
      ${delivData.recent.length === 0 ? '<div class="empty-state"><p>No email events yet.</p></div>' :
        `<div class="history-list">${delivData.recent.slice(0, 15).map(e => `
          <div class="history-item">
            <div class="activity-dot ${e.event_type === 'sent' || e.event_type === 'delivered' ? 'success' : e.event_type === 'bounced' || e.event_type === 'complained' ? 'failure' : 'neutral'}"></div>
            <div class="history-content">
              <div class="history-task"><span class="outcome-badge outcome-${e.event_type === 'opened' || e.event_type === 'clicked' ? 'partial' : e.event_type === 'bounced' ? 'failure' : 'success'}">${e.event_type}</span></div>
              <div class="history-meta">${timeAgo(e.created_at)}</div>
            </div>
          </div>
        `).join('')}</div>`}
    </div>

    <div class="section-card">
      <h3>SMTP Provider Presets</h3>
      <p class="section-description">Quick setup guides for popular email providers</p>
      <div class="procedures-grid">
        ${Object.entries(presetsData.presets).map(([name, p]) => `
          <div class="procedure-card">
            <div class="procedure-name">${capitalize(name)}</div>
            <div class="procedure-desc">${p.host}:${p.port} (${p.secure ? 'SSL' : 'TLS'})</div>
            <div class="procedure-steps"><div class="procedure-step">${p.notes}</div></div>
          </div>
        `).join('')}
      </div>
    </div>

    ${renderAddEmailAccountModal(presetsData.presets)}
  `;
});

function renderAddEmailAccountModal(presets) {
  return `
    <div class="modal-overlay" id="add-email-modal" style="display:none" onclick="closeModal('add-email-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Connect Email Account</h3><button class="modal-close" onclick="closeModal('add-email-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group">
            <label>Provider Preset</label>
            <select id="email-preset" onchange="applyEmailPreset(this.value)">
              <option value="">Custom SMTP</option>
              ${Object.keys(presets).map(p => `<option value="${p}">${capitalize(p)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Account Name *</label><input type="text" id="email-name" placeholder="My Gmail"></div>
          <div class="form-group"><label>Email Address *</label><input type="email" id="email-address" placeholder="you@gmail.com"></div>
          <div class="form-row">
            <div class="form-group"><label>SMTP Host *</label><input type="text" id="email-host" placeholder="smtp.gmail.com"></div>
            <div class="form-group"><label>Port</label><input type="number" id="email-port" value="587"></div>
          </div>
          <div class="form-group"><label>SMTP Username *</label><input type="text" id="email-user" placeholder="you@gmail.com"></div>
          <div class="form-group"><label>SMTP Password *</label><input type="password" id="email-pass" placeholder="App password or API key"></div>
          <div class="form-row">
            <div class="form-group"><label>Daily Limit</label><input type="number" id="email-limit" value="50"></div>
            <div class="form-group" style="display:flex; align-items:end; gap:8px;"><label class="toggle-switch"><input type="checkbox" id="email-secure"><span class="toggle-slider"></span></label><span>Use SSL</span></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal('add-email-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="submitAddEmailAccount()">Test & Connect</button>
        </div>
      </div>
    </div>
  `;
}

function openAddEmailAccountModal() { document.getElementById('add-email-modal').style.display = 'flex'; }

function applyEmailPreset(preset) {
  const presets = { gmail: ['smtp.gmail.com',587,false], outlook: ['smtp-mail.outlook.com',587,false], yahoo: ['smtp.mail.yahoo.com',465,true], zoho: ['smtp.zoho.com',465,true], sendgrid: ['smtp.sendgrid.net',587,false], resend: ['smtp.resend.com',465,true] };
  const p = presets[preset];
  if (p) {
    document.getElementById('email-host').value = p[0];
    document.getElementById('email-port').value = p[1];
    document.getElementById('email-secure').checked = p[2];
  }
}

async function submitAddEmailAccount() {
  const name = document.getElementById('email-name').value.trim();
  const email = document.getElementById('email-address').value.trim();
  const host = document.getElementById('email-host').value.trim();
  const user = document.getElementById('email-user').value.trim();
  const pass = document.getElementById('email-pass').value;
  if (!name || !email || !host || !user || !pass) { showToast('Fill in all required fields', 'error'); return; }

  showToast('Testing SMTP connection...', 'info');
  try {
    await postAPI('email/accounts', {
      name, emailAddress: email, smtpHost: host,
      smtpPort: parseInt(document.getElementById('email-port').value) || 587,
      smtpSecure: document.getElementById('email-secure').checked,
      smtpUser: user, smtpPass: pass,
      dailyLimit: parseInt(document.getElementById('email-limit').value) || 50,
    });
    closeModal('add-email-modal');
    showToast('Email account connected!', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['email-settings'](main);
  } catch (e) { showToast(e.message, 'error'); }
}
