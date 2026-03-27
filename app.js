const routes = [
  { key: 'home', label: 'Home' },
  { key: 'capture', label: 'Capture' },
  { key: 'processing', label: 'Processing' },
  { key: 'storage', label: 'Storage' }
];

let deferredPrompt = null;
let statsIntervalId = null;
const processingState = {
  notes: [],
  selectedIndex: -1
};
const storageState = {
  notes: [],
  links: [],
  selectedNoteId: null
};
const linkTypeOptions = ['related', 'supports', 'contrasts', 'depends_on', 'duplicates'];

const routeKeySet = new Set(routes.map((route) => route.key));

function getBasePath() {
  const path = window.location.pathname;
  if (path.endsWith('/index.html')) {
    return path.slice(0, -'/index.html'.length) || '/';
  }
  return '/';
}

function normalizePath(path) {
  const withLeadingSlash = path.startsWith('/') ? path : '/' + path;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

function routePath(key) {
  const base = getBasePath();
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (key === 'home') return (cleanBase || '') + '/';
  return (cleanBase || '') + '/' + key;
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
    window.history.replaceState({}, '', url.pathname);
  } catch (error) {
    console.warn('Invalid route query fallback:', error);
  }
}

function navigateToRoute(routeKey, replace = false) {
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', routePath(routeKey));
  renderRoute();
}

function renderNav(activeKey) {
  const nav = document.getElementById('app-nav');
  nav.innerHTML = `
    <nav class="spa-nav">
      <ul>
        ${routes.map((route) => `<li><a href="${routePath(route.key)}" data-route="${route.key}" class="${route.key === activeKey ? 'active' : ''}">${route.label}</a></li>`).join('')}
      </ul>
    </nav>
  `;

  bindRouteLinks(nav);
}

function renderHome() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="container">
      <h1>Memoirage</h1>
      <p class="subtitle">Capture fleeting thoughts and connect them later.</p>

      <div class="menu">
        <a href="${routePath('capture')}" data-route="capture" class="menu-item">
          <h3>Capture</h3>
          <p>Save ideas quickly as inbox notes.</p>
        </a>
        <a href="${routePath('processing')}" data-route="processing" class="menu-item">
          <h3>Processing</h3>
          <p>Review inbox notes and move them forward.</p>
        </a>
        <a href="${routePath('storage')}" data-route="storage" class="menu-item">
          <h3>Storage</h3>
          <p>Browse done notes and manage links.</p>
        </a>
      </div>

      <div class="status">
        <h4>Workspace Status</h4>
        <div id="stats" class="stats">
          <div class="stat">
            <div class="number" id="inboxCount">-</div>
            <div class="label">Inbox</div>
          </div>
          <div class="stat">
            <div class="number" id="doneCount">-</div>
            <div class="label">Done</div>
          </div>
          <div class="stat">
            <div class="number" id="totalCount">-</div>
            <div class="label">Total</div>
          </div>
        </div>
      </div>

      <button id="installBtn" class="install-btn">Install App</button>
    </div>
  `;

  const installBtn = document.getElementById('installBtn');
  if (deferredPrompt) {
    installBtn.style.display = 'inline-block';
  }

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  bindRouteLinks(root);
}

function renderPlaceholder(title) {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <section class="placeholder">
      <h2>${title}</h2>
      <p>This route will be migrated from the existing page in the next step.</p>
    </section>
  `;
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCapture() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <section class="capture-card">
      <h2>Quick Capture</h2>
      <textarea id="captureContent" placeholder="Write anything..."></textarea>
      <button id="captureSubmit">Save</button>
      <div id="captureStatus" class="capture-status"></div>
    </section>
  `;

  const submitButton = document.getElementById('captureSubmit');
  submitButton.addEventListener('click', async () => {
    const textarea = document.getElementById('captureContent');
    const statusEl = document.getElementById('captureStatus');
    const content = textarea.value.trim();

    if (!content) {
      showCaptureStatus(statusEl, 'Please enter content', 'error');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';

    try {
      await saveNote({
        id: generateId(),
        type: 'text',
        content,
        status: 'inbox',
        tags: [],
        created_at: new Date().toISOString(),
        deleted_at: null
      });

      textarea.value = '';
      showCaptureStatus(statusEl, 'Saved!', 'success');
    } catch (error) {
      console.error('Save failed:', error);
      showCaptureStatus(statusEl, 'Save failed: ' + error.message, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Save';
    }
  });
}

function showCaptureStatus(element, message, type) {
  element.textContent = message;
  element.className = 'capture-status show ' + type;
  setTimeout(() => {
    element.className = 'capture-status';
  }, 2500);
}

async function loadProcessingNotes() {
  const [inboxNotes, processingNotes] = await Promise.all([
    getNotes({ status: 'inbox', include_deleted: false }),
    getNotes({ status: 'processing', include_deleted: false })
  ]);

  processingState.notes = [...processingNotes, ...inboxNotes].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

function renderProcessing() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="processing-wrap">
      <section id="processingList" class="processing-list"></section>
      <section id="processingDetail" class="processing-detail"><p>Select a note...</p></section>
    </div>
  `;

  renderProcessingList();
  renderProcessingDetail();
}

async function loadStorageData() {
  const doneNotes = await getNotes({ status: 'done', include_deleted: false });
  const allLinks = await getLinks({});

  doneNotes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  storageState.notes = doneNotes;

  const doneIds = new Set(doneNotes.map((note) => note.id));
  storageState.links = allLinks.filter((link) => doneIds.has(link.source_id) && doneIds.has(link.target_id));

  if (storageState.selectedNoteId && !doneIds.has(storageState.selectedNoteId)) {
    storageState.selectedNoteId = null;
  }
}

function getStorageNoteById(id) {
  return storageState.notes.find((note) => note.id === id) || null;
}

function getStorageRelatedLinks(noteId) {
  return storageState.links.filter((link) => link.source_id === noteId || link.target_id === noteId);
}

function getStorageTargetCandidates(noteId) {
  return storageState.notes
    .filter((item) => item.id !== noteId)
    .map((item) => ({
      id: item.id,
      content: item.content || '(No content)',
      display: trimText(item.content || '(No content)', 64)
    }));
}

function findStorageTargetByQuery(noteId, query) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return null;

  const candidates = getStorageTargetCandidates(noteId);
  const exact = candidates.find((item) => item.id === query || item.display.toLowerCase() === normalized);
  if (exact) return exact;

  const includes = candidates.filter((item) => item.content.toLowerCase().includes(normalized));
  if (includes.length === 1) return includes[0];
  return null;
}

function trimText(text, max = 42) {
  if (!text) return '(No content)';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function getNoteStatusLabel(status) {
  if (status === 'processing') return 'Processing';
  if (status === 'done') return 'Done';
  return 'Inbox';
}

function renderStorage() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="storage-wrap">
      <aside class="storage-panel storage-left">
        <h2 class="storage-title">Done Notes</h2>
        <div id="storageList"></div>
      </aside>
      <section class="storage-panel storage-center">
        <div id="storageGraph" class="storage-graph"></div>
      </section>
      <aside class="storage-panel storage-right">
        <div id="storageStatus" class="storage-status"></div>
        <div id="storageDetail" class="storage-empty">Select a note from the list or graph.</div>
      </aside>
    </div>
  `;

  renderStorageList();
  renderStorageGraph();
  renderStorageDetail();
}

function renderStorageList() {
  const panel = document.getElementById('storageList');
  if (!panel) return;

  if (storageState.notes.length === 0) {
    panel.innerHTML = '<div class="storage-empty">No completed notes yet.</div>';
    return;
  }

  panel.innerHTML = storageState.notes.map((note) => {
    const selectedClass = note.id === storageState.selectedNoteId ? ' selected' : '';
    return `
      <div class="storage-note-item${selectedClass}" data-id="${note.id}">
        <div class="storage-note-content">${escapeHtml(trimText(note.content))}</div>
        <div class="storage-note-date">${escapeHtml(new Date(note.created_at).toLocaleString())}</div>
      </div>
    `;
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

function computeStoragePositions(width, height) {
  const padding = 56;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(40, Math.min(width, height) / 2 - padding);
  const positions = new Map();

  storageState.notes.forEach((note, index) => {
    const angle = (Math.PI * 2 * index) / storageState.notes.length;
    const jitter = (index % 3) * 10;
    positions.set(note.id, {
      x: centerX + Math.cos(angle) * (radius - jitter),
      y: centerY + Math.sin(angle) * (radius - jitter)
    });
  });

  return positions;
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]));
  return el;
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
  const positions = computeStoragePositions(width, height);

  const svg = createSvgEl('svg', { class: 'storage-graph-svg', viewBox: `0 0 ${width} ${height}` });
  const defs = createSvgEl('defs');
  const marker = createSvgEl('marker', {
    id: 'spa-arrow',
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse'
  });
  marker.appendChild(createSvgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#8b95a7' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  storageState.links.forEach((link) => {
    const from = positions.get(link.source_id);
    const to = positions.get(link.target_id);
    if (!from || !to) return;

    svg.appendChild(createSvgEl('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      class: 'storage-edge',
      'marker-end': 'url(#spa-arrow)'
    }));

    const label = createSvgEl('text', {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - 4,
      class: 'storage-edge-label'
    });
    label.textContent = (link.type || 'related').slice(0, 12);
    svg.appendChild(label);
  });

  storageState.notes.forEach((note) => {
    const point = positions.get(note.id);
    const selected = note.id === storageState.selectedNoteId;
    const radius = selected ? 18 : 14;

    const node = createSvgEl('circle', {
      cx: point.x,
      cy: point.y,
      r: radius,
      class: 'storage-node' + (selected ? ' selected' : '')
    });
    node.addEventListener('click', () => {
      storageState.selectedNoteId = note.id;
      renderStorageList();
      renderStorageGraph();
      renderStorageDetail();
    });
    svg.appendChild(node);

    const text = createSvgEl('text', {
      x: point.x,
      y: point.y + radius + 13,
      class: 'storage-node-label'
    });
    text.textContent = trimText(note.content, 16);
    svg.appendChild(text);
  });

  panel.appendChild(svg);
}

function renderStorageDetail() {
  const panel = document.getElementById('storageDetail');
  if (!panel) return;

  if (!storageState.selectedNoteId) {
    panel.className = 'storage-empty';
    panel.textContent = 'Select a note from the list or graph.';
    return;
  }

  const note = getStorageNoteById(storageState.selectedNoteId);
  if (!note) {
    panel.className = 'storage-empty';
    panel.textContent = 'Selected note was not found.';
    return;
  }

  const relatedLinks = getStorageRelatedLinks(note.id);
  const targetCandidates = getStorageTargetCandidates(note.id);
  const targetOptions = targetCandidates
    .map((item) => `<option value="${escapeHtml(item.display)}"></option>`)
    .join('');
  const relationOptions = linkTypeOptions
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join('');

  panel.className = '';
  panel.innerHTML = `
    <h2 style="margin: 0 0 8px 0; font-size: 20px;">Note Detail</h2>
    <p style="margin: 0 0 14px 0; color: #6b7280; font-size: 12px;">Created: ${escapeHtml(new Date(note.created_at).toLocaleString())}</p>
    <div class="storage-note-box">${escapeHtml(note.content || '(No content)')}</div>

    <h3 class="storage-section-title">Add Link</h3>
    <div class="storage-link-form">
      <input id="storageTargetSearch" list="storageTargetOptions" class="storage-input" placeholder="Search note text or paste note id">
      <datalist id="storageTargetOptions">${targetOptions}</datalist>
      <select id="storageType" class="storage-select">${relationOptions}</select>
      <button id="storageAddLink" class="storage-btn primary">Link Note</button>
    </div>
    <p class="storage-link-help">Type part of a note to search target, then choose a relation.</p>

    <h3 class="storage-section-title">Related Links (${relatedLinks.length})</h3>
    <div id="storageLinks"></div>

    <button id="storageDeleteNote" class="storage-btn danger">Delete Note</button>
  `;

  renderStorageLinks(relatedLinks, note.id);

  document.getElementById('storageAddLink').addEventListener('click', addStorageLink);
  document.getElementById('storageDeleteNote').addEventListener('click', deleteStorageNote);
}

function renderStorageLinks(relatedLinks, noteId) {
  const container = document.getElementById('storageLinks');
  if (!container) return;

  if (relatedLinks.length === 0) {
    container.innerHTML = '<div class="storage-empty" style="padding: 10px 0;">No related links.</div>';
    return;
  }

  container.innerHTML = relatedLinks.map((link) => {
    const outgoing = link.source_id === noteId;
    const otherId = outgoing ? link.target_id : link.source_id;
    const other = getStorageNoteById(otherId);
    const direction = outgoing ? '->' : '<-';
    return `
      <div class="storage-link-row">
        <div class="storage-link-head">
          <span class="storage-link-type">${escapeHtml(link.type || 'related')}</span>
          <button class="storage-link-remove" data-link-id="${link.id}">Delete</button>
        </div>
        <div>${direction} ${escapeHtml(trimText(other ? other.content : '(Deleted note)', 48))}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.storage-link-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteStorageLink(btn.dataset.linkId);
    });
  });
}

async function addStorageLink() {
  const target = document.getElementById('storageTargetSearch');
  const type = document.getElementById('storageType');
  if (!target || !type || !storageState.selectedNoteId) return;

  const targetQuery = target.value.trim();
  const targetMatch = findStorageTargetByQuery(storageState.selectedNoteId, targetQuery);
  const targetId = targetMatch ? targetMatch.id : '';
  const linkType = type.value.trim() || 'related';
  if (!targetId) {
    showStorageStatus('Target note not found. Try a more specific keyword.', 'error');
    return;
  }

  const duplicated = storageState.links.find((link) =>
    link.source_id === storageState.selectedNoteId &&
    link.target_id === targetId &&
    (link.type || 'related') === linkType
  );
  if (duplicated) {
    showStorageStatus('The same link already exists.', 'error');
    return;
  }

  await saveLink({
    id: generateId(),
    source_id: storageState.selectedNoteId,
    target_id: targetId,
    type: linkType,
    weight: 1,
    created_at: new Date().toISOString()
  });

  await loadStorageData();
  renderStorageList();
  renderStorageGraph();
  renderStorageDetail();
  showStorageStatus('Link added.', 'success');
}

async function deleteStorageLink(linkId) {
  if (!confirm('Delete this link?')) return;
  await deleteLink(linkId);
  await loadStorageData();
  renderStorageList();
  renderStorageGraph();
  renderStorageDetail();
  showStorageStatus('Link deleted.', 'success');
}

async function deleteStorageNote() {
  if (!storageState.selectedNoteId) return;
  if (!confirm('Delete selected note?')) return;

  const noteId = storageState.selectedNoteId;
  await deleteNote(noteId);
  const related = getStorageRelatedLinks(noteId);
  for (const link of related) {
    await deleteLink(link.id);
  }

  storageState.selectedNoteId = null;
  await loadStorageData();
  renderStorageList();
  renderStorageGraph();
  renderStorageDetail();
  showStorageStatus('Note deleted.', 'success');
}

function showStorageStatus(message, type) {
  const status = document.getElementById('storageStatus');
  if (!status) return;
  status.textContent = message;
  status.className = 'storage-status show ' + type;
  setTimeout(() => {
    status.className = 'storage-status';
  }, 2500);
}

function renderProcessingList() {
  const panel = document.getElementById('processingList');
  if (!panel) return;

  if (processingState.notes.length === 0) {
    panel.innerHTML = '<div style="padding: 20px; color: #999;">No notes</div>';
    return;
  }

  panel.innerHTML = processingState.notes.map((note, idx) => {
    const selectedClass = idx === processingState.selectedIndex ? ' selected' : '';
    return `
      <div class="processing-item${selectedClass}">
        <div class="processing-item-content" data-action="select" data-idx="${idx}">
          <div class="processing-item-text">${escapeHtml(note.content || '(No content)')}</div>
          <div class="processing-item-meta">
            <span class="processing-status-chip ${escapeHtml(note.status || 'inbox')}">${escapeHtml(getNoteStatusLabel(note.status))}</span>
            <span class="processing-item-date">${escapeHtml(new Date(note.created_at).toLocaleString())}</span>
          </div>
        </div>
        <button class="processing-delete-mini" data-action="delete" data-id="${note.id}">Delete</button>
      </div>
    `;
  }).join('');

  panel.querySelectorAll('[data-action=\"select\"]').forEach((el) => {
    el.addEventListener('click', () => {
      processingState.selectedIndex = Number(el.dataset.idx);
      renderProcessingList();
      renderProcessingDetail();
    });
  });

  panel.querySelectorAll('[data-action=\"delete\"]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteProcessingNote(el.dataset.id);
    });
  });
}

function renderProcessingDetail() {
  const panel = document.getElementById('processingDetail');
  if (!panel) return;

  const selected = processingState.notes[processingState.selectedIndex];
  if (!selected) {
    panel.innerHTML = '<p>Select a note...</p>';
    return;
  }

  const currentStatus = selected.status || 'inbox';
  const toggleTarget = currentStatus === 'processing' ? 'inbox' : 'processing';
  const toggleLabel = currentStatus === 'processing' ? 'Move back to Inbox' : 'Start Processing';
  const toggleHelp = currentStatus === 'processing'
    ? 'Send this note back for later review.'
    : 'Move this note into the active processing queue.';

  panel.innerHTML = `
    <div id="processingStatus" class="processing-status"></div>
    <h2 style="margin-top: 0;">Note</h2>
    <p><small>Created: ${escapeHtml(new Date(selected.created_at).toLocaleString())}</small></p>
    <p><small>Current status: <strong>${escapeHtml(getNoteStatusLabel(currentStatus))}</strong></small></p>
    <div class="processing-note-box">${escapeHtml(selected.content || '(No content)')}</div>

    <div class="processing-btn-row">
      <button class="processing-btn primary" id="toggleProcessingBtn">${toggleLabel}</button>
      <button class="processing-btn primary" id="moveDoneBtn">Move to Done</button>
    </div>
    <p class="processing-help-text">${escapeHtml(toggleHelp)}</p>

    <button class="processing-btn danger" id="deleteNoteBtn">Delete Note</button>
  `;

  document.getElementById('toggleProcessingBtn').addEventListener('click', async () => {
    await updateProcessingStatus(toggleTarget);
  });

  document.getElementById('moveDoneBtn').addEventListener('click', async () => {
    await updateProcessingStatus('done');
  });

  document.getElementById('deleteNoteBtn').addEventListener('click', async () => {
    await deleteProcessingNote(selected.id);
  });
}

async function updateProcessingStatus(status) {
  const selected = processingState.notes[processingState.selectedIndex];
  if (!selected) return;

  try {
    await updateNote(selected.id, { status });
    await loadProcessingNotes();
    processingState.selectedIndex = -1;
    renderProcessingList();
    renderProcessingDetail();
  } catch (error) {
    showProcessingStatus('Update failed: ' + error.message, 'error');
  }
}

async function deleteProcessingNote(noteId) {
  if (!confirm('Delete this note?')) return;

  try {
    await deleteNote(noteId);
    await loadProcessingNotes();
    processingState.selectedIndex = -1;
    renderProcessingList();
    renderProcessingDetail();
  } catch (error) {
    showProcessingStatus('Delete failed: ' + error.message, 'error');
  }
}

function showProcessingStatus(message, type) {
  const statusEl = document.getElementById('processingStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = 'processing-status show ' + type;
}

async function loadHomeStats() {
  const inboxEl = document.getElementById('inboxCount');
  const doneEl = document.getElementById('doneCount');
  const totalEl = document.getElementById('totalCount');
  if (!inboxEl || !doneEl || !totalEl) return;

  try {
    const [inbox, done, total] = await Promise.all([
      getNotes({ status: 'inbox', include_deleted: false }),
      getNotes({ status: 'done', include_deleted: false }),
      getNotes({ include_deleted: false })
    ]);

    inboxEl.textContent = inbox.length;
    doneEl.textContent = done.length;
    totalEl.textContent = total.length;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function clearTimers() {
  if (statsIntervalId) {
    clearInterval(statsIntervalId);
    statsIntervalId = null;
  }
}

async function renderRoute() {
  clearTimers();

  const route = getRouteKeyFromLocation();
  renderNav(route);

  if (route === 'home') {
    renderHome();
    await loadHomeStats();
    statsIntervalId = setInterval(loadHomeStats, 5000);
    return;
  }

  if (route === 'capture') {
    renderCapture();
    return;
  }

  if (route === 'processing') {
    await loadProcessingNotes();
    renderProcessing();
    return;
  }

  if (route !== 'storage') {
    renderPlaceholder('Not Found');
    return;
  }

  await loadStorageData();
  renderStorage();
}

async function initApp() {
  applyRouteFromQueryFallback();

  try {
    await initDB();
    await renderRoute();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    document.getElementById('app-root').innerHTML = `
      <section class="placeholder">
        <h2>Initialization Error</h2>
        <p>${error.message}</p>
      </section>
    `;
  }

  window.addEventListener('popstate', () => {
    renderRoute();
  });

  window.addEventListener('resize', () => {
    if (getRouteKeyFromLocation() === 'storage') {
      renderStorageGraph();
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    const installBtn = document.getElementById('installBtn');
    if (installBtn) installBtn.style.display = 'inline-block';
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.error('SW registration failed:', error);
      });
    });
  }
}

function bindRouteLinks(scope) {
  scope.querySelectorAll('a[data-route]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const routeKey = anchor.dataset.route || 'home';
      navigateToRoute(routeKey);
    });
  });
}

window.addEventListener('DOMContentLoaded', initApp);
