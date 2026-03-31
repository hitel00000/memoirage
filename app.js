const routes = [
  { key: 'home', label: 'Home' },
  { key: 'capture', label: 'Capture' },
  { key: 'processing', label: 'Processing' },
  { key: 'storage', label: 'Storage' }
];

let deferredPrompt = null;
let statsIntervalId = null;
const appUpdateState = {
  registration: null,
  waitingWorker: null,
  controllerChanged: false
};

const processingState = {
  notes: [],
  selectedNoteId: null,
  query: '',
  allNotes: [],
  links: [],
  evolutions: []
};

const storageState = {
  notes: [],
  links: [],
  evolutions: [],
  selectedNoteId: null,
  query: '',
  graphNodes: null  // force-directed 위치 캐시
};

// 설계 원칙대로 통일된 link type
const LINK_TYPE_OPTIONS = ['derive', 'contradict', 'support', 'related'];
const EVOLUTION_TYPE_OPTIONS = ['extends', 'shrinks', 'decay'];

const routeKeySet = new Set(routes.map((r) => r.key));
const ADVANCED_MODE_STORAGE_KEY = 'memoirage:advanced_mode';

const uiState = {
  advancedMode: false
};

// ── 라우팅 ──

function getBasePath() {
  const path = normalizePath(window.location.pathname);
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const last = segments[segments.length - 1];
  if (last === 'index.html' || last === '404.html' || routeKeySet.has(last)) segments.pop();
  return '/' + (segments.length ? segments.join('/') + '/' : '');
}

function normalizePath(path) {
  const p = path.startsWith('/') ? path : '/' + path;
  return p.replace(/\/+$/, '') || '/';
}

function routePath(key) {
  const base = getBasePath();
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (key === 'home') return (cleanBase || '') + '/';
  return (cleanBase || '') + '/' + key + '/';
}

function getRouteKeyFromLocation() {
  const base = normalizePath(getBasePath());
  const current = normalizePath(window.location.pathname);
  const relative = current.startsWith(base) ? current.slice(base.length) : current;
  const clean = relative.replace(/^\/+/, '');
  if (!clean || clean === 'index.html') return 'home';
  if (routeKeySet.has(clean)) return clean;
  return 'home';
}

function applyRouteFromQueryFallback() {
  const params = new URLSearchParams(window.location.search);
  const routePathQuery = params.get('route');
  if (!routePathQuery) return;
  try {
    const decoded = decodeURIComponent(routePathQuery);
    const url = new URL(decoded, window.location.origin);
    window.history.replaceState({}, '', url.pathname + (url.search || '') + (url.hash || ''));
  } catch (e) {
    console.warn('Invalid route query fallback:', e);
  }
}

function navigateToRoute(routeKey, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', routePath(routeKey));
  renderRoute();
}

function loadUiState() {
  try {
    uiState.advancedMode = localStorage.getItem(ADVANCED_MODE_STORAGE_KEY) === '1';
  } catch (_) {
    uiState.advancedMode = false;
  }
}

function setAdvancedMode(enabled) {
  uiState.advancedMode = !!enabled;
  try {
    localStorage.setItem(ADVANCED_MODE_STORAGE_KEY, uiState.advancedMode ? '1' : '0');
  } catch (_) {}
}

function bindRouteLinks(scope) {
  scope.querySelectorAll('a[data-route]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigateToRoute(a.dataset.route || 'home');
    });
  });
}

// ── 공통 유틸 ──

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function trimText(text, max = 42) {
  if (!text) return '(No content)';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function firstLineText(text) {
  return String(text || '').split(/\r?\n/, 1)[0].trim();
}

function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/^#+/, '');
}

function extractTagsFromText(text) {
  const src = String(text || '');
  const tagSet = new Set();
  const re = /(?:^|\s)#([a-z0-9][a-z0-9_-]{0,39})/gi;
  let match;
  while ((match = re.exec(src))) {
    const tag = normalizeTag(match[1]);
    if (tag) tagSet.add(tag);
  }
  return [...tagSet];
}

function getNoteTags(note) {
  if (!note) return [];
  const set = new Set((Array.isArray(note.tags) ? note.tags : []).map(normalizeTag).filter(Boolean));
  return [...set];
}

function parseSearchQuery(query) {
  const parsed = { textTerms: [], tagTerms: [], statusTerms: [] };
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  const allowedStatuses = new Set(['inbox', 'processing', 'done', 'deleted']);
  tokens.forEach((token) => {
    const low = token.toLowerCase();
    if (low.startsWith('#')) {
      const tag = normalizeTag(low);
      if (tag) parsed.tagTerms.push(tag);
      return;
    }
    if (low.startsWith('tag:')) {
      const tag = normalizeTag(low.slice(4));
      if (tag) parsed.tagTerms.push(tag);
      return;
    }
    if (low.startsWith('status:')) {
      const status = low.slice(7);
      if (allowedStatuses.has(status)) parsed.statusTerms.push(status);
      return;
    }
    parsed.textTerms.push(low);
  });
  parsed.textTerms = [...new Set(parsed.textTerms)];
  parsed.tagTerms = [...new Set(parsed.tagTerms)];
  parsed.statusTerms = [...new Set(parsed.statusTerms)];
  return parsed;
}

function matchesNoteQuery(note, parsed, statusScope = null) {
  if (!note) return false;
  const status = String(note.status || 'inbox').toLowerCase();
  if (statusScope && !statusScope.has(status)) return false;
  if (parsed.statusTerms.length && !parsed.statusTerms.includes(status)) return false;
  const content = String(note.content || '').toLowerCase();
  if (parsed.textTerms.some((term) => !content.includes(term))) return false;
  if (parsed.tagTerms.length) {
    const tags = getNoteTags(note);
    if (parsed.tagTerms.some((tag) => !tags.includes(tag))) return false;
  }
  return true;
}

function filterNotesByQuery(notes, query, statusScope = null) {
  const parsed = parseSearchQuery(query);
  return notes.filter((note) => matchesNoteQuery(note, parsed, statusScope));
}

function renderTagChips(note, max = 3) {
  const tags = getNoteTags(note);
  if (!tags.length) return '';
  const visible = tags.slice(0, max);
  const extra = tags.length - visible.length;
  const chips = visible.map((tag) => `<span class="note-tag-chip">#${escapeHtml(tag)}</span>`).join('');
  return `<div class="note-tag-row">${chips}${extra > 0 ? `<span class="note-tag-chip muted">+${extra}</span>` : ''}</div>`;
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function getNoteAttachments(note) {
  if (!note || !Array.isArray(note.attachments)) return [];
  return note.attachments
    .filter((a) => a && typeof a.url === 'string' && isValidHttpUrl(a.url))
    .map((a) => ({
      id: String(a.id || generateId()),
      url: String(a.url),
      label: String(a.label || '').trim(),
      created_at: a.created_at || new Date().toISOString()
    }));
}

function normalizeClusterId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.slice(0, 32);
}

function getClusterHue(clusterId) {
  const input = String(clusterId || '');
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 360;
  return h;
}

function renderClusterChip(note) {
  if (!uiState.advancedMode || !note || !note.cluster_id) return '';
  return `<span class="note-tag-chip cluster">cluster:${escapeHtml(note.cluster_id)}</span>`;
}

function fallbackRefineText(content) {
  const text = String(content || '').trim();
  if (!text) return '';
  return text
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function runOptionalAiRefine(content) {
  const maybeProvider = window.memoirageAI;
  if (maybeProvider && typeof maybeProvider.refine === 'function') {
    try {
      const result = await maybeProvider.refine(content);
      if (result && typeof result.text === 'string' && result.text.trim()) {
        return { text: result.text.trim(), mode: 'provider' };
      }
    } catch (_) {
      // fall through to local fallback
    }
  }
  return { text: fallbackRefineText(content), mode: 'fallback' };
}

function getPointOnRect(p1, p2, w, h) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return { ...p2 };
  const tX = Math.abs((w / 2) / dx);
  const tY = Math.abs((h / 2) / dy);
  const t = Math.min(tX, tY);
  return { x: p2.x - t * dx, y: p2.y - t * dy };
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
  return el;
}

function showStatus(elId, message, type, duration = 2500) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = el.className.replace(/\bshow\b|\bsuccess\b|\berror\b/g, '').trim() + ` show ${type}`;
  setTimeout(() => { el.className = el.className.replace(/\bshow\b|\bsuccess\b|\berror\b/g, '').trim(); }, duration);
}

function ensureUpdateBanner() {
  let banner = document.getElementById('appUpdateBanner');
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'appUpdateBanner';
  banner.className = 'app-update-banner';
  banner.innerHTML = `
    <div class="app-update-text">A new version is ready.</div>
    <div class="app-update-actions">
      <button id="appUpdateRefreshBtn" class="app-update-btn primary">Refresh</button>
      <button id="appUpdateLaterBtn" class="app-update-btn">Later</button>
    </div>`;
  document.body.appendChild(banner);

  document.getElementById('appUpdateRefreshBtn').addEventListener('click', () => {
    const waiting = appUpdateState.waitingWorker || (appUpdateState.registration && appUpdateState.registration.waiting);
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  });
  document.getElementById('appUpdateLaterBtn').addEventListener('click', () => {
    banner.classList.remove('show');
  });

  return banner;
}

function showUpdateBanner() {
  ensureUpdateBanner().classList.add('show');
}

function wireServiceWorkerUpdates(registration) {
  appUpdateState.registration = registration;

  if (registration.waiting) {
    appUpdateState.waitingWorker = registration.waiting;
    showUpdateBanner();
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        appUpdateState.waitingWorker = registration.waiting || worker;
        showUpdateBanner();
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (appUpdateState.controllerChanged) return;
    appUpdateState.controllerChanged = true;
    window.location.reload();
  });
}

// ── NAV ──

function renderNav(activeKey) {
  const nav = document.getElementById('app-nav');
  nav.innerHTML = `
    <nav class="spa-nav">
      <ul>
        ${routes.map((r) => `<li><a href="${routePath(r.key)}" data-route="${r.key}" class="${r.key === activeKey ? 'active' : ''}">${r.label}</a></li>`).join('')}
      </ul>
    </nav>`;
  bindRouteLinks(nav);
}

// ── HOME ──

function renderHome() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="container">
      <h1>Memoirage</h1>
      <p class="subtitle">Capture fleeting thoughts and connect them later.</p>
      <div class="menu">
        <a href="${routePath('capture')}" data-route="capture" class="menu-item"><h3>Capture</h3><p>Save ideas quickly as inbox notes.</p></a>
        <a href="${routePath('processing')}" data-route="processing" class="menu-item"><h3>Processing</h3><p>Review inbox notes and move them forward.</p></a>
        <a href="${routePath('storage')}" data-route="storage" class="menu-item"><h3>Storage</h3><p>Browse done notes and manage connections.</p></a>
      </div>
      <div class="status">
        <h4>Workspace Status</h4>
        <div class="stats">
          <div class="stat"><div class="number" id="inboxCount">-</div><div class="label">Inbox</div></div>
          <div class="stat"><div class="number" id="doneCount">-</div><div class="label">Done</div></div>
          <div class="stat"><div class="number" id="totalCount">-</div><div class="label">Total</div></div>
        </div>
      </div>
      <button id="installBtn" class="install-btn">Install App</button>
    </div>`;

  const installBtn = document.getElementById('installBtn');
  if (deferredPrompt) installBtn.style.display = 'inline-block';
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
  bindRouteLinks(root);
}

async function loadHomeStats() {
  const inboxEl = document.getElementById('inboxCount');
  if (!inboxEl) return;
  try {
    const [inbox, done, total] = await Promise.all([
      getNotes({ status: 'inbox', include_deleted: false }),
      getNotes({ status: 'done', include_deleted: false }),
      getNotes({ include_deleted: false })
    ]);
    document.getElementById('inboxCount').textContent = inbox.length;
    document.getElementById('doneCount').textContent = done.length;
    document.getElementById('totalCount').textContent = total.length;
  } catch (e) { console.error('Failed to load stats:', e); }
}

// ── CAPTURE ──

function renderCapture() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <section class="capture-card">
      <h2>Quick Capture</h2>
      <textarea id="captureContent" placeholder="Write anything…"></textarea>
      <button id="captureSubmit">Save</button>
      <div id="captureStatus" class="capture-status"></div>
    </section>`;

  document.getElementById('captureSubmit').addEventListener('click', async () => {
    const textarea = document.getElementById('captureContent');
    const content = textarea.value.trim();
    if (!content) { showStatus('captureStatus', 'Please enter content', 'error'); return; }

    const btn = document.getElementById('captureSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveNote({
        id: generateId(),
        type: 'text',
        content,
        status: 'inbox',
        tags: extractTagsFromText(content), // 초기 캡처 시에만 자동 추출
        created_at: new Date().toISOString(),
        deleted_at: null
      });
      textarea.value = '';
      showStatus('captureStatus', 'Saved!', 'success');
    } catch (e) {
      showStatus('captureStatus', 'Save failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
}

// ── PROCESSING ──

async function loadProcessingNotes() {
  const [inbox, processing, allNotes, links, evolutions] = await Promise.all([
    getNotes({ status: 'inbox', include_deleted: false }),
    getNotes({ status: 'processing', include_deleted: false }),
    getNotes({ include_deleted: false }),
    getLinks({}),
    getEvolutions({})
  ]);
  processingState.notes = [...processing, ...inbox].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  processingState.allNotes = allNotes;
  processingState.links = links;
  processingState.evolutions = evolutions;
}

async function reloadProcessingAndSelect(noteId = null) {
  await loadProcessingNotes();
  if (noteId) {
    // 지정된 noteId가 목록에 있으면 유지, 없으면(삭제된 경우) null
    processingState.selectedNoteId = processingState.notes.find((n) => n.id === noteId) ? noteId : null;
  } else if (processingState.selectedNoteId && !processingState.notes.find((n) => n.id === processingState.selectedNoteId)) {
    // 선택된 노트가 목록에서 사라진 경우(삭제/상태변경) null로
    processingState.selectedNoteId = null;
  }
  // 선택 보존: 검색 필터 밖으로 나가더라도 selectedNoteId는 건드리지 않음
  renderProcessingList();
  renderProcessingDetail();
}

function getNoteById_processing(id) {
  return processingState.allNotes.find((n) => n.id === id) || null;
}

function renderProcessing() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="processing-wrap">
      <section id="processingList" class="processing-list"></section>
      <section id="processingDetail" class="processing-detail">
        <div class="processing-legend">
          <p><strong>Inbox</strong>: quick captures waiting for first review.</p>
          <p><strong>Processing</strong>: notes you're actively refining and connecting.</p>
        </div>
        <p>Select a note…</p>
      </section>
    </div>`;
  renderProcessingList();
  renderProcessingDetail();
}

function renderProcessingList() {
  const panel = document.getElementById('processingList');
  if (!panel) return;

  const filtered = filterNotesByQuery(processingState.notes, processingState.query, new Set(['inbox', 'processing']));

  panel.innerHTML = `
    <div class="list-search-wrap">
      <input id="processingSearchInput" class="list-search-input" placeholder="Search: keyword #tag status:inbox" value="${escapeHtml(processingState.query)}" />
      <div class="list-search-meta">${filtered.length}/${processingState.notes.length} notes
        <span class="search-hint">· <code>#tag</code> or <code>status:processing</code></span>
      </div>
    </div>
    <div id="processingListBody"></div>`;

  const searchInput = document.getElementById('processingSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      processingState.query = e.target.value;
      renderProcessingList();
      renderProcessingDetail();
    });
  }

  const body = document.getElementById('processingListBody');
  if (!body) return;

  if (processingState.notes.length === 0) {
    body.innerHTML = '<div style="padding:20px;color:#999;">No notes</div>';
    return;
  }
  if (filtered.length === 0) {
    body.innerHTML = '<div style="padding:20px;color:#999;">No matching notes</div>';
    return;
  }

  body.innerHTML = filtered.map((note) => {
    const sel = note.id === processingState.selectedNoteId ? ' selected' : '';
    const tagsHtml = renderTagChips(note, 3);
    const clusterChip = renderClusterChip(note);
    return `
      <div class="processing-item${sel}">
        <div class="processing-item-content" data-action="select" data-id="${note.id}">
          <div class="processing-item-text">${escapeHtml(note.content || '(No content)')}</div>
          ${tagsHtml}${clusterChip ? `<div class="note-tag-row">${clusterChip}</div>` : ''}
          <div class="processing-item-meta">
            <span class="processing-status-chip ${escapeHtml(note.status || 'inbox')}">${note.status === 'processing' ? 'Processing' : 'Inbox'}</span>
            <span class="processing-item-date">${escapeHtml(new Date(note.created_at).toLocaleString())}</span>
          </div>
        </div>
        <button class="processing-delete-mini" data-action="delete" data-id="${note.id}">×</button>
      </div>`;
  }).join('');

  panel.querySelectorAll('[data-action="select"]').forEach((el) => {
    el.addEventListener('click', () => {
      processingState.selectedNoteId = el.dataset.id;
      renderProcessingList();
      renderProcessingDetail();
    });
  });
  panel.querySelectorAll('[data-action="delete"]').forEach((el) => {
    el.addEventListener('click', async (e) => { e.stopPropagation(); await deleteProcessingNote(el.dataset.id); });
  });
}

function renderProcessingDetail() {
  const panel = document.getElementById('processingDetail');
  if (!panel) return;
  const selected = processingState.notes.find((n) => n.id === processingState.selectedNoteId);
  if (!selected) {
    panel.innerHTML = `
      <div class="processing-legend">
        <p><strong>Inbox</strong>: quick captures waiting for first review.</p>
        <p><strong>Processing</strong>: notes you're actively refining and connecting.</p>
      </div>
      <p>Select a note…</p>`;
    return;
  }

  const status = selected.status || 'inbox';
  const toggleTarget = status === 'processing' ? 'inbox' : 'processing';
  const toggleLabel = status === 'processing' ? 'Move back to Inbox' : 'Start Processing';
  const relatedLinks = processingState.links.filter(l => l.source_id === selected.id || l.target_id === selected.id);
  const relatedEvos = processingState.evolutions.filter(e => e.source_id === selected.id || e.target_id === selected.id);
  const attachments = getNoteAttachments(selected);

  const targetOptions = processingState.allNotes
    .filter(n => n.id !== selected.id)
    .map(n => `<option value="${escapeHtml(trimText(n.content, 64))}"></option>`)
    .join('');

  const linkTypeHtml = LINK_TYPE_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('');
  const evoTypeHtml = EVOLUTION_TYPE_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('');

  panel.innerHTML = `
    <div id="processingStatus" class="processing-status"></div>
    <h2 style="margin-top:0">Note</h2>
    <p><small>Created: ${escapeHtml(new Date(selected.created_at).toLocaleString())}</small></p>
    <p><small>Status: <strong>${status === 'processing' ? 'Processing' : 'Inbox'}</strong></small></p>
    <label for="processingContent"><small>Content</small></label>
    <textarea id="processingContent" class="processing-content-input">${escapeHtml(selected.content || '')}</textarea>
    <div class="processing-btn-row">
      <button class="processing-btn primary" id="saveProcessingNoteBtn">Save Edits</button>
      <button class="processing-btn" id="aiRefineBtn">AI Refine (Optional)</button>
    </div>

    <h3 class="storage-section-title">Tags</h3>
    <div id="processingTagsWrap" class="tag-editor-wrap"></div>
    <div class="storage-link-form tag-add-form">
      <input id="pTagInput" class="storage-input" placeholder="tag name (without #)" maxlength="40">
      <button id="pAddTagBtn" class="storage-btn primary">Add Tag</button>
    </div>
    <div class="processing-btn-row">
      <button class="processing-btn primary" id="toggleProcessingBtn">${escapeHtml(toggleLabel)}</button>
      <button class="processing-btn primary" id="moveDoneBtn">Move to Done</button>
    </div>

    <h3 class="storage-section-title">Attachments <span style="font-size:11px;font-weight:400;opacity:.7">(${attachments.length})</span></h3>
    <div id="processingAttachments"></div>
    <div class="storage-link-form attachment-add-form">
      <input id="pAttachmentUrl" class="storage-input" placeholder="https://example.com/article" maxlength="2048">
      <input id="pAttachmentLabel" class="storage-input" placeholder="Label (optional)" maxlength="80">
      <button id="pAddAttachmentBtn" class="storage-btn primary">Add Link</button>
    </div>
    <div id="pAttachmentValidation" class="input-validation-hint"></div>

    <h3 class="storage-section-title">Add Link <span style="font-size:11px;font-weight:400;opacity:.7">(개념 간 관계)</span></h3>
    <div class="storage-link-form">
      <input id="pLinkTarget" list="pLinkTargetList" class="storage-input" placeholder="Search note…">
      <datalist id="pLinkTargetList">${targetOptions}</datalist>
      <select id="pLinkType" class="storage-select">${linkTypeHtml}</select>
      <button id="pAddLinkBtn" class="storage-btn primary">Add</button>
    </div>
    <div id="processingLinks"></div>

    <h3 class="storage-section-title">Add Evolution <span style="font-size:11px;font-weight:400;opacity:.7">(시간적 변화)</span></h3>
    <div class="storage-link-form">
      <input id="pEvoTarget" list="pEvoTargetList" class="storage-input" placeholder="Search note…">
      <datalist id="pEvoTargetList">${targetOptions}</datalist>
      <select id="pEvoType" class="storage-select">${evoTypeHtml}</select>
      <button id="pAddEvoBtn" class="storage-btn primary">Add</button>
    </div>
    <div id="processingEvolutions"></div>

    <button class="processing-btn danger" id="deleteNoteBtn">Delete Note</button>`;

  renderProcessingLinks(relatedLinks, selected.id);
  renderProcessingEvolutions(relatedEvos, selected.id);
  renderProcessingAttachments(selected.id);
  renderProcessingTags(selected.id);

  document.getElementById('pAddTagBtn').addEventListener('click', async () => {
    await addProcessingTag(selected.id);
  });
  document.getElementById('pTagInput').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); await addProcessingTag(selected.id); }
  });

  document.getElementById('saveProcessingNoteBtn').addEventListener('click', async () => {
    const content = document.getElementById('processingContent').value.trim();
    if (!content) { showStatus('processingStatus', 'Content cannot be empty.', 'error'); return; }
    try {
      const existingTags = getNoteTags(selected);
      const newExtracted = extractTagsFromText(content);
      // 기존 태그 유지 + 본문에서 새로 발견된 태그만 합침
      const mergedTags = [...new Set([...existingTags, ...newExtracted])];
      
      await updateNote(selected.id, { content, tags: mergedTags });
      await reloadProcessingAndSelect(selected.id);
      showStatus('processingStatus', 'Saved.', 'success');
    } catch (e) { showStatus('processingStatus', 'Save failed: ' + e.message, 'error'); }
  });

  document.getElementById('aiRefineBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('processingContent');
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) {
      showStatus('processingStatus', 'Content cannot be empty.', 'error');
      return;
    }
    const btn = document.getElementById('aiRefineBtn');
    btn.disabled = true;
    btn.textContent = 'Refining…';
    try {
      const refined = await runOptionalAiRefine(content);
      if (!refined.text) {
        showStatus('processingStatus', 'Refine produced empty result.', 'error');
        return;
      }
      textarea.value = refined.text;
      showStatus('processingStatus', refined.mode === 'provider' ? 'Refined with AI provider.' : 'Refined with local fallback.', 'success');
    } catch (e) {
      showStatus('processingStatus', 'Refine failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'AI Refine (Optional)';
    }
  });

  document.getElementById('toggleProcessingBtn').addEventListener('click', async () => {
    try {
      await updateNote(selected.id, { status: toggleTarget });
      await reloadProcessingAndSelect(selected.id);
    } catch (e) { showStatus('processingStatus', 'Update failed.', 'error'); }
  });

  document.getElementById('moveDoneBtn').addEventListener('click', async () => {
    try {
      await updateNote(selected.id, { status: 'done' });
      await reloadProcessingAndSelect();
      showStatus('processingStatus', 'Moved to Done.', 'success');
    } catch (e) { showStatus('processingStatus', 'Update failed.', 'error'); }
  });

  document.getElementById('deleteNoteBtn').addEventListener('click', async () => {
    await deleteProcessingNote(selected.id);
  });

  document.getElementById('pAddLinkBtn').addEventListener('click', async () => {
    await addProcessingLink(selected.id);
  });

  document.getElementById('pAddEvoBtn').addEventListener('click', async () => {
    await addProcessingEvolution(selected.id);
  });

  document.getElementById('pAddAttachmentBtn').addEventListener('click', async () => {
    await addProcessingAttachment(selected.id);
  });

  const urlInput = document.getElementById('pAttachmentUrl');
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const hint = document.getElementById('pAttachmentValidation');
      if (!hint) return;
      const val = urlInput.value.trim();
      if (!val) { hint.textContent = ''; hint.className = 'input-validation-hint'; return; }
      if (!isValidHttpUrl(val)) {
        hint.textContent = 'Must be a valid http(s) URL.';
        hint.className = 'input-validation-hint error';
      } else if (val.length > 2048) {
        hint.textContent = 'URL too long (max 2048 chars).';
        hint.className = 'input-validation-hint error';
      } else {
        hint.textContent = '✓ Valid URL';
        hint.className = 'input-validation-hint ok';
      }
    });
  }
}

function renderProcessingLinks(links, noteId) {
  const container = document.getElementById('processingLinks');
  if (!container) return;
  if (links.length === 0) { container.innerHTML = '<div class="storage-empty" style="padding:8px 0">No links yet.</div>'; return; }
  container.innerHTML = links.map((link) => {
    const out = link.source_id === noteId;
    const otherId = out ? link.target_id : link.source_id;
    const other = getNoteById_processing(otherId);
    const dir = out ? '→' : '←';
    return `
      <div class="storage-link-row">
        <div class="storage-link-head">
          <span class="storage-link-type">${escapeHtml(link.type || 'related')}</span>
          <button class="storage-link-remove" data-id="${link.id}">Delete</button>
        </div>
        <div>${dir} ${escapeHtml(trimText(other ? other.content : '(Deleted)', 48))}</div>
      </div>`;
  }).join('');
  container.querySelectorAll('.storage-link-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteLink(btn.dataset.id);
      await reloadProcessingAndSelect(noteId);
    });
  });
}

function renderProcessingEvolutions(evos, noteId) {
  const container = document.getElementById('processingEvolutions');
  if (!container) return;
  if (evos.length === 0) { container.innerHTML = '<div class="storage-empty" style="padding:8px 0">No evolutions yet.</div>'; return; }
  container.innerHTML = evos.map((evo) => {
    const out = evo.source_id === noteId;
    const otherId = out ? evo.target_id : evo.source_id;
    const other = getNoteById_processing(otherId);
    const dir = out ? '→' : '←';
    return `
      <div class="storage-link-row evo-row">
        <div class="storage-link-head">
          <span class="storage-link-type evo-type ${escapeHtml(evo.evolution_type)}">${escapeHtml(evo.evolution_type)}</span>
          <button class="storage-link-remove" data-id="${evo.id}">Delete</button>
        </div>
        <div>${dir} ${escapeHtml(trimText(other ? other.content : '(Deleted)', 48))}</div>
      </div>`;
  }).join('');
  container.querySelectorAll('.storage-link-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteEvolution(btn.dataset.id);
      await reloadProcessingAndSelect(noteId);
    });
  });
}

function renderProcessingAttachments(noteId) {
  const container = document.getElementById('processingAttachments');
  if (!container) return;
  const note = processingState.notes.find((n) => n.id === noteId);
  const attachments = getNoteAttachments(note);
  if (!attachments.length) {
    container.innerHTML = '<div class="storage-empty" style="padding:8px 0">No attachments.</div>';
    return;
  }
  container.innerHTML = attachments.map((a) => `
    <div class="attachment-row">
      <a class="attachment-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.label || a.url)}</a>
      <button class="storage-link-remove" data-aid="${a.id}">Delete</button>
    </div>`).join('');

  container.querySelectorAll('[data-aid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const current = processingState.notes.find((n) => n.id === noteId);
      if (!current) return;
      const next = getNoteAttachments(current).filter((a) => a.id !== btn.dataset.aid);
      await updateNote(noteId, { attachments: next });
      await reloadProcessingAndSelect(noteId);
      showStatus('processingStatus', 'Attachment deleted.', 'success');
    });
  });
}

async function addProcessingAttachment(noteId) {
  const urlInput = document.getElementById('pAttachmentUrl');
  const labelInput = document.getElementById('pAttachmentLabel');
  if (!urlInput || !labelInput) return;
  const url = urlInput.value.trim();
  const label = labelInput.value.trim();
  if (!isValidHttpUrl(url)) {
    showStatus('processingStatus', 'Please enter a valid http(s) URL.', 'error');
    return;
  }
  if (url.length > 2048) {
    showStatus('processingStatus', 'URL too long (max 2048 chars).', 'error');
    return;
  }
  if (label.length > 80) {
    showStatus('processingStatus', 'Label too long (max 80 chars).', 'error');
    return;
  }
  const note = processingState.notes.find((n) => n.id === noteId);
  if (!note) return;
  const attachments = getNoteAttachments(note);
  if (attachments.length >= 20) {
    showStatus('processingStatus', 'Max 20 attachments per note.', 'error');
    return;
  }
  if (attachments.some((a) => a.url === url)) {
    showStatus('processingStatus', 'Same attachment already exists.', 'error');
    return;
  }
  attachments.push({ id: generateId(), url, label, created_at: new Date().toISOString() });
  await updateNote(noteId, { attachments });
  urlInput.value = '';
  labelInput.value = '';
  const hint = document.getElementById('pAttachmentValidation');
  if (hint) { hint.textContent = ''; hint.className = 'input-validation-hint'; }
  await reloadProcessingAndSelect(noteId);
  showStatus('processingStatus', 'Attachment added.', 'success');
}

function renderProcessingTags(noteId) {
  const container = document.getElementById('processingTagsWrap');
  if (!container) return;
  const note = processingState.notes.find((n) => n.id === noteId);
  const tags = getNoteTags(note);
  if (tags.length === 0) {
    container.innerHTML = '<div class="storage-empty" style="padding:4px 0 8px">No tags yet. Type in content with #hashtag or add manually.</div>';
    return;
  }
  container.innerHTML = tags.map((tag) => `
    <span class="note-tag-chip tag-removable">
      #${escapeHtml(tag)}
      <button class="tag-remove-btn" data-tag="${escapeHtml(tag)}" title="Remove tag">×</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tagToRemove = normalizeTag(btn.dataset.tag);
      const current = processingState.notes.find((n) => n.id === noteId);
      if (!current) return;
      const nextTags = getNoteTags(current).filter((t) => t !== tagToRemove);
      await updateNote(noteId, { tags: nextTags });
      await reloadProcessingAndSelect(noteId);
    });
  });
}

async function addProcessingTag(noteId) {
  const input = document.getElementById('pTagInput');
  if (!input) return;
  const raw = input.value.trim();
  const tag = normalizeTag(raw);
  if (!tag) { showStatus('processingStatus', 'Tag cannot be empty.', 'error'); return; }
  if (tag.length > 40) { showStatus('processingStatus', 'Tag too long (max 40 chars).', 'error'); return; }
  const note = processingState.notes.find((n) => n.id === noteId);
  if (!note) return;
  const existing = getNoteTags(note);
  if (existing.includes(tag)) { showStatus('processingStatus', 'Tag already exists.', 'error'); return; }
  await updateNote(noteId, { tags: [...existing, tag] });
  input.value = '';
  await reloadProcessingAndSelect(noteId);
  showStatus('processingStatus', `Tag #${tag} added.`, 'success');
}

function findNoteByQuery(noteId, query, noteList) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const candidates = noteList.filter(n => n.id !== noteId);
  const exact = candidates.find(n => n.id === query || trimText(n.content, 64).toLowerCase() === q);
  if (exact) return exact;
  const matches = candidates.filter(n => n.content && n.content.toLowerCase().includes(q));
  return matches.length === 1 ? matches[0] : null;
}

async function addProcessingLink(noteId) {
  const targetQuery = document.getElementById('pLinkTarget').value.trim();
  const linkType = document.getElementById('pLinkType').value || 'related';
  const target = findNoteByQuery(noteId, targetQuery, processingState.allNotes);
  if (!target) { showStatus('processingStatus', 'Target not found. Be more specific.', 'error'); return; }
  const dup = processingState.links.find(l => l.source_id === noteId && l.target_id === target.id && l.type === linkType);
  if (dup) { showStatus('processingStatus', 'Same link already exists.', 'error'); return; }
  try {
    await saveLink({ id: generateId(), source_id: noteId, target_id: target.id, type: linkType, created_at: new Date().toISOString() });
    await reloadProcessingAndSelect(noteId);
    showStatus('processingStatus', 'Link added.', 'success');
  } catch (e) { showStatus('processingStatus', 'Failed: ' + e.message, 'error'); }
}

async function addProcessingEvolution(noteId) {
  const targetQuery = document.getElementById('pEvoTarget').value.trim();
  const evoType = document.getElementById('pEvoType').value || 'extends';
  const target = findNoteByQuery(noteId, targetQuery, processingState.allNotes);
  if (!target) { showStatus('processingStatus', 'Target not found. Be more specific.', 'error'); return; }
  const dup = processingState.evolutions.find(e => e.source_id === noteId && e.target_id === target.id && e.evolution_type === evoType);
  if (dup) { showStatus('processingStatus', 'Same evolution already exists.', 'error'); return; }
  try {
    await saveEvolution({ id: generateId(), source_id: noteId, target_id: target.id, evolution_type: evoType, evolved_at: new Date().toISOString() });
    await reloadProcessingAndSelect(noteId);
    showStatus('processingStatus', 'Evolution added.', 'success');
  } catch (e) { showStatus('processingStatus', 'Failed: ' + e.message, 'error'); }
}

async function deleteProcessingNote(noteId) {
  if (!confirm('Delete this note?')) return;
  try {
    await deleteNote(noteId);
    // 관련 링크 및 에볼루션 정리 (Storage와 일관성 유지)
    const relatedLinks = processingState.links.filter(l => l.source_id === noteId || l.target_id === noteId);
    const relatedEvos = processingState.evolutions.filter(e => e.source_id === noteId || e.target_id === noteId);
    for (const l of relatedLinks) await deleteLink(l.id);
    for (const e of relatedEvos) await deleteEvolution(e.id);
    
    processingState.selectedNoteId = null;
    await reloadProcessingAndSelect();
  } catch (e) { showStatus('processingStatus', 'Delete failed.', 'error'); }
}

// ── STORAGE ──

async function loadStorageData() {
  const [doneNotes, allLinks, allEvos] = await Promise.all([
    getNotes({ status: 'done', include_deleted: false }),
    getLinks({}),
    getEvolutions({})
  ]);
  doneNotes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  storageState.notes = doneNotes;

  const doneIds = new Set(doneNotes.map(n => n.id));
  storageState.links = allLinks.filter(l => doneIds.has(l.source_id) && doneIds.has(l.target_id));
  storageState.evolutions = allEvos.filter(e => doneIds.has(e.source_id) && doneIds.has(e.target_id));

  if (storageState.selectedNoteId && !doneIds.has(storageState.selectedNoteId)) {
    storageState.selectedNoteId = null;
  }
}

function renderStorage() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="storage-wrap">
      <aside class="storage-panel storage-left">
        <h2 class="storage-title">
          <span>Done Notes${uiState.advancedMode ? ' <span class="advanced-badge">Advanced</span>' : ''}</span>
          <button id="storageAdvancedToggle" class="storage-advanced-toggle" aria-pressed="${uiState.advancedMode ? 'true' : 'false'}">
            ${uiState.advancedMode ? 'Advanced On' : 'Advanced'}
          </button>
        </h2>
        <div class="list-search-wrap storage-search-wrap">
          <input id="storageSearchInput" class="list-search-input" placeholder="Search: keyword #tag status:done" value="${escapeHtml(storageState.query)}" />
          <div id="storageSearchMeta" class="list-search-meta">
            <span class="search-hint"><code>#tag</code> or <code>status:done</code></span>
          </div>
        </div>
        <div id="storageList"></div>
      </aside>
      <section class="storage-panel storage-center">
        <div id="storageGraph" class="storage-graph"></div>
      </section>
      <aside class="storage-panel storage-right">
        <div id="storageStatus" class="storage-status"></div>
        <div id="storageDetail" class="storage-empty">Select a note from the list or graph.</div>
      </aside>
    </div>`;
  const searchInput = document.getElementById('storageSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      storageState.query = e.target.value;
      renderStorageList();
      renderStorageDetail();
    });
  }
  const advancedToggle = document.getElementById('storageAdvancedToggle');
  if (advancedToggle) {
    advancedToggle.addEventListener('click', () => {
      setAdvancedMode(!uiState.advancedMode);
      renderStorage();
    });
  }
  renderStorageList();
  renderStorageGraph();
  renderStorageDetail();
}

function renderStorageList() {
  const panel = document.getElementById('storageList');
  if (!panel) return;
  const filtered = filterNotesByQuery(storageState.notes, storageState.query, new Set(['done']));
  const meta = document.getElementById('storageSearchMeta');
  if (meta) meta.innerHTML = `${filtered.length}/${storageState.notes.length} notes <span class="search-hint">· <code>#tag</code> or <code>status:done</code></span>`;
  if (storageState.selectedNoteId && !filtered.find((n) => n.id === storageState.selectedNoteId)) {
    storageState.selectedNoteId = null;
  }
  if (storageState.notes.length === 0) {
    panel.innerHTML = '<div class="storage-empty">No completed notes yet.</div>';
    return;
  }
  if (filtered.length === 0) {
    panel.innerHTML = '<div class="storage-empty">No matching notes.</div>';
    return;
  }
  panel.innerHTML = filtered.map((note) => {
    const clusterChip = renderClusterChip(note);
    return `
    <div class="storage-note-item${note.id === storageState.selectedNoteId ? ' selected' : ''}" data-id="${note.id}">
      <div class="storage-note-content">${escapeHtml(trimText(note.content))}</div>
      ${renderTagChips(note, 3)}
      ${clusterChip ? `<div class="note-tag-row">${clusterChip}</div>` : ''}
      <div class="storage-note-date">${escapeHtml(new Date(note.created_at).toLocaleString())}</div>
    </div>`;
  }).join('');

  panel.querySelectorAll('.storage-note-item').forEach((item) => {
    item.addEventListener('click', () => {
      storageState.selectedNoteId = item.dataset.id;
      renderStorageList();
      renderStorageGraph();
      renderStorageDetail();
    });
  });
}

// ── force-directed 그래프 ──

function initGraphPositions(width, height) {
  const existing = storageState.graphNodes || {};
  const nodes = {};
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  
  storageState.notes.forEach((note, i) => {
    if (existing[note.id]) {
      nodes[note.id] = existing[note.id];
    } else {
      const angle = (Math.PI * 2 * i) / (storageState.notes.length || 1);
      nodes[note.id] = {
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 20,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0
      };
    }
  });
  storageState.graphNodes = nodes;
  return nodes;
}

function runForceLayout(nodes, width, height, iterations = 80) {
  const noteIds = storageState.notes.map(n => n.id);
  const allEdges = [
    ...storageState.links.map(l => ({ source: l.source_id, target: l.target_id })),
    ...storageState.evolutions.map(e => ({ source: e.source_id, target: e.target_id }))
  ];

  // 클러스터별 노드 그룹
  const clusterGroups = {};
  storageState.notes.forEach((note) => {
    const cid = normalizeClusterId(note.cluster_id);
    if (!cid) return;
    if (!clusterGroups[cid]) clusterGroups[cid] = [];
    clusterGroups[cid].push(note.id);
  });

  const k = Math.sqrt((width * height) / Math.max(noteIds.length, 1));
  const repulsion = k * 1.3;
  const targetDistance = Math.max(72, Math.min(150, k * 1.2));
  const collisionDistance = Math.max(120, Math.min(200, k * 1.4));
  const clusterTargetDist = Math.max(50, Math.min(90, k * 0.8));

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;

    // 반발력
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const a = nodes[noteIds[i]], b = nodes[noteIds[j]];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = (repulsion * repulsion) / dist;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // 인력 (엣지)
    allEdges.forEach(({ source, target }) => {
      const a = nodes[source], b = nodes[target];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const force = (dist - targetDistance) * 0.08;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    // 클러스터 인력 — 같은 클러스터 노드끼리 가까이 당긴다
    Object.values(clusterGroups).forEach((ids) => {
      if (ids.length < 2) return;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = nodes[ids[i]], b = nodes[ids[j]];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          if (dist <= clusterTargetDist) continue;
          const force = (dist - clusterTargetDist) * 0.12;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
    });

    // 충돌 방지
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const a = nodes[noteIds[i]], b = nodes[noteIds[j]];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        if (dist >= collisionDistance) continue;
        const push = (collisionDistance - dist) * 0.22;
        const fx = (dx / dist) * push, fy = (dy / dist) * push;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // 위치 업데이트 + 경계 처리
    const maxDisp = 30 * cooling + 2;
    const pad = 200;
    noteIds.forEach(id => {
      const n = nodes[id];
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      const clamp = Math.min(speed, maxDisp);
      n.x += (n.vx / speed) * clamp;
      n.y += (n.vy / speed) * clamp;
      n.x = Math.max(pad, Math.min(width - pad, n.x));
      n.y = Math.max(pad, Math.min(height - pad, n.y));
      n.vx *= 0.6; n.vy *= 0.6;
    });
  }
}

// ── convex hull (Gift wrapping) ──

function computeConvexHull(points) {
  if (points.length < 2) return points;
  if (points.length === 2) return points;

  // 가장 왼쪽 점 찾기
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[start].x) start = i;
  }

  const hull = [];
  let current = start;
  do {
    hull.push(points[current]);
    let next = (current + 1) % points.length;
    for (let i = 0; i < points.length; i++) {
      const cross = (points[next].x - points[current].x) * (points[i].y - points[current].y)
                  - (points[next].y - points[current].y) * (points[i].x - points[current].x);
      if (cross < 0) next = i;
    }
    current = next;
  } while (current !== start && hull.length <= points.length);

  return hull;
}

// hull 점들을 padding만큼 바깥으로 확장한 부드러운 path 생성
function hullToRoundedPath(hull, padding) {
  if (hull.length === 1) {
    const p = hull[0];
    return `M ${p.x - padding} ${p.y} a ${padding} ${padding} 0 1 0 ${padding * 2} 0 a ${padding} ${padding} 0 1 0 ${-padding * 2} 0`;
  }
  if (hull.length === 2) {
    const cx = (hull[0].x + hull[1].x) / 2;
    const cy = (hull[0].y + hull[1].y) / 2;
    const r = Math.sqrt((hull[1].x - hull[0].x) ** 2 + (hull[1].y - hull[0].y) ** 2) / 2 + padding;
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
  }

  // 각 점에서 바깥 방향 계산 후 padding 이동
  const n = hull.length;
  const expanded = hull.map((pt, i) => {
    const prev = hull[(i - 1 + n) % n];
    const next = hull[(i + 1) % n];
    const dx1 = pt.x - prev.x, dy1 = pt.y - prev.y;
    const dx2 = next.x - pt.x, dy2 = next.y - pt.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    // 두 엣지의 평균 법선 방향 (바깥쪽)
    const nx = (dy1 / len1 + dy2 / len2) / 2;
    const ny = (-dx1 / len1 - dx2 / len2) / 2;
    const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    return { x: pt.x - (nx / nlen) * padding, y: pt.y - (ny / nlen) * padding };
  });

  // 부드러운 곡선 (catmull-rom 근사)
  const parts = [];
  for (let i = 0; i < expanded.length; i++) {
    const p0 = expanded[(i - 1 + expanded.length) % expanded.length];
    const p1 = expanded[i];
    const p2 = expanded[(i + 1) % expanded.length];
    const cp1x = p1.x + (p2.x - p0.x) * 0.15;
    const cp1y = p1.y + (p2.y - p0.y) * 0.15;
    const cp2x = p2.x - (expanded[(i + 2) % expanded.length].x - p1.x) * 0.15;
    const cp2y = p2.y - (expanded[(i + 2) % expanded.length].y - p1.y) * 0.15;
    if (i === 0) parts.push(`M ${p1.x} ${p1.y}`);
    parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function renderClusterHulls(svg, nodes, clusterGroups) {
  Object.entries(clusterGroups).forEach(([cid, ids]) => {
    const pts = ids.map(id => nodes[id]).filter(Boolean);
    if (pts.length === 0) return;

    const hull = computeConvexHull(pts);
    const pad = 28;
    const pathD = hullToRoundedPath(hull, pad);
    const hue = getClusterHue(cid);

    const area = createSvgEl('path', {
      d: pathD,
      class: 'cluster-hull',
      fill: `hsl(${hue} 65% 68%)`,
      stroke: `hsl(${hue} 60% 48%)`,
      'fill-opacity': '0.13',
      'stroke-opacity': '0.45',
      'stroke-width': '1.5',
      'stroke-dasharray': '4 3'
    });
    svg.appendChild(area);

    // 클러스터 이름 레이블 — hull 중심 위쪽
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const minY = Math.min(...pts.map(p => p.y));
    const labelY = minY - pad - 6;

    const label = createSvgEl('text', {
      x: cx,
      y: labelY,
      class: 'cluster-hull-label',
      fill: `hsl(${hue} 55% 38%)`
    });
    label.textContent = trimText(cid, 18);
    svg.appendChild(label);
  });
}

function renderStorageGraph() {
  const panel = document.getElementById('storageGraph');
  if (!panel) return;
  panel.innerHTML = '';
  if (storageState.notes.length === 0) {
    panel.innerHTML = '<div class="storage-empty">No completed notes to render yet.</div>';
    return;
  }

  const width = Math.max(320, panel.clientWidth || 320);
  const height = Math.max(260, panel.clientHeight || 260);

  const nodes = initGraphPositions(width, height);
  runForceLayout(nodes, width, height, storageState.notes.length > 1 ? Math.min(180, 72 + storageState.notes.length * 2) : 0);

  const svg = createSvgEl('svg', { class: 'storage-graph-svg', viewBox: `0 0 ${width} ${height}` });
  const selectedId = storageState.selectedNoteId;
  const edgeTotal = storageState.links.length + storageState.evolutions.length;
  const showAllEdgeLabels = edgeTotal <= 18;

  // 클러스터 그룹 구성
  const clusterGroups = {};
  const clusterCounts = {};
  storageState.notes.forEach((n) => {
    const cid = normalizeClusterId(n.cluster_id);
    if (!cid) return;
    if (!clusterGroups[cid]) clusterGroups[cid] = [];
    clusterGroups[cid].push(n.id);
    clusterCounts[cid] = (clusterCounts[cid] || 0) + 1;
  });
  const clusterEntries = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // 노드 크기 사전 계산 (교점 계산용)
  const nodeDims = {};
  storageState.notes.forEach(note => {
    const labelText = note.content || '';
    const boxW = 180;
    const boxH = Math.max(60, Math.min(160, (labelText.length / 20) * 16 + 40));
    nodeDims[note.id] = { w: boxW, h: boxH };
  });

  // 클러스터 hull — 엣지보다 먼저, 노드보다 뒤에 그린다
  renderClusterHulls(svg, nodes, clusterGroups);

  const connectedToSelected = new Set();
  if (selectedId) {
    storageState.links.forEach((l) => {
      if (l.source_id === selectedId) connectedToSelected.add(l.target_id);
      if (l.target_id === selectedId) connectedToSelected.add(l.source_id);
    });
    storageState.evolutions.forEach((e) => {
      if (e.source_id === selectedId) connectedToSelected.add(e.target_id);
      if (e.target_id === selectedId) connectedToSelected.add(e.source_id);
    });
  }

  const degreeByNode = {};
  storageState.notes.forEach((n) => { degreeByNode[n.id] = 0; });
  [...storageState.links, ...storageState.evolutions].forEach((e) => {
    if (degreeByNode[e.source_id] !== undefined) degreeByNode[e.source_id] += 1;
    if (degreeByNode[e.target_id] !== undefined) degreeByNode[e.target_id] += 1;
  });

  const edgeSlotMap = {};
  const getEdgeSlot = (a, b) => {
    const key = [a, b].sort().join('::');
    edgeSlotMap[key] = (edgeSlotMap[key] || 0) + 1;
    return edgeSlotMap[key];
  };

  const makeEdgeLabelPosition = (from, to, slot) => {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;
    const sign = slot % 2 === 0 ? -1 : 1;
    const band = Math.floor((slot - 1) / 2);
    const offset = sign * (6 + band * 8);
    return { x: midX + nx * offset, y: midY + ny * offset };
  };

  // defs: 화살표 마커 두 종류
  const defs = createSvgEl('defs');

  const makeMarker = (id, color) => {
    const marker = createSvgEl('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.appendChild(createSvgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
    return marker;
  };
  defs.appendChild(makeMarker('arrow-link', 'var(--accent)'));
  defs.appendChild(makeMarker('arrow-evo', '#9b7ec8'));
  svg.appendChild(defs);

  // NoteLink 엣지 (실선)
  storageState.links.forEach((link) => {
    const from = nodes[link.source_id], to = nodes[link.target_id];
    if (!from || !to) return;
    const dFrom = nodeDims[link.source_id], dTo = nodeDims[link.target_id];
    const p1 = getPointOnRect(to, from, dFrom.w, dFrom.h);
    const p2 = getPointOnRect(from, to, dTo.w, dTo.h);

    const highlighted = !selectedId || link.source_id === selectedId || link.target_id === selectedId;
    const line = createSvgEl('line', {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      class: 'storage-edge' + (highlighted ? '' : ' muted'),
      'marker-end': 'url(#arrow-link)'
    });
    svg.appendChild(line);
    if (showAllEdgeLabels || highlighted) {
      const slot = getEdgeSlot(link.source_id, link.target_id);
      const pos = makeEdgeLabelPosition(from, to, slot);
      const label = createSvgEl('text', { x: pos.x, y: pos.y, class: 'storage-edge-label' + (highlighted ? '' : ' muted') });
      label.textContent = link.type || 'related';
      svg.appendChild(label);
    }
  });

  // NoteEvolution 엣지 (점선 + 보라색)
  storageState.evolutions.forEach((evo) => {
    const from = nodes[evo.source_id], to = nodes[evo.target_id];
    if (!from || !to) return;
    const dFrom = nodeDims[evo.source_id], dTo = nodeDims[evo.target_id];
    const p1 = getPointOnRect(to, from, dFrom.w, dFrom.h);
    const p2 = getPointOnRect(from, to, dTo.w, dTo.h);

    const highlighted = !selectedId || evo.source_id === selectedId || evo.target_id === selectedId;
    const line = createSvgEl('line', {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      class: 'storage-edge evo-edge' + (highlighted ? '' : ' muted'),
      'marker-end': 'url(#arrow-evo)',
      'stroke-dasharray': '5 3'
    });
    svg.appendChild(line);
    if (showAllEdgeLabels || highlighted) {
      const slot = getEdgeSlot(evo.source_id, evo.target_id);
      const pos = makeEdgeLabelPosition(from, to, slot);
      const label = createSvgEl('text', { x: pos.x, y: pos.y, class: 'storage-edge-label evo-label' + (highlighted ? '' : ' muted') });
      label.textContent = evo.evolution_type;
      svg.appendChild(label);
    }
  });

  // 노드
  storageState.notes.forEach((note) => {
    const pos = nodes[note.id];
    const selected = note.id === storageState.selectedNoteId;
    const isNeighbor = selectedId ? connectedToSelected.has(note.id) : false;
    const dimmed = !!selectedId && !selected && !isNeighbor;
    
    const labelText = note.content || '';
    const { w: boxW, h: boxH } = nodeDims[note.id];
    
    const clusterId = normalizeClusterId(note.cluster_id);
    const clusterHue = clusterId ? getClusterHue(clusterId) : null;
    const fillColor = clusterHue === null ? null : `hsl(${clusterHue} 55% ${selected ? 55 : 72}%)`;
    const strokeColor = clusterHue === null ? null : `hsl(${clusterHue} 45% ${selected ? 45 : 55}%)`;
    
    const rect = createSvgEl('rect', {
      x: pos.x - boxW / 2,
      y: pos.y - boxH / 2,
      width: boxW,
      height: boxH,
      rx: 8, ry: 8,
      class: 'storage-node' + (selected ? ' selected' : '') + (dimmed ? ' dimmed' : '')
    });
    if (fillColor) rect.setAttribute('fill', fillColor);
    if (strokeColor) rect.setAttribute('stroke', strokeColor);
    rect.addEventListener('click', () => {
      storageState.selectedNoteId = note.id;
      renderStorageList();
      renderStorageGraph();
      renderStorageDetail();
    });
    svg.appendChild(rect);

    const fo = createSvgEl('foreignObject', {
      x: pos.x - boxW / 2 + 10,
      y: pos.y - boxH / 2 + 10,
      width: boxW - 20,
      height: boxH - 20,
      style: 'pointer-events: none;'
    });
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px; line-height:1.3; color:var(--text); word-break:break-all; white-space:pre-wrap; overflow:hidden; height:100%; opacity:${dimmed ? 0.4 : 1}">${escapeHtml(labelText)}</div>`;
    svg.appendChild(fo);
  });

  if (clusterEntries.length > 0) {
    const legend = createSvgEl('g', { class: 'storage-cluster-legend' });
    const maxItems = Math.min(6, clusterEntries.length);
    const totalRows = maxItems + (clusterEntries.length > maxItems ? 1 : 0);
    const boxX = 8;
    const boxY = 8;
    const rowH = 16;
    const titleH = 18;
    const boxW = Math.min(250, Math.max(160, width * 0.42));
    const boxH = 10 + titleH + totalRows * rowH + 6;
    legend.appendChild(createSvgEl('rect', {
      x: boxX, y: boxY, width: boxW, height: boxH, rx: 8, ry: 8, class: 'storage-cluster-legend-bg'
    }));
    const title = createSvgEl('text', {
      x: boxX + 10, y: boxY + 15, class: 'storage-cluster-legend-title'
    });
    title.textContent = 'Clusters';
    legend.appendChild(title);

    for (let i = 0; i < maxItems; i++) {
      const [cid, count] = clusterEntries[i];
      const y = boxY + titleH + 8 + i * rowH;
      const hue = getClusterHue(cid);
      legend.appendChild(createSvgEl('circle', {
        cx: boxX + 15, cy: y - 4, r: 4, fill: `hsl(${hue} 70% 58%)`, stroke: `hsl(${hue} 72% 36%)`
      }));
      const text = createSvgEl('text', {
        x: boxX + 24, y, class: 'storage-cluster-legend-item'
      });
      text.textContent = `${trimText(cid, 20)} (${count})`;
      legend.appendChild(text);
    }
    if (clusterEntries.length > maxItems) {
      const more = createSvgEl('text', {
        x: boxX + 24, y: boxY + titleH + 8 + maxItems * rowH, class: 'storage-cluster-legend-item'
      });
      more.textContent = `+${clusterEntries.length - maxItems} more`;
      legend.appendChild(more);
    }
    svg.appendChild(legend);
  }

  panel.appendChild(svg);
}

// ── STORAGE DETAIL ──

function renderStorageDetail() {
  const panel = document.getElementById('storageDetail');
  if (!panel) return;

  if (!storageState.selectedNoteId) {
    panel.className = 'storage-empty';
    panel.textContent = 'Select a note from the list or graph.';
    return;
  }

  const note = storageState.notes.find(n => n.id === storageState.selectedNoteId);
  if (!note) { panel.className = 'storage-empty'; panel.textContent = 'Note not found.'; return; }

  const relatedLinks = storageState.links.filter(l => l.source_id === note.id || l.target_id === note.id);
  const relatedEvos = storageState.evolutions.filter(e => e.source_id === note.id || e.target_id === note.id);
  const attachments = getNoteAttachments(note);
  const clusterId = normalizeClusterId(note.cluster_id) || '';

  const targetOptions = storageState.notes
    .filter(n => n.id !== note.id)
    .map(n => `<option value="${escapeHtml(trimText(n.content, 64))}"></option>`)
    .join('');

  const linkTypeHtml = LINK_TYPE_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('');
  const evoTypeHtml = EVOLUTION_TYPE_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('');

  panel.className = '';
  panel.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:20px">Note Detail</h2>
    <p style="margin:0 0 14px;font-size:12px;color:var(--text-muted)">Created: ${escapeHtml(new Date(note.created_at).toLocaleString())}</p>
    <div class="storage-note-box">${escapeHtml(note.content || '(No content)')}</div>

    <h3 class="storage-section-title">Attachments <span style="font-size:11px;font-weight:400;opacity:.7">(${attachments.length})</span></h3>
    <div id="storageAttachments">${attachments.length === 0
      ? '<div class="storage-empty" style="padding:8px 0">No attachments.</div>'
      : attachments.map((a) => `<div class="attachment-row"><a class="attachment-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.label || a.url)}</a></div>`).join('')
    }</div>

    ${uiState.advancedMode ? `
    <h3 class="storage-section-title">Cluster (Advanced)</h3>
    <div class="storage-link-form">
      <input id="sClusterId" class="storage-input" placeholder="cluster id (optional)" value="${escapeHtml(clusterId)}">
      <button id="sSaveCluster" class="storage-btn primary">Save Cluster</button>
      <button id="sClearCluster" class="storage-btn">Clear</button>
    </div>` : ''}

    <h3 class="storage-section-title">Links <span style="font-size:11px;font-weight:400;opacity:.7">(${relatedLinks.length})</span></h3>
    <div id="storageLinks"></div>
    <div class="storage-link-form" style="margin-top:8px">
      <input id="sLinkTarget" list="sLinkTargetList" class="storage-input" placeholder="Search note…">
      <datalist id="sLinkTargetList">${targetOptions}</datalist>
      <select id="sLinkType" class="storage-select">${linkTypeHtml}</select>
      <button id="sAddLink" class="storage-btn primary">Add</button>
    </div>

    <h3 class="storage-section-title">Evolutions <span style="font-size:11px;font-weight:400;opacity:.7">(${relatedEvos.length})</span></h3>
    <div id="storageEvolutions"></div>
    <div class="storage-link-form" style="margin-top:8px">
      <input id="sEvoTarget" list="sEvoTargetList" class="storage-input" placeholder="Search note…">
      <datalist id="sEvoTargetList">${targetOptions}</datalist>
      <select id="sEvoType" class="storage-select">${evoTypeHtml}</select>
      <button id="sAddEvo" class="storage-btn primary">Add</button>
    </div>

    <button id="storageDeleteNote" class="storage-btn danger">Delete Note</button>`;

  renderStorageLinks(relatedLinks, note.id);
  renderStorageEvolutions(relatedEvos, note.id);

  document.getElementById('sAddLink').addEventListener('click', () => addStorageLink(note.id));
  document.getElementById('sAddEvo').addEventListener('click', () => addStorageEvolution(note.id));
  document.getElementById('storageDeleteNote').addEventListener('click', () => deleteStorageNote(note.id));
  if (uiState.advancedMode) {
    document.getElementById('sSaveCluster').addEventListener('click', async () => {
      const input = document.getElementById('sClusterId');
      const nextClusterId = normalizeClusterId(input ? input.value : '');
      await updateNote(note.id, { cluster_id: nextClusterId });
      await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
      showStatus('storageStatus', 'Cluster updated.', 'success');
    });
    document.getElementById('sClearCluster').addEventListener('click', async () => {
      await updateNote(note.id, { cluster_id: null });
      await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
      showStatus('storageStatus', 'Cluster cleared.', 'success');
    });
  }
}

function renderStorageLinks(links, noteId) {
  const container = document.getElementById('storageLinks');
  if (!container) return;
  if (links.length === 0) { container.innerHTML = '<div class="storage-empty" style="padding:8px 0">No links.</div>'; return; }
  container.innerHTML = links.map((link) => {
    const out = link.source_id === noteId;
    const other = storageState.notes.find(n => n.id === (out ? link.target_id : link.source_id));
    return `
      <div class="storage-link-row">
        <div class="storage-link-head">
          <span class="storage-link-type">${escapeHtml(link.type || 'related')}</span>
          <button class="storage-link-remove" data-id="${link.id}">Delete</button>
        </div>
        <div>${out ? '→' : '←'} ${escapeHtml(trimText(other ? other.content : '(Deleted)', 48))}</div>
      </div>`;
  }).join('');
  container.querySelectorAll('.storage-link-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteLink(btn.dataset.id);
      await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
      showStatus('storageStatus', 'Link deleted.', 'success');
    });
  });
}

function renderStorageEvolutions(evos, noteId) {
  const container = document.getElementById('storageEvolutions');
  if (!container) return;
  if (evos.length === 0) { container.innerHTML = '<div class="storage-empty" style="padding:8px 0">No evolutions.</div>'; return; }
  container.innerHTML = evos.map((evo) => {
    const out = evo.source_id === noteId;
    const other = storageState.notes.find(n => n.id === (out ? evo.target_id : evo.source_id));
    return `
      <div class="storage-link-row evo-row">
        <div class="storage-link-head">
          <span class="storage-link-type evo-type ${escapeHtml(evo.evolution_type)}">${escapeHtml(evo.evolution_type)}</span>
          <button class="storage-link-remove" data-id="${evo.id}">Delete</button>
        </div>
        <div>${out ? '→' : '←'} ${escapeHtml(trimText(other ? other.content : '(Deleted)', 48))}</div>
      </div>`;
  }).join('');
  container.querySelectorAll('.storage-link-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteEvolution(btn.dataset.id);
      await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
      showStatus('storageStatus', 'Evolution deleted.', 'success');
    });
  });
}

async function addStorageLink(noteId) {
  const targetQuery = document.getElementById('sLinkTarget').value.trim();
  const linkType = document.getElementById('sLinkType').value || 'related';
  const target = findNoteByQuery(noteId, targetQuery, storageState.notes);
  if (!target) { showStatus('storageStatus', 'Target not found.', 'error'); return; }
  const dup = storageState.links.find(l => l.source_id === noteId && l.target_id === target.id && l.type === linkType);
  if (dup) { showStatus('storageStatus', 'Same link already exists.', 'error'); return; }
  await saveLink({ id: generateId(), source_id: noteId, target_id: target.id, type: linkType, created_at: new Date().toISOString() });
  await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
  showStatus('storageStatus', 'Link added.', 'success');
}

async function addStorageEvolution(noteId) {
  const targetQuery = document.getElementById('sEvoTarget').value.trim();
  const evoType = document.getElementById('sEvoType').value || 'extends';
  const target = findNoteByQuery(noteId, targetQuery, storageState.notes);
  if (!target) { showStatus('storageStatus', 'Target not found.', 'error'); return; }
  const dup = storageState.evolutions.find(e => e.source_id === noteId && e.target_id === target.id && e.evolution_type === evoType);
  if (dup) { showStatus('storageStatus', 'Same evolution already exists.', 'error'); return; }
  await saveEvolution({ id: generateId(), source_id: noteId, target_id: target.id, evolution_type: evoType, evolved_at: new Date().toISOString() });
  await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
  showStatus('storageStatus', 'Evolution added.', 'success');
}

async function deleteStorageNote(noteId) {
  if (!confirm('Delete selected note?')) return;
  await deleteNote(noteId);
  const related = storageState.links.filter(l => l.source_id === noteId || l.target_id === noteId);
  const relatedEvos = storageState.evolutions.filter(e => e.source_id === noteId || e.target_id === noteId);
  for (const l of related) await deleteLink(l.id);
  for (const e of relatedEvos) await deleteEvolution(e.id);
  storageState.selectedNoteId = null;
  await loadStorageData(); renderStorageList(); renderStorageGraph(); renderStorageDetail();
  showStatus('storageStatus', 'Note deleted.', 'success');
}

// ── ROUTE ──

function clearTimers() {
  if (statsIntervalId) { clearInterval(statsIntervalId); statsIntervalId = null; }
}

async function renderRoute() {
  clearTimers();
  const route = getRouteKeyFromLocation();
  renderNav(route);

  if (route === 'home') {
    renderHome(); await loadHomeStats();
    statsIntervalId = setInterval(loadHomeStats, 5000);
    return;
  }
  if (route === 'capture') { renderCapture(); return; }
  if (route === 'processing') { processingState.query = ''; await loadProcessingNotes(); renderProcessing(); return; }
  if (route === 'storage') { await loadStorageData(); renderStorage(); return; }
  document.getElementById('app-root').innerHTML = '<section class="placeholder"><h2>Not Found</h2></section>';
}

async function initApp() {
  loadUiState();
  applyRouteFromQueryFallback();
  try {
    await initDB();
    await renderRoute();
  } catch (e) {
    console.error('Failed to initialize app:', e);
    document.getElementById('app-root').innerHTML = `<section class="placeholder"><h2>Initialization Error</h2><p>${e.message}</p></section>`;
  }

  window.addEventListener('popstate', () => renderRoute());
  window.addEventListener('keydown', async (e) => {
    if (!(e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a'))) return;
    setAdvancedMode(!uiState.advancedMode);
    await renderRoute();
  });
  window.addEventListener('resize', () => {
    if (getRouteKeyFromLocation() === 'storage') {
      storageState.graphNodes = null;
      renderStorageGraph();
    }
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'inline-block';
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((registration) => {
          wireServiceWorkerUpdates(registration);
          setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
        })
        .catch(e => console.error('SW registration failed:', e));
    });
  }
}

window.addEventListener('DOMContentLoaded', initApp);
