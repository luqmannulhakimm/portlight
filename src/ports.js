const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const netstat = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netstat.exe');
const options = { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' };
const scriptPath = name => path.join(__dirname, 'windows', name).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function parseEndpoint(endpoint) {
  const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(endpoint);
  return match ? { address: match[1] || match[2], port: Number(match[3]) } : null;
}

function parseNetstat(output) {
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const protocol = parts[0];
    if (protocol !== 'TCP' && protocol !== 'UDP') continue;
    // Only server listeners. Established outbound connections are not localhost servers.
    if (protocol === 'TCP' && parts[3] !== 'LISTENING') continue;
    const endpoint = parseEndpoint(parts[1]);
    const pid = Number(parts[protocol === 'TCP' ? 4 : 3]);
    if (!endpoint || !Number.isInteger(pid)) continue;
    rows.push({ ...endpoint, pid, protocol });
  }
  return rows;
}

const critical = /^(system|registry|smss|csrss|wininit|services|lsass|winlogon|svchost|fontdrvhost|dwm|securityhealthservice|msmpeng)$/i;
function assembleSnapshot(endpoints, processes, selfPid = process.pid, ownExecutable = process.execPath) {
  const processMap = new Map(processes.map(p => [p.pid, p]));
  const ancestors = new Set([selfPid]);
  let current = processMap.get(selfPid);
  while (current?.parentPid && !ancestors.has(current.parentPid)) {
    ancestors.add(current.parentPid);
    current = processMap.get(current.parentPid);
  }
  const groups = new Map();
  const windowsRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase() + '\\';
  for (const endpoint of endpoints) {
    const id = `${endpoint.protocol}:${endpoint.port}:${endpoint.pid}`;
    if (groups.has(id)) { groups.get(id).addresses.push(endpoint.address); continue; }
    const p = processMap.get(endpoint.pid);
    const executable = (p?.path || '').toLowerCase();
    let protectedReason = '';
    if (endpoint.pid <= 4 || critical.test(p?.name || '') || executable.startsWith(windowsRoot)) protectedReason = 'Windows system process';
    else if (ancestors.has(endpoint.pid) || executable === ownExecutable.toLowerCase()) protectedReason = 'Portlight or its parent process';
    else if (!p?.identity || !p?.path) protectedReason = 'Process details unavailable; try running as administrator';
    const name = p?.name || (endpoint.pid === 4 ? 'System' : `Process ${endpoint.pid}`);
    const developer = /^(node|python\w*|php|ruby|java\w*|dotnet|deno|bun|go|uvicorn|postgres|mysqld|redis-server|mongod|nginx|httpd|caddy)$/i.test(name) || /(?:vite|next[\\/]|webpack|uvicorn|flask|django|http-server|serve[\\/]|cargo\s+run)/i.test(p?.command || '');
    groups.set(id, {
      id, port: endpoint.port, pid: endpoint.pid, protocol: endpoint.protocol,
      addresses: [endpoint.address], name, path: p?.path || '', command: p?.command || '',
      identity: p?.identity || '', startedAt: p?.startedAt || null, memoryBytes: p?.memoryBytes || 0,
      parentPid: p?.parentPid || 0, developer, protectedReason,
    });
  }
  return [...groups.values()].map(row => ({ ...row, addresses: [...new Set(row.addresses)] })).sort((a,b) => a.port - b.port || a.pid - b.pid || a.protocol.localeCompare(b.protocol));
}

async function scanPorts() {
  if (process.platform !== 'win32') throw new Error('Portlight requires Windows 11 or Windows 10.');
  const [network, metadata] = await Promise.all([
    execute(netstat, ['-ano'], options),
    execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('snapshot.ps1')], options),
  ]);
  const processes = JSON.parse(metadata.stdout.replace(/^\uFEFF/, '').trim() || '[]');
  return { rows: assembleSnapshot(parseNetstat(network.stdout), Array.isArray(processes) ? processes : [processes]), scannedAt: new Date().toISOString() };
}

async function stopListener(row) {
  if (row.protectedReason) throw new Error(row.protectedReason);
  if (!Number.isInteger(row.pid) || row.pid <= 4 || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535 || !/^\d+$/.test(row.identity) || !['TCP','UDP'].includes(row.protocol)) throw new Error('Invalid process identity.');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('stop.ps1'), '-TargetPid', String(row.pid), '-Identity', row.identity, '-Port', String(row.port), '-Protocol', row.protocol];
  try {
    const { stdout } = await execute(powershell, args, options);
    const result = JSON.parse(stdout.trim());
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    let message = error.message;
    try { message = JSON.parse(error.stdout.trim()).error || message; } catch {}
    if (/access.*denied|denied.*access|privilege/i.test(message)) message = 'Access denied. Run Portlight as administrator to stop this process.';
    throw new Error(message);
  }
  return { pid: row.pid, port: row.port, name: row.name };
}

function localhostUrl(row) {
  if (row.protocol !== 'TCP') throw new Error('UDP endpoints cannot be opened in a browser.');
  const wildcard = row.addresses.some(a => a === '0.0.0.0' || a === '::');
  const address = wildcard ? 'localhost' : row.addresses.find(a => a === '127.0.0.1') || row.addresses.find(a => a === '::1') || row.addresses[0];
  return `http://${address.includes(':') ? `[${address}]` : address}:${row.port}`;
}
module.exports = { parseEndpoint, parseNetstat, assembleSnapshot, scanPorts, stopListener, localhostUrl };
