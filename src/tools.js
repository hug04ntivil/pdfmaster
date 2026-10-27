// Panel de herramientas (derecha) y los diálogos de cada herramienta
import { S, emit, onChange, openGenerated, openEntry, askPassword, PDF_OPTS, pdfjs } from './docs.js';
import { OV } from './overlay.js';
import * as E from './engine.js';
import * as C from './convert.js';
import {
  h, $, icon, field, modal, toast, withBusy, busy, parseRanges, rangesToString, baseName, fmtBytes, bytesToDataUrl, dataUrlToBytes,
  canvasToBlob, blobToBytes, status, uid, clamp, hexToRgb01,
} from './util.js';

let app = null; // { viewer, thumbs }
export const setApp = (a) => { app = a; };
const cur = () => S.cur;

// ---------------------------------------------------------------- catálogo
const PDF_FILTER = [{ name: 'Documento PDF', extensions: ['pdf'] }];
export const CATS = [
  { id: 'edit', title: 'Editar', icon: 'pencil', open: true, tools: [
    { id: 'select', label: 'Seleccionar', icon: 'pointer', mode: true },
    { id: 'text', label: 'Añadir texto', icon: 'text', mode: true },
    { id: 'edittext', label: 'Editar texto existente', icon: 'filePen', mode: true },
    { id: 'image', label: 'Añadir imagen', icon: 'imagePlus' },
    { id: 'sign', label: 'Firmar', icon: 'signature' },
    { id: 'stamp', label: 'Sellos', icon: 'stamp' },
    { id: 'highlight', label: 'Resaltar texto', icon: 'highlight', mode: true },
    { id: 'underline', label: 'Subrayar', icon: 'underline', mode: true },
    { id: 'strike', label: 'Tachar texto', icon: 'strike', mode: true },
    { id: 'area', label: 'Resaltar área', icon: 'brush', mode: true },
    { id: 'ink', label: 'Dibujo libre', icon: 'pencil', mode: true },
    { id: 'rect', label: 'Rectángulo', icon: 'square', mode: true },
    { id: 'ellipse', label: 'Elipse', icon: 'circle', mode: true },
    { id: 'line', label: 'Línea', icon: 'line', mode: true },
    { id: 'arrow', label: 'Flecha', icon: 'arrow', mode: true },
    { id: 'whiteout', label: 'Tapar con blanco', icon: 'eraser', mode: true },
    { id: 'redact', label: 'Redactar (borrar)', icon: 'eyeOff', mode: true },
  ] },
  { id: 'pages', title: 'Páginas', icon: 'layers', open: true, tools: [
    { id: 'organize', label: 'Organizar páginas', icon: 'grid' },
    { id: 'rotateR', label: 'Rotar a la derecha', icon: 'rotateCw' },
    { id: 'rotateL', label: 'Rotar a la izquierda', icon: 'rotateCcw' },
    { id: 'delete', label: 'Eliminar páginas', icon: 'trash' },
    { id: 'extract', label: 'Extraer páginas', icon: 'extract' },
    { id: 'blank', label: 'Insertar en blanco', icon: 'filePlus' },
    { id: 'insertFile', label: 'Insertar desde PDF', icon: 'filePlus2' },
    { id: 'crop', label: 'Recortar márgenes', icon: 'crop' },
    { id: 'split', label: 'Dividir PDF', icon: 'split', nodoc: false },
    { id: 'merge', label: 'Unir PDFs', icon: 'merge', nodoc: true },
  ] },
  { id: 'insert', title: 'Numeración y marcas', icon: 'hash', tools: [
    { id: 'pagenum', label: 'Numerar páginas', icon: 'hash' },
    { id: 'headfoot', label: 'Encabezado y pie', icon: 'header' },
    { id: 'watermark', label: 'Marca de agua', icon: 'watermark' },
  ] },
  { id: 'forms', title: 'Formularios', icon: 'form', tools: [
    { id: 'fillform', label: 'Rellenar formulario', icon: 'form' },
    { id: 'flatten', label: 'Aplanar formulario', icon: 'layers' },
  ] },
  { id: 'convert', title: 'Convertir', icon: 'swap', tools: [
    { id: 'toimages', label: 'PDF a imágenes', icon: 'fileImage' },
    { id: 'toword', label: 'PDF a Word', icon: 'fileText' },
    { id: 'toexcel', label: 'PDF a Excel', icon: 'sheet' },
    { id: 'topptx', label: 'PDF a PowerPoint', icon: 'slides' },
    { id: 'totext', label: 'PDF a texto', icon: 'fileType' },
    { id: 'tohtml', label: 'PDF a HTML', icon: 'code' },
    { id: 'imgs2pdf', label: 'Imágenes a PDF', icon: 'imagePlus', nodoc: true },
    { id: 'txt2pdf', label: 'Texto / HTML a PDF', icon: 'fileUp', nodoc: true },
    { id: 'office2pdf', label: 'Office a PDF', icon: 'fileDown', nodoc: true },
  ] },
  { id: 'optimize', title: 'Optimizar', icon: 'sparkles', tools: [
    { id: 'compress', label: 'Comprimir PDF', icon: 'compress' },
    { id: 'ocr', label: 'OCR (texto buscable)', icon: 'ocr' },
  ] },
  { id: 'security', title: 'Seguridad y datos', icon: 'shield', tools: [
    { id: 'protect', label: 'Proteger con contraseña', icon: 'lock' },
    { id: 'unprotect', label: 'Quitar contraseña', icon: 'unlock' },
    { id: 'metadata', label: 'Metadatos', icon: 'info' },
    { id: 'props', label: 'Propiedades', icon: 'help' },
  ] },
];
const ALL_TOOLS = CATS.flatMap((c) => c.tools.map((t) => ({ ...t, cat: c.id })));

// ---------------------------------------------------------------- panel
const catOpen = new Map(CATS.map((c) => [c.id, !!c.open]));
export function renderTools() {
  const box = $('#tools');
  const hasDoc = !!cur();
  box.innerHTML = '';
  for (const c of CATS) {
    const cat = h('div', { class: 'cat' + (catOpen.get(c.id) ? ' open' : ''), 'data-cat': c.id });
    const head = h('button', { class: 'cat-h', onclick: () => { catOpen.set(c.id, !catOpen.get(c.id)); cat.classList.toggle('open'); } },
      h('span', { class: 'ci' }, icon(c.icon, 17)), c.title, h('span', { class: 'chev' }, icon('chevDown', 16)));
    const body = h('div', { class: 'cat-b' });
    for (const t of c.tools) {
      const disabled = !hasDoc && !t.nodoc;
      const b = h('button', { class: 'tool' + (t.mode && OV.tool === t.id ? ' on' : ''), 'data-tool': t.id, disabled, title: t.label, onclick: () => clickTool(t) }, icon(t.icon, 20), h('span', null, t.label));
      body.append(b);
    }
    cat.append(head, body);
    box.append(cat);
  }
  applyToolSearch($('#tool-search-wrap input') ? $('#tool-search-wrap input').value : '');
}
export function initToolSearch() {
  const wrap = $('#tool-search-wrap');
  const inp = h('input', { type: 'search', placeholder: 'Buscar herramienta…', oninput: (e) => applyToolSearch(e.target.value) });
  wrap.append(h('div', { class: 'sw' }, icon('search', 15), inp));
}
function applyToolSearch(q) {
  q = (q || '').trim().toLowerCase();
  document.querySelectorAll('#tools .cat').forEach((cat) => {
    let any = false;
    cat.querySelectorAll('.tool').forEach((b) => {
      const t = ALL_TOOLS.find((x) => x.id === b.dataset.tool);
      const hit = !q || t.label.toLowerCase().includes(q);
      b.classList.toggle('hidden-by-search', !hit);
      if (hit) any = true;
    });
    cat.classList.toggle('hidden-by-search', !any);
    if (q && any) cat.classList.add('open');
    else cat.classList.toggle('open', !!catOpen.get(cat.dataset.cat));
  });
}
export function refreshToolState() {
  document.querySelectorAll('#tools .tool').forEach((b) => {
    const t = ALL_TOOLS.find((x) => x.id === b.dataset.tool);
    b.classList.toggle('on', !!t.mode && OV.tool === t.id);
    b.disabled = !cur() && !t.nodoc;
  });
}
export function renderProps() {
  const box = $('#props');
  box.innerHTML = '';
  const card = cur() ? OV.propsCard() : null;
  if (card) box.append(card);
}

function clickTool(t) {
  if (t.mode) {
    const next = OV.tool === t.id && t.id !== 'select' ? 'select' : t.id;
    OV.setTool(next);
    const hints = {
      text: 'Haz clic en la página para escribir.', edittext: 'Haz clic sobre un texto del PDF para reemplazarlo.', highlight: 'Selecciona texto con el ratón para resaltarlo.',
      underline: 'Selecciona texto para subrayarlo.', strike: 'Selecciona texto para tacharlo.', redact: 'Dibuja recuadros sobre lo que quieras eliminar.', area: 'Arrastra para resaltar un área.',
      ink: 'Dibuja con el ratón sobre la página.', rect: 'Arrastra para dibujar.', ellipse: 'Arrastra para dibujar.', line: 'Arrastra (Mayús = ángulo fijo).', arrow: 'Arrastra (Mayús = ángulo fijo).', whiteout: 'Arrastra sobre lo que quieras tapar.',
    };
    status(hints[next] || 'Listo');
    return;
  }
  runTool(t.id);
}
export function runTool(id) {
  const fn = TOOLS[id];
  if (!fn) return toast('Herramienta no disponible', 'err');
  const t = ALL_TOOLS.find((x) => x.id === id);
  if (!cur() && !(t && t.nodoc)) return toast('Abre un PDF primero', 'err');
  return fn();
}

// ---------------------------------------------------------------- utilidades de herramientas
async function structural(label, fn, { keepView = true } = {}) {
  const d = cur();
  return withBusy(label + '…', async (b) => {
    await d.commit();
    const out = await fn(d, b);
    if (out) {
      const keep = app.viewer.current;
      await d.applyBytes(out, label);
      if (keepView) setTimeout(() => app.viewer.goTo(Math.min(keep, d.numPages - 1)), 60);
    }
    return out;
  });
}
function scopeField(d, { label = 'Páginas', def, preferSel = false } = {}) {
  const sel = [...d.sel].sort((a, b) => a - b);
  const curPage = app.viewer.current;
  const options = [['all', `Todas (${d.numPages})`], ['current', `Página actual (${curPage + 1})`]];
  if (sel.length) options.push(['sel', `Seleccionadas en miniaturas (${rangesToString(sel)})`]);
  options.push(['range', 'Rango personalizado…']);
  const initial = def || (sel.length && preferSel ? 'sel' : 'all');
  const s = field({ type: 'select', label, options, value: initial });
  const r = field({ type: 'text', label: 'Páginas (ej. 1-3, 5, 8-)', placeholder: '1-3, 5, 8-' });
  r.el.hidden = initial !== 'range';
  s.input.addEventListener('change', () => { r.el.hidden = s.get() !== 'range'; if (!r.el.hidden) r.input.focus(); });
  const el = h('div', null, s.el, r.el);
  return {
    el,
    get() {
      switch (s.get()) {
        case 'all': return Array.from({ length: d.numPages }, (_, i) => i);
        case 'current': return [curPage];
        case 'sel': return sel;
        default: return parseRanges(r.get(), d.numPages);
      }
    },
  };
}
function targetPages(d) {
  // acciones rápidas: miniaturas seleccionadas o la página actual
  const sel = [...d.sel].sort((a, b) => a - b);
  return sel.length ? sel : [app.viewer.current];
}
const colorToHex = (c) => c;
async function pickFile(kind, multi = false) {
  const r = await window.pm.openDialog({ kind, multi });
  return r;
}
async function saveAs(defaultName, data, filters) {
  return window.pm.saveDialog({ defaultName, data, filters });
}
function doneToast(msg, path) {
  toast(msg, 'ok', 7000, path ? { label: 'Mostrar', fn: () => window.pm.showInFolder(path) } : undefined);
}
async function loadForMerge(entry) {
  try {
    await E.pageCount(entry.bytes, entry.password);
  } catch (e) {
    if (E.isEncryptedError(e)) {
      const pw = await askPassword(entry.name);
      if (!pw) throw new Error('Operación cancelada');
      entry.password = pw;
      await E.pageCount(entry.bytes, pw);
    } else throw e;
  }
}

// ---------------------------------------------------------------- herramientas
const TOOLS = {};

TOOLS.image = async () => {
  const files = await pickFile('images', false);
  if (!files.length) return;
  const f = files[0];
  const prep = await C.prepareImage(f);
  const src = bytesToDataUrl(prep.bytes, prep.mime);
  const { w, h: hh } = await imgSize(src);
  OV.placing = { src, w, h: hh, maxW: 260 };
  OV.setTool('place');
  toast('Haz clic en la página donde quieres colocar la imagen', '', 4500);
};
function imgSize(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => rej(new Error('No se pudo leer la imagen'));
    im.src = src;
  });
}

// ---- firma
async function trimCanvas(cv, pad = 6) {
  const ctx = cv.getContext('2d');
  const { width: W, height: H } = cv;
  const data = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
TOOLS.sign = async () => {
  const saved = [...(S.settings.signatures || [])];
  let tab = saved.length ? 'saved' : 'draw';
  let result = null; // dataURL
  const pad = h('canvas', { class: 'sig-pad', width: 760, height: 360 });
  const ctx = pad.getContext('2d');
  let color = '#1d2b6b';
  let drawn = false;
  const setupPad = () => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 4.2;
    let down = false, last = null;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height }; };
    pad.onpointerdown = (e) => { down = true; pad.setPointerCapture(e.pointerId); last = pos(e); ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y); ctx.stroke(); drawn = true; };
    pad.onpointermove = (e) => { if (!down) return; const p = pos(e); const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }; ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; };
    pad.onpointerup = () => { down = false; };
  };
  setupPad();
  const typed = field({ type: 'text', label: 'Escribe tu nombre', value: S.settings.author || '' });
  const fontOpts = ['Segoe Script', 'Ink Free', 'Brush Script MT', 'Times New Roman', 'Georgia', 'Arial'].filter((f) => S.sysFonts[f]);
  const fontSel = field({ type: 'select', label: 'Estilo', options: fontOpts.length ? fontOpts : ['Arial'], value: fontOpts[0] });
  const typedPrev = h('canvas', { width: 760, height: 200, style: { width: '100%', background: '#fff', borderRadius: '10px', border: '1px dashed var(--line)' } });
  const drawTyped = () => {
    const c = typedPrev.getContext('2d');
    c.clearRect(0, 0, 760, 200);
    c.fillStyle = color; c.textBaseline = 'middle'; c.textAlign = 'center';
    const fam = fontSel.get();
    const italic = ['Times New Roman', 'Georgia', 'Arial'].includes(fam) ? 'italic ' : '';
    let size = 96;
    c.font = `${italic}${size}px "${fam}"`;
    while (c.measureText(typed.get()).width > 720 && size > 20) { size -= 4; c.font = `${italic}${size}px "${fam}"`; }
    c.fillText(typed.get(), 380, 100);
  };
  typed.input.addEventListener('input', drawTyped); fontSel.input.addEventListener('change', drawTyped);
  const imgField = h('div', null, h('button', { class: 'btn', onclick: async () => {
    const f = (await pickFile('images', false))[0];
    if (!f) return;
    const prep = await C.prepareImage(f);
    const src = bytesToDataUrl(prep.bytes, prep.mime);
    const im = await loadImage(src);
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const cx = cv.getContext('2d');
    cx.drawImage(im, 0, 0);
    if (removeBg.get()) {
      const d = cx.getImageData(0, 0, cv.width, cv.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        if (lum > 200) d.data[i + 3] = Math.max(0, 255 - (lum - 200) * 4.6);
      }
      cx.putImageData(d, 0, 0);
    }
    imgPrev.src = cv.toDataURL('image/png');
    imgPrev.hidden = false;
  } }, icon('image', 16), 'Elegir imagen de firma…'));
  const removeBg = field({ type: 'check', label: 'Quitar fondo blanco', value: true });
  const imgPrev = h('img', { style: { maxWidth: '100%', maxHeight: '160px', background: '#fff', marginTop: '8px', borderRadius: '8px' }, hidden: true });
  imgField.append(removeBg.el, imgPrev);
  const keep = field({ type: 'check', label: 'Guardar esta firma para usarla otra vez', value: true });
  const colorIn = h('input', { type: 'color', value: color, onchange: (e) => { color = e.target.value; ctx.strokeStyle = color; drawTyped(); } });
  const savedList = h('div', { class: 'sig-list' });
  const renderSaved = () => {
    savedList.innerHTML = '';
    if (!saved.length) savedList.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'Aún no hay firmas guardadas.'));
    saved.forEach((src, idx) => {
      savedList.append(h('div', { class: 'sig-item', onclick: () => { result = src; dlg.ok.click(); } }, h('img', { src }),
        h('button', { title: 'Eliminar', onclick: (e) => { e.stopPropagation(); saved.splice(idx, 1); window.pm.setSettings({ signatures: saved }).then((s) => { S.settings = s; }); renderSaved(); } }, icon('x', 12))));
    });
  };
  const panes = {
    saved: h('div', null, h('div', { class: 'hint', style: { color: 'var(--muted)' } }, 'Haz clic en una firma para colocarla en el documento.'), savedList),
    draw: h('div', null, pad, h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' } }, h('button', { class: 'btn', onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; } }, 'Borrar'), h('span', { style: { color: 'var(--muted)' } }, 'Color'), colorIn)),
    type: h('div', null, typed.el, fontSel.el, typedPrev),
    image: imgField,
  };
  const tabs = h('div', { class: 'seg-tabs' });
  const names = { saved: 'Guardadas', draw: 'Dibujar', type: 'Escribir', image: 'Imagen' };
  const show = (t) => {
    tab = t;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    Object.entries(panes).forEach(([k, el]) => { el.hidden = k !== t; });
    keep.el.hidden = t === 'saved';
    if (t === 'type') drawTyped();
  };
  Object.keys(names).forEach((k) => tabs.append(h('button', { 'data-t': k, onclick: () => show(k) }, names[k])));
  renderSaved();
  const body = h('div', null, tabs, ...Object.values(panes), keep.el);
  const dlg = { ok: null };
  const r = await modal({
    title: 'Firmar', icon: 'signature', size: 'wide', body: (api) => { dlg.ok = api.ok; setTimeout(() => show(tab), 0); return body; }, okText: 'Colocar en el documento',
    onOk: async () => {
      if (result) return true;
      let cv = null;
      if (tab === 'draw') { if (!drawn) throw new Error('Dibuja tu firma en el recuadro'); cv = await trimCanvas(pad); }
      else if (tab === 'type') { if (!typed.get().trim()) throw new Error('Escribe tu nombre'); cv = await trimCanvas(typedPrev, 10); }
      else if (tab === 'image') { if (imgPrev.hidden) throw new Error('Elige una imagen'); const im = await loadImage(imgPrev.src); cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); cv = await trimCanvas(cv, 4) || cv; }
      else throw new Error('Elige una firma guardada');
      if (!cv) throw new Error('La firma está vacía');
      result = cv.toDataURL('image/png');
      if (keep.get()) { saved.unshift(result); S.settings = await window.pm.setSettings({ signatures: saved.slice(0, 12) }); }
      return true;
    },
  });
  if (!r || !result) return;
  const { w, h: hh } = await imgSize(result);
  OV.placing = { src: result, w, h: hh, maxW: 170 };
  OV.setTool('place');
  toast('Haz clic donde quieres colocar la firma. Luego puedes moverla y cambiar su tamaño.', '', 5000);
};
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

// ---- sellos
TOOLS.stamp = async () => {
  const presets = ['APROBADO', 'RECHAZADO', 'CONFIDENCIAL', 'BORRADOR', 'COPIA', 'URGENTE', 'PAGADO', 'ORIGINAL', 'REVISADO'];
  const sel = field({ type: 'select', label: 'Sello', options: [...presets, 'Personalizado…'], value: 'APROBADO' });
  const txt = field({ type: 'text', label: 'Texto personalizado', value: '' });
  txt.el.hidden = true;
  sel.input.addEventListener('change', () => { txt.el.hidden = sel.get() !== 'Personalizado…'; draw(); });
  txt.input.addEventListener('input', () => draw());
  const col = field({ type: 'color', label: 'Color', value: '#c81e3c' });
  const date = field({ type: 'check', label: 'Añadir la fecha de hoy', value: true });
  const prev = h('canvas', { style: { maxWidth: '100%', background: '#fff', borderRadius: '10px', border: '1px solid var(--line)' } });
  const draw = () => {
    const text = sel.get() === 'Personalizado…' ? txt.get() || 'TEXTO' : sel.get();
    const dateStr = date.get() ? new Date().toLocaleDateString('es-CL') : '';
    const c = prev.getContext('2d');
    c.font = '700 64px "Segoe UI", Arial';
    const w1 = c.measureText(text).width;
    c.font = '600 28px "Segoe UI", Arial';
    const w2 = dateStr ? c.measureText(dateStr).width : 0;
    const W = Math.ceil(Math.max(w1, w2) + 70), H = dateStr ? 150 : 110;
    prev.width = W; prev.height = H; prev.style.width = Math.min(W, 420) + 'px';
    const cx = prev.getContext('2d');
    cx.clearRect(0, 0, W, H);
    cx.strokeStyle = col.get(); cx.fillStyle = col.get(); cx.lineWidth = 6;
    const r = 14;
    cx.beginPath(); cx.roundRect(5, 5, W - 10, H - 10, r); cx.stroke();
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = '700 64px "Segoe UI", Arial'; cx.fillText(text, W / 2, dateStr ? 52 : H / 2);
    if (dateStr) { cx.font = '600 28px "Segoe UI", Arial'; cx.fillText(dateStr, W / 2, 112); }
  };
  col.input.addEventListener('input', draw); date.input.addEventListener('change', draw);
  const body = h('div', null, sel.el, txt.el, col.el, date.el, prev);
  setTimeout(draw, 0);
  const ok = await modal({ title: 'Sellos', icon: 'stamp', body, okText: 'Colocar en el documento' });
  if (!ok) return;
  const src = prev.toDataURL('image/png');
  OV.placing = { src, w: prev.width, h: prev.height, maxW: 190 };
  OV.setTool('place');
  toast('Haz clic donde quieres colocar el sello.', '', 4500);
};

// ---- páginas
TOOLS.rotateR = () => rotateQuick(90);
TOOLS.rotateL = () => rotateQuick(-90);
async function rotateQuick(delta) {
  const d = cur();
  const idx = targetPages(d);
  await structural('Rotar', (dd) => E.rotatePages(dd.bytes, idx, delta));
  d.sel = new Set(idx);
  app.thumbs.refreshSel();
}
TOOLS.delete = async () => {
  const d = cur();
  const sc = scopeField(d, { label: 'Páginas a eliminar', def: d.sel.size ? 'sel' : 'current' });
  const ok = await modal({ title: 'Eliminar páginas', icon: 'trash', body: sc.el, okText: 'Eliminar', onOk: () => { const i = sc.get(); if (i.length >= d.numPages) throw new Error('No puedes eliminar todas las páginas.'); return true; } });
  if (!ok) return;
  const idx = sc.get();
  await structural('Eliminar páginas', (dd) => E.deletePages(dd.bytes, idx));
};
TOOLS.extract = async () => {
  const d = cur();
  const sc = scopeField(d, { label: 'Páginas a extraer', def: d.sel.size ? 'sel' : 'current' });
  const ok = await modal({ title: 'Extraer páginas', icon: 'extract', sub: 'Se crea un PDF nuevo con esas páginas.', body: sc.el, okText: 'Extraer', onOk: () => { sc.get(); return true; } });
  if (!ok) return;
  const idx = sc.get();
  await withBusy('Extrayendo…', async () => {
    await d.commit();
    const out = await E.extractPages(d.bytes, idx);
    await openGenerated(`${baseName(d.name)}_extracto.pdf`, out);
  });
};
TOOLS.blank = async () => {
  const d = cur();
  const count = field({ type: 'number', label: 'Cantidad de páginas', value: 1, min: 1, max: 200 });
  const where = field({ type: 'select', label: 'Dónde', options: [['after', `Después de la página actual (${app.viewer.current + 1})`], ['start', 'Al principio'], ['end', 'Al final']], value: 'after' });
  const size = field({ type: 'select', label: 'Tamaño', options: [['same', 'Igual que la página actual'], ['a4', 'A4'], ['letter', 'Carta']], value: 'same' });
  const ok = await modal({ title: 'Insertar páginas en blanco', icon: 'filePlus', body: h('div', null, count.el, where.el, size.el), okText: 'Insertar' });
  if (!ok) return;
  const after = where.get() === 'start' ? -1 : where.get() === 'end' ? d.numPages - 1 : app.viewer.current;
  const sz = { a4: [595.28, 841.89], letter: [612, 792] }[size.get()];
  await structural('Insertar páginas', (dd) => E.insertBlank(dd.bytes, after, clamp(count.get() || 1, 1, 200), sz));
};
TOOLS.insertFile = async () => {
  const d = cur();
  const files = await pickFile('pdf', false);
  if (!files.length) return;
  const entry = { name: files[0].name, bytes: files[0].data };
  await loadForMerge(entry);
  const n = await E.pageCount(entry.bytes, entry.password);
  const range = field({ type: 'text', label: `Páginas de «${entry.name}» (${n} en total)`, value: `1-${n}` });
  const where = field({ type: 'select', label: 'Dónde', options: [['after', `Después de la página actual (${app.viewer.current + 1})`], ['start', 'Al principio'], ['end', 'Al final']], value: 'after' });
  const ok = await modal({ title: 'Insertar páginas desde otro PDF', icon: 'filePlus2', body: h('div', null, range.el, where.el), okText: 'Insertar', onOk: () => { parseRanges(range.get(), n); return true; } });
  if (!ok) return;
  const after = where.get() === 'start' ? -1 : where.get() === 'end' ? d.numPages - 1 : app.viewer.current;
  await structural('Insertar páginas', (dd) => E.insertFrom(dd.bytes, entry.bytes, after, parseRanges(range.get(), n), entry.password));
};
TOOLS.crop = async () => {
  const d = cur();
  const mk = (l) => field({ type: 'number', label: l, value: 0, min: 0, step: 1 });
  const t = mk('Arriba (mm)'), r = mk('Derecha (mm)'), b = mk('Abajo (mm)'), l = mk('Izquierda (mm)');
  const sc = scopeField(d, { label: 'Aplicar a' });
  const body = h('div', null, h('div', { class: 'field' }, h('div', { class: 'row' }, t.el, r.el)), h('div', { class: 'field' }, h('div', { class: 'row' }, b.el, l.el)), sc.el);
  const ok = await modal({ title: 'Recortar márgenes', icon: 'crop', sub: 'Quita espacio blanco alrededor de las páginas (el contenido recortado se oculta).', body, okText: 'Recortar', onOk: () => { sc.get(); return true; } });
  if (!ok) return;
  const mm = (f) => (f.get() || 0) * 2.8346;
  await structural('Recortar', (dd) => E.cropPages(dd.bytes, sc.get(), { top: mm(t), right: mm(r), bottom: mm(b), left: mm(l) }));
};
TOOLS.organize = async () => {
  const d = cur();
  await withBusy('Preparando páginas…', () => d.commit());
  const n = d.numPages;
  let items = Array.from({ length: n }, (_, i) => ({ id: uid(), orig: i, rot: 0, del: false }));
  const sel = new Set();
  const grid = h('div', { class: 'grid-pages' });
  let thumbGen = 0;
  const cache = new Map();
  const thumbOf = async (orig) => {
    if (cache.has(orig)) return cache.get(orig);
    const { canvas } = await C.renderPage(d.pdf, orig + 1, 0.32);
    cache.set(orig, canvas);
    return canvas;
  };
  let dragId = null;
  const render = () => {
    const gen = ++thumbGen;
    grid.innerHTML = '';
    items.forEach((it, pos) => {
      const cv = document.createElement('canvas');
      const holder = h('div', { style: { width: '100%', display: 'grid', placeItems: 'center', minHeight: '110px', overflow: 'hidden' } }, cv);
      thumbOf(it.orig).then((src) => {
        if (gen !== thumbGen) return;
        cv.width = src.width; cv.height = src.height;
        cv.getContext('2d').drawImage(src, 0, 0);
        cv.style.transform = `rotate(${it.rot}deg)`;
        if (it.rot % 180 !== 0) { cv.style.maxWidth = '110px'; }
      });
      if (it.del) holder.style.opacity = '0.25';
      const card = h('div', { class: 'gp' + (sel.has(it.id) ? ' sel' : ''), draggable: true, 'data-id': it.id },
        holder,
        h('div', { class: 'gn' }, `${pos + 1}${it.del ? ' · eliminada' : ''}`),
        h('div', { class: 'ga' },
          h('button', { title: 'Rotar a la izquierda', onclick: (e) => { e.stopPropagation(); it.rot = (it.rot + 270) % 360; render(); } }, icon('rotateCcw', 14)),
          h('button', { title: 'Rotar a la derecha', onclick: (e) => { e.stopPropagation(); it.rot = (it.rot + 90) % 360; render(); } }, icon('rotateCw', 14)),
          h('button', { title: 'Duplicar', onclick: (e) => { e.stopPropagation(); items.splice(pos + 1, 0, { id: uid(), orig: it.orig, rot: it.rot, del: false }); render(); } }, icon('copy', 14)),
          h('button', { title: it.del ? 'Restaurar' : 'Eliminar', onclick: (e) => { e.stopPropagation(); it.del = !it.del; render(); } }, icon(it.del ? 'refresh' : 'trash', 14))));
      card.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) sel.has(it.id) ? sel.delete(it.id) : sel.add(it.id); else { sel.clear(); sel.add(it.id); } render(); });
      card.addEventListener('dragstart', (e) => { dragId = it.id; if (!sel.has(it.id)) { sel.clear(); sel.add(it.id); } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); grid.querySelectorAll('.gp').forEach((x) => x.classList.remove('dragover-before', 'dragover-after')); });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const r = card.getBoundingClientRect();
        grid.querySelectorAll('.gp').forEach((x) => x.classList.remove('dragover-before', 'dragover-after'));
        card.classList.add(e.clientX > r.left + r.width / 2 ? 'dragover-after' : 'dragover-before');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragId) return;
        const r = card.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        const moving = items.filter((x) => sel.has(x.id));
        const rest = items.filter((x) => !sel.has(x.id));
        let at = rest.findIndex((x) => x.id === it.id);
        if (sel.has(it.id)) { dragId = null; return; }
        at = at + (after ? 1 : 0);
        items = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
        dragId = null;
        render();
      });
      grid.append(card);
    });
  };
  render();
  const bar = h('div', { style: { display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
    h('button', { class: 'btn', onclick: () => { items.forEach((x) => { if (sel.has(x.id)) x.rot = (x.rot + 90) % 360; }); render(); } }, icon('rotateCw', 15), 'Rotar selección'),
    h('button', { class: 'btn', onclick: () => { items.forEach((x) => { if (sel.has(x.id)) x.del = !x.del; }); render(); } }, icon('trash', 15), 'Eliminar / restaurar selección'),
    h('button', { class: 'btn', onclick: () => { items.reverse(); render(); } }, icon('swap', 15), 'Invertir orden'),
    h('span', { style: { color: 'var(--muted)', alignSelf: 'center' } }, 'Arrastra las páginas para reordenarlas. Ctrl+clic selecciona varias.'));
  const ok = await modal({
    title: 'Organizar páginas', icon: 'grid', size: 'xl', body: h('div', null, bar, grid), okText: 'Aplicar cambios', persistent: true,
    onOk: () => { if (items.every((x) => x.del)) throw new Error('Debe quedar al menos una página.'); return true; },
  });
  if (!ok) return;
  const kept = items.filter((x) => !x.del);
  const removed = items.filter((x) => x.del).map((x) => x.orig);
  const order = kept.map((x) => x.orig);
  const sameOrder = order.every((v, k) => k === 0 || v > order[k - 1]) && new Set(order).size === order.length;
  if (sameOrder && !removed.length && kept.every((x) => !x.rot)) return;
  await structural('Organizar páginas', async (dd) => {
    let bytes = dd.bytes;
    if (sameOrder) { if (removed.length) bytes = await E.deletePages(bytes, [...new Set(removed)].filter((o) => !order.includes(o))); }
    else bytes = await E.reorderPages(bytes, order);
    const byRot = new Map();
    kept.forEach((x, k) => { if (x.rot) { if (!byRot.has(x.rot)) byRot.set(x.rot, []); byRot.get(x.rot).push(k); } });
    for (const [rot, idx] of byRot) bytes = await E.rotatePages(bytes, idx, rot);
    return bytes;
  });
};
TOOLS.split = async () => {
  const d = cur();
  const mode = field({ type: 'select', label: 'Dividir por', options: [['every', 'Cada N páginas'], ['ranges', 'Rangos personalizados'], ['each', 'Una página por archivo']], value: 'every' });
  const n = field({ type: 'number', label: 'Páginas por archivo', value: 1, min: 1 });
  const rg = field({ type: 'text', label: 'Rangos (separados por ;)', placeholder: '1-3; 4-6; 7-' });
  rg.el.hidden = true;
  mode.input.addEventListener('change', () => { n.el.hidden = mode.get() !== 'every'; rg.el.hidden = mode.get() !== 'ranges'; });
  const ok = await modal({ title: 'Dividir PDF', icon: 'split', sub: `${d.name} · ${d.numPages} páginas`, body: h('div', null, mode.el, n.el, rg.el), okText: 'Elegir carpeta y dividir', onOk: () => { if (mode.get() === 'ranges') rg.get().split(';').filter((s) => s.trim()).forEach((s) => parseRanges(s, d.numPages)); return true; } });
  if (!ok) return;
  const dir = await window.pm.pickFolder('Carpeta donde guardar los archivos');
  if (!dir) return;
  await withBusy('Dividiendo…', async () => {
    await d.commit();
    let groups;
    if (mode.get() === 'every') groups = E.groupsEvery(d.numPages, Math.max(1, n.get() || 1));
    else if (mode.get() === 'each') groups = E.groupsEvery(d.numPages, 1);
    else groups = rg.get().split(';').filter((s) => s.trim()).map((s) => parseRanges(s, d.numPages));
    const parts = await E.splitDoc(d.bytes, { groups });
    const base = baseName(d.name);
    const paths = await window.pm.writeFolder({ dir, files: parts.map((p, i) => ({ name: `${base}_${String(i + 1).padStart(2, '0')}_${p.label}.pdf`, data: p.bytes })) });
    doneToast(`Se crearon ${parts.length} archivos`, paths[0]);
  });
};
TOOLS.merge = async () => {
  const items = [];
  const d = cur();
  const pre = S.pendingMerge; // archivos elegidos desde el menú contextual de Windows
  S.pendingMerge = null;
  if (pre) pre.forEach((f) => items.push({ id: uid(), name: f.name, bytes: f.data, range: '' }));
  else if (d) items.push({ id: uid(), name: `${d.name} (documento abierto)`, live: d, range: '' });
  const list = h('div', { class: 'filelist' });
  const render = () => {
    list.innerHTML = '';
    if (!items.length) list.append(h('div', { class: 'empty' }, 'Añade los PDFs que quieres unir.'));
    items.forEach((it, i) => {
      const rng = h('input', { type: 'text', placeholder: 'Todas las páginas', value: it.range, style: { width: '150px', height: '28px', border: '1px solid var(--line)', borderRadius: '6px', padding: '0 6px', background: 'var(--panel-2)' }, oninput: (e) => { it.range = e.target.value; } });
      const row = h('div', { class: 'fileitem', draggable: true },
        h('span', { class: 'grip' }, icon('grip', 16)), h('span', { class: 'fn', title: it.name }, `${i + 1}. ${it.name}`), rng,
        h('button', { class: 'icon-btn', title: 'Subir', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } }, icon('up', 15)),
        h('button', { class: 'icon-btn', title: 'Bajar', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } }, icon('down', 15)),
        h('button', { class: 'icon-btn', title: 'Quitar', onclick: () => { items.splice(i, 1); render(); } }, icon('x', 15)));
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); if (Number.isNaN(from) || from === i) return; const [m] = items.splice(from, 1); items.splice(i, 0, m); render(); });
      list.append(row);
    });
  };
  render();
  const add = h('button', { class: 'btn', style: { marginBottom: '10px' }, onclick: async () => { const fs = await pickFile('pdf', true); fs.forEach((f) => items.push({ id: uid(), name: f.name, bytes: f.data, range: '' })); render(); } }, icon('plus', 15), 'Añadir PDFs…');
  const ok = await modal({ title: 'Unir PDFs', icon: 'merge', size: 'wide', sub: 'Arrastra para ordenar. Opcionalmente indica qué páginas de cada archivo usar (ej. 1-3, 7).', body: h('div', null, add, list), okText: 'Unir', onOk: () => { if (items.length < 2) throw new Error('Añade al menos dos PDFs.'); return true; } });
  if (!ok) return;
  await withBusy('Uniendo PDFs…', async (b) => {
    const list2 = [];
    for (const it of items) {
      let bytes = it.bytes;
      if (it.live) { await it.live.commit(); bytes = it.live.bytes; }
      const entry = { name: it.name, bytes, password: undefined };
      await loadForMerge(entry);
      const n = await E.pageCount(entry.bytes, entry.password);
      list2.push({ bytes: entry.bytes, password: entry.password, pages: it.range.trim() ? parseRanges(it.range, n) : undefined });
    }
    b.text('Generando el PDF unido…');
    const out = await E.mergeDocs(list2);
    await openGenerated('PDF unido.pdf', out);
  });
};

// ---- numeración / encabezados / marcas
TOOLS.pagenum = async () => {
  const d = cur();
  const fmt = field({ type: 'select', label: 'Formato', options: [['{n}', '1, 2, 3…'], ['Página {n}', 'Página 1'], ['Página {n} de {total}', 'Página 1 de 10'], ['{n} / {total}', '1 / 10'], ['- {n} -', '- 1 -']], value: 'Página {n} de {total}' });
  const pos = field({ type: 'select', label: 'Posición', options: [['bottom-center', 'Abajo, centro'], ['bottom-right', 'Abajo, derecha'], ['bottom-left', 'Abajo, izquierda'], ['top-center', 'Arriba, centro'], ['top-right', 'Arriba, derecha'], ['top-left', 'Arriba, izquierda']], value: 'bottom-center' });
  const size = field({ type: 'number', label: 'Tamaño (pt)', value: 10, min: 6, max: 48 });
  const start = field({ type: 'number', label: 'Empezar en', value: 1, min: 0 });
  const sc = scopeField(d);
  const ok = await modal({ title: 'Numerar páginas', icon: 'hash', body: h('div', null, fmt.el, pos.el, h('div', { class: 'field' }, h('div', { class: 'row' }, size.el, start.el)), sc.el), okText: 'Aplicar', onOk: () => { sc.get(); return true; } });
  if (!ok) return;
  const [where, align] = pos.get().split('-');
  const zones = { left: '', center: '', right: '' };
  zones[align] = fmt.get();
  await structural('Numerar páginas', (dd) => E.addHeaderFooter(dd.bytes, ctx(), { idxs: sc.get(), ...zones, where, size: size.get() || 10, startAt: start.get() || 1 }));
};
const ctx = () => ({ systemFonts: S.sysFonts, loadFont: (f) => window.pm.readFont(f) });
TOOLS.headfoot = async () => {
  const d = cur();
  const mk = (l, v = '') => field({ type: 'text', label: l, value: v });
  const hl = mk('Encabezado — izquierda'), hc = mk('Encabezado — centro'), hr = mk('Encabezado — derecha');
  const fl = mk('Pie — izquierda'), fc = mk('Pie — centro', 'Página {n} de {total}'), fr = mk('Pie — derecha');
  const size = field({ type: 'number', label: 'Tamaño (pt)', value: 10, min: 6, max: 36 });
  const fam = field({ type: 'select', label: 'Fuente', options: [...E.STANDARD_FAMILIES, ...Object.keys(S.sysFonts)], value: 'Helvetica' });
  const sc = scopeField(d);
  const body = h('div', null,
    h('div', { class: 'hint', style: { color: 'var(--muted)', marginBottom: '6px' } }, 'Variables: {n} = nº de página · {total} = total · {fecha} = fecha de hoy · {archivo} = nombre del archivo'),
    hl.el, hc.el, hr.el, fl.el, fc.el, fr.el, h('div', { class: 'field' }, h('div', { class: 'row' }, size.el, fam.el)), sc.el);
  const ok = await modal({ title: 'Encabezado y pie de página', icon: 'header', body, okText: 'Aplicar', onOk: () => { sc.get(); return true; } });
  if (!ok) return;
  const idxs = sc.get();
  await structural('Encabezado y pie', async (dd) => {
    let bytes = dd.bytes;
    const common = { idxs, size: size.get() || 10, family: fam.get(), file: dd.name };
    if (hl.get() || hc.get() || hr.get()) bytes = await E.addHeaderFooter(bytes, ctx(), { ...common, left: hl.get(), center: hc.get(), right: hr.get(), where: 'top' });
    if (fl.get() || fc.get() || fr.get()) bytes = await E.addHeaderFooter(bytes, ctx(), { ...common, left: fl.get(), center: fc.get(), right: fr.get(), where: 'bottom' });
    return bytes;
  });
};
TOOLS.watermark = async () => {
  const d = cur();
  let tab = 'text';
  const text = field({ type: 'text', label: 'Texto', value: 'CONFIDENCIAL' });
  const size = field({ type: 'number', label: 'Tamaño (pt)', value: 80, min: 8, max: 400 });
  const col = field({ type: 'color', label: 'Color', value: '#c81e3c' });
  const op = field({ type: 'number', label: 'Opacidad (%)', value: 25, min: 5, max: 100 });
  const ang = field({ type: 'number', label: 'Ángulo (°)', value: 45, min: -90, max: 90 });
  const fam = field({ type: 'select', label: 'Fuente', options: [...E.STANDARD_FAMILIES, ...Object.keys(S.sysFonts)], value: 'Helvetica' });
  let imgData = null;
  const imgName = h('span', { style: { color: 'var(--muted)' } }, 'Ninguna imagen elegida');
  const imgScale = field({ type: 'number', label: 'Ancho respecto a la página (%)', value: 50, min: 5, max: 100 });
  const imgBtn = h('button', { class: 'btn', onclick: async () => { const f = (await pickFile('images', false))[0]; if (!f) return; imgData = await C.prepareImage(f); imgName.textContent = f.name; } }, icon('image', 15), 'Elegir imagen…');
  const sc = scopeField(d);
  const tabs = h('div', { class: 'seg-tabs' });
  const pT = h('div', null, text.el, h('div', { class: 'field' }, h('div', { class: 'row' }, size.el, col.el)), h('div', { class: 'field' }, h('div', { class: 'row' }, ang.el, fam.el)));
  const pI = h('div', null, h('div', { class: 'field' }, imgBtn, ' ', imgName), imgScale.el);
  pI.hidden = true;
  const show = (t) => { tab = t; tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); pT.hidden = t !== 'text'; pI.hidden = t !== 'image'; };
  tabs.append(h('button', { 'data-t': 'text', class: 'on', onclick: () => show('text') }, 'Texto'), h('button', { 'data-t': 'image', onclick: () => show('image') }, 'Imagen'));
  const ok = await modal({ title: 'Marca de agua', icon: 'watermark', body: h('div', null, tabs, pT, pI, op.el, sc.el), okText: 'Aplicar', onOk: () => { sc.get(); if (tab === 'text' && !text.get().trim()) throw new Error('Escribe el texto'); if (tab === 'image' && !imgData) throw new Error('Elige una imagen'); return true; } });
  if (!ok) return;
  const idxs = sc.get();
  await structural('Marca de agua', (dd) => (tab === 'text'
    ? E.addWatermarkText(dd.bytes, ctx(), { idxs, text: text.get(), size: size.get() || 80, color: hexToRgb01(col.get()), opacity: clamp((op.get() || 25) / 100, 0.05, 1), angle: ang.get() || 0, family: fam.get() })
    : E.addWatermarkImage(dd.bytes, { idxs, image: imgData.bytes, mime: imgData.mime, scale: clamp((imgScale.get() || 50) / 100, 0.05, 1), opacity: clamp((op.get() || 25) / 100, 0.05, 1) })));
};

// ---- formularios
TOOLS.fillform = async () => {
  const d = cur();
  await withBusy('Leyendo formulario…', () => d.commit());
  const fields = await E.getFormFields(d.bytes);
  if (!fields.length) return toast('Este PDF no tiene campos de formulario rellenables. Usa «Añadir texto» para escribir sobre el documento.', '', 6500);
  const inputs = [];
  const body = h('div');
  fields.forEach((f) => {
    let input;
    if (f.type === 'check') input = h('input', { type: 'checkbox', checked: !!f.value, disabled: f.readOnly, style: { width: '18px', height: '18px', accentColor: 'var(--accent)' } });
    else if (f.type === 'select') input = h('select', { disabled: f.readOnly, style: { width: '100%', height: '32px' } }, h('option', { value: '' }, '—'), f.options.map((o) => h('option', { value: o, selected: o === f.value }, o)));
    else input = f.multiline ? h('textarea', { value: f.value, disabled: f.readOnly, style: { width: '100%', minHeight: '60px' } }) : h('input', { type: 'text', value: f.value, disabled: f.readOnly, style: { width: '100%', height: '32px', padding: '0 8px' } });
    inputs.push([f, input]);
    body.append(h('div', { class: 'form-field-row' }, h('label', { title: f.name }, f.name), input));
  });
  const flat = field({ type: 'check', label: 'Aplanar el formulario al terminar (los campos dejan de ser editables)', value: false });
  body.append(flat.el);
  const ok = await modal({ title: 'Rellenar formulario', icon: 'form', size: 'wide', sub: `${fields.length} campos detectados`, body, okText: 'Aplicar' });
  if (!ok) return;
  const values = {};
  inputs.forEach(([f, el]) => { if (!f.readOnly) values[f.name] = f.type === 'check' ? el.checked : el.value; });
  await structural('Rellenar formulario', (dd) => E.fillFormFields(dd.bytes, values, { flatten: flat.get() }));
};
TOOLS.flatten = async () => {
  const ok = await modal({ title: 'Aplanar formulario', icon: 'layers', body: 'Los campos del formulario se convertirán en contenido fijo y ya no se podrán editar.', okText: 'Aplanar' });
  if (ok) await structural('Aplanar formulario', (dd) => E.flattenForm(dd.bytes));
};

// ---- conversiones
async function convertDialog(title, iconName, extraFields = [], okText = 'Convertir') {
  const d = cur();
  const sc = scopeField(d);
  const ok = await modal({ title, icon: iconName, body: h('div', null, sc.el, ...extraFields.map((f) => f.el)), okText, onOk: () => { sc.get(); return true; } });
  if (!ok) return null;
  return sc.get();
}
TOOLS.toimages = async () => {
  const d = cur();
  const fmt = field({ type: 'select', label: 'Formato', options: [['png', 'PNG (sin pérdida)'], ['jpg', 'JPG (más ligero)']], value: 'png' });
  const dpi = field({ type: 'select', label: 'Resolución', options: [['96', '96 ppp (pantalla)'], ['150', '150 ppp (buena)'], ['300', '300 ppp (impresión)'], ['600', '600 ppp (máxima)']], value: '150' });
  const idx = await convertDialog('PDF a imágenes', 'fileImage', [fmt, dpi]);
  if (!idx) return;
  const dir = await window.pm.pickFolder('Carpeta donde guardar las imágenes');
  if (!dir) return;
  await withBusy('Generando imágenes…', async (b) => {
    await d.commit();
    const files = await C.pagesToImages(d, idx, { dpi: +dpi.get(), format: fmt.get() }, (f) => b.progress(f));
    const paths = await window.pm.writeFolder({ dir, files });
    doneToast(`${files.length} imágenes guardadas`, paths[0]);
  });
};
async function singleFileConvert(title, iconName, ext, filterName, extra, build, okText) {
  const d = cur();
  const idx = await convertDialog(title, iconName, extra, okText);
  if (!idx) return;
  const name = `${baseName(d.name)}.${ext}`;
  await withBusy('Convirtiendo…', async (b) => {
    await d.commit();
    const data = await build(d, idx, (f) => b.progress(f));
    b.text('Guardando…');
    const p = await saveAs(name, data, [{ name: filterName, extensions: [ext] }]);
    if (p) { doneToast(`Guardado: ${p.split(/[\\/]/).pop()}`, p); }
  });
}
TOOLS.toword = () => {
  const mode = field({ type: 'select', label: 'Tipo de conversión', options: [['text', 'Texto editable (recomendado)'], ['image', 'Fiel al original (cada página como imagen)']], value: 'text' });
  return singleFileConvert('PDF a Word', 'fileText', 'docx', 'Documento de Word', [mode], (d, idx, p) => C.toDocx(d, idx, { mode: mode.get() }, p));
};
TOOLS.toexcel = () => singleFileConvert('PDF a Excel', 'sheet', 'xlsx', 'Libro de Excel', [h('div', { el: null })].filter(() => false), (d, idx, p) => C.toXlsx(d, idx, p));
TOOLS.topptx = () => singleFileConvert('PDF a PowerPoint', 'slides', 'pptx', 'Presentación de PowerPoint', [], (d, idx, p) => C.toPptx(d, idx, p));
TOOLS.totext = () => singleFileConvert('PDF a texto', 'fileType', 'txt', 'Texto', [], (d, idx, p) => C.toText(d, idx, p));
TOOLS.tohtml = () => {
  const img = field({ type: 'check', label: 'Incluir una imagen de cada página', value: false });
  return singleFileConvert('PDF a HTML', 'code', 'html', 'Página web', [img], (d, idx, p) => C.toHtml(d, idx, { images: img.get() }, p));
};
TOOLS.imgs2pdf = async () => {
  const items = [];
  const list = h('div', { class: 'filelist' });
  const render = () => {
    list.innerHTML = '';
    if (!items.length) list.append(h('div', { class: 'empty' }, 'Añade las imágenes (JPG, PNG, WebP, BMP, GIF).'));
    items.forEach((it, i) => list.append(h('div', { class: 'fileitem' },
      h('span', { class: 'fn' }, `${i + 1}. ${it.name}`), h('small', null, fmtBytes(it.data.length)),
      h('button', { class: 'icon-btn', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } }, icon('up', 15)),
      h('button', { class: 'icon-btn', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } }, icon('down', 15)),
      h('button', { class: 'icon-btn', onclick: () => { items.splice(i, 1); render(); } }, icon('x', 15)))));
  };
  render();
  const size = field({ type: 'select', label: 'Tamaño de página', options: [['fit', 'Igual que la imagen'], ['a4', 'A4'], ['letter', 'Carta'], ['legal', 'Oficio']], value: 'a4' });
  const margin = field({ type: 'number', label: 'Margen (pt)', value: 0, min: 0, max: 100 });
  const add = h('button', { class: 'btn', style: { marginBottom: '10px' }, onclick: async () => { (await pickFile('images', true)).forEach((f) => items.push(f)); render(); } }, icon('plus', 15), 'Añadir imágenes…');
  if (S.pendingImages) { items.push(...S.pendingImages); S.pendingImages = null; render(); }
  const ok = await modal({ title: 'Imágenes a PDF', icon: 'imagePlus', size: 'wide', body: h('div', null, add, list, h('div', { class: 'field' }, h('div', { class: 'row' }, size.el, margin.el))), okText: 'Crear PDF', onOk: () => { if (!items.length) throw new Error('Añade al menos una imagen.'); return true; } });
  if (!ok) return;
  await withBusy('Creando PDF…', async (b) => {
    const prepared = [];
    for (let i = 0; i < items.length; i++) { prepared.push(await C.prepareImage(items[i])); b.progress((i + 1) / items.length / 2); }
    const out = await E.imagesToPdf(prepared, { size: size.get(), margin: margin.get() || 0 });
    await openGenerated('Imágenes.pdf', out);
  });
};
TOOLS.txt2pdf = async () => {
  const src = field({ type: 'textarea', label: 'Texto a convertir (o elige un archivo .txt / .html / .md)', placeholder: 'Escribe o pega aquí…' });
  let isHtml = false;
  let fname = 'Documento';
  const pick = h('button', { class: 'btn', style: { marginBottom: '8px' }, onclick: async () => {
    const f = (await window.pm.openDialog({ kind: 'text', multi: false }))[0];
    if (!f) return;
    src.set(new TextDecoder().decode(f.data));
    isHtml = /\.html?$/i.test(f.name);
    fname = baseName(f.name);
  } }, icon('folderOpen', 15), 'Elegir archivo…');
  const size = field({ type: 'select', label: 'Papel', options: [['A4', 'A4'], ['Letter', 'Carta'], ['Legal', 'Oficio']], value: 'A4' });
  const mono = field({ type: 'check', label: 'Usar fuente de ancho fijo (código)', value: false });
  const ok = await modal({ title: 'Texto / HTML a PDF', icon: 'fileUp', size: 'wide', body: h('div', null, pick, src.el, size.el, mono.el), okText: 'Crear PDF', onOk: () => { if (!src.get().trim()) throw new Error('No hay contenido.'); return true; } });
  if (!ok) return;
  await withBusy('Creando PDF…', async () => {
    const html = isHtml && /<html|<body|<p|<div/i.test(src.get()) ? src.get() : C.textToHtml(src.get(), { mono: mono.get() });
    const bytes = await window.pm.htmlToPdf({ html, pageSize: size.get(), margin: 18 });
    await openGenerated(`${fname}.pdf`, bytes);
  });
};
TOOLS.office2pdf = async () => {
  const paths = S.pendingOffice || (await window.pm.pickPaths({ kind: 'office', multi: true }));
  S.pendingOffice = null;
  if (!paths.length) return;
  await withBusy('Convirtiendo con Microsoft Office…', async (b) => {
    for (let i = 0; i < paths.length; i++) {
      b.text(`Convirtiendo ${paths[i].split(/[\\/]/).pop()} (${i + 1}/${paths.length})…`);
      const r = await window.pm.officeToPdf(paths[i]);
      await openGenerated(r.name, r.data);
      b.progress((i + 1) / paths.length);
    }
  });
};

// ---- optimizar
TOOLS.compress = async () => {
  const d = cur();
  await withBusy('Preparando…', () => d.commit());
  const lvl = field({ type: 'select', label: 'Nivel de compresión', options: [['low', 'Baja — calidad casi igual'], ['medium', 'Media — recomendado'], ['high', 'Alta — archivo mínimo']], value: 'medium', hint: 'Recomprime las imágenes JPEG y elimina datos sobrantes. El texto y los vectores no se alteran.' });
  const ok = await modal({ title: 'Comprimir PDF', icon: 'compress', sub: `Tamaño actual: ${fmtBytes(d.bytes.length)}`, body: lvl.el, okText: 'Comprimir' });
  if (!ok) return;
  const before = d.bytes.length;
  const out = await withBusy('Comprimiendo…', (b) => E.compressPdf(d.bytes, lvl.get(), { recompressJpeg: C.recompressJpeg }, (f) => b.progress(f)));
  if (!out) return;
  if (out.length >= before) return toast('El archivo ya estaba optimizado: no se pudo reducir más.', '');
  await d.applyBytes(out, 'Comprimir');
  toast(`Comprimido: ${fmtBytes(before)} → ${fmtBytes(out.length)} (−${Math.round((1 - out.length / before) * 100)}%)`, 'ok', 7000);
};
TOOLS.ocr = async () => {
  const d = cur();
  const lang = field({ type: 'select', label: 'Idioma del documento', options: [['spa+eng', 'Español + inglés'], ['spa', 'Español'], ['eng', 'Inglés']], value: S.settings.ocrLang || 'spa+eng' });
  const dpi = field({ type: 'select', label: 'Calidad de lectura', options: [['200', 'Rápida (200 ppp)'], ['250', 'Equilibrada (250 ppp)'], ['300', 'Alta (300 ppp)']], value: '250' });
  const idx = await convertDialog('OCR — texto buscable', 'ocr', [lang, dpi], 'Iniciar OCR');
  if (!idx) return;
  await withBusy('Cargando motor de OCR…', async (b) => {
    await d.commit();
    const out = await C.runOcr(d, idx, { lang: lang.get(), dpi: +dpi.get() }, (f, t) => { b.progress(f); if (t) b.text(t); });
    await d.applyBytes(out, 'OCR');
    toast('Listo: ahora puedes buscar y copiar texto de las páginas procesadas.', 'ok', 6000);
  });
};

// ---- seguridad
TOOLS.protect = async () => {
  const d = cur();
  const pw = field({ type: 'password', label: 'Contraseña para abrir el documento', hint: 'Déjala vacía para solo restringir permisos.' });
  const pw2 = field({ type: 'password', label: 'Repite la contraseña' });
  const owner = field({ type: 'password', label: 'Contraseña de propietario (opcional)', hint: 'Permite cambiar permisos. Si la dejas vacía se usa la misma.' });
  const perms = { printing: field({ type: 'check', label: 'Permitir imprimir', value: true }), copying: field({ type: 'check', label: 'Permitir copiar texto', value: true }), modifying: field({ type: 'check', label: 'Permitir modificar', value: false }), annotating: field({ type: 'check', label: 'Permitir comentar / anotar', value: true }) };
  const ok = await modal({ title: 'Proteger con contraseña', icon: 'lock', sub: 'Cifrado AES-256. Se aplica al guardar el archivo.', body: h('div', null, pw.el, pw2.el, owner.el, ...Object.values(perms).map((p) => p.el)), okText: 'Proteger', onOk: () => {
    if (pw.get() !== pw2.get()) throw new Error('Las contraseñas no coinciden.');
    if (!pw.get() && !owner.get()) throw new Error('Escribe al menos una contraseña.');
    return true;
  } });
  if (!ok) return;
  d.checkpoint('Proteger');
  d.protect = { userPassword: pw.get(), ownerPassword: owner.get() || pw.get() || 'pm-' + uid(), permissions: Object.fromEntries(Object.entries(perms).map(([k, f]) => [k, f.get()])) };
  emit('overlays');
  toast('Protección configurada. Guarda el documento para aplicarla (Ctrl+S).', 'ok', 6500);
};
TOOLS.unprotect = async () => {
  const d = cur();
  if (!d.protect) return toast('Este documento no tiene contraseña en esta sesión.', '');
  const ok = await modal({ title: 'Quitar contraseña', icon: 'unlock', body: 'Al guardar, el documento se escribirá sin contraseña ni restricciones.', okText: 'Quitar' });
  if (!ok) return;
  d.checkpoint('Quitar contraseña');
  d.protect = null;
  emit('overlays');
  toast('Contraseña eliminada. Guarda el documento para aplicar el cambio.', 'ok', 6000);
};
TOOLS.metadata = async () => {
  const d = cur();
  await withBusy('Leyendo…', () => d.commit());
  const m = await E.getMetadata(d.bytes);
  const f = { title: field({ type: 'text', label: 'Título', value: m.title }), author: field({ type: 'text', label: 'Autor', value: m.author || S.settings.author }), subject: field({ type: 'text', label: 'Asunto', value: m.subject }), keywords: field({ type: 'text', label: 'Palabras clave (separadas por coma)', value: m.keywords }), creator: field({ type: 'text', label: 'Creador', value: m.creator }) };
  const clear = h('button', { class: 'btn danger', onclick: async (e) => {
    e.target.closest('.modal-back').remove();
    await structural('Limpiar metadatos', (dd) => E.setMetadata(dd.bytes, {}, { clear: true }));
    toast('Metadatos eliminados.', 'ok');
  } }, icon('eyeOff', 15), 'Limpiar todos los metadatos');
  const ok = await modal({ title: 'Metadatos del documento', icon: 'info', body: h('div', null, ...Object.values(f).map((x) => x.el)), okText: 'Guardar', extraButtons: [clear] });
  if (!ok) return;
  await structural('Editar metadatos', (dd) => E.setMetadata(dd.bytes, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.get()]))));
};
TOOLS.props = async () => {
  const d = cur();
  await withBusy('Leyendo…', () => d.commit());
  const m = await E.getMetadata(d.bytes);
  const first = await d.pdf.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  const mm = (p) => Math.round((p / 72) * 25.4);
  const rows = [['Nombre', d.name], ['Ubicación', d.path || '(sin guardar)'], ['Tamaño del archivo', fmtBytes(d.bytes.length)], ['Páginas', m.pages], ['Tamaño de página', `${mm(vp.width)} × ${mm(vp.height)} mm`], ['Título', m.title || '—'], ['Autor', m.author || '—'], ['Creador', m.creator || '—'], ['Productor', m.producer || '—'], ['Creado', m.created ? new Date(m.created).toLocaleString('es-CL') : '—'], ['Modificado', m.modified ? new Date(m.modified).toLocaleString('es-CL') : '—'], ['Protegido', d.protect ? 'Sí (al guardar)' : 'No']];
  await modal({ title: 'Propiedades', icon: 'info', body: h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))])), hideCancel: true, okText: 'Cerrar' });
};

export { TOOLS };
void onChange; void openEntry; void PDF_OPTS; void pdfjs; void busy; void dataUrlToBytes; void canvasToBlob; void blobToBytes; void colorToHex; void PDF_FILTER;
