// PDF Master - proceso principal (Electron)
'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, net, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const UPSTREAM_REPO = 'storytold/pdfcraft'; // proyecto open source usado como referencia/guía
const DIST = path.join(__dirname, 'dist');
const IS_DEV = !app.isPackaged;

if (process.env.PM_E2E && !app.isPackaged) {
  // las pruebas usan sus propios datos de usuario: no tocan los ajustes ni la instancia instalada
  app.setPath('userData', path.join(os.tmpdir(), 'pdfmaster-e2e-userdata'));
  // en las pruebas automáticas la ventana puede quedar tapada: evita que Chromium la "duerma"
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------------------------------------------------------- ajustes
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  theme: 'system',
  autoCheckUpdates: true,
  updateRepo: 'hug04ntivil/pdfmaster', // "usuario/repositorio" de GitHub con los releases de PDF Master
  recent: [],
  signatures: [],
  defaultZoom: 'fit-width',
  ocrLang: 'spa+eng',
  bounds: null,
  author: '',
};
let settings = { ...DEFAULTS };
function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
  // el proyecto de referencia no es el repositorio de PDF Master: se restablece al propio
  if (!settings.updateRepo || settings.updateRepo.toLowerCase() === UPSTREAM_REPO.toLowerCase()) settings.updateRepo = DEFAULTS.updateRepo;
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
    } catch (e) {
      console.error('No se pudieron guardar los ajustes', e);
    }
  }, 150);
}

// ---------------------------------------------------------------- utilidades
function writeAtomic(file, data) {
  const tmp = `${file}.pmtmp-${process.pid}`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, file);
}
const toU8 = (buf) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
function safeName(n) {
  return String(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}
function addRecent(file) {
  settings.recent = [file, ...settings.recent.filter((f) => f.toLowerCase() !== file.toLowerCase())].slice(0, 12);
  saveSettings();
  try { app.addRecentDocument(file); } catch {}
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.json': 'application/json', '.gz': 'application/octet-stream', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.icc': 'application/octet-stream',
};

// ---------------------------------------------------------------- ventana
let win = null;
let forceClose = false;

// Acciones rápidas del menú contextual de Windows: PDF Master.exe --pm-action=<acción> "archivo"
const LAUNCH_ACTIONS = new Set(['open', 'merge', 'split', 'compress', 'toword', 'toimages', 'sign', 'protect', 'ocr', 'imgs2pdf', 'office2pdf']);
let rendererReady = false;
const launchQueue = []; // lanzamientos recibidos antes de que la interfaz esté lista

function parseLaunch(argv) {
  // Se revisa toda la línea de comandos: en segundas instancias Electron no mantiene siempre las mismas posiciones.
  const args = argv.slice(1);
  const a = args.find((x) => x.startsWith('--pm-action='));
  const action = a && LAUNCH_ACTIONS.has(a.split('=')[1]) ? a.split('=')[1] : 'open';
  const paths = args
    .filter((x) => !x.startsWith('--') && /\.(pdf|png|jpe?g|webp|bmp|gif|docx?|xlsx?|pptx?)$/i.test(x) && fs.existsSync(x))
    .map((x) => path.resolve(x));
  return { action, paths };
}

// Explorer lanza un proceso por cada archivo seleccionado: se agrupan los que llegan casi a la vez (p. ej. "Unir PDFs").
const collect = { action: null, paths: [], timer: null };
function collectLaunch({ action, paths }) {
  if (process.env.PM_E2E) console.log('[launch] recibido', action, paths.map((p) => path.basename(p)).join(','));
  if (!paths.length) return;
  if (collect.action && collect.action !== action) flushLaunch();
  collect.action = action;
  for (const p of paths) if (!collect.paths.includes(p)) collect.paths.push(p);
  clearTimeout(collect.timer);
  collect.timer = setTimeout(flushLaunch, 900);
}
function flushLaunch() {
  clearTimeout(collect.timer);
  const l = { action: collect.action, paths: collect.paths };
  collect.action = null;
  collect.paths = [];
  if (process.env.PM_E2E) console.log('[launch] entrega', l.action, l.paths.map((p) => path.basename(p)).join(','), 'ready=' + rendererReady);
  if (!l.action) return;
  if (rendererReady && win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('app:launch', l);
  } else launchQueue.push(l);
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    x: b.x,
    y: b.y,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'PDF Master',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: dark ? '#1b1c20' : '#f3f4f6',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#202228' : '#ffffff', symbolColor: dark ? '#e8e9ed' : '#202228', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !process.env.PM_E2E,
    },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.on('close', (e) => {
    const bounds = win.getNormalBounds();
    settings.bounds = { ...bounds, maximized: win.isMaximized() };
    saveSettings();
    if (!forceClose) {
      e.preventDefault();
      win.webContents.send('app:request-close');
    }
  });
  win.on('closed', () => { win = null; });
  win.loadURL('app://pdfmaster/index.html');
  if (IS_DEV && process.env.PM_E2E) setupE2E();
  if (IS_DEV && process.env.PM_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

// Pruebas de extremo a extremo (solo en desarrollo): PM_E2E=ruta/al/script.js
function setupE2E() {
  const wc = win.webContents;
  const logs = [];
  wc.on('console-message', (e) => { const lvl = e.level || e.severity; if (lvl === 'error' || lvl === 3 || lvl === 'warning') logs.push(`[${lvl}] ${e.message}`.slice(0, 400)); });
  wc.once('did-finish-load', async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const drv = require(path.resolve(process.env.PM_E2E));
      await drv({
        win, wc, app, sleep, logs,
        run: (js) => wc.executeJavaScript(js, true),
        shot: async (f) => { const img = await wc.capturePage(); fs.writeFileSync(f, img.toPNG()); },
      });
    } catch (e) {
      console.error('E2E ERROR', e);
    } finally {
      console.log('--- consola del renderer ---\n' + logs.join('\n'));
      forceClose = true;
      app.exit(0);
    }
  });
}

// ---------------------------------------------------------------- arranque
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    collectLaunch(parseLaunch(argv));
  });

  app.whenReady().then(() => {
    loadSettings();
    Menu.setApplicationMenu(null);
    protocol.handle('app', (req) => {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.normalize(path.join(DIST, p));
      if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
      try {
        const data = fs.readFileSync(file);
        return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    collectLaunch(parseLaunch(process.argv));
    createWindow();
    registerIpc();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
}

// ---------------------------------------------------------------- IPC
const fileFilters = {
  pdf: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
  images: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  office: [{ name: 'Documentos de Office', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt'] }],
  text: [{ name: 'Texto / HTML', extensions: ['txt', 'html', 'htm', 'md', 'csv'] }],
  any: [{ name: 'Todos los archivos', extensions: ['*'] }],
};

function readFileEntry(p) {
  const buf = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: toU8(buf) };
}

const FONT_DIR = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const FONT_FAMILIES = {
  Arial: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'],
  Calibri: ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf'],
  'Segoe UI': ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf'],
  'Times New Roman': ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'],
  Georgia: ['georgia.ttf', 'georgiab.ttf', 'georgiai.ttf', 'georgiaz.ttf'],
  Verdana: ['verdana.ttf', 'verdanab.ttf', 'verdanai.ttf', 'verdanaz.ttf'],
  Tahoma: ['tahoma.ttf', 'tahomabd.ttf', 'tahoma.ttf', 'tahomabd.ttf'],
  'Courier New': ['cour.ttf', 'courbd.ttf', 'couri.ttf', 'courbi.ttf'],
  Consolas: ['consola.ttf', 'consolab.ttf', 'consolai.ttf', 'consolaz.ttf'],
  'Segoe Script': ['segoesc.ttf', 'segoescb.ttf', 'segoesc.ttf', 'segoescb.ttf'],
  'Ink Free': ['Inkfree.ttf', 'Inkfree.ttf', 'Inkfree.ttf', 'Inkfree.ttf'],
};

function runPowerShell(script, env) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `PowerShell terminó con código ${code}`))));
  });
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => fn(...args));
  // Solo pruebas automáticas (PM_E2E): sustituye los diálogos nativos por rutas dadas en variables de entorno
  const e2e = !app.isPackaged && !!process.env.PM_E2E;
  const e2eOpen = () => JSON.parse(process.env.PM_E2E_OPEN || '[]');

  h('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    upstream: UPSTREAM_REPO,
    electron: process.versions.electron,
    platform: process.platform === 'win32' ? `${parseInt(os.release().split('.')[2], 10) >= 22000 ? 'Windows 11' : 'Windows 10'} (compilación ${os.release().split('.')[2]})` : `${os.type()} ${os.release()}`,
    darkSystem: nativeTheme.shouldUseDarkColors,
  }));

  h('app:take-pending', () => {
    rendererReady = true;
    if (collect.action) flushLaunch(); // si ya hay archivos agrupándose, se entregan ahora
    return launchQueue.splice(0);
  });
  h('app:confirm-close', () => { forceClose = true; if (win) win.close(); });
  h('app:set-title-theme', (dark) => {
    if (!win) return;
    try { win.setTitleBarOverlay({ color: dark ? '#202228' : '#ffffff', symbolColor: dark ? '#e8e9ed' : '#202228', height: 44 }); } catch {}
  });
  h('app:set-title', (t) => { if (win) win.setTitle(t || 'PDF Master'); });

  // ajustes
  h('settings:get', () => settings);
  h('settings:set', (patch) => {
    settings = { ...settings, ...patch };
    saveSettings();
    return settings;
  });

  // diálogos y archivos
  h('dialog:open', async ({ kind = 'pdf', multi = true, title } = {}) => {
    if (e2e) return e2eOpen().map(readFileEntry);
    const r = await dialog.showOpenDialog(win, {
      title,
      defaultPath: settings.recent[0] ? path.dirname(settings.recent[0]) : app.getPath('documents'),
      properties: ['openFile', ...(multi ? ['multiSelections'] : [])],
      filters: [...(fileFilters[kind] || fileFilters.any), ...(kind === 'any' ? [] : fileFilters.any)],
    });
    if (r.canceled) return [];
    const out = [];
    for (const p of r.filePaths) {
      out.push(readFileEntry(p));
      if (kind === 'pdf') addRecent(p);
    }
    return out;
  });
  h('dialog:pick-paths', async ({ kind = 'office', multi = true } = {}) => {
    if (e2e) return e2eOpen();
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', ...(multi ? ['multiSelections'] : [])],
      filters: fileFilters[kind] || fileFilters.any,
    });
    return r.canceled ? [] : r.filePaths;
  });
  h('file:read', (p) => readFileEntry(p));
  h('file:exists', (p) => fs.existsSync(p));
  h('dialog:save', async ({ defaultName = 'documento.pdf', data, kind = 'pdf', dir, filters } = {}) => {
    const base = dir || (settings.recent[0] ? path.dirname(settings.recent[0]) : app.getPath('documents'));
    if (e2e) {
      const p = path.join(process.env.PM_E2E_OUT, safeName(defaultName));
      if (data) writeAtomic(p, data);
      return p;
    }
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(base, safeName(defaultName)),
      filters: [...(filters || fileFilters[kind] || []), ...fileFilters.any],
    });
    if (r.canceled || !r.filePath) return null;
    if (data) writeAtomic(r.filePath, data);
    if (kind === 'pdf' && data) addRecent(r.filePath);
    return r.filePath;
  });
  h('file:write', (p, data) => { writeAtomic(p, data); return true; });
  h('dialog:folder', async (title) => {
    if (e2e) return process.env.PM_E2E_OUT;
    const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('folder:write', ({ dir, files }) => {
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    for (const f of files) {
      const p = path.join(dir, safeName(f.name));
      writeAtomic(p, f.data);
      written.push(p);
    }
    return written;
  });
  h('shell:show', (p) => { shell.showItemInFolder(p); return true; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:external', (url) => { if (/^(https:\/\/|ms-settings:)/i.test(url)) shell.openExternal(url); return true; });
  h('recent:remove', (p) => {
    settings.recent = settings.recent.filter((f) => f !== p);
    saveSettings();
    return settings.recent;
  });

  // fuentes de Windows
  h('fonts:list', () => {
    const out = {};
    for (const [fam, files] of Object.entries(FONT_FAMILIES)) {
      if (fs.existsSync(path.join(FONT_DIR, files[0]))) out[fam] = files;
    }
    return out;
  });
  h('fonts:read', (file) => {
    const p = path.join(FONT_DIR, path.basename(file));
    return toU8(fs.readFileSync(p));
  });

  // HTML / texto -> PDF (motor de impresión de Chromium)
  h('html:topdf', async ({ html, pageSize = 'A4', landscape = false, margin = 15 }) => {
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, offscreen: false } });
    try {
      await w.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
      const mm = margin / 25.4;
      const pdf = await w.webContents.printToPDF({
        pageSize,
        landscape,
        printBackground: true,
        margins: { top: mm, bottom: mm, left: mm, right: mm },
      });
      return toU8(pdf);
    } finally {
      w.destroy();
    }
  });

  // Office -> PDF (requiere Microsoft Office instalado)
  h('office:topdf', async (inPath) => {
    const ext = path.extname(inPath).toLowerCase();
    const out = path.join(os.tmpdir(), `pdfmaster-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    let script;
    if (['.doc', '.docx', '.rtf', '.odt'].includes(ext)) {
      script = `$ErrorActionPreference='Stop'; $a=New-Object -ComObject Word.Application; $a.Visible=$false; $a.DisplayAlerts=0; try { $d=$a.Documents.Open($env:PM_IN,$false,$true); $d.ExportAsFixedFormat($env:PM_OUT,17); $d.Close(0) } finally { $a.Quit() }`;
    } else if (['.xls', '.xlsx'].includes(ext)) {
      script = `$ErrorActionPreference='Stop'; $a=New-Object -ComObject Excel.Application; $a.Visible=$false; $a.DisplayAlerts=$false; try { $b=$a.Workbooks.Open($env:PM_IN,0,$true); $b.ExportAsFixedFormat(0,$env:PM_OUT); $b.Close($false) } finally { $a.Quit() }`;
    } else if (['.ppt', '.pptx'].includes(ext)) {
      script = `$ErrorActionPreference='Stop'; $a=New-Object -ComObject PowerPoint.Application; try { $p=$a.Presentations.Open($env:PM_IN,-1,0,0); $p.SaveAs($env:PM_OUT,32); $p.Close() } finally { $a.Quit() }`;
    } else {
      throw new Error('Formato no soportado: ' + ext);
    }
    try {
      await runPowerShell(script, { PM_IN: inPath, PM_OUT: out });
      const data = toU8(fs.readFileSync(out));
      return { name: path.basename(inPath, ext) + '.pdf', data };
    } catch (e) {
      throw new Error('No se pudo convertir con Microsoft Office. ¿Está instalado? Detalle: ' + e.message);
    } finally {
      try { fs.unlinkSync(out); } catch {}
    }
  });

  // actualizaciones
  registerUpdater(h);
}

function sendUpdate(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update:event', payload);
}

function friendlyUpdateError(e, repo) {
  const msg = String((e && e.message) || e || '');
  if (/latest\.yml|404|Not Found|Cannot find/i.test(msg)) {
    return `No hay versiones de PDF Master publicadas en «${repo}». Publica un Release con el instalador (PDF-Master-Setup-X.exe y latest.yml) o revisa que el nombre sea correcto y el repositorio sea público.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|ERR_NAME|net::/i.test(msg)) return 'Sin conexión a internet. Inténtalo de nuevo más tarde.';
  return msg.split('\n')[0].slice(0, 220);
}

function registerUpdater(h) {
  let autoUpdater = null;
  const getUpdater = () => {
    if (autoUpdater) return autoUpdater;
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
    autoUpdater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : '' }));
    autoUpdater.on('update-not-available', (i) => sendUpdate({ state: 'none', version: i.version }));
    autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'downloaded', version: i.version }));
    autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: friendlyUpdateError(e, settings.updateRepo) }));
    return autoUpdater;
  };

  h('update:check', async () => {
    const repo = (settings.updateRepo || '').trim();
    if (!app.isPackaged) return { state: 'dev', message: 'Las actualizaciones solo funcionan en la versión instalada.' };
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
    if (!m) return { state: 'norepo', message: 'Configura tu repositorio de GitHub en Ajustes > Actualizaciones (usuario/repositorio).' };
    if (repo.toLowerCase() === UPSTREAM_REPO.toLowerCase()) {
      return { state: 'norepo', message: `«${UPSTREAM_REPO}» es el proyecto de referencia (de otra persona), no tu repositorio. Escribe en Ajustes el repositorio donde publicas PDF Master.` };
    }
    const u = getUpdater();
    u.setFeedURL({ provider: 'github', owner: m[1], repo: m[2] });
    try {
      await u.checkForUpdates();
      return { state: 'started' };
    } catch (e) {
      return { state: 'error', message: friendlyUpdateError(e, repo) };
    }
  });
  h('update:download', async () => { await getUpdater().downloadUpdate(); return true; });
  h('update:install', () => { forceClose = true; getUpdater().quitAndInstall(false, true); return true; });

  // Estado del proyecto de referencia (pdfcraft): última versión publicada
  h('upstream:latest', async () => {
    try {
      const r = await net.fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PDF-Master' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return { tag: j.tag_name, name: j.name, url: j.html_url, date: j.published_at, notes: String(j.body || '').slice(0, 1800) };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  });
}
