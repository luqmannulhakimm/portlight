const { app, BrowserWindow, ipcMain, shell, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { scanPorts, stopListener, localhostUrl } = require('./ports');
let window;
let snapshot = { rows: [], scannedAt: null };
let scanPending;
let stopPending = false;
const activity = [];
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });

function prefsPath() { return path.join(app.getPath('userData'), 'preferences.json'); }
function readPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch { return {}; }
}
async function scan() {
  if (!scanPending) scanPending = scanPorts().then(result => { snapshot = result; return result; }).finally(() => { scanPending = null; });
  return scanPending;
}
function findRow(id) {
  const row = snapshot.rows.find(r => r.id === id);
  if (!row) throw new Error('This listener has disappeared. Refresh the list.');
  return row;
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
    try { return { ok: true, data: await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}
handle('ports:scan', scan);
handle('ports:stop', async targets => {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 100 || targets.some(t => typeof t?.id !== 'string' || typeof t?.identity !== 'string')) throw new Error('Invalid selection.');
  if (stopPending) throw new Error('A stop operation is already in progress.');
  stopPending = true;
  try {
    const unique = new Map();
    for (const target of targets) {
      const row = findRow(target.id);
      if (row.identity !== target.identity) throw new Error('The selected process changed. Refresh and select it again.');
      if (row.protectedReason) throw new Error(row.protectedReason);
      unique.set(row.pid, row);
    }
    const results = [];
    for (const row of unique.values()) {
      try {
        const stopped = await stopListener(row);
        const item = { ...stopped, status: 'stopped', at: new Date().toISOString(), ports: snapshot.rows.filter(r => r.pid === row.pid).map(r => r.port) };
        activity.unshift(item); results.push(item);
      } catch (error) {
        const item = { pid: row.pid, port: row.port, name: row.name, status: 'failed', error: error.message, at: new Date().toISOString() };
        activity.unshift(item); results.push(item);
      }
    }
    activity.splice(200);
    let refreshError;
    try { await scan(); } catch(error) { refreshError = error.message; }
    return { results, snapshot, activity, refreshError };
  } finally { stopPending = false; }
});
handle('ports:open', id => shell.openExternal(localhostUrl(findRow(id))));
handle('ports:copy', id => clipboard.writeText(localhostUrl(findRow(id))));
handle('activity:list', () => activity);
handle('preferences:read', readPrefs);
handle('preferences:save', prefs => {
  const sanitized = {
    autoRefresh: prefs?.autoRefresh !== false,
    refreshSeconds: [3,5,10,15].includes(prefs?.refreshSeconds) ? prefs.refreshSeconds : 5,
    favorites: Array.isArray(prefs?.favorites) ? [...new Set(prefs.favorites.filter(x => typeof x === 'string' && /^(TCP|UDP):\d{1,5}$/.test(x)))].slice(0,500) : [],
  };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(sanitized, null, 2));
  return sanitized;
});
handle('window:action', action => {
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
  if (action === 'close') window.close();
});

if (single) app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  window = new BrowserWindow({
    width: 1320, height: 880, minWidth: 920, minHeight: 650,
    title: 'Portlight', backgroundColor: '#101211', frame: false, show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
