'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, cb) => {
  const fn = (_e, ...a) => cb(...a);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('pm', {
  info: inv('app:info'),
  takePending: inv('app:take-pending'),
  confirmClose: inv('app:confirm-close'),
  setTitleTheme: inv('app:set-title-theme'),
  setTitle: inv('app:set-title'),
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  openDialog: inv('dialog:open'),
  pickPaths: inv('dialog:pick-paths'),
  readFile: inv('file:read'),
  exists: inv('file:exists'),
  saveDialog: inv('dialog:save'),
  writeFile: inv('file:write'),
  pickFolder: inv('dialog:folder'),
  writeFolder: inv('folder:write'),
  showInFolder: inv('shell:show'),
  openPath: inv('shell:open'),
  openExternal: inv('shell:external'),
  removeRecent: inv('recent:remove'),
  listFonts: inv('fonts:list'),
  readFont: inv('fonts:read'),
  htmlToPdf: inv('html:topdf'),
  officeToPdf: inv('office:topdf'),
  checkUpdate: inv('update:check'),
  downloadUpdate: inv('update:download'),
  installUpdate: inv('update:install'),
  upstreamLatest: inv('upstream:latest'),
  onUpdate: (cb) => on('update:event', cb),
  onOpenPaths: (cb) => on('app:open-paths', cb),
  onRequestClose: (cb) => on('app:request-close', cb),
  pathForFile: (f) => {
    try { return webUtils.getPathForFile(f); } catch { return ''; }
  },
});
