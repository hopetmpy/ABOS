/**
 * Dashboard App - Client-side SPA routing, data fetching, auto-refresh
 */

// ─── State ──────────────────────────────────────────────────────
let currentPage = 'overview';
let refreshInterval = null;
let REFRESH_MS = 30000;

// ─── API Helper ─────────────────────────────────────────────────
async function fetchAPI(endpoint) {
  try {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`API error (${endpoint}):`, err);
    throw err;
  }
}

async function postAPI(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

async function patchAPI(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

// ─── Formatting Helpers ─────────────────────────────────────────
function formatCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function formatLargeCents(cents) {
  if (cents >= 100000) return '$' + (cents / 100000).toFixed(1) + 'k';
  return formatCents(cents);
}

function timeAgo(isoString) {
  if (!isoString) return '--';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

// ─── Toast Notifications ────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Page Rendering ─────────────────────────────────────────────
const pageRenderers = {};

function registerPage(name, renderer) {
  pageRenderers[name] = renderer;
}

async function renderPage(page) {
  const main = document.getElementById('main-content');
  currentPage = page;

  // Update nav highlight
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  if (pageRenderers[page]) {
    main.innerHTML = '<div class="page-loading"><div class="spinner"></div><p>Loading...</p></div>';
    try {
      await pageRenderers[page](main);
    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h2>Error loading page</h2><p>${err.message}</p></div>`;
    }
  } else {
    main.innerHTML = `
      <div class="coming-soon">
        <h2>${capitalize(page)}</h2>
        <p>This page will be available in a future sprint.</p>
      </div>
    `;
  }
}

// ─── Routing ────────────────────────────────────────────────────
function getPageFromHash() {
  const hash = window.location.hash || '#/overview';
  return hash.replace('#/', '').split('?')[0] || 'overview';
}

function navigate(page) {
  window.location.hash = `#/${page}`;
}

window.addEventListener('hashchange', () => {
  renderPage(getPageFromHash());
});

// ─── Auto-Refresh ───────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(() => {
    if (pageRenderers[currentPage]) {
      const main = document.getElementById('main-content');
      pageRenderers[currentPage](main).catch(() => {});
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// ─── Global Status Updates ──────────────────────────────────────
async function updateGlobalStatus() {
  try {
    const data = await fetchAPI('overview');
    // Update agent status badge
    const badge = document.getElementById('agent-status-badge');
    const state = data.agentState || 'unknown';
    badge.textContent = state;
    badge.className = `agent-status ${state}`;

    // Update credit display
    const creditEl = document.getElementById('credit-amount');
    creditEl.textContent = formatCents(data.creditBalance);
  } catch {
    // Silently fail on status updates
  }
}

// ─── Mobile Navigation ─────────────────────────────────────────
document.getElementById('mobile-nav-toggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// Close sidebar on nav click (mobile)
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });
});

// ─── Auth / Login ───────────────────────────────────────────────
let authToken = localStorage.getItem('dashboard-token') || '';

function setAuthToken(token) {
  authToken = token;
  localStorage.setItem('dashboard-token', token);
}

// Override fetchAPI to include token
const _origFetch = window.fetch;
window.fetch = function(url, opts = {}) {
  if (typeof url === 'string' && url.startsWith('/api/') && authToken) {
    opts.headers = { ...opts.headers, 'Authorization': `Bearer ${authToken}` };
  }
  return _origFetch.call(this, url, opts);
};

async function checkAuth() {
  try {
    const res = await _origFetch('/api/auth/check');
    const data = await res.json();
    return data;
  } catch { return { authConfigured: false, authenticated: false }; }
}

async function submitLogin() {
  const token = document.getElementById('login-token').value.trim();
  if (!token) return;
  document.getElementById('login-error').textContent = '';

  try {
    const res = await _origFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.authenticated) {
      setAuthToken(token);
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-wrapper').style.display = 'flex';
      initApp();
    } else {
      document.getElementById('login-error').textContent = 'Invalid token. Please try again.';
    }
  } catch (e) {
    document.getElementById('login-error').textContent = 'Connection error.';
  }
}

async function setupAuth() {
  try {
    const res = await _origFetch('/api/auth/setup', { method: 'POST' });
    const data = await res.json();
    if (data.token) {
      document.getElementById('login-content').innerHTML = `
        <div style="margin-top:16px; padding:16px; background:var(--bg-primary); border-radius:var(--radius); border:1px solid var(--success);">
          <p style="font-size:0.8rem; color:var(--success); margin-bottom:8px;">Token generated! Copy and save it — it won't be shown again.</p>
          <input type="text" value="${data.token}" readonly onclick="this.select()" style="width:100%; font-family:var(--font-mono); font-size:0.75rem;">
        </div>
        <button class="btn btn-primary" style="width:100%; margin-top:12px;" onclick="location.reload()">Continue to Login</button>
      `;
    } else {
      document.getElementById('login-error').textContent = data.error || 'Failed to generate token';
    }
  } catch (e) {
    document.getElementById('login-error').textContent = 'Connection error.';
  }
}

// Allow Enter key on login
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
    submitLogin();
  }
});

function initApp() {
  renderPage(getPageFromHash());
  updateGlobalStatus();
  startAutoRefresh();
  setInterval(updateGlobalStatus, REFRESH_MS);
}

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await checkAuth();

  if (auth.authConfigured && !auth.authenticated && !authToken) {
    // Auth is required, show login
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-wrapper').style.display = 'none';
  } else if (auth.authConfigured && authToken) {
    // Try existing token
    const res = await _origFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: authToken }),
    });
    const data = await res.json();
    if (data.authenticated) {
      initApp();
    } else {
      localStorage.removeItem('dashboard-token');
      authToken = '';
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app-wrapper').style.display = 'none';
    }
  } else {
    // No auth configured, go straight in
    initApp();
  }
});
