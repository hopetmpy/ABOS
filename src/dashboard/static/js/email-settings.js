/**
 * Email Settings Page — SMTP accounts, deliverability infrastructure, warm-up, suppressions
 */

registerPage('email-settings', async (container) => {
  const [accountsData, presetsData, queueData, delivData, rotationData, reputationData, warmupData, suppressionData, placementData] = await Promise.all([
    fetchAPI('email/accounts'),
    fetchAPI('email/presets'),
    fetchAPI('email/queue'),
    fetchAPI('deliverability'),
    fetchAPI('email/domain-rotation').catch(() => ({ accounts: [], nextSendingAccount: null })),
    fetchAPI('email/reputation').catch(() => ({ domains: [] })),
    fetchAPI('email/warmup').catch(() => ({ schedules: [] })),
    fetchAPI('email/suppressions').catch(() => ({ suppressions: [], counts: [], total: 0 })),
    fetchAPI('email/placement').catch(() => ({ byDomain: [], total: 0 })),
  ]);

  const rates = delivData.rates || {};

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Email Settings & Deliverability</h2>
        <p>${accountsData.accounts.length} accounts &middot; ${suppressionData.total} suppressed &middot; ${placementData.total} tracked sends</p>
      </div>
      <button class="btn btn-primary" onclick="openAddEmailAccountModal()">+ Connect Email Account</button>
    </div>

    <!-- KPI Row: Core Metrics -->
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="kpi-label">Delivery Rate</div><div class="kpi-value positive">${rates.deliveryRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Bounce Rate</div><div class="kpi-value ${parseFloat(rates.bounceRate||0) > 5 ? 'danger' : ''}">${rates.bounceRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Open Rate</div><div class="kpi-value">${rates.openRate || 0}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Complaint Rate</div><div class="kpi-value ${parseFloat(rates.complaintRate||0) > 0.1 ? 'danger' : ''}">${rates.complaintRate || 0}%</div></div>
    </div>

    <!-- Reputation Scores -->
    ${reputationData.domains.length > 0 ? `
      <div class="section-card">
        <h3>Sending Reputation by Domain</h3>
        <div class="reputation-grid">
          ${reputationData.domains.map(r => `
            <div class="reputation-card reputation-${r.grade}">
              <div class="reputation-domain">${r.domain}</div>
              <div class="reputation-score">${r.score}<span class="reputation-max">/100</span></div>
              <div class="reputation-grade">${r.grade.toUpperCase()}</div>
              <div class="reputation-details">
                <span>Sent: ${r.totalSent}</span>
                <span>Bounce: ${r.bounceRate}%</span>
                <span>Open: ${r.openRate}%</span>
                <span>Suppressed: ${r.suppressedCount}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="grid-2">
      <!-- Connected Accounts + Domain Rotation -->
      <div class="section-card">
        <h3>Connected Accounts (Domain Rotation)</h3>
        <p class="section-description">Emails are distributed round-robin across accounts. Least-used account sends next.</p>
        ${rotationData.accounts.length === 0 ? '<div class="empty-state"><p>No email accounts connected yet.</p></div>' :
          rotationData.accounts.map(a => `
            <div class="email-account-row">
              <div class="email-account-info">
                <span class="email-account-name">${a.name}</span>
                <span class="email-account-addr">${a.email_address}</span>
              </div>
              <div class="email-account-meta">
                <div class="utilization-bar" title="${a.utilization}% of daily limit used">
                  <div class="utilization-fill ${a.utilization > 80 ? 'danger' : a.utilization > 50 ? 'warning' : 'positive'}" style="width:${a.utilization}%"></div>
                </div>
                <span class="cell-mono">${a.sent_today}/${a.daily_limit}</span>
                <span class="health-badge health-${a.status === 'active' ? 'healthy' : 'failed'}">${a.status}</span>
              </div>
            </div>
          `).join('')}
        ${rotationData.nextSendingAccount ? `<div class="cell-muted" style="margin-top:8px; font-size:0.75rem;">Next send from: <strong>${rotationData.nextSendingAccount.email}</strong></div>` : ''}
      </div>

      <!-- Warm-Up Status -->
      <div class="section-card">
        <h3>Warm-Up Status</h3>
        <p class="section-description">New accounts ramp up gradually: 5→10→15→25→35→50 emails/day over 14 days.</p>
        ${warmupData.schedules.length === 0 ? '<div class="empty-state"><p>No active warm-up schedules. Connect an account to start warm-up.</p></div>' :
          warmupData.schedules.map(s => `
            <div class="warmup-row">
              <div class="warmup-info">
                <span class="warmup-account">${s.account_name || s.account_id}</span>
                <span class="cell-muted">${s.email_address || ''}</span>
              </div>
              <div class="warmup-progress">
                <div class="warmup-bar"><div class="warmup-fill" style="width:${Math.min(100, (s.current_day / 14) * 100)}%"></div></div>
                <span class="warmup-day">Day ${s.current_day}/14</span>
                <span class="campaign-status-badge status-${s.status === 'completed' ? 'completed' : s.status === 'active' ? 'active' : 'paused'}">${s.status}</span>
              </div>
            </div>
          `).join('')}
      </div>
    </div>

    <!-- Deliverability Tools -->
    <div class="section-card">
      <h3>Deliverability Tools</h3>
      <div class="deliv-tools-grid">
        <div class="deliv-tool-card" onclick="openDnsAuthCheck()">
          <span class="deliv-tool-icon">&#128274;</span>
          <strong>DNS Auth Check</strong>
          <p>Verify SPF, DKIM, DMARC records for your sending domain</p>
        </div>
        <div class="deliv-tool-card" onclick="openBlacklistCheck()">
          <span class="deliv-tool-icon">&#128683;</span>
          <strong>Blacklist Monitor</strong>
          <p>Check if your IP/domain is on Spamhaus, Barracuda, SpamCop</p>
        </div>
        <div class="deliv-tool-card" onclick="openSpamScoreCheck()">
          <span class="deliv-tool-icon">&#128200;</span>
          <strong>Spam Score</strong>
          <p>Check your email content for spam triggers before sending</p>
        </div>
        <div class="deliv-tool-card" onclick="openEmailVerifyCheck()">
          <span class="deliv-tool-icon">&#9989;</span>
          <strong>Email Verify</strong>
          <p>Check if a specific email address exists and is deliverable</p>
        </div>
      </div>
      <div id="deliv-tool-result" style="margin-top:12px;"></div>
    </div>

    <!-- Suppression List -->
    <div class="section-card">
      <h3>Suppression List (${suppressionData.total} addresses)</h3>
      <p class="section-description">These addresses will never receive emails. Hard bounces, complaints, and unsubscribes are added automatically.</p>
      <div style="display:flex; gap:6px; margin-bottom:12px;">
        ${(suppressionData.counts || []).map(c => `<span class="report-tag">${c.reason}: ${c.count}</span>`).join('')}
      </div>
      <div class="form-row" style="margin-bottom:12px;">
        <input type="email" id="suppress-email" placeholder="email@example.com" style="flex:1; padding:6px 10px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:var(--radius); color:var(--text-primary); font-size:0.8rem;">
        <select id="suppress-reason" style="padding:6px 10px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:var(--radius); color:var(--text-primary); font-size:0.8rem;">
          <option value="manual">Manual</option>
          <option value="hard_bounce">Hard Bounce</option>
          <option value="complaint">Complaint</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="invalid">Invalid</option>
        </select>
        <button class="btn btn-sm" onclick="addSuppression()">Add</button>
      </div>
      ${suppressionData.suppressions.length === 0 ? '<div class="cell-muted">No suppressed addresses.</div>' :
        `<div class="table-container" style="max-height:250px; overflow-y:auto;"><table class="data-table"><thead><tr><th>Email</th><th>Reason</th><th>When</th><th></th></tr></thead><tbody>
        ${suppressionData.suppressions.slice(0, 50).map(s => `
          <tr><td class="cell-mono">${s.email}</td><td><span class="outcome-badge outcome-${s.reason === 'hard_bounce' || s.reason === 'complaint' ? 'failure' : 'neutral'}">${s.reason}</span></td><td class="cell-muted">${timeAgo(s.suppressed_at)}</td><td><button class="btn-micro" onclick="removeSuppression('${s.email}')" title="Remove">&#10005;</button></td></tr>
        `).join('')}
        </tbody></table></div>`}
    </div>

    <!-- Inbox Placement by Domain -->
    ${placementData.byDomain.length > 0 ? `
      <div class="section-card">
        <h3>Send Distribution by Domain</h3>
        <div class="stage-bars">
          ${placementData.byDomain.map(d => {
            const pct = Math.max((d.total / (placementData.byDomain[0]?.total || 1)) * 100, 5);
            return `<div class="stage-row"><span class="stage-label" style="width:120px">${d.recipient_domain}</span><div class="stage-bar-track"><div class="stage-bar-fill contacted" style="width:${pct}%">${d.total}</div></div></div>`;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="grid-2">
      <!-- Send Queue -->
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
      </div>

      <!-- Recent Events -->
      <div class="section-card">
        <h3>Recent Events</h3>
        ${delivData.recent.length === 0 ? '<div class="empty-state"><p>No events yet.</p></div>' :
          `<div class="history-list">${delivData.recent.slice(0, 10).map(e => `
            <div class="history-item">
              <div class="activity-dot ${e.event_type === 'sent' || e.event_type === 'delivered' ? 'success' : e.event_type === 'bounced' || e.event_type === 'complained' ? 'failure' : 'neutral'}"></div>
              <div class="history-content">
                <div class="history-task"><span class="outcome-badge outcome-${e.event_type === 'bounced' ? 'failure' : 'success'}">${e.event_type}</span></div>
                <div class="history-meta">${timeAgo(e.created_at)}</div>
              </div>
            </div>
          `).join('')}</div>`}
      </div>
    </div>

    <!-- SMTP Presets -->
    <div class="section-card">
      <h3>SMTP Provider Presets</h3>
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

// ─── Deliverability Tool Modals ─────────────────────────────────

async function openDnsAuthCheck() {
  const domain = prompt('Enter your sending domain (e.g., company.com):');
  if (!domain) return;
  const el = document.getElementById('deliv-tool-result');
  el.innerHTML = '<div class="spinner"></div> Checking DNS records...';
  try {
    const data = await postAPI('email/dns-auth', { domain });
    el.innerHTML = `
      <div class="section-card" style="border-color:${data.overallScore >= 75 ? 'var(--success)' : data.overallScore >= 50 ? 'var(--warning)' : 'var(--danger)'};">
        <h4>DNS Authentication: ${domain} — ${data.overallScore}/100</h4>
        <div class="detail-grid" style="margin-top:8px;">
          <div class="detail-item"><span class="detail-label">SPF</span><span class="detail-value"><span class="health-badge health-${data.spf.found ? 'healthy' : 'failed'}">${data.spf.found ? 'PASS' : 'FAIL'}</span></span></div>
          <div class="detail-item"><span class="detail-label">DKIM</span><span class="detail-value"><span class="health-badge health-${data.dkim.found ? 'healthy' : 'failed'}">${data.dkim.found ? 'PASS' : 'FAIL'}</span> ${data.dkim.selector ? `(${data.dkim.selector})` : ''}</span></div>
          <div class="detail-item"><span class="detail-label">DMARC</span><span class="detail-value"><span class="health-badge health-${data.dmarc.found ? 'healthy' : 'failed'}">${data.dmarc.found ? 'PASS' : 'FAIL'}</span> ${data.dmarc.policy ? `(${data.dmarc.policy})` : ''}</span></div>
          <div class="detail-item"><span class="detail-label">MX Records</span><span class="detail-value"><span class="health-badge health-${data.mx.found ? 'healthy' : 'failed'}">${data.mx.found ? `${data.mx.records.length} found` : 'NONE'}</span></span></div>
        </div>
        ${data.issues.length > 0 ? `<div style="margin-top:12px;"><strong style="color:var(--warning);">Issues:</strong><ul style="margin:4px 0 0 16px; font-size:0.8rem; color:var(--text-secondary);">${data.issues.map(i => `<li>${i}</li>`).join('')}</ul></div>` : '<div style="margin-top:8px; color:var(--success);">All checks passed!</div>'}
      </div>
    `;
  } catch (e) { el.innerHTML = `<div class="cell-muted">Error: ${e.message}</div>`; }
}

async function openBlacklistCheck() {
  const target = prompt('Enter IP address or domain to check:');
  if (!target) return;
  const el = document.getElementById('deliv-tool-result');
  el.innerHTML = '<div class="spinner"></div> Checking blacklists...';
  try {
    const data = await postAPI('email/blacklist', { ip: target, domain: target });
    el.innerHTML = `
      <div class="section-card" style="border-color:${data.listed ? 'var(--danger)' : 'var(--success)'};">
        <h4>Blacklist Check: ${data.ip} — ${data.listed ? 'LISTED!' : 'CLEAN'}</h4>
        <div style="margin-top:8px;">${data.listings.map(l => `
          <div class="setting-row"><span class="setting-label">${l.name}</span><span class="setting-value"><span class="health-badge health-${l.listed ? 'failed' : 'healthy'}">${l.listed ? 'LISTED' : 'Clean'}</span></span></div>
        `).join('')}</div>
      </div>
    `;
  } catch (e) { el.innerHTML = `<div class="cell-muted">Error: ${e.message}</div>`; }
}

async function openSpamScoreCheck() {
  const subject = prompt('Email subject line:');
  if (!subject) return;
  const body = prompt('Email body (can include HTML):');
  if (!body) return;
  const el = document.getElementById('deliv-tool-result');
  el.innerHTML = '<div class="spinner"></div> Analyzing content...';
  try {
    const data = await postAPI('email/spam-score', { subject, body });
    const gradeColors = { clean: 'var(--success)', low_risk: 'var(--success)', medium_risk: 'var(--warning)', high_risk: 'var(--danger)', spam: 'var(--danger)' };
    el.innerHTML = `
      <div class="section-card" style="border-color:${gradeColors[data.grade] || 'var(--border-color)'};">
        <h4>Spam Score: ${data.score}/100 — <span style="color:${gradeColors[data.grade]}">${data.grade.replace('_', ' ').toUpperCase()}</span></h4>
        ${data.triggers.length > 0 ? `<div style="margin-top:8px;"><strong>Triggers found:</strong><ul style="margin:4px 0 0 16px; font-size:0.8rem;">${data.triggers.map(t => `<li style="color:var(--text-secondary);">${t.reason} (weight: ${t.weight})</li>`).join('')}</ul></div>` : ''}
        ${data.recommendations.length > 0 ? `<div style="margin-top:8px;"><strong>Recommendations:</strong><ul style="margin:4px 0 0 16px; font-size:0.8rem; color:var(--text-secondary);">${data.recommendations.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}
      </div>
    `;
  } catch (e) { el.innerHTML = `<div class="cell-muted">Error: ${e.message}</div>`; }
}

async function openEmailVerifyCheck() {
  const email = prompt('Email address to verify:');
  if (!email) return;
  const el = document.getElementById('deliv-tool-result');
  el.innerHTML = '<div class="spinner"></div> Verifying email...';
  try {
    const data = await postAPI('email/verify', { email });
    el.innerHTML = `
      <div class="section-card">
        <h4>Email Verification: ${email}</h4>
        <div class="detail-grid" style="margin-top:8px;">
          <div class="detail-item"><span class="detail-label">Valid Format</span><span class="detail-value"><span class="health-badge health-${data.valid ? 'healthy' : 'failed'}">${data.valid ? 'Yes' : 'No'}</span></span></div>
          <div class="detail-item"><span class="detail-label">Mailbox Exists</span><span class="detail-value"><span class="health-badge health-${data.exists === true ? 'healthy' : data.exists === false ? 'failed' : 'disabled'}">${data.exists === true ? 'Yes' : data.exists === false ? 'No' : 'Unknown'}</span></span></div>
          <div class="detail-item"><span class="detail-label">Catch-All Domain</span><span class="detail-value">${data.catchAll ? 'Yes (accepts all)' : 'No'}</span></div>
          <div class="detail-item"><span class="detail-label">MX Server</span><span class="detail-value mono">${data.mxHost || 'N/A'}</span></div>
        </div>
        ${data.error ? `<div class="cell-muted" style="margin-top:8px;">Note: ${data.error}</div>` : ''}
      </div>
    `;
  } catch (e) { el.innerHTML = `<div class="cell-muted">Error: ${e.message}</div>`; }
}

// ─── Suppression Management ─────────────────────────────────────

async function addSuppression() {
  const email = document.getElementById('suppress-email').value.trim();
  if (!email) { showToast('Enter an email address', 'error'); return; }
  try {
    await postAPI('email/suppressions', { email, reason: document.getElementById('suppress-reason').value });
    document.getElementById('suppress-email').value = '';
    showToast(`${email} suppressed`, 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['email-settings'](main);
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeSuppression(email) {
  if (!confirm(`Remove ${email} from suppression list?`)) return;
  try {
    await fetch(`/api/email/suppressions/${encodeURIComponent(email)}`, { method: 'DELETE' });
    showToast('Removed from suppression', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['email-settings'](main);
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Add Account Modal ──────────────────────────────────────────

function renderAddEmailAccountModal(presets) {
  return `
    <div class="modal-overlay" id="add-email-modal" style="display:none" onclick="closeModal('add-email-modal')">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Connect Email Account</h3><button class="modal-close" onclick="closeModal('add-email-modal')">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Provider Preset</label><select id="email-preset" onchange="applyEmailPreset(this.value)"><option value="">Custom SMTP</option>${Object.keys(presets).map(p => `<option value="${p}">${capitalize(p)}</option>`).join('')}</select></div>
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
        <div class="modal-footer"><button class="btn" onclick="closeModal('add-email-modal')">Cancel</button><button class="btn btn-primary" onclick="submitAddEmailAccount()">Test & Connect</button></div>
      </div>
    </div>
  `;
}

function openAddEmailAccountModal() { document.getElementById('add-email-modal').style.display = 'flex'; }

function applyEmailPreset(preset) {
  const presets = { gmail: ['smtp.gmail.com',587,false], outlook: ['smtp-mail.outlook.com',587,false], yahoo: ['smtp.mail.yahoo.com',465,true], zoho: ['smtp.zoho.com',465,true], sendgrid: ['smtp.sendgrid.net',587,false], resend: ['smtp.resend.com',465,true] };
  const p = presets[preset];
  if (p) { document.getElementById('email-host').value = p[0]; document.getElementById('email-port').value = p[1]; document.getElementById('email-secure').checked = p[2]; }
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
    await postAPI('email/accounts', { name, emailAddress: email, smtpHost: host, smtpPort: parseInt(document.getElementById('email-port').value) || 587, smtpSecure: document.getElementById('email-secure').checked, smtpUser: user, smtpPass: pass, dailyLimit: parseInt(document.getElementById('email-limit').value) || 50 });
    closeModal('add-email-modal');
    showToast('Email account connected! Warm-up schedule created.', 'success');
    const main = document.getElementById('main-content');
    await pageRenderers['email-settings'](main);
  } catch (e) { showToast(e.message, 'error'); }
}
