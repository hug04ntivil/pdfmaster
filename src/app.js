// PDF Master - arranque de la interfaz
import { S, emit, onChange, openEntry, closeDoc, setCurrent, openGenerated } from './docs.js';
import { Viewer, Thumbs } from './viewer.js';
import { OV, initOverlay } from './overlay.js';
import { CATS, setApp, renderTools, renderProps, refreshToolState, initToolSearch, runTool } from './tools.js';
import * as E from './engine.js';
import * as C from './convert.js';
import {
  h, $, icon, toast, status, withBusy, modal, field, askSave, showContextMenu, baseName, fmtBytes, debounce, clamp,
} from './util.js';

const pm = window.pm;
let viewer, thumbs;
let updateState = { state: 'idle' };
let updateListeners = new Set();

// Cancelar o cerrar un documento interrumpe tareas de pdf.js en curso: no es un error para el usuario
window.addEventListener('unhandledrejection', (e) => {
  const m = String((e.reason && e.reason.message) || e.reason || '');
  if (/Transport destroyed|Worker was terminated|Rendering cancelled|cancelled|Loading aborted/i.test(m)) e.preventDefault();
});

// ---------------------------------------------------------------- tema
function applyTheme() {
  const t = S.settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  pm.setTitleTheme(dark);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------------------------------------------------------------- acciones
async function openFiles() {
  const files = await pm.openDialog({ kind: 'pdf', multi: true });
  for (const f of files) await openEntry(f);
}
async function openPaths(paths) {
  const images = [];
  for (const p of paths) {
    try {
      if (/\.pdf$/i.test(p)) {
        const ex = S.docs.find((d) => d.path && d.path.toLowerCase() === p.toLowerCase());
        if (ex) { setCurrent(ex); continue; }
        await openEntry(await pm.readFile(p));
      } else if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(p)) images.push(await pm.readFile(p));
    } catch (e) {
      toast(`No se pudo abrir ${p.split(/[\\/]/).pop()}: ${e.message}`, 'err', 6000);
      await pm.removeRecent(p);
    }
  }
  if (images.length) { S.pendingImages = images; runTool('imgs2pdf'); }
}
// Acciones rápidas que llegan desde el menú contextual de Windows (clic derecho sobre un archivo)
const LAUNCH_TOOL = { split: 'split', compress: 'compress', toword: 'toword', toimages: 'toimages', sign: 'sign', protect: 'protect', ocr: 'ocr' };
async function handleLaunch({ action, paths }) {
  if (!paths || !paths.length) return;
  try {
    if (action === 'merge') {
      S.pendingMerge = await Promise.all(paths.map((p) => pm.readFile(p)));
      return await runTool('merge');
    }
    if (action === 'imgs2pdf') {
      S.pendingImages = await Promise.all(paths.map((p) => pm.readFile(p)));
      return await runTool('imgs2pdf');
    }
    if (action === 'office2pdf') {
      S.pendingOffice = paths;
      return await runTool('office2pdf');
    }
    if (LAUNCH_TOOL[action]) {
      for (const p of paths) {
        await openPaths([p]);
        if (S.cur && S.cur.path && S.cur.path.toLowerCase() === p.toLowerCase()) await runTool(LAUNCH_TOOL[action]);
      }
      return;
    }
    await openPaths(paths);
  } catch (e) {
    toast(`No se pudo ejecutar la acción: ${e.message}`, 'err', 6000);
  }
}
async function saveCurrent(as = false) {
  const d = S.cur;
  if (!d) return;
  await withBusy('Guardando…', async () => {
    const ok = await d.save(as);
    if (ok) toast(`Guardado: ${d.name}`, 'ok', 2600);
  });
}
async function closeTab(d) {
  if (d.dirty) {
    const r = await askSave(d.name);
    if (r === 'cancel') return false;
    if (r === 'save') { const ok = await d.save(false).catch((e) => { toast(e.message, 'err'); return false; }); if (!ok) return false; }
  }
  closeDoc(d);
  return true;
}
async function doPrint() {
  const d = S.cur;
  if (!d) return;
  await withBusy('Preparando impresión…', async (b) => {
    await d.commit();
    await C.printPages(d, Array.from({ length: d.numPages }, (_, i) => i), (f) => b.progress(f));
  });
}
async function doUndo() { const d = S.cur; if (d && d.canUndo) { await d.undo(); } }
async function doRedo() { const d = S.cur; if (d && d.canRedo) { await d.redo(); } }

// ---------------------------------------------------------------- barra de herramientas
const btn = (id, ic, title, fn, label) => {
  const b = h('button', { class: label ? 'tb-btn' : 'icon-btn', id, title, onclick: fn }, icon(ic, 18), label ? h('span', null, label) : null);
  return b;
};
function buildToolbar() {
  $('#tg-file').append(btn('b-open', 'folderOpen', 'Abrir (Ctrl+O)', openFiles, 'Abrir'), btn('b-save', 'save', 'Guardar (Ctrl+S)', () => saveCurrent(false), 'Guardar'),
    btn('b-saveas', 'saveAs', 'Guardar como… (Ctrl+Mayús+S)', () => saveCurrent(true)), btn('b-print', 'print', 'Imprimir (Ctrl+P)', doPrint));
  $('#tg-history').append(btn('b-undo', 'undo', 'Deshacer (Ctrl+Z)', doUndo), btn('b-redo', 'redo', 'Rehacer (Ctrl+Y)', doRedo));
  const zl = h('button', { class: 'zoom-label', id: 'zoom-label', title: 'Elegir zoom', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, [50, 75, 100, 125, 150, 200, 300, 400].map((z) => ({ label: `${z}%`, fn: () => viewer.setZoom(z / 100) })));
  } }, '100%');
  $('#tg-zoom').append(btn('b-zout', 'zoomOut', 'Alejar (Ctrl+-)', () => viewer.zoomBy(1 / 1.2)), zl, btn('b-zin', 'zoomIn', 'Acercar (Ctrl++)', () => viewer.zoomBy(1.2)),
    btn('b-fitw', 'fit', 'Ajustar al ancho', () => viewer.applyZoom('fit-width')), btn('b-fitp', 'fitPage', 'Ajustar a la página (Ctrl+0)', () => viewer.applyZoom('fit-page')));
  const pg = h('input', { id: 'page-input', type: 'text', value: '1', title: 'Ir a la página', onkeydown: (e) => { if (e.key === 'Enter') { viewer.goTo(clamp((parseInt(e.target.value, 10) || 1) - 1, 0, viewer.pages.length - 1)); e.target.blur(); } e.stopPropagation(); } });
  $('#tg-nav').append(btn('b-prev', 'chevUp', 'Página anterior', () => viewer.goTo(viewer.current - 1, true)), h('div', { class: 'pager' }, pg, h('span', { id: 'page-total' }, '/ 0')), btn('b-next', 'chevDown', 'Página siguiente', () => viewer.goTo(viewer.current + 1, true)));
  const sIn = h('input', { id: 'search-input', type: 'text', placeholder: 'Buscar en el PDF (Ctrl+F)', spellcheck: false });
  const run = debounce(() => viewer.search(sIn.value.trim()), 250);
  sIn.addEventListener('input', run);
  sIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); if (viewer.query !== sIn.value.trim()) viewer.search(sIn.value.trim()); else viewer.nextHit(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { sIn.value = ''; viewer.search(''); sIn.blur(); }
  });
  $('#tg-search').append(h('div', { class: 'search-box' }, icon('search', 15), sIn, h('span', { class: 'hits', id: 'search-hits' }),
    h('span', { class: 'sb' }, btn('b-sprev', 'chevUp', 'Anterior', () => viewer.nextHit(-1)), btn('b-snext', 'chevDown', 'Siguiente', () => viewer.nextHit(1)))));
  $('#tg-app').append(btn('b-thumbs', 'panelLeft', 'Mostrar/ocultar miniaturas', () => { $('#left').classList.toggle('collapsed'); setTimeout(() => viewer.doc && viewer.doc.zoomMode !== 'custom' && viewer.applyZoom(viewer.doc.zoomMode), 200); }),
    btn('b-theme', 'sun', 'Cambiar tema claro / oscuro', toggleTheme), btn('b-settings', 'settings', 'Ajustes y actualizaciones', () => openSettings()));
  $('#btn-newtab').append(icon('plus', 16));
  $('#btn-newtab').onclick = openFiles;
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  S.settings.theme = dark ? 'light' : 'dark';
  pm.setSettings({ theme: S.settings.theme });
  applyTheme();
}
function refreshToolbar() {
  const d = S.cur;
  const has = !!d;
  const dis = (id, v) => { const el = $('#' + id); if (el) el.disabled = v; };
  ['b-save', 'b-saveas', 'b-print', 'b-zout', 'b-zin', 'b-fitw', 'b-fitp', 'b-prev', 'b-next', 'b-sprev', 'b-snext'].forEach((id) => dis(id, !has));
  dis('b-undo', !(d && d.canUndo)); dis('b-redo', !(d && d.canRedo));
  $('#search-input').disabled = !has; $('#page-input').disabled = !has;
  $('#zoom-label').textContent = has && viewer ? `${viewer.pct}%` : '—';
  $('#page-total').textContent = `/ ${has ? d.numPages : 0}`;
  const dark = document.documentElement.dataset.theme === 'dark';
  const tb = $('#b-theme'); tb.innerHTML = ''; tb.append(icon(dark ? 'sun' : 'moon', 18));
  $('#b-settings').classList.toggle('update-dot', updateState.state === 'available' || updateState.state === 'downloaded');
  document.querySelectorAll('.thumb-act').forEach((b) => { b.disabled = !has; });
  pm.setTitle(has ? `${d.name}${d.dirty ? ' •' : ''} — PDF Master` : 'PDF Master');
  const st = $('#st-doc');
  st.textContent = has ? `Página ${viewer.current + 1} de ${d.numPages}  ·  ${fmtBytes(d.bytes.length)}${d.protect ? '  ·  protegido' : ''}${d.dirty ? '  ·  sin guardar' : ''}` : '';
}

// ---------------------------------------------------------------- pestañas
function renderTabs() {
  const box = $('#tabs');
  box.innerHTML = '';
  S.docs.forEach((d) => {
    const t = h('div', { class: 'tab' + (d === S.cur ? ' active' : ''), role: 'tab', title: d.path || d.name, onclick: () => setCurrent(d), onauxclick: (e) => { if (e.button === 1) closeTab(d); } },
      d.dirty ? h('span', { class: 'dot' }) : icon('fileText', 14), h('span', { class: 'tname' }, d.name),
      h('button', { class: 'x', title: 'Cerrar (Ctrl+W)', onclick: (e) => { e.stopPropagation(); closeTab(d); } }, icon('x', 13)));
    box.append(t);
  });
}

// ---------------------------------------------------------------- bienvenida
function renderWelcome() {
  const w = $('#welcome');
  w.hidden = !!S.cur;
  $('#viewer-scroll').style.visibility = S.cur ? 'visible' : 'hidden';
  if (S.cur) return;
  w.innerHTML = '';
  const withDoc = async (id) => { if (!S.cur) await openFiles(); if (S.cur) runTool(id); };
  const card = (ic, title, sub, fn) => h('button', { class: 'card', onclick: fn }, h('span', { class: 'ci' }, icon(ic, 20)), h('span', null, h('b', null, title), h('small', null, sub)));
  w.append(
    h('div', { class: 'hero' }, h('img', { src: 'icon.svg', alt: '' }), h('h1', null, 'PDF Master'), h('div', { class: 'by' }, 'by Hugo'), h('p', null, 'Todo lo que necesitas para trabajar con archivos PDF, en un solo lugar.'),
      h('button', { class: 'tb-btn primary big', onclick: openFiles }, icon('folderOpen', 20), 'Abrir un PDF'), h('p', { style: { margin: '10px 0 0', fontSize: '12px' } }, 'o arrastra un archivo hasta aquí')),
    h('div', { class: 'cards' },
      card('merge', 'Unir PDFs', 'Combina varios archivos en uno', () => runTool('merge')),
      card('split', 'Dividir PDF', 'Separa por páginas o rangos', () => withDoc('split')),
      card('imagePlus', 'Imágenes a PDF', 'JPG, PNG, WebP…', () => runTool('imgs2pdf')),
      card('signature', 'Firmar documento', 'Dibuja, escribe o sube tu firma', () => withDoc('sign')),
      card('compress', 'Comprimir PDF', 'Reduce el tamaño del archivo', () => withDoc('compress')),
      card('fileText', 'PDF a Word', 'Convierte a documento editable', () => withDoc('toword')),
      card('ocr', 'OCR', 'Haz buscable un documento escaneado', () => withDoc('ocr')),
      card('lock', 'Proteger con clave', 'Cifrado AES-256', () => withDoc('protect')),
      card('fileDown', 'Office a PDF', 'Word, Excel y PowerPoint', () => runTool('office2pdf'))));
  const recents = S.settings.recent || [];
  if (recents.length) {
    const box = h('div', { class: 'recent' }, h('h3', null, 'Recientes'));
    recents.slice(0, 8).forEach((p) => box.append(h('button', { class: 'recent-item', onclick: () => openPaths([p]) }, icon('fileText', 16), p.split(/[\\/]/).pop(), h('span', { class: 'p' }, p))));
    w.append(box);
  }
}

// ---------------------------------------------------------------- vista
let showToken = 0;
async function showCurrent({ keepScroll = false } = {}) {
  const d = S.cur;
  const token = ++showToken;
  renderTabs();
  renderWelcome();
  OV.selId = null;
  if (!d) { await viewer.show(null); await thumbs.show(null); refreshAll(); return; }
  if (!d._zi) {
    d._zi = true;
    const z = S.settings.defaultZoom;
    if (z === 'fit-page' || z === 'fit-width') d.zoomMode = z;
    else if (+z) { d.zoomMode = 'custom'; d.zoom = +z / 100; }
  }
  await Promise.all([viewer.show(d, { keepScroll }), thumbs.show(d)]);
  if (token !== showToken) return;
  thumbs.setCurrent(viewer.current);
  $('#page-input').value = String(viewer.current + 1);
  viewer.search(viewer.query);
  refreshAll();
}
function refreshAll() {
  refreshToolbar();
  refreshToolState();
  renderProps();
  renderTabs();
}
const schedule = (() => { let p = false; return (keep) => { if (p) return; p = true; requestAnimationFrame(() => { p = false; showCurrent({ keepScroll: keep }); }); }; })();

onChange((what) => {
  switch (what) {
    case 'docs': showCurrent(); break;
    case 'bytes': schedule(true); break;
    case 'overlays-restored': OV.renderAll(); OV.select(null); refreshAll(); break;
    case 'overlays': case 'saved': refreshAll(); break;
    case 'zoom': refreshToolbar(); break;
    case 'selection': renderProps(); refreshToolbar(); break;
    case 'tool': refreshToolState(); renderProps(); break;
    default: break;
  }
});

// ---------------------------------------------------------------- miniaturas: acciones
async function structuralQuick(label, fn) {
  const d = S.cur;
  await withBusy(label + '…', async () => {
    await d.commit();
    const out = await fn(d);
    if (out) await d.applyBytes(out, label);
  });
}
function buildThumbActions() {
  const mk = (ic, title, id) => h('button', { class: 'icon-btn thumb-act', title, style: { height: '26px', minWidth: '26px' }, onclick: () => runTool(id) }, icon(ic, 15));
  $('#thumb-actions').append(mk('rotateCcw', 'Rotar a la izquierda', 'rotateL'), mk('rotateCw', 'Rotar a la derecha', 'rotateR'), mk('trash', 'Eliminar páginas', 'delete'), mk('grid', 'Organizar páginas', 'organize'));
}

// ---------------------------------------------------------------- ajustes (General · Actualizaciones · Acerca de)
const LEGEND = 'PDF Master es un proyecto de código abierto para uso personal, personalizado por Hugo A.';

function updateText() {
  const u = updateState;
  switch (u.state) {
    case 'checking': return 'Buscando actualizaciones…';
    case 'available': return `Hay una nueva versión: ${u.version}`;
    case 'none': return 'Tienes la última versión.';
    case 'downloading': return `Descargando… ${u.percent || 0}%`;
    case 'downloaded': return `La versión ${u.version} está lista para instalar.`;
    case 'error': return `No se pudo comprobar: ${u.message}`;
    case 'dev': case 'norepo': return u.message;
    default: return 'Pulsa «Buscar actualizaciones» para comprobar si hay una versión nueva.';
  }
}

function legendCard() {
  return h('div', { class: 'legend' },
    h('div', { class: 'legend-t' }, icon('sparkles', 15), 'Código abierto · uso personal'),
    h('p', null, LEGEND),
    h('small', null, 'Construido sobre software libre: pdf.js, pdf-lib, Tesseract y Electron. Inspirado en pdfcraft (Apache-2.0 / MIT).'));
}

async function openSettings(startTab = 'general') {
  const f = {
    theme: field({ type: 'select', label: 'Tema', options: [['system', 'Seguir el de Windows'], ['light', 'Claro'], ['dark', 'Oscuro']], value: S.settings.theme }),
    zoom: field({ type: 'select', label: 'Zoom al abrir un documento', options: [['fit-width', 'Ajustar al ancho'], ['fit-page', 'Página completa'], ['100', '100%'], ['125', '125%']], value: S.settings.defaultZoom || 'fit-width' }),
    author: field({ type: 'text', label: 'Tu nombre (para firmas y metadatos)', value: S.settings.author || '' }),
    ocr: field({ type: 'select', label: 'Idioma predeterminado del OCR', options: [['spa+eng', 'Español + inglés'], ['spa', 'Español'], ['eng', 'Inglés']], value: S.settings.ocrLang || 'spa+eng' }),
    repo: field({ type: 'text', label: 'Repositorio de actualizaciones (GitHub)', placeholder: 'hug04ntivil/pdfmaster', value: S.settings.updateRepo || '', hint: 'Donde publicas las nuevas versiones de PDF Master (Releases).' }),
    auto: field({ type: 'check', label: 'Buscar actualizaciones automáticamente al abrir el programa', value: S.settings.autoCheckUpdates !== false }),
  };
  const checkRepo = () => {
    const r = f.repo.get().trim();
    if (r && !/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error('El repositorio debe tener el formato usuario/repositorio');
    if (r.toLowerCase() === (S.info.upstream || '').toLowerCase()) throw new Error(`«${r}» es el proyecto de referencia, no tu repositorio. Usa el tuyo: hug04ntivil/pdfmaster.`);
    return r;
  };
  const defApps = h('button', { class: 'btn', onclick: () => pm.openExternal('ms-settings:defaultapps') }, icon('external', 15), 'Elegir PDF Master como lector de PDF predeterminado');

  // --- pestaña Actualizaciones
  const status1 = h('div', { class: 'upd-status' });
  const actions = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  const upstream = h('div', { class: 'props-card', style: { marginTop: '12px' } }, h('h4', null, 'Proyecto de referencia (pdfcraft)'), h('div', { id: 'upstream-info' }, 'Consultando…'));
  const paint = () => {
    status1.textContent = updateText();
    actions.innerHTML = '';
    const u = updateState;
    actions.append(h('button', { class: 'btn', disabled: u.state === 'checking' || u.state === 'downloading', onclick: async () => {
      try {
        const repo = checkRepo();
        S.settings = await pm.setSettings({ updateRepo: repo, autoCheckUpdates: f.auto.get() });
      } catch (e) { return toast(e.message, 'err', 6000); }
      updateState = { state: 'checking' }; paint();
      const r = await pm.checkUpdate();
      if (r.state !== 'started') { updateState = r; paint(); }
    } }, icon('refresh', 15), 'Buscar actualizaciones'));
    if (u.state === 'available') actions.append(h('button', { class: 'btn primary', onclick: () => pm.downloadUpdate() }, icon('download', 15), 'Descargar'));
    if (u.state === 'downloaded') actions.append(h('button', { class: 'btn primary', onclick: () => pm.installUpdate() }, icon('rocket', 15), 'Reiniciar e instalar'));
  };
  updateListeners.add(paint);
  paint();
  pm.upstreamLatest().then((r) => {
    const box = upstream.querySelector('#upstream-info');
    if (!box) return;
    box.innerHTML = '';
    if (r.error) { box.textContent = `No se pudo consultar (${r.error}).`; return; }
    box.append(h('div', null, 'Última versión publicada: ', h('span', { class: 'badge' }, r.tag), ` (${new Date(r.date).toLocaleDateString('es-CL')})`),
      h('div', { class: 'notes', style: { marginTop: '8px' } }, r.notes || 'Sin notas.'),
      h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => pm.openExternal(r.url) }, icon('external', 15), 'Ver novedades en GitHub'));
  });

  const panes = {
    general: h('div', null, f.theme.el, f.zoom.el, f.author.el, f.ocr.el, h('div', { class: 'field' }, defApps)),
    updates: h('div', null,
      h('div', { style: { color: 'var(--muted)' } }, `Versión instalada: ${S.info.version}`), status1, actions,
      h('div', { style: { marginTop: '12px' } }, f.repo.el, f.auto.el), upstream, legendCard()),
    about: h('div', { class: 'about' },
      h('img', { src: 'icon.svg', alt: '', width: 72, height: 72 }),
      h('div', { class: 'about-name' }, 'PDF Master'),
      h('div', { class: 'by' }, 'by Hugo'),
      h('div', { class: 'about-ver' }, `Versión ${S.info.version}`),
      legendCard(),
      h('div', { class: 'about-meta' }, `Electron ${S.info.electron} · ${S.info.platform}`),
      h('div', { class: 'about-meta' }, '© 2026 Hugo A.')),
  };
  const tabs = h('div', { class: 'seg-tabs' });
  const names = { general: 'General', updates: 'Actualizaciones', about: 'Acerca de' };
  const show = (t) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    Object.entries(panes).forEach(([k, el]) => { el.hidden = k !== t; });
  };
  Object.keys(names).forEach((k) => tabs.append(h('button', { 'data-t': k, onclick: () => show(k) }, names[k])));
  show(startTab);

  const ok = await modal({
    title: 'Ajustes', icon: 'settings', size: 'wide', body: h('div', { style: { minHeight: '420px' } }, tabs, ...Object.values(panes)),
    okText: 'Guardar', onOk: () => { checkRepo(); return true; },
  });
  updateListeners.delete(paint);
  if (!ok) return;
  S.settings = await pm.setSettings({ theme: f.theme.get(), defaultZoom: f.zoom.get(), author: f.author.get(), ocrLang: f.ocr.get(), updateRepo: f.repo.get().trim(), autoCheckUpdates: f.auto.get() });
  applyTheme();
  refreshAll();
  toast('Ajustes guardados', 'ok');
}

// ---------------------------------------------------------------- arrastrar y soltar
function setupDnD() {
  let depth = 0;
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!has(e)) return; depth++; $('#dropzone').classList.add('on'); });
  window.addEventListener('dragleave', (e) => { if (!has(e)) return; if (--depth <= 0) { depth = 0; $('#dropzone').classList.remove('on'); } });
  window.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0; $('#dropzone').classList.remove('on');
    const paths = [...e.dataTransfer.files].map((f) => pm.pathForFile(f)).filter(Boolean);
    if (paths.length) await openPaths(paths);
  });
}

// ---------------------------------------------------------------- atajos de teclado
function setupKeys() {
  document.addEventListener('keydown', async (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if ($('#modal-root').children.length) return;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); return openFiles(); }
      if (k === 's') { e.preventDefault(); return saveCurrent(e.shiftKey); }
      if (k === 'p') { e.preventDefault(); return doPrint(); }
      if (k === 'w') { e.preventDefault(); if (S.cur) closeTab(S.cur); return; }
      if (k === 'f') { e.preventDefault(); const s = $('#search-input'); if (!s.disabled) { s.focus(); s.select(); } return; }
      if (k === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
      if (k === 'y' && !typing) { e.preventDefault(); return doRedo(); }
      if (k === 'd' && OV.selId && !typing) { e.preventDefault(); return OV.duplicate(); }
      if (k === 'tab') { e.preventDefault(); if (S.docs.length > 1) { const i = S.docs.indexOf(S.cur); setCurrent(S.docs[(i + (e.shiftKey ? -1 : 1) + S.docs.length) % S.docs.length]); } return; }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); return viewer.zoomBy(1.15); }
      if (e.key === '-') { e.preventDefault(); return viewer.zoomBy(1 / 1.15); }
      if (e.key === '0') { e.preventDefault(); return viewer.applyZoom('fit-page'); }
      return;
    }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && OV.selId) { e.preventDefault(); return OV.deleteSelected(); }
    if (e.key === 'Delete' && S.cur && S.cur.sel.size && !OV.selId) { return runTool('delete'); }
    if (e.key === 'Escape') { if (OV.selId) OV.select(null); else if (OV.tool && OV.tool !== 'select') OV.setTool('select'); return; }
    const step = e.shiftKey ? 10 : 1;
    if (OV.selId && e.key.startsWith('Arrow')) {
      e.preventDefault();
      OV.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    }
    if (!OV.selId && S.cur) {
      if (e.key === 'PageDown') { e.preventDefault(); viewer.goTo(viewer.current + 1, true); }
      if (e.key === 'PageUp') { e.preventDefault(); viewer.goTo(viewer.current - 1, true); }
      if (e.key === 'Home') { e.preventDefault(); viewer.goTo(0); }
      if (e.key === 'End') { e.preventDefault(); viewer.goTo(viewer.pages.length - 1); }
    }
  });
}

// ---------------------------------------------------------------- inicio
async function main() {
  S.info = await pm.info();
  S.settings = await pm.getSettings();
  try { S.sysFonts = await pm.listFonts(); } catch { S.sysFonts = {}; }
  applyTheme();

  viewer = new Viewer($('#viewer-scroll'), $('#viewer'));
  $('#viewer-scroll').tabIndex = 0;
  thumbs = new Thumbs($('#thumbs'), {
    onGo: (i) => viewer.goTo(i),
    onReorder: async (order, newSel) => {
      const d = S.cur;
      await structuralQuick('Reordenar páginas', (dd) => E.reorderPages(dd.bytes, order));
      d.sel = new Set(newSel);
      thumbs.refreshSel();
    },
    onAction: async (name, idxs) => {
      const d = S.cur;
      switch (name) {
        case 'rotateR': await structuralQuick('Rotar', (dd) => E.rotatePages(dd.bytes, idxs, 90)); break;
        case 'rotateL': await structuralQuick('Rotar', (dd) => E.rotatePages(dd.bytes, idxs, -90)); break;
        case 'duplicate': {
          const order = [];
          for (let i = 0; i < d.numPages; i++) { order.push(i); if (idxs.includes(i)) order.push(i); }
          await structuralQuick('Duplicar páginas', (dd) => E.reorderPages(dd.bytes, order));
          break;
        }
        case 'extract': await withBusy('Extrayendo…', async () => { await d.commit(); await openGenerated(`${baseName(d.name)}_extracto.pdf`, await E.extractPages(d.bytes, idxs)); }); break;
        case 'blankAfter': await structuralQuick('Insertar página', (dd) => E.insertBlank(dd.bytes, idxs[idxs.length - 1], 1)); break;
        case 'insertFile': d.sel = new Set([idxs[idxs.length - 1]]); runTool('insertFile'); break;
        case 'delete': if (idxs.length >= d.numPages) return toast('No puedes eliminar todas las páginas.', 'err'); await structuralQuick('Eliminar páginas', (dd) => E.deletePages(dd.bytes, idxs)); break;
        default: break;
      }
    },
  });
  initOverlay(viewer);
  viewer.hooks.onPage = (i) => {
    $('#page-input').value = String(i + 1);
    thumbs.setCurrent(i);
    refreshToolbar();
  };
  viewer.hooks.onSearch = (n, idx) => { $('#search-hits').textContent = viewer.query ? (n ? `${idx + 1}/${n}` : 'Sin resultados') : ''; };
  setApp({ viewer, thumbs });

  buildToolbar();
  buildThumbActions();
  initToolSearch();
  renderTools();
  setupDnD();
  setupKeys();
  OV.setTool('select');

  pm.onLaunch((l) => handleLaunch(l));
  pm.onUpdate((ev) => {
    updateState = ev;
    updateListeners.forEach((f) => f());
    if (ev.state === 'available') toast(`Nueva versión disponible: ${ev.version}`, 'ok', 9000, { label: 'Ver', fn: () => openSettings('updates') });
    refreshToolbar();
  });
  pm.onRequestClose(async () => {
    for (const d of [...S.docs]) {
      if (!d.dirty) continue;
      setCurrent(d);
      const r = await askSave(d.name);
      if (r === 'cancel') return;
      if (r === 'save') { try { if (!(await d.save(false))) return; } catch (e) { toast(e.message, 'err'); return; } }
    }
    pm.confirmClose();
  });

  await showCurrent();
  for (const l of await pm.takePending()) await handleLaunch(l);
  if (S.settings.autoCheckUpdates !== false && S.settings.updateRepo && S.info.packaged) setTimeout(() => pm.checkUpdate(), 5000);
  window.__pm = { S, viewer, thumbs, OV, E, C, runTool, CATS, openPaths, openEntry, saveCurrent, handleLaunch }; // para depuración/pruebas
}

main().catch((e) => {
  console.error(e);
  document.body.prepend(h('pre', { style: { position: 'fixed', zIndex: 999, background: '#fee', color: '#900', padding: '12px', inset: '0 0 auto 0' } }, 'Error al iniciar: ' + (e && e.stack || e)));
});
void status; void refreshAll;
