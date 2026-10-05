const $ = selector => document.querySelector(selector);
const api = window.portlight;
const icons = {
  layers:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
  star:'<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9Z"/>',
  radio:'<circle cx="12" cy="12" r="2"/><path d="M7.1 7.1a7 7 0 0 0 0 9.8m9.8-9.8a7 7 0 0 1 0 9.8M3.6 3.6a12 12 0 0 0 0 16.8M20.4 3.6a12 12 0 0 1 0 16.8"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 6M3 4v7h7m2-5v6l4 2"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  settings:'<path d="m10 3-.8 3-2 .9-2.9-.8-2 3.5 2.1 2.2v2.3l-2.1 2.2 2 3.5 2.9-.8 2 .9.8 3h4l.8-3 2-.9 2.9.8 2-3.5-2.1-2.2v-2.3l2.1-2.2-2-3.5-2.9.8-2-.9-.8-3Z"/><circle cx="12" cy="13" r="3"/>',
  refresh:'<path d="M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6m-4 8a9 9 0 0 0 15 1l3-3m0 6v-6h-6"/>',
  memory:'<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sort:'<path d="M4 6h16M4 12h11M4 18h6"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6"/>',
  alert:'<path d="m12 3 10 18H2Zm0 6v5m0 3v.2"/>',
  external:'<path d="M14 3h7v7m0-7L11 13m-1-9H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  minimize:'<path d="M5 12h14"/>',
  maximize:'<rect x="5" y="5" width="14" height="14"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.radio}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
['minimize','maximize','close'].forEach(action => { $(`#${action}`).innerHTML = icon(action); $(`#${action}`).addEventListener('click', () => api.windowAction(action)); });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let rows = [], view = 'tcp', scannedAt = null, selected = new Set(), preferences = { autoRefresh: true, refreshSeconds: 5, favorites: [] }, activities = [];
let scanning = false, stopping = false, scanFailed = false, timer, toastTimer, drawerId, previousFocus, modalFocus, modalAction;
const favoriteKey = row => `${row.protocol}:${row.port}`;
const pinned = row => preferences.favorites.includes(favoriteKey(row));
const memory = bytes => bytes >= 1024 ** 3 ? { value: (bytes / 1024 ** 3).toFixed(1), unit: 'GB' } : { value: Math.round(bytes / 1024 ** 2).toLocaleString(), unit: 'MB' };
function uptime(start) {
  if (!start) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
}
function runtime(row) {
  const cmd = row.command.toLowerCase(), name = row.name.toLowerCase();
  if (row.protectedReason === 'Windows system process') return { label: 'Windows service', symbol: '⊞', cls: 'system' };
  if (/vite/.test(cmd)) return { label: 'Vite development server', symbol: 'V', cls: '' };
  if (/next[\\/]|next-server/.test(cmd)) return { label: 'Next.js application', symbol: 'N', cls: '' };
  if (/node/.test(name)) return { label: 'Node.js runtime', symbol: 'JS', cls: '' };
  if (/python|uvicorn/.test(name)) return { label: /uvicorn/.test(cmd) ? 'Python · Uvicorn' : 'Python runtime', symbol: 'Py', cls: 'python' };
  if (/postgres|mysql|redis|mongo/.test(name)) return { label: 'Local database', symbol: 'DB', cls: 'database' };
  if (/dotnet/.test(name)) return { label: '.NET application', symbol: '.N', cls: 'python' };
  if (/java/.test(name)) return { label: 'Java runtime', symbol: 'J', cls: 'database' };
  if (/php/.test(name)) return { label: 'PHP runtime', symbol: 'PHP', cls: 'database' };
  if (/bun|deno/.test(name)) return { label: `${row.name} runtime`, symbol: name.slice(0,2).toUpperCase(), cls: '' };
  return { label: row.developer ? 'Local development service' : 'Local process', symbol: name.slice(0,2).toUpperCase(), cls: 'system' };
}
function visibleRows() {
  const q = $('#search').value.trim().toLowerCase();
  const filtered = rows.filter(row => {
    if (view === 'tcp' && row.protocol !== 'TCP') return false;
    if (view === 'udp' && row.protocol !== 'UDP') return false;
    if (view === 'developer' && !row.developer) return false;
    if (view === 'favorites' && !pinned(row)) return false;
    return !q || `${row.port} ${row.pid} ${row.name} ${row.command} ${row.path} ${row.addresses.join(' ')} ${runtime(row).label}`.toLowerCase().includes(q);
  });
  const sort = $('#sort').value;
  return filtered.sort((a,b) => {
    if (sort === 'developer') return Number(b.developer) - Number(a.developer) || Number(pinned(b)) - Number(pinned(a)) || a.port - b.port;
    if (sort === 'name') return a.name.localeCompare(b.name) || a.port - b.port;
    if (sort === 'memory') return b.memoryBytes - a.memoryBytes || a.port - b.port;
    return a.port - b.port || a.pid - b.pid;
  });
}
function toast(message, error = false) {
  clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden');
  toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 7000 : 3500);
}
function renderStats() {
  const tcp = rows.filter(r => r.protocol === 'TCP');
  const devs = new Map(rows.filter(r => r.developer).map(r => [r.pid, r]));
  const ram = memory([...devs.values()].reduce((sum,r) => sum + r.memoryBytes, 0));
  $('#stat-tcp').textContent = tcp.length; $('#stat-dev').textContent = devs.size; $('#stat-memory').textContent = ram.value; $('#memory-unit').textContent = ram.unit;
  $('#nav-tcp').textContent = tcp.length; $('#nav-dev').textContent = rows.filter(r => r.developer).length; $('#nav-fav').textContent = rows.filter(pinned).length;
  $('#nav-activity').textContent = activities.length; $('#nav-activity').classList.toggle('hidden', !activities.length);
}
function renderRows() {
  const focusedRow = document.activeElement?.closest('#port-rows tr');
  const focusedId = focusedRow?.dataset.id;
  const focusedAction = document.activeElement?.dataset.action;
  const filtered = visibleRows();
  selected = new Set([...selected].filter(id => filtered.some(r => r.id === id && !r.protectedReason)));
  $('#list-count').textContent = filtered.length;
  $('#port-rows').innerHTML = filtered.map(row => {
    const rt = runtime(row);
    return `<tr data-id="${escape(row.id)}" class="${selected.has(row.id) ? 'selected' : ''}" tabindex="0" aria-label="Port ${row.port}, ${escape(row.name)}, PID ${row.pid}. Press Enter for details.">
      <td class="check-cell"><input type="checkbox" data-action="select" aria-label="Select port ${row.port}, PID ${row.pid}" ${selected.has(row.id) ? 'checked' : ''} ${row.protectedReason || stopping ? 'disabled' : ''}></td>
      <td><div class="port-line"><span class="port-number">:${row.port}</span><span class="protocol-tag">${row.protocol}</span></div><span class="port-address" title="${escape(row.addresses.join(', '))}">${escape(row.addresses.join(' · '))}</span></td>
      <td><div class="process-cell"><span class="runtime-icon ${rt.cls}">${rt.symbol}</span><div class="process-label"><div class="process-name">${escape(row.name)}${row.name === 'System' ? '' : '.exe'}</div><span class="process-meta">${escape(rt.label)}</span></div></div></td>
      <td class="mono">${row.pid}</td><td class="mono">${uptime(row.startedAt)}</td>
      <td><div class="actions"><button class="icon-button ${pinned(row) ? 'pinned' : ''}" data-action="pin" aria-label="${pinned(row) ? 'Unpin' : 'Pin'} port ${row.port}" title="${pinned(row) ? 'Unpin' : 'Pin'} port">${icon('star')}</button>${row.protocol === 'TCP' ? `<button class="icon-button" data-action="open" aria-label="Open port ${row.port} in browser" title="Open in browser (HTTP)">${icon('external')}</button>` : ''}${row.protectedReason ? `<span class="protected-label" title="${escape(row.protectedReason)}">${icon('shield')}Protected</span>` : `<button class="stop-button" data-action="stop" aria-label="Stop ${escape(row.name)} on port ${row.port}" ${stopping ? 'disabled' : ''}>${icon('stop')}Stop</button>`}</div></td></tr>`;
  }).join('');
  if (focusedId) {
    const replacement = $(`#port-rows tr[data-id="${focusedId}"]`);
    const target = focusedAction ? replacement?.querySelector(`[data-action="${focusedAction}"]`) : replacement;
    target?.focus({preventScroll:true});
  }
  $('#loading-state').classList.toggle('hidden', Boolean(scannedAt) || scanFailed);
  $('#empty-state').classList.toggle('hidden', filtered.length > 0 || (!scannedAt && !scanFailed));
  if (filtered.length === 0) {
    $('#empty-state h3').textContent = scanFailed ? 'Could not read listeners' : $('#search').value ? 'No matching listeners' : view === 'favorites' ? 'Keep your usual ports close' : 'No listeners here';
    $('#empty-state p').textContent = scanFailed ? 'Retry the scan. Your current listeners have not been changed.' : $('#search').value ? 'Try another port number, process name or PID.' : view === 'favorites' ? 'Click the star next to a port to pin it. Pins follow the port across app restarts.' : 'Start a local app and it will appear on the next refresh.';
  }
  const eligible = filtered.filter(r => !r.protectedReason);
  $('#select-all').disabled = stopping || eligible.length === 0;
  $('#select-all').checked = eligible.length > 0 && eligible.every(r => selected.has(r.id));
  $('#select-all').indeterminate = selected.size > 0 && !$('#select-all').checked;
  $('#stop-selected').classList.toggle('hidden', selected.size === 0);
  $('#stop-selected').disabled = stopping;
  $('#stop-selected span:last-child').textContent = `Stop selected (${new Set(filtered.filter(r => selected.has(r.id)).map(r => r.pid)).size})`;
  $('#scan-time').textContent = scanFailed ? 'Scan failed · showing last known data' : scannedAt ? `Updated ${new Date(scannedAt).toLocaleTimeString([], { hour:'2-digit',minute:'2-digit',second:'2-digit' })} · ${preferences.autoRefresh ? `${preferences.refreshSeconds}s refresh` : 'manual refresh'}` : 'Waiting for first scan';
}
function setView(next) {
  view = next; selected.clear(); $('#search').value = '';
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if(button.dataset.view === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  const headings = { tcp:['Localhost overview','See what’s running. Free up a port. Get back to your work.','Running listeners','TCP · IPv4 + IPv6'], developer:['Developer ports','Your runtimes, dev servers and local databases in one place.','Development listeners','TCP + UDP · detected runtimes'], favorites:['Pinned ports','Your frequently used ports, always easy to find.','Pinned listeners','TCP + UDP · available now'], udp:['UDP endpoints','Connectionless services bound to ports on your machine.','Bound endpoints','UDP · IPv4 + IPv6'], activity:['Activity','A record of the processes you stopped during this session.','',''] };
  const h = headings[view]; $('#page-title').innerHTML = `${h[0]}<span>.</span>`; $('#page-description').textContent = h[1]; $('#list-title').textContent = h[2]; $('#list-hint').textContent = h[3];
  $('#listeners-panel').classList.toggle('hidden', view === 'activity'); $('#activity-panel').classList.toggle('hidden', view !== 'activity');
  renderRows(); renderActivity();
}
async function refresh() {
  if (scanning || stopping) return;
  scanning = true; $('#refresh').classList.add('spinning'); $('#refresh').disabled = true;
  try {
    const snapshot = await api.scan(); rows = snapshot.rows; scannedAt = snapshot.scannedAt; scanFailed = false; $('#scan-error').classList.add('hidden');
    renderStats(); renderRows();
    if (drawerId) renderDrawer(drawerId);
  } catch (error) {
    scanFailed = true; $('#scan-error span:nth-child(2)').textContent = error.message; $('#scan-error').classList.remove('hidden'); renderRows();
  } finally { scanning = false; $('#refresh').classList.remove('spinning'); $('#refresh').disabled = false; }
}
function schedule() {
  clearInterval(timer);
  if (preferences.autoRefresh) timer = setInterval(refresh, preferences.refreshSeconds * 1000);
  $('#monitor-status').classList.toggle('paused', !preferences.autoRefresh);
  $('#monitor-status').innerHTML = `<span class="live-dot"></span>${preferences.autoRefresh ? 'Live monitoring' : 'Monitoring paused'}`;
}
async function savePreferences() {
  try { preferences = await api.savePreferences(preferences); } catch(error) { toast(`Could not save preferences: ${error.message}`, true); }
}
async function togglePin(row) {
  const key = favoriteKey(row);
  preferences.favorites = pinned(row) ? preferences.favorites.filter(p => p !== key) : [...preferences.favorites, key];
  renderStats(); renderRows(); await savePreferences();
}
function openModal(html, action) {
  if (drawerId) closeDrawer();
  modalFocus = document.activeElement; $('#modal-body').innerHTML = html; modalAction = action;
  $('#modal-overlay').classList.remove('hidden'); $('.modal').focus();
}
function closeModal() {
  if (stopping) return;
  $('#modal-overlay').classList.add('hidden'); modalAction = null; modalFocus?.focus();
}
function confirmStop(ids) {
  const targets = rows.filter(r => ids.includes(r.id) && !r.protectedReason);
  if (!targets.length) return;
  const pids = new Set(targets.map(r => r.pid));
  const affected = rows.filter(r => pids.has(r.pid));
  const details = [...pids].map(pid => { const p = targets.find(r => r.pid === pid); return `${escape(p.name)} · PID ${pid}<br><span>${affected.filter(r => r.pid === pid).map(r => `${r.protocol} :${r.port}`).join(' · ')}</span>`; }).join('<br><br>');
  openModal(`<div class="modal-symbol">${icon('stop')}</div><h2 id="modal-title">Stop ${pids.size === 1 ? escape(targets[0].name) : `${pids.size} processes`}?</h2><p>This ends ${pids.size === 1 ? 'the process' : 'these processes'} and releases all the ports ${pids.size === 1 ? 'it owns' : 'they own'}. You can restart your apps when you’re ready.</p><div class="affected-ports">${details}</div><p class="stop-warning">Active requests and unsaved in-memory work will be interrupted. A process supervisor may restart the app.</p><div class="modal-actions"><button class="button secondary" id="modal-cancel">Keep running</button><button class="button danger" id="modal-confirm">${icon('stop')}<span>Stop ${pids.size === 1 ? 'process' : `${pids.size} processes`}</span></button></div>`, () => performStop(targets.map(r => ({id:r.id,identity:r.identity}))));
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-confirm').addEventListener('click', () => modalAction?.());
}
async function performStop(targets) {
  if (stopping) return;
  stopping = true; $('#modal-confirm').disabled = true; $('#modal-confirm span:last-child').textContent = 'Stopping…'; $('#modal-cancel').disabled = true; $('#modal-close').disabled = true;
  try {
    const result = await api.stop(targets); rows = result.snapshot.rows; scannedAt = result.snapshot.scannedAt; activities = result.activity; selected.clear(); scanFailed = Boolean(result.refreshError);
    if (result.refreshError) { $('#scan-error span:nth-child(2)').textContent = result.refreshError; $('#scan-error').classList.remove('hidden'); }
    else $('#scan-error').classList.add('hidden');
    const failures = result.results.filter(r => r.status === 'failed'), successes = result.results.filter(r => r.status === 'stopped');
    if (failures.length) toast(`${successes.length ? `${successes.length} stopped. ` : ''}${failures[0].error}${failures.length > 1 ? ` (${failures.length} failed; see Activity)` : ''}`, true);
    else toast(`${successes.length === 1 ? successes[0].name : `${successes.length} processes`} stopped. Ports released.`);
    renderStats(); renderActivity();
  } catch(error) { toast(error.message,true); }
  finally { stopping = false; $('#modal-close').disabled = false; closeModal(); renderRows(); schedule(); }
}
function closeDrawer() { $('#drawer-overlay').classList.add('hidden'); drawerId = null; previousFocus?.focus(); }
function renderDrawer(id) {
  const row = rows.find(r => r.id === id);
  if (!row) { closeDrawer(); toast('This listener is no longer running.'); return; }
  const rt = runtime(row), ram = memory(row.memoryBytes);
  $('#drawer-body').innerHTML = `<h2 id="drawer-title">:${row.port}</h2><div class="drawer-subtitle">${escape(row.name)}.exe <span class="running-tag"><span class="live-dot"></span>LISTENING</span></div><div class="detail-grid"><div><span class="detail-label">PROCESS ID</span><span class="detail-value">${row.pid}</span></div><div><span class="detail-label">PROTOCOL</span><span class="detail-value">${row.protocol}</span></div><div><span class="detail-label">MEMORY</span><span class="detail-value">${ram.value} ${ram.unit}</span></div><div><span class="detail-label">UPTIME</span><span class="detail-value">${uptime(row.startedAt)}</span></div><div><span class="detail-label">BIND ADDRESS</span><span class="detail-value">${escape(row.addresses.join(', '))}</span></div><div><span class="detail-label">PARENT PID</span><span class="detail-value">${row.parentPid || '—'}</span></div></div><div class="detail-section"><span class="detail-label">EXECUTABLE PATH</span><div class="detail-code">${escape(row.path || 'Unavailable · administrator access may be required')}</div></div><div class="detail-section"><span class="detail-label">COMMAND LINE</span><div class="detail-code">${escape(row.command || 'Unavailable')}</div></div><div class="detail-section"><span class="detail-label">OTHER PORTS ON THIS PROCESS</span><div class="detail-value">${rows.filter(r => r.pid === row.pid && r.id !== row.id).map(r => `${r.protocol} :${r.port}`).join(' · ') || 'None'}</div></div><div class="drawer-buttons">${row.protocol === 'TCP' ? `<button class="button secondary" id="detail-open">${icon('external')}Open in browser</button><button class="button secondary" id="detail-copy">${icon('copy')}Copy URL</button>` : ''}${!row.protectedReason ? `<button class="button danger" id="detail-stop">${icon('stop')}Stop process</button>` : ''}</div><p class="detail-note">${row.protectedReason ? escape(row.protectedReason) : 'Stopping this process releases all its TCP and UDP ports. Child processes are left running.'}${row.protocol === 'TCP' ? ' Browser links use HTTP; non-web services may not respond to a browser.' : ''}</p>`;
  $('#detail-open')?.addEventListener('click', () => api.open(id).catch(e => toast(e.message,true)));
  $('#detail-copy')?.addEventListener('click', () => api.copy(id).then(() => toast('Local address copied.')).catch(e => toast(e.message,true)));
  $('#detail-stop')?.addEventListener('click', () => confirmStop([id]));
}
function showDrawer(id) { previousFocus = document.activeElement; drawerId = id; renderDrawer(id); $('#drawer-overlay').classList.remove('hidden'); $('.drawer').focus(); }
function renderActivity() {
  $('#activity-count').textContent = activities.length;
  $('#activity-list').innerHTML = activities.length ? activities.map(item => `<div class="activity-entry"><span class="activity-symbol ${item.status === 'failed' ? 'failed' : ''}">${icon(item.status === 'failed' ? 'alert' : 'check')}</span><div class="activity-text"><strong>${escape(item.name)} ${item.status === 'failed' ? 'could not be stopped' : 'stopped'}</strong><p>PID ${item.pid} · ${item.status === 'failed' ? escape(item.error) : `Released ${[...new Set(item.ports)].map(p => `:${p}`).join(', ')}`}</p></div><time class="activity-time">${new Date(item.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>`).join('') : `<div class="empty-state"><span class="empty-icon">${icon('history')}</span><h3>A clean slate</h3><p>Processes you stop will appear here. Activity resets when Portlight closes.</p></div>`;
}
function showSettings() {
  openModal(`<div class="modal-symbol green">${icon('settings')}</div><h2 id="modal-title">Make yourself at home.</h2><p>A few preferences for your local workspace.</p><div class="settings-row"><div>Auto-refresh<small>Keep the listener list up to date</small></div><button id="auto-refresh" class="switch ${preferences.autoRefresh ? 'on' : ''}" role="switch" aria-checked="${preferences.autoRefresh}" aria-label="Auto-refresh"></button></div><div class="settings-row"><div>Refresh interval<small>Scans run without overlapping</small></div><select id="refresh-interval" aria-label="Refresh interval">${[3,5,10,15].map(s => `<option value="${s}" ${preferences.refreshSeconds === s ? 'selected' : ''}>Every ${s} seconds</option>`).join('')}</select></div><p>Portlight runs locally. Port numbers, process details and activity stay on this computer.</p><div class="modal-actions"><button class="button accent" id="settings-done">Done</button></div>`);
  $('#auto-refresh').addEventListener('click', async () => { preferences.autoRefresh = !preferences.autoRefresh; $('#auto-refresh').classList.toggle('on',preferences.autoRefresh); $('#auto-refresh').setAttribute('aria-checked',preferences.autoRefresh); schedule(); renderRows(); await savePreferences(); });
  $('#refresh-interval').addEventListener('change', async e => { preferences.refreshSeconds = Number(e.target.value); schedule(); renderRows(); await savePreferences(); });
  $('#settings-done').addEventListener('click',closeModal);
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => setView(button.dataset.view)));
$('#refresh').addEventListener('click',refresh); $('#retry-scan').addEventListener('click',refresh); $('#search').addEventListener('input',renderRows); $('#sort').addEventListener('change',renderRows);
$('#settings').addEventListener('click',showSettings); $('#modal-close').addEventListener('click',closeModal); $('#drawer-close').addEventListener('click',closeDrawer);
$('#modal-overlay').addEventListener('click',e => { if (e.target === e.currentTarget) closeModal(); });
$('#drawer-overlay').addEventListener('click',e => { if (e.target === e.currentTarget) closeDrawer(); });
$('#stop-selected').addEventListener('click',() => confirmStop([...selected]));
$('#select-all').addEventListener('change', e => { selected = e.target.checked ? new Set(visibleRows().filter(r => !r.protectedReason).map(r => r.id)) : new Set(); renderRows(); });
$('#port-rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const row = rows.find(r => r.id === tr.dataset.id); if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'select') { if (selected.has(row.id)) selected.delete(row.id); else selected.add(row.id); renderRows(); }
  else if (action === 'pin') await togglePin(row);
  else if (action === 'open') { try { await api.open(row.id); } catch(error) { toast(error.message,true); } }
  else if (action === 'stop') confirmStop([row.id]);
  else showDrawer(row.id);
});
$('#port-rows').addEventListener('keydown',e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr')) { e.preventDefault(); showDrawer(e.target.dataset.id); } });
document.addEventListener('keydown',e => {
  const modalOpen = !$('#modal-overlay').classList.contains('hidden'), drawerOpen = !$('#drawer-overlay').classList.contains('hidden');
  if (e.key === 'Escape') { if (modalOpen) closeModal(); else if (drawerOpen) closeDrawer(); else { $('#search').value = ''; renderRows(); $('#search').blur(); } }
  if (e.key === 'Tab' && (modalOpen || drawerOpen)) {
    const scope = modalOpen ? $('.modal') : $('.drawer');
    const focusable = [...scope.querySelectorAll('button:not(:disabled),select,input')];
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === scope)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !modalOpen && !drawerOpen && view !== 'activity') { e.preventDefault(); $('#search').focus(); }
  if ((e.ctrlKey && e.key.toLowerCase() === 'r') || e.key === 'F5') { e.preventDefault(); refresh(); }
});
async function init() {
  try { const saved = await api.getPreferences(); preferences = { ...preferences, ...saved }; if (!Array.isArray(preferences.favorites)) preferences.favorites = []; } catch(error) { toast(error.message,true); }
  schedule(); await refresh();
}
init();
