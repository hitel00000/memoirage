const routes = [
  { key: 'home', label: 'Home' },
  { key: 'capture', label: 'Capture' },
  { key: 'processing', label: 'Processing' },
  { key: 'storage', label: 'Storage' }
];

let deferredPrompt = null;
let statsIntervalId = null;

function getRouteKey() {
  const hash = window.location.hash.replace('#', '').trim();
  if (!hash) return 'home';
  return routes.some((route) => route.key === hash) ? hash : 'home';
}

function renderNav(activeKey) {
  const nav = document.getElementById('app-nav');
  nav.innerHTML = `
    <nav class="spa-nav">
      <ul>
        ${routes.map((route) => `<li><a href="#${route.key}" class="${route.key === activeKey ? 'active' : ''}">${route.label}</a></li>`).join('')}
      </ul>
    </nav>
  `;
}

function renderHome() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="container">
      <h1>Memoirage</h1>
      <p class="subtitle">Capture fleeting thoughts and connect them later.</p>

      <div class="menu">
        <a href="#capture" class="menu-item">
          <h3>Capture</h3>
          <p>Save ideas quickly as inbox notes.</p>
        </a>
        <a href="#processing" class="menu-item">
          <h3>Processing</h3>
          <p>Review inbox notes and move them forward.</p>
        </a>
        <a href="#storage" class="menu-item">
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

  const route = getRouteKey();
  renderNav(route);

  if (route === 'home') {
    renderHome();
    await loadHomeStats();
    statsIntervalId = setInterval(loadHomeStats, 5000);
    return;
  }

  if (route === 'capture') {
    renderPlaceholder('Capture');
    return;
  }

  if (route === 'processing') {
    renderPlaceholder('Processing');
    return;
  }

  renderPlaceholder('Storage');
}

async function initApp() {
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

  window.addEventListener('hashchange', () => {
    renderRoute();
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

window.addEventListener('DOMContentLoaded', initApp);
