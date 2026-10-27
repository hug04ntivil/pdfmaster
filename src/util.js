// Utilidades de interfaz: DOM, iconos, avisos, diálogos
import {
  createElement, FolderOpen, Save, SaveAll, Printer, Undo2, Redo2, ZoomIn, ZoomOut, Search, Settings, RefreshCw, Download, Type, Image as ImageIcon,
  Eraser, PenLine, Highlighter, Underline, Strikethrough, Square, Circle, Minus, MoveUpRight, Pencil, Signature, Stamp, Combine, Scissors, RotateCw,
  RotateCcw, Trash2, FilePlus, FileOutput, Crop, Hash, PanelTop, PanelBottom, Droplets, TextCursorInput, Lock, Unlock, Info, FileImage, FileText,
  FileSpreadsheet, Presentation, FileCode, Globe, ScanText, FileArchive, Wrench, ShieldCheck, Layers, LayoutGrid, Sun, Moon, X, ChevronDown,
  ChevronRight, ChevronLeft, ChevronUp, MousePointer2, Hand, Maximize, Maximize2, Plus, Copy, ArrowUp, ArrowDown, GripVertical, FileType, Files,
  FilePen, PanelLeft, FileInput, Check, TriangleAlert, Monitor, EyeOff, ExternalLink, Rocket, ListOrdered, BookOpen, FileSearch, Sparkles, Table,
  FileUp, ImagePlus, FilePlus2, ScissorsLineDashed, Replace, CircleHelp, Columns2, StickyNote, ArrowLeftRight, Link, ImageDown, FileDown, Clock,
  History, House, Shield, KeyRound, PenTool, Frame, Eye, Settings2, Palette, Paintbrush, Brush,
} from 'lucide';

const ICONS = {
  folderOpen: FolderOpen, save: Save, saveAs: SaveAll, print: Printer, undo: Undo2, redo: Redo2, zoomIn: ZoomIn, zoomOut: ZoomOut, search: Search,
  settings: Settings, refresh: RefreshCw, download: Download, text: Type, image: ImageIcon, eraser: Eraser, penLine: PenLine, highlight: Highlighter,
  underline: Underline, strike: Strikethrough, square: Square, circle: Circle, line: Minus, arrow: MoveUpRight, pencil: Pencil, signature: Signature,
  stamp: Stamp, merge: Combine, split: Scissors, rotateCw: RotateCw, rotateCcw: RotateCcw, trash: Trash2, filePlus: FilePlus, extract: FileOutput,
  crop: Crop, hash: Hash, header: PanelTop, footer: PanelBottom, watermark: Droplets, form: TextCursorInput, lock: Lock, unlock: Unlock, info: Info,
  fileImage: FileImage, fileText: FileText, sheet: FileSpreadsheet, slides: Presentation, code: FileCode, globe: Globe, ocr: ScanText,
  compress: FileArchive, wrench: Wrench, shield: ShieldCheck, layers: Layers, grid: LayoutGrid, sun: Sun, moon: Moon, x: X, chevDown: ChevronDown,
  chevRight: ChevronRight, chevLeft: ChevronLeft, chevUp: ChevronUp, pointer: MousePointer2, hand: Hand, fit: Maximize, fitPage: Maximize2, plus: Plus,
  copy: Copy, up: ArrowUp, down: ArrowDown, grip: GripVertical, fileType: FileType, files: Files, filePen: FilePen, panelLeft: PanelLeft,
  fileInput: FileInput, check: Check, warn: TriangleAlert, monitor: Monitor, eyeOff: EyeOff, external: ExternalLink, rocket: Rocket,
  numbered: ListOrdered, book: BookOpen, fileSearch: FileSearch, sparkles: Sparkles, table: Table, fileUp: FileUp, imagePlus: ImagePlus,
  filePlus2: FilePlus2, splitLines: ScissorsLineDashed, replace: Replace, help: CircleHelp, columns: Columns2, note: StickyNote, swap: ArrowLeftRight,
  link: Link, imageDown: ImageDown, fileDown: FileDown, clock: Clock, history: History, home: House, shieldPlain: Shield, key: KeyRound, penTool: PenTool,
  frame: Frame, eye: Eye, settings2: Settings2, palette: Palette, paint: Paintbrush, brush: Brush,
};

export function icon(name, size = 18, sw = 1.9) {
  const node = ICONS[name];
  if (!node) return document.createTextNode('');
  return createElement(node, { width: size, height: size, 'stroke-width': sw });
}

/** Crea elementos: h('div', {class:'x', onclick:fn}, hijo1, 'texto') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
export function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '');
}
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#000000') || [0, '00', '00', '00'];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
export function dataUrlToBytes(url) {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToDataUrl(bytes, mime) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}
export function blobToBytes(blob) {
  return blob.arrayBuffer().then((b) => new Uint8Array(b));
}
export function canvasToBlob(canvas, type = 'image/png', q) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), type, q));
}
/** Interpreta "1-3, 5, 8-" -> índices base 0 ordenados y únicos. Lanza Error si es inválido. */
export function parseRanges(str, max) {
  const set = new Set();
  const parts = String(str || '').split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('Indica las páginas (por ejemplo 1-3, 5, 8-)');
  for (const p of parts) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(p);
    let a, b;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : max;
    } else if (/^\d+$/.test(p)) {
      a = b = parseInt(p, 10);
    } else throw new Error(`Rango no válido: "${p}"`);
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > max) throw new Error(`Las páginas deben estar entre 1 y ${max}`);
    for (let i = a; i <= b; i++) set.add(i - 1);
  }
  return [...set].sort((x, y) => x - y);
}
export function rangesToString(idx) {
  if (!idx.length) return '';
  const out = [];
  let s = idx[0], p = idx[0];
  for (let i = 1; i <= idx.length; i++) {
    if (idx[i] === p + 1) { p = idx[i]; continue; }
    out.push(s === p ? `${s + 1}` : `${s + 1}-${p + 1}`);
    s = p = idx[i];
  }
  return out.join(', ');
}

// ---------------------------------------------------------------- avisos
export function toast(msg, kind = '', ms = 3600, action) {
  const t = h('div', { class: 'toast ' + kind }, icon(kind === 'err' ? 'warn' : kind === 'ok' ? 'check' : 'info', 16), h('span', null, msg));
  if (action) t.append(h('button', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
export const status = (m) => { $('#st-msg').textContent = m || 'Listo'; };

let busyDepth = 0;
export function busy(text) {
  busyDepth++;
  $('#busy').hidden = false;
  $('#busy-text').textContent = text || 'Procesando…';
  $('#busy-bar').style.width = '0%';
  const api = {
    text: (t) => { $('#busy-text').textContent = t; },
    progress: (f) => { $('#busy-bar').style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`; },
    done: () => { if (--busyDepth <= 0) { busyDepth = 0; $('#busy').hidden = true; } },
  };
  return api;
}
/** Ejecuta fn con indicador de ocupado y errores mostrados al usuario. */
export async function withBusy(text, fn) {
  const b = busy(text);
  try {
    await nextFrame();
    return await fn(b);
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : String(e), 'err', 6500);
    return undefined;
  } finally {
    b.done();
  }
}

// ---------------------------------------------------------------- diálogos
/**
 * Diálogo modal genérico.
 * opts: {title, sub, icon, size, body: Node|fn(api), okText, cancelText, onOk: async (api)=>any, hideCancel}
 * Devuelve una promesa con el valor devuelto por onOk (o undefined si se cancela).
 */
export function modal(opts) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const api = { close: (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); }, el: null, ok: null };
    const body = typeof opts.body === 'function' ? opts.body(api) : opts.body;
    const okBtn = h('button', { class: 'btn primary', onclick: async () => {
      if (!opts.onOk) return api.close(true);
      okBtn.disabled = true;
      try {
        const v = await opts.onOk(api);
        if (v !== false) api.close(v === undefined ? true : v);
      } catch (e) {
        toast(e.message || String(e), 'err', 6000);
      } finally { okBtn.disabled = false; }
    } }, opts.okText || 'Aceptar');
    api.ok = okBtn;
    const m = h('div', { class: 'modal ' + (opts.size || ''), role: 'dialog' },
      h('div', { class: 'modal-h' }, opts.icon ? h('span', { class: 'ci' }, icon(opts.icon, 20)) : null, h('h2', null, opts.title || '')),
      opts.sub ? h('div', { class: 'modal-sub' }, opts.sub) : null,
      h('div', { class: 'modal-b' }, body),
      h('div', { class: 'modal-f' },
        opts.hideCancel ? null : h('button', { class: 'btn', onclick: () => api.close(undefined) }, opts.cancelText || 'Cancelar'),
        ...(opts.extraButtons || []),
        opts.noOk ? null : okBtn));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back && !opts.persistent) api.close(undefined); } }, m);
    api.el = m;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); api.close(undefined); }
      else if (e.key === 'Enter' && !e.shiftKey && !['TEXTAREA', 'BUTTON', 'SELECT'].includes(document.activeElement?.tagName) && !opts.noOk) { e.preventDefault(); okBtn.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    root.append(back);
    const first = m.querySelector('input:not([type=checkbox]):not([type=color]),textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export function confirmBox({ title = 'Confirmar', text, okText = 'Aceptar', cancelText = 'Cancelar', danger = false, extra }) {
  return modal({
    title, icon: 'warn', body: h('div', null, text), okText, cancelText,
    extraButtons: extra ? [h('button', { class: 'btn ' + (extra.danger ? 'danger' : ''), onclick: (e) => e.target.closest('.modal-back').dispatchEvent(new CustomEvent('pm-extra')) }, extra.label)] : [],
    onOk: () => true,
  });
}

/** Pregunta de 3 vías (guardar / no guardar / cancelar). */
export function askSave(name) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const done = (v) => { back.remove(); resolve(v); };
    const m = h('div', { class: 'modal' },
      h('div', { class: 'modal-h' }, h('span', { class: 'ci' }, icon('warn', 20)), h('h2', null, 'Cambios sin guardar')),
      h('div', { class: 'modal-b' }, `«${name}» tiene cambios sin guardar. ¿Qué quieres hacer?`),
      h('div', { class: 'modal-f' },
        h('button', { class: 'btn', onclick: () => done('cancel') }, 'Cancelar'),
        h('button', { class: 'btn danger', onclick: () => done('discard') }, 'No guardar'),
        h('button', { class: 'btn primary', onclick: () => done('save') }, 'Guardar')));
    const back = h('div', { class: 'modal-back' }, m);
    root.append(back);
  });
}

/** Construye un campo de formulario. Devuelve {el, get, set}. */
export function field(spec) {
  const id = 'f' + uid();
  const wrap = h('div', { class: 'field' });
  let get, input;
  const lab = spec.label ? h('label', { for: id }, spec.label) : null;
  switch (spec.type) {
    case 'select':
      input = h('select', { id }, spec.options.map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: String(v) === String(spec.value) }, t);
      }));
      get = () => input.value;
      break;
    case 'check':
      input = h('input', { type: 'checkbox', id, checked: !!spec.value });
      wrap.append(h('label', { class: 'check', for: id }, input, spec.label));
      get = () => input.checked;
      break;
    case 'textarea':
      input = h('textarea', { id, placeholder: spec.placeholder || '' }, spec.value || '');
      get = () => input.value;
      break;
    case 'number':
      input = h('input', { type: 'number', id, value: spec.value, min: spec.min, max: spec.max, step: spec.step || 1 });
      get = () => parseFloat(input.value);
      break;
    case 'color':
      input = h('input', { type: 'color', id, value: spec.value || '#000000' });
      get = () => input.value;
      break;
    case 'password':
      input = h('input', { type: 'password', id, value: spec.value || '', placeholder: spec.placeholder || '', autocomplete: 'off' });
      get = () => input.value;
      break;
    default:
      input = h('input', { type: 'text', id, value: spec.value ?? '', placeholder: spec.placeholder || '' });
      get = () => input.value;
  }
  if (spec.type !== 'check' && lab) wrap.append(lab);
  if (spec.type !== 'check') wrap.append(input);
  if (spec.hint) wrap.append(h('div', { class: 'hint' }, spec.hint));
  return { el: wrap, input, get, set: (v) => { if (spec.type === 'check') input.checked = !!v; else input.value = v; } };
}

export function showContextMenu(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.append(h('hr')); continue; }
    m.append(h('button', { onclick: () => { hideContextMenu(); it.fn(); } }, it.icon ? icon(it.icon, 16) : h('span', { style: { width: '16px' } }), it.label));
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
export function hideContextMenu() { $('#ctxmenu').hidden = true; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxmenu')) hideContextMenu(); });
document.addEventListener('scroll', hideContextMenu, true);
