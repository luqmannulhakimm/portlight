const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
contextBridge.exposeInMainWorld('portlight', {
  scan: () => invoke('ports:scan'),
  stop: targets => invoke('ports:stop', targets),
  open: id => invoke('ports:open', id),
  copy: id => invoke('ports:copy', id),
  activity: () => invoke('activity:list'),
  getPreferences: () => invoke('preferences:read'),
  savePreferences: prefs => invoke('preferences:save', prefs),
  windowAction: action => invoke('window:action', action),
});
