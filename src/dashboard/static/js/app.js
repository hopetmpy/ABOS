/**
 * Dashboard App - Client-side SPA routing, data fetching, auto-refresh
 */

// ─── State ──────────────────────────────────────────────────────
let currentPage = 'overview';
let refreshInterval = null;
const REFRESH_MS = 30000;

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

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderPage(getPageFromHash());
  updateGlobalStatus();
  startAutoRefresh();
  // Refresh global status every 30s too
  setInterval(updateGlobalStatus, REFRESH_MS);
});
