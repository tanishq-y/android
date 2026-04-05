// Flit extension popup script
// Shows login status for each platform and a link to open the web app.

const PLATFORMS = [
  { id: 'blinkit',   name: 'Blinkit',   color: '#0C831F', loginUrl: 'https://blinkit.com' },
  { id: 'zepto',     name: 'Zepto',     color: '#8025FB', loginUrl: 'https://www.zeptonow.com' },
  { id: 'instamart', name: 'Instamart', color: '#FC8019', loginUrl: 'https://www.swiggy.com' },
  { id: 'bigbasket', name: 'BigBasket', color: '#84C225', loginUrl: 'https://www.bigbasket.com' },
  { id: 'jiomart',   name: 'JioMart',   color: '#0089CF', loginUrl: 'https://www.jiomart.com' },
];

const listEl      = document.getElementById('platform-list');
const refreshBtn  = document.getElementById('refresh-btn');
const openAppBtn  = document.getElementById('open-app');

// Render loading placeholders
function renderLoading() {
  listEl.innerHTML = PLATFORMS.map(p => `
    <div class="platform-row">
      <div class="platform-info">
        <div class="platform-dot" style="background:${p.color}"></div>
        <div>
          <div class="platform-name">${p.name}</div>
        </div>
      </div>
      <span class="status-badge status-loading">Checking…</span>
    </div>
  `).join('');
}

function renderStatus(statusMap) {
  listEl.innerHTML = PLATFORMS.map(p => {
    const status = statusMap[p.id] ?? 'unknown';
    const isLoggedIn = status === 'logged_in';
    const label = isLoggedIn ? '✓ Logged in' : 'Login';
    const badgeClass = isLoggedIn ? 'status-logged-in' : 'status-logged-out';

    const actionHtml = isLoggedIn
      ? `<span class="status-badge ${badgeClass}">${label}</span>`
      : `<a href="${p.loginUrl}" target="_blank"
            style="font-size:11px;font-weight:600;color:${p.color};text-decoration:none;
                   border:1px solid ${p.color};padding:3px 8px;border-radius:12px;"
         >Log in →</a>`;

    return `
      <div class="platform-row">
        <div class="platform-info">
          <div class="platform-dot" style="background:${p.color}"></div>
          <div>
            <div class="platform-name">${p.name}</div>
          </div>
        </div>
        ${actionHtml}
      </div>
    `;
  }).join('');
}

async function loadStatus() {
  renderLoading();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response?.type === 'STATUS') {
      renderStatus(response.platforms);
    }
  } catch (_err) {
    renderStatus({});
  }
}

// Detect if we're in production or dev and set the open link accordingly
async function setupOpenLink() {
  try {
    const stored = await chrome.storage.local.get('flit_app_url');
    const url = stored.flit_app_url ?? 'http://localhost:5173';
    openAppBtn.href = url;
  } catch {
    openAppBtn.href = 'http://localhost:5173';
  }
}

refreshBtn.addEventListener('click', loadStatus);

setupOpenLink();
loadStatus();
