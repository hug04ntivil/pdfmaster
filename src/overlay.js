// Capa de edición: texto, imágenes, firmas, formas, resaltados... (se incrustan en el PDF al guardar)
import { S, emit } from './docs.js';
import { h, uid, clamp, icon, field, hexToRgb01, toast, withBusy, sleep, status } from './util.js';
import { STANDARD_FAMILIES, BUNDLED_FILES } from './engine.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DRAW_TOOLS = new Set(['text', 'rect', 'ellipse', 'line', 'arrow', 'ink', 'whiteout', 'redact', 'area', 'place', 'edittext']);
const SELECTION_TOOLS = new Set(['highlight', 'underline', 'strike']);

export const OV = {
  viewer: null,
  tool: null,
  selId: null,
  placing: null, // {src, w, h}
  style: {
    family: 'Helvetica', size: 14, bold: false, italic: false, underline: false, color: '#111111',
    stroke: '#d6284a', fill: '', strokeWidth: 2, opacity: 1,
    hlColor: '#ffe433', hlOpacity: 0.45, inkColor: '#1d4ed8', inkWidth: 2.5, markColor: '#d6284a', whiteColor: '#ffffff',
  },
};

const doc = () => S.cur;
// quitar un nodo puede fallar si otro manejador (p. ej. 'blur' del editor) ya lo movió: no es un error
const rm = (n) => { try { n.remove(); } catch { /* ya se quitó durante un blur */ } };
const scale =() => OV.viewer.scale;
const cssFamily = (f) => ({ Helvetica: 'Arial, Helvetica, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' }[f] || `"${f}", Arial, sans-serif`);

export function initOverlay(viewer) {
  OV.viewer = viewer;
  viewer.hooks.onMountPage = (el, i, layer) => mount(layer, i);
  viewer.hooks.onZoom = () => OV.renderAll();
  viewer.hooks.onPageRendered = (i) => { if (OV.tool === 'edittext') renderTextBoxes(i); };
  document.addEventListener('mouseup', onSelectionMouseUp);
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.ov') && !e.target.closest('#right') && !e.target.closest('#modal-root') && OV.selId) {
      if (e.target.closest('#viewer-scroll')) OV.select(null);
    }
  });
}

function mount(layer, i) {
  layer.classList.toggle('active', DRAW_TOOLS.has(OV.tool));
  layer.addEventListener('pointerdown', (e) => onLayerDown(e, layer, i));
  renderPageObjects(i);
}

OV.setTool = function (name) {
  if (OV.tool === 'edittext' && name !== 'edittext') document.querySelectorAll('.ov-hover, .ov-tbox, .ov-tghost').forEach(rm);
  OV.tool = name;
  document.querySelectorAll('.ov-layer').forEach((l) => {
    l.classList.toggle('active', DRAW_TOOLS.has(name));
    l.classList.toggle('tool-draw', ['rect', 'ellipse', 'line', 'arrow', 'ink', 'whiteout', 'redact', 'area'].includes(name));
    l.classList.toggle('tool-text', name === 'text');
    l.classList.toggle('tool-place', name === 'place');
  });
  document.querySelectorAll('.textLayer').forEach((t) => t.classList.toggle('edit-mode', name === 'edittext'));
  if (name !== 'select' && name) OV.select(null);
  if (name === 'edittext' && OV.viewer) OV.viewer.pages.forEach((p, i) => { if (p.rendered) renderTextBoxes(i); });
  emit('tool');
};

/** Espera a que termine la edición pendiente y el visor se reconstruya con el PDF nuevo. */
OV.settle = async () => {
  const d = doc();
  if (OV.pending) { try { await OV.pending; } catch { /* ya se avisó */ } }
  for (let k = 0; k < 80 && d && OV.viewer.builtVersion !== d.version; k++) await sleep(50);
};

// ---------------------------------------------------------------- utilidades de objetos
const find = (id) => doc() && doc().overlays.find((o) => o.id === id);
OV.selected = () => (OV.selId ? find(OV.selId) : null);

function pts(layer, e) {
  const r = layer.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale(), y: (e.clientY - r.top) / scale() };
}
function mutate(label, fn) {
  const d = doc();
  if (!d) return;
  d.checkpoint(label);
  fn();
  emit('overlays');
}
OV.add = function (o, { select = true } = {}) {
  const d = doc();
  d.checkpoint('Añadir ' + o.type);
  o.id = o.id || uid();
  d.overlays.push(o);
  renderPageObjects(o.page);
  if (select) OV.select(o.id);
  emit('overlays');
  return o;
};
OV.update = function (o, patch, label = 'Modificar') {
  mutate(label, () => Object.assign(o, patch));
  renderObject(o);
};
OV.remove = function (id, { noHistory = false } = {}) {
  const d = doc();
  const o = find(id);
  if (!o) return;
  if (!noHistory) d.checkpoint('Eliminar');
  const kill = [id, o.linked].filter(Boolean);
  d.overlays = d.overlays.filter((x) => !kill.includes(x.id));
  kill.forEach((k) => document.querySelectorAll(`[data-id="${k}"]`).forEach(rm));
  if (OV.selId && kill.includes(OV.selId)) OV.selId = null;
  emit('overlays');
  emit('selection');
};
OV.deleteSelected = function () {
  if (OV.selId) OV.remove(OV.selId);
};
OV.duplicate = function () {
  const o = OV.selected();
  if (!o) return;
  const c = structuredClone(o);
  c.id = uid(); delete c.linked;
  if (c.x !== undefined) { c.x += 12; c.y += 12; }
  if (c.x1 !== undefined) { c.x1 += 12; c.x2 += 12; c.y1 += 12; c.y2 += 12; }
  if (c.points) c.points = c.points.map(([x, y]) => [x + 12, y + 12]);
  OV.add(c);
};
OV.nudge = function (dx, dy) {
  const o = OV.selected();
  if (!o) return;
  mutate('Mover', () => translate(o, dx, dy));
  renderObject(o);
};
function translate(o, dx, dy) {
  if (o.x !== undefined) { o.x += dx; o.y += dy; }
  if (o.x1 !== undefined) { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; }
  if (o.points) o.points = o.points.map(([x, y]) => [x + dx, y + dy]);
}
OV.select = function (id) {
  OV.selId = id;
  document.querySelectorAll('.ov.sel, .ov-svg.sel').forEach((n) => n.classList.remove('sel'));
  if (id) document.querySelectorAll(`[data-id="${id}"]`).forEach((n) => n.classList.add('sel'));
  emit('selection');
};
OV.hasPending = () => !!(doc() && doc().overlays.length);

// ---------------------------------------------------------------- dibujo
OV.renderAll = function () {
  if (!OV.viewer) return;
  document.querySelectorAll('.ov-tbox, .ov-tghost').forEach(rm);
  OV.viewer.pages.forEach((_, i) => renderPageObjects(i));
};
function renderPageObjects(i) {
  const p = OV.viewer.pages[i];
  if (!p || !doc()) return;
  p.ov.querySelectorAll('.ov, .ov-svg').forEach(rm);
  doc().overlays.filter((o) => o.page === i).forEach((o) => p.ov.append(buildEl(o)));
  if (OV.selId) p.ov.querySelectorAll(`[data-id="${OV.selId}"]`).forEach((n) => n.classList.add('sel'));
}
function renderObject(o) {
  const p = OV.viewer.pages[o.page];
  if (!p) return;
  p.ov.querySelectorAll(`[data-id="${o.id}"]`).forEach(rm);
  p.ov.append(buildEl(o));
  if (OV.selId === o.id) p.ov.querySelectorAll(`[data-id="${o.id}"]`).forEach((n) => n.classList.add('sel'));
}
function px(v) { return `${v * scale()}px`; }

function buildEl(o) {
  const s = scale();
  let el;
  const rz = () => h('i', { class: 'rz', title: 'Redimensionar' });
  switch (o.type) {
    case 'text':
      el = h('div', { class: 'ov ov-text', 'data-id': o.id });
      el.textContent = o.text;
      Object.assign(el.style, {
        left: px(o.x), top: px(o.y), fontSize: px(o.size), color: o.color, fontFamily: cssFamily(o.family),
        fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', textDecoration: o.underline ? 'underline' : 'none', opacity: o.opacity ?? 1,
      });
      el.append(rz());
      el.addEventListener('dblclick', () => startEdit(o, el));
      break;
    case 'textedit': {
      el = h('div', { class: 'ov ov-text ov-textedit', 'data-id': o.id });
      el.textContent = o.text;
      const fams = [o.sysFamily ? `"${o.sysFamily}"` : '', `"${o.bundledFamily}"`, 'sans-serif'].filter(Boolean).join(', ');
      Object.assign(el.style, {
        left: px(o.x - 1), top: px(o.y), minWidth: px(o.w + 2), height: px(o.h), lineHeight: px(o.h), fontSize: px(o.size), color: o.color,
        fontFamily: fams, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', background: o.cover, whiteSpace: 'pre', padding: '0 1px', cursor: 'text',
      });
      el.addEventListener('dblclick', () => startEdit(o, el));
      break;
    }
    case 'image':
      el = h('div', { class: 'ov ov-img', 'data-id': o.id }, h('img', { src: o.src, draggable: false }), rz());
      Object.assign(el.style, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h), opacity: o.opacity ?? 1 });
      break;
    case 'rect':
    case 'ellipse':
      el = h('div', { class: 'ov ov-shape', 'data-id': o.id }, rz());
      Object.assign(el.style, {
        left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h),
        border: o.stroke ? `${Math.max(1, o.strokeWidth * s)}px solid ${o.stroke}` : 'none', background: o.fill || 'transparent',
        borderRadius: o.type === 'ellipse' ? '50%' : '0', opacity: o.opacity ?? 1,
      });
      break;
    case 'whiteout':
    case 'redact':
    case 'highlight':
      el = h('div', { class: 'ov ov-shape' + (o.type === 'redact' ? ' ov-redact' : ''), 'data-id': o.id }, rz());
      Object.assign(el.style, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h) });
      if (o.type === 'whiteout') { el.style.background = typeof o.color === 'string' ? o.color : '#fff'; el.style.outline = '1px dashed rgba(0,0,0,.15)'; }
      if (o.type === 'highlight') { el.style.background = o.color; el.style.opacity = o.opacity ?? 0.45; el.style.mixBlendMode = 'multiply'; }
      break;
    case 'underline':
    case 'strike':
      el = h('div', { class: 'ov ov-shape', 'data-id': o.id });
      Object.assign(el.style, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h) });
      el.append(h('i', { style: { position: 'absolute', left: 0, right: 0, top: o.type === 'strike' ? '55%' : 'calc(100% - 2px)', height: Math.max(1.2, 1.1 * s) + 'px', background: o.color, pointerEvents: 'none' } }));
      break;
    case 'line':
    case 'arrow':
    case 'ink': {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'ov ov-svg');
      svg.dataset.id = o.id;
      svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
      const mk = (d, extra = {}) => {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        for (const [k, v] of Object.entries(extra)) p.setAttribute(k, v);
        return p;
      };
      let d;
      if (o.type === 'ink') d = o.points.map(([x, y], k) => `${k ? 'L' : 'M'}${x * s} ${y * s}`).join(' ') + (o.points.length === 1 ? ` l0.1 0` : '');
      else {
        d = `M${o.x1 * s} ${o.y1 * s} L${o.x2 * s} ${o.y2 * s}`;
        if (o.type === 'arrow') {
          const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
          const len = Math.max(8, o.strokeWidth * 4.5);
          for (const sg of [-1, 1]) {
            const a = ang + Math.PI - sg * 0.45;
            d += ` M${o.x2 * s} ${o.y2 * s} L${(o.x2 + len * Math.cos(a)) * s} ${(o.y2 + len * Math.sin(a)) * s}`;
          }
        }
      }
      svg.append(mk(d, { stroke: o.color, 'stroke-width': Math.max(1, o.strokeWidth * s), opacity: o.opacity ?? 1, 'pointer-events': 'none' }));
      svg.append(mk(d, { stroke: 'transparent', 'stroke-width': Math.max(14, o.strokeWidth * s + 10), 'pointer-events': 'stroke', style: 'cursor:move' }));
      el = svg;
      break;
    }
    default:
      el = h('div');
  }
  el.dataset.id = o.id;
  if (o.type !== 'ink' && o.type !== 'line' && o.type !== 'arrow') el.style.position = 'absolute';
  el.addEventListener('pointerdown', (e) => onObjDown(e, o, el));
  return el;
}

// ---------------------------------------------------------------- mover / redimensionar
function onObjDown(e, o, el) {
  if (e.button !== 0) return;
  if (el.isContentEditable) return;
  if (o.type === 'textedit') { e.stopPropagation(); OV.select(o.id); return; }
  if (DRAW_TOOLS.has(OV.tool) && OV.tool !== 'select') return; // las herramientas de dibujo trabajan sobre la capa
  e.stopPropagation();
  OV.select(o.id);
  const layer = el.closest('.ov-layer');
  const isResize = e.target.classList.contains('rz');
  let last = pts(layer, e);
  const start = { ...last };
  let started = false;
  const base = structuredClone(o);
  const move = (ev) => {
    const cur = pts(layer, ev);
    if (!started) {
      if (Math.hypot(cur.x - start.x, cur.y - start.y) * scale() < 3) return;
      started = true;
      doc().checkpoint(isResize ? 'Redimensionar' : 'Mover');
    }
    const dx = cur.x - last.x, dy = cur.y - last.y;
    last = cur;
    if (isResize) {
      if (o.type === 'text') {
        const k = clamp((cur.x - o.x) / Math.max(10, (base.w || estimateWidth(base))), 0.3, 12);
        o.size = clamp(base.size * k, 4, 400);
      } else if (o.type === 'image') {
        o.w = Math.max(10, cur.x - o.x); o.h = o.w * (base.h / base.w);
      } else {
        o.w = Math.max(4, cur.x - o.x); o.h = Math.max(4, cur.y - o.y);
      }
    } else translate(o, dx, dy);
    renderObject(o);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (started) emit('overlays');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function estimateWidth(o) { return o.size * 0.55 * Math.max(...String(o.text).split('\n').map((l) => l.length), 1); }

// ---------------------------------------------------------------- edición de texto
/** Pone el cursor donde se hizo clic (o al final): se puede avanzar letra a letra sin seleccionar todo. */
function placeCaret(el, at) {
  let range = null;
  try {
    if (at && document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(at.x, at.y);
      if (c && el.contains(c.offsetNode)) { range = document.createRange(); range.setStart(c.offsetNode, c.offset); }
    } else if (at && document.caretRangeFromPoint) {
      const c = document.caretRangeFromPoint(at.x, at.y);
      if (c && el.contains(c.startContainer)) range = c;
    }
  } catch { /* sin posición exacta */ }
  if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
  range.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Asa para mover la línea que se está editando sin salir de la edición (el cuadro de texto solo mueve el cursor). */
function addGrip(o, el) {
  const layer = el.parentElement;
  const grip = h('div', { class: 'ov-grip', title: 'Arrastrar para mover el texto' }, '✥');
  const place = () => Object.assign(grip.style, { left: `${el.offsetLeft - 24}px`, top: `${el.offsetTop + el.offsetHeight / 2 - 11}px` });
  place();
  layer.append(grip);
  grip.addEventListener('mousedown', (e) => e.preventDefault()); // evita que el cuadro pierda el foco
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no se pierde el foco: la edición sigue activa
    e.stopPropagation();
    let last = pts(layer, e);
    const move = (ev) => {
      const cur = pts(layer, ev);
      const dx = cur.x - last.x, dy = cur.y - last.y;
      last = cur;
      o.x += dx; o.y += dy;
      o.moveX = (o.moveX || 0) + dx; o.moveY = (o.moveY || 0) - dy;
      el.style.left = px(o.x - 1); el.style.top = px(o.y);
      place();
      doc().dirty = true;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return grip;
}

function startEdit(o, el, { fresh = false, at = null } = {}) {
  if (!el) el = document.querySelector(`.ov-text[data-id="${o.id}"]`);
  if (!el) return;
  const rzEl = el.querySelector('.rz');
  if (rzEl) rm(rzEl);
  el.contentEditable = 'plaintext-only';
  el.focus();
  if (!fresh) {
    if (at || o.type === 'textedit' || o.linked) placeCaret(el, at);
    else { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  }
  const grip = o.type === 'textedit' ? addGrip(o, el) : null;
  let checkpointed = fresh || o.type === 'textedit';
  el.addEventListener('input', () => {
    if (!checkpointed) { doc().checkpoint('Editar texto'); checkpointed = true; }
    o.text = el.textContent;
    doc().dirty = true;
    if (o.type === 'textedit') emit('selection');
  });
  const finish = () => {
    el.removeEventListener('blur', finish);
    el.contentEditable = 'false';
    o.text = el.textContent;
    if (grip) rm(grip);
    if (o.type === 'textedit') {
      const d = doc();
      setTimeout(() => { try { OV.remove(o.id, { noHistory: true }); } catch { /* ya no está */ } }, 0);
      if (o.text === o.str && !o.moveX && !o.moveY) return;
      OV.pending = withBusy('Aplicando el cambio…', async () => {
        const r = await d.editTextNow(o);
        if (!r.ok) {
          d.checkpoint('Editar texto');
          for (const x of d.fallbackOverlays(o)) { d.overlays.push(x); renderObject(x); }
          toast('Esta fuente no se puede reescribir de forma exacta: se usó una equivalente. (' + r.reason + ')', '', 6000);
          emit('overlays');
        } else if (r.dropped) toast('Ninguna fuente disponible tiene: ' + r.dropped, '', 6000);
        else if (r.usedFallback) toast('Se usó ' + r.usedFallback + ' solo para: ' + r.missing, '', 4500);
      });
      return;
    }
    if (!o.text.trim()) setTimeout(() => { try { OV.remove(o.id, { noHistory: true }); } catch { /* ya no está */ } }, 0);
    else renderObject(o);
    emit('overlays');
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', (e) => {
    if (o.type === 'textedit') {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } // Enter aplica el cambio
      else if (e.key === 'Escape') { e.preventDefault(); el.textContent = o.str; o.text = o.str; el.blur(); } // Esc cancela
    } else if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
    e.stopPropagation();
  });
}

// ---------------------------------------------------------------- herramientas sobre la capa
function onLayerDown(e, layer, i) {
  if (OV.tool === 'edittext') { onEditToolDown(e, layer, i); return; }
  if (e.button !== 0 || e.target !== layer) return;
  const tool = OV.tool;
  if (!DRAW_TOOLS.has(tool)) return;
  const p0 = pts(layer, e);
  const st = OV.style;
  if (tool === 'text') {
    e.preventDefault();
    const o = { type: 'text', page: i, x: p0.x, y: p0.y - st.size * 0.5, text: '', size: st.size, family: st.family, bold: st.bold, italic: st.italic, underline: st.underline, color: st.color };
    doc().checkpoint('Añadir texto');
    o.id = uid();
    doc().overlays.push(o);
    renderObject(o);
    OV.select(o.id);
    startEdit(o, null, { fresh: true });
    emit('overlays');
    return;
  }
  if (tool === 'place' && OV.placing) {
    e.preventDefault();
    const { src, w, h } = OV.placing;
    const maxW = OV.placing.maxW || 200;
    const ww = Math.min(maxW, w), hh = ww * (h / w);
    OV.add({ type: 'image', page: i, x: p0.x - ww / 2, y: p0.y - hh / 2, w: ww, h: hh, src, opacity: 1 });
    OV.placing = null;
    OV.setTool('select');
    return;
  }
  e.preventDefault();
  layer.setPointerCapture(e.pointerId);
  if (tool === 'ink') return drawInk(layer, e, i, p0);
  if (tool === 'line' || tool === 'arrow') return dragLine(layer, e, i, p0, tool);
  return dragRect(layer, e, i, p0, tool);
}

function dragRect(layer, e, i, p0, tool) {
  const prev = h('div', { class: 'ov', style: { pointerEvents: 'none', border: '1.5px dashed var(--accent)', background: 'rgba(214,40,74,.08)' } });
  layer.append(prev);
  const upd = (cur) => {
    const x = Math.min(p0.x, cur.x), y = Math.min(p0.y, cur.y), w = Math.abs(cur.x - p0.x), hh = Math.abs(cur.y - p0.y);
    Object.assign(prev.style, { left: px(x), top: px(y), width: px(w), height: px(hh) });
    return { x, y, w, h: hh };
  };
  let box = null;
  const move = (ev) => { box = upd(pts(layer, ev)); };
  const up = (ev) => {
    layer.removeEventListener('pointermove', move);
    layer.removeEventListener('pointerup', up);
    try { layer.releasePointerCapture(ev.pointerId); } catch {}
    prev.remove();
    if (!box || box.w < 3 || box.h < 3) return;
    const st = OV.style;
    const base = { page: i, x: box.x, y: box.y, w: box.w, h: box.h };
    if (tool === 'rect') OV.add({ type: 'rect', ...base, stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth, opacity: st.opacity });
    else if (tool === 'ellipse') OV.add({ type: 'ellipse', ...base, stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth, opacity: st.opacity });
    else if (tool === 'whiteout') OV.add({ type: 'whiteout', ...base, color: st.whiteColor });
    else if (tool === 'redact') OV.add({ type: 'redact', ...base });
    else if (tool === 'area') OV.add({ type: 'highlight', ...base, color: st.hlColor, opacity: st.hlOpacity });
  };
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
}

function dragLine(layer, e, i, p0, tool) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
  const ln = document.createElementNS(SVGNS, 'line');
  ln.setAttribute('stroke', 'var(--accent)'); ln.setAttribute('stroke-width', '2'); ln.setAttribute('stroke-dasharray', '5 3');
  svg.append(ln); layer.append(svg);
  const s = scale();
  ln.setAttribute('x1', p0.x * s); ln.setAttribute('y1', p0.y * s); ln.setAttribute('x2', p0.x * s); ln.setAttribute('y2', p0.y * s);
  let cur = p0;
  const move = (ev) => {
    cur = pts(layer, ev);
    if (ev.shiftKey) { // ángulos múltiplos de 15°
      const a = Math.round(Math.atan2(cur.y - p0.y, cur.x - p0.x) / (Math.PI / 12)) * (Math.PI / 12);
      const d = Math.hypot(cur.x - p0.x, cur.y - p0.y);
      cur = { x: p0.x + d * Math.cos(a), y: p0.y + d * Math.sin(a) };
    }
    ln.setAttribute('x2', cur.x * s); ln.setAttribute('y2', cur.y * s);
  };
  const up = (ev) => {
    layer.removeEventListener('pointermove', move);
    layer.removeEventListener('pointerup', up);
    try { layer.releasePointerCapture(ev.pointerId); } catch {}
    svg.remove();
    if (Math.hypot(cur.x - p0.x, cur.y - p0.y) < 4) return;
    OV.add({ type: tool, page: i, x1: p0.x, y1: p0.y, x2: cur.x, y2: cur.y, color: OV.style.inkColor, strokeWidth: OV.style.inkWidth, opacity: 1 });
  };
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
}

function drawInk(layer, e, i, p0) {
  const s = scale();
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', OV.style.inkColor); path.setAttribute('stroke-width', Math.max(1, OV.style.inkWidth * s));
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); layer.append(svg);
  const points = [[p0.x, p0.y]];
  const redraw = () => path.setAttribute('d', points.map(([x, y], k) => `${k ? 'L' : 'M'}${x * s} ${y * s}`).join(' ') + (points.length === 1 ? ' l0.1 0' : ''));
  redraw();
  const move = (ev) => {
    const c = pts(layer, ev);
    const l = points[points.length - 1];
    if (Math.hypot(c.x - l[0], c.y - l[1]) < 0.8) return;
    points.push([c.x, c.y]);
    redraw();
  };
  const up = (ev) => {
    layer.removeEventListener('pointermove', move);
    layer.removeEventListener('pointerup', up);
    try { layer.releasePointerCapture(ev.pointerId); } catch {}
    svg.remove();
    OV.add({ type: 'ink', page: i, points, color: OV.style.inkColor, strokeWidth: OV.style.inkWidth, opacity: 1 });
  };
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
}

// ---------------------------------------------------------------- editar texto existente
async function itemAt(i, p) {
  const pt = await OV.viewer.pageText(i);
  let best = null;
  for (const m of pt.map) {
    if (!m.it.str.trim()) continue;
    const r = OV.viewer.rectsFor(pt, m.start, m.end)[0];
    if (!r) continue;
    if (p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1) {
      if (!best || r.w * r.h < best.r.w * best.r.h) best = { m, r };
    }
  }
  return best;
}
/** Une los fragmentos de texto que están en la misma línea (palabras o trozos sueltos) en una sola caja. */
function groupLines(ents) {
  const groups = [];
  for (const e of [...ents].sort((a, b) => a.r.x - b.r.x)) {
    const cy = e.r.y + e.r.h / 2;
    let best = null;
    for (const g of groups) {
      const h0 = Math.max(g.h, e.r.h);
      const gap = e.r.x - g.right;
      if (Math.abs(cy - g.cy) < Math.min(g.h, e.r.h) * 0.4 && gap < h0 * 1.0 && gap > -h0 * 0.5 && (!best || gap < e.r.x - best.right)) best = g;
    }
    if (best) {
      best.items.push(e);
      best.right = Math.max(best.right, e.r.x + e.r.w);
      best.top = Math.min(best.top, e.r.y);
      best.bottom = Math.max(best.bottom, e.r.y + e.r.h);
      best.cy = (best.top + best.bottom) / 2;
      best.h = best.bottom - best.top;
    } else groups.push({ items: [e], left: e.r.x, right: e.r.x + e.r.w, top: e.r.y, bottom: e.r.y + e.r.h, cy, h: e.r.h });
  }
  return groups.map((g) => ({ items: g.items, m: g.items[0].m, r: { x: g.left, y: g.top, w: g.right - g.left, h: g.bottom - g.top } }))
    .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
}

/** Dibuja una caja sobre cada línea de texto de la página: clic = editar, arrastrar = mover la línea entera, × = borrar. */
async function renderTextBoxes(i) {
  const pg = OV.viewer.pages[i];
  if (!pg || !doc()) return;
  const layer = pg.ov;
  const gen = (layer._tbGen = (layer._tbGen || 0) + 1);
  const pt = await OV.viewer.pageText(i);
  if (layer._tbGen !== gen || OV.tool !== 'edittext') return;
  layer.querySelectorAll('.ov-tbox').forEach(rm);
  const ents = [];
  for (const m of pt.map) {
    if (!m.it.str.trim()) continue;
    const r = OV.viewer.rectsFor(pt, m.start, m.end)[0];
    if (r) ents.push({ m, r });
  }
  const list = groupLines(ents);
  const frag = document.createDocumentFragment();
  list.forEach((g, k) => {
    const r = g.r;
    const b = h('div', { class: 'ov-tbox', 'data-k': k }, h('span', { class: 'x', title: g.items.length > 1 ? 'Borrar esta línea' : 'Borrar este texto' }, '×'));
    Object.assign(b.style, { left: px(r.x - 1), top: px(r.y - 1), width: px(r.w + 2), height: px(r.h + 2) });
    frag.append(b);
  });
  layer._tb = list;
  layer.prepend(frag);
}

async function onEditToolDown(e, layer, i) {
  if (e.button !== 0) return;
  if (e.target.closest && e.target.closest('.ov-textedit')) return; // dentro del cuadro de edición: cursor normal
  const ae = document.activeElement;
  const hadEditor = !!(ae && ae.isContentEditable && ae.classList.contains('ov-textedit'));
  const p0 = pts(layer, e);
  const box = e.target.closest && e.target.closest('.ov-tbox');
  const ent = box && layer._tb ? layer._tb[+box.dataset.k] : null;
  const onX = !!(e.target.classList && e.target.classList.contains('x'));
  if (hadEditor) {
    // clic fuera del texto que se está editando: se aplica el cambio de inmediato
    e.preventDefault();
    ae.blur();
    if (ae.isContentEditable) ae.dispatchEvent(new FocusEvent('blur')); // por si la ventana no tiene el foco del sistema
    await OV.settle();
    const hit = await itemAt(i, p0);
    if (hit && !onX) await beginTextEdit(i, hit.m, hit.r, { x: e.clientX, y: e.clientY });
    return;
  }
  if (!ent) return;
  e.preventDefault();
  if (onX) { await changeTextGroup(i, ent.items, { clear: true, busy: 'Borrando el texto…', done: 'Texto borrado (Ctrl+Z para deshacer)' }); return; }
  startDragOrEdit(e, i, ent, box);
}

/** Fragmento de la línea que está bajo el puntero (o el más cercano). */
function itemUnder(g, p) {
  const inside = g.items.find((it) => p.x >= it.r.x - 1 && p.x <= it.r.x + it.r.w + 1);
  if (inside) return inside;
  return g.items.reduce((a, b) => (Math.abs(p.x - (b.r.x + b.r.w / 2)) < Math.abs(p.x - (a.r.x + a.r.w / 2)) ? b : a));
}

function startDragOrEdit(e, i, ent, box) {
  const start = { x: e.clientX, y: e.clientY };
  const layer = box.parentElement;
  let dragging = false;
  let ghost = null;
  const move = (ev) => {
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!dragging && Math.hypot(dx, dy) > 5) {
      dragging = true;
      box.classList.add('drag-src');
      ghost = h('div', { class: 'ov-tghost' }, ent.items.map((x) => x.m.it.str).join(' '));
      Object.assign(ghost.style, { left: px(ent.r.x - 1), top: px(ent.r.y - 1), minWidth: px(ent.r.w + 2), height: px(ent.r.h + 2), lineHeight: px(ent.r.h + 2), fontSize: px(ent.r.h * 0.8) });
      layer.append(ghost);
    }
    if (dragging) ghost.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const up = async (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!dragging) {
      const it = itemUnder(ent, pts(layer, ev));
      await beginTextEdit(i, it.m, it.r, { x: ev.clientX, y: ev.clientY });
      return;
    }
    box.classList.remove('drag-src');
    if (ghost) rm(ghost);
    const dx = (ev.clientX - start.x) / scale(), dy = (ev.clientY - start.y) / scale();
    if (Math.hypot(dx, dy) < 1) return;
    await changeTextGroup(i, ent.items, { dx, dy, busy: 'Moviendo el texto…' });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Ejecuta un cambio sobre un texto del PDF: fiel si se puede; si no, se tapa y se escribe una copia con fuente equivalente. */
async function changeTextItem(i, m, r, { text = m.it.str, dx = 0, dy = 0, busy = 'Aplicando el cambio…', done = '' }) {
  const d0 = doc();
  let probe = null;
  if (OV.viewer.pages[i].proxy.rotate === 0) {
    try { probe = await d0.probeText(i, { x: m.it.transform[4], y: m.it.transform[5], str: m.it.str, fontName: m.it.fontName }); } catch (err) { console.warn(err); }
  }
  const o = { page: i, ox: m.it.transform[4], oy: m.it.transform[5], str: m.it.str, text, moveX: dx, moveY: -dy };
  if (probe && probe.ok) {
    OV.pending = withBusy(busy, async () => {
      const res = await d0.editTextNow(o);
      if (res.ok) { if (done) toast(done, 'ok', 3500); return; }
      fallbackText(i, m, r, text, dx, dy, probe);
    });
  } else { fallbackText(i, m, r, text, dx, dy, null); }
  await OV.pending;
}

function fallbackText(i, m, r, text, dx, dy, probe) {
  const d0 = doc();
  d0.checkpoint('Editar texto');
  const bg = sampleBg(i, r);
  const size = probe ? probe.size : Math.hypot(m.t[2], m.t[3]) || m.it.height || 12;
  const cover = { id: uid(), type: 'whiteout', page: i, x: r.x - 1, y: r.y, w: r.w + 2, h: r.h, color: bg };
  const list = [cover];
  if (text.trim()) {
    const fname = String(m.it.fontName).toLowerCase();
    list.push({ id: uid(), type: 'text', page: i, x: r.x + dx, y: r.y + dy + r.h / 2 - size * 0.6, text, size, family: probe && probe.sysFamily && S.sysFonts[probe.sysFamily] ? probe.sysFamily : probe ? probe.bundledFamily : /mono|courier/.test(fname) ? 'Courier' : 'Helvetica', bold: probe ? probe.bold : false, italic: probe ? probe.italic : false, color: probe ? probe.color : '#000000' });
  }
  list.forEach((x) => { d0.overlays.push(x); renderObject(x); });
  toast('Esta fuente no se puede reescribir de forma exacta: se usó una equivalente.', '', 5000);
  emit('overlays');
}

/** Mueve o borra todos los fragmentos de una línea de una sola vez (un único cambio en el PDF). */
async function changeTextGroup(i, ents, { clear = false, dx = 0, dy = 0, busy, done = '' }) {
  if (ents.length === 1) return changeTextItem(i, ents[0].m, ents[0].r, { text: clear ? '' : ents[0].m.it.str, dx, dy, busy, done });
  const d0 = doc();
  const edits = ents.map(({ m }) => ({ page: i, ox: m.it.transform[4], oy: m.it.transform[5], str: m.it.str, text: clear ? '' : m.it.str, moveX: dx, moveY: -dy }));
  OV.pending = withBusy(busy, async () => {
    let results = [];
    if (OV.viewer.pages[i].proxy.rotate === 0) {
      try {
        const out = await d0.applyTextEdits(d0.bytes, edits);
        results = out.results;
        if (results.some((r) => r.ok && !r.unchanged)) await d0.applyBytes(out.bytes, clear ? 'Borrar texto' : 'Mover texto');
      } catch (err) { console.warn(err); }
    }
    const failed = ents.filter((_, k) => !(results[k] && results[k].ok));
    failed.forEach(({ m, r }) => fallbackText(i, m, r, clear ? '' : m.it.str, dx, dy, null));
    if (!failed.length && done) toast(done, 'ok', 3500);
  });
  await OV.pending;
}

function sampleBg(i, r) {
  let bg = '#ffffff';
  try {
    const cv = OV.viewer.pages[i].canvas;
    if (cv.width) {
      const k = cv.width / OV.viewer.pages[i].w;
      const px4 = cv.getContext('2d').getImageData(clamp(Math.round((r.x - 1.5) * k), 0, cv.width - 1), clamp(Math.round((r.y + r.h / 2) * k), 0, cv.height - 1), 1, 1).data;
      bg = '#' + [px4[0], px4[1], px4[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* sin muestra de color */ }
  return bg;
}

async function beginTextEdit(i, m, r, at = null) {
  const d0 = doc();
  document.querySelectorAll('.ov-hover').forEach(rm);
  // ¿ya hay una edición pendiente de este mismo texto? se continúa
  const prev = d0.overlays.find((x) => x.type === 'textedit' && x.page === i && Math.abs(x.ox - m.it.transform[4]) < 0.5 && Math.abs(x.oy - m.it.transform[5]) < 0.5);
  if (prev) { OV.select(prev.id); startEdit(prev, null, { fresh: false, at }); return; }

  // 1) edición fiel: se reescribe el propio texto del PDF con su fuente incrustada
  let probe = null;
  if (OV.viewer.pages[i].proxy.rotate === 0) {
    try { probe = await d0.probeText(i, { x: m.it.transform[4], y: m.it.transform[5], str: m.it.str, fontName: m.it.fontName }); } catch (e) { console.warn('edición fiel no disponible', e); }
  }
  const bg = sampleBg(i, r);
  if (probe && probe.ok) {
    const o = {
      id: uid(), type: 'textedit', page: i, x: r.x, y: r.y, w: r.w, h: r.h, ox: m.it.transform[4], oy: m.it.transform[5], str: m.it.str, text: m.it.str,
      size: probe.size, color: probe.color, cover: bg, loaded: probe.loaded, fontBase: probe.fontBase, avail: probe.avail,
      sysFamily: probe.sysFamily, bundledFamily: probe.bundledFamily, bold: probe.bold, italic: probe.italic,
    };
    d0.overlays.push(o);
    renderObject(o);
    OV.select(o.id);
    startEdit(o, null, { fresh: false, at });
    emit('overlays');
    return;
  }

  // 2) alternativa: se tapa el texto y se escribe encima con la fuente más parecida
  d0.checkpoint('Editar texto existente');
  const [a, b, c, d] = m.t;
  const size = Math.hypot(c, d) || m.it.height || 12;
  const style = (await OV.viewer.pages[i].proxy.getTextContent()).styles[m.it.fontName] || {};
  const fname = (m.it.fontName + ' ' + (style.fontFamily || '')).toLowerCase();
  const family = /mono|courier/.test(fname) ? 'Courier' : /serif/.test(fname) && !/sans/.test(fname) ? 'Times' : 'Helvetica';
  const bold = /bold|black|heavy/.test(fname);
  void a; void b;
  const cover = { id: uid(), type: 'whiteout', page: i, x: r.x - 1, y: r.y, w: r.w + 2, h: r.h, color: bg };
  const o = { id: uid(), type: 'text', page: i, x: r.x, y: r.y + r.h / 2 - size * 0.6, text: m.it.str, size, family, bold, italic: false, color: '#000000', linked: cover.id };
  cover.linked = o.id;
  d0.overlays.push(cover, o);
  renderObject(cover);
  renderObject(o);
  OV.select(o.id);
  startEdit(o, null, { fresh: false, at });
  toast('Esta fuente no se puede editar de forma exacta: se usará una equivalente.', '', 5000);
  emit('overlays');
}

// ---------------------------------------------------------------- resaltar / subrayar / tachar el texto seleccionado
function onSelectionMouseUp() {
  const tool = OV.tool;
  if (!SELECTION_TOOLS.has(tool)) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  if (!rects.length) return;
  const s = scale();
  const items = [];
  for (const r of rects) {
    const pageEl = OV.viewer.pages.find((p) => {
      const pr = p.el.getBoundingClientRect();
      return r.left >= pr.left - 2 && r.right <= pr.right + 2 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2;
    });
    if (!pageEl) continue;
    const pr = pageEl.el.getBoundingClientRect();
    items.push({ page: OV.viewer.pages.indexOf(pageEl), x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, w: r.width / s, h: r.height / s });
  }
  if (!items.length) return;
  const d = doc();
  d.checkpoint('Marcar texto');
  for (const it of items) {
    const o = { id: uid(), type: tool, ...it };
    if (tool === 'highlight') Object.assign(o, { color: OV.style.hlColor, opacity: OV.style.hlOpacity });
    else Object.assign(o, { color: OV.style.markColor });
    d.overlays.push(o);
    renderObject(o);
  }
  sel.removeAllRanges();
  emit('overlays');
}

// ---------------------------------------------------------------- panel de propiedades
OV.propsCard = function () {
  const o = OV.selected();
  const kind = o ? o.type : OV.tool;
  if (!kind) return null;
  const st = OV.style;
  const rows = [];
  const apply = (patch, styleKey) => {
    Object.assign(st, styleKey || {});
    const cur = OV.selected();
    if (cur) OV.update(cur, patch, 'Cambiar propiedades');
  };
  const row = (label, ...kids) => h('div', { class: 'prop-row' }, h('label', null, label), ...kids);
  const colorInput = (val, cb) => h('input', { type: 'color', value: val || '#000000', onchange: (e) => cb(e.target.value) });
  const num = (val, min, max, step, cb) => h('input', { type: 'number', value: val, min, max, step, onchange: (e) => cb(parseFloat(e.target.value) || min) });
  const range = (val, min, max, step, cb) => h('input', { type: 'range', value: val, min, max, step, onchange: (e) => cb(parseFloat(e.target.value)) });
  const get = (k, alt) => (o && o[k] !== undefined ? o[k] : alt);
  let title = '';
  switch (kind) {
    case 'edittext': {
      title = 'Editar texto existente';
      const li = (ic, txt) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '6px 0', fontSize: '12.5px', lineHeight: '1.4' } }, h('span', { style: { color: 'var(--accent)', flex: 'none', marginTop: '1px' } }, icon(ic, 15)), h('span', null, txt));
      rows.push(li('pointer', 'Todos los textos de la página están marcados con una caja.'));
      rows.push(li('text', 'Clic en un texto: se edita con su misma fuente.'));
      rows.push(li('arrow', 'Arrastra una caja para mover el texto.'));
      rows.push(li('trash', 'Pulsa la × de la caja para borrar ese texto.'));
      rows.push(li('check', 'Clic fuera (o Enter) aplica el cambio al instante. Esc cancela. Ctrl+Z deshace.'));
      break;
    }
    case 'text': {
      title = 'Texto';
      const fams = [...new Set([...STANDARD_FAMILIES, ...Object.keys(S.sysFonts), ...Object.keys(BUNDLED_FILES)])];
      rows.push(row('Fuente', h('select', { onchange: (e) => apply({ family: e.target.value }, { family: e.target.value }) }, fams.map((f) => h('option', { value: f, selected: f === get('family', st.family) }, f)))));
      rows.push(row('Tamaño', num(Math.round(get('size', st.size) * 10) / 10, 4, 400, 1, (v) => apply({ size: v }, { size: v }))));
      const tog = (key, ic, ttl) => h('button', { class: get(key, st[key]) ? 'on' : '', title: ttl, onclick: (e) => { const v = !get(key, st[key]); e.currentTarget.classList.toggle('on', v); apply({ [key]: v }, { [key]: v }); } }, ic);
      rows.push(row('Estilo', h('div', { class: 'seg' }, tog('bold', h('b', null, 'N'), 'Negrita'), tog('italic', h('i', null, 'K'), 'Cursiva'), tog('underline', h('u', null, 'S'), 'Subrayado'))));
      rows.push(row('Color', colorInput(get('color', st.color), (v) => apply({ color: v }, { color: v }))));
      break;
    }
    case 'textedit': {
      title = 'Texto del PDF';
      const have = new Set([...(o.avail || '')]);
      const missing = [...new Set([...(o.text || '')].filter((ch) => !/\s/.test(ch) && !have.has(ch)))];
      rows.push(h('div', { style: { fontSize: '12.5px', lineHeight: '1.45' } },
        h('div', null, 'Fuente original: ', h('b', null, o.fontBase)),
        missing.length
          ? h('div', { style: { color: 'var(--muted)', marginTop: '4px' } }, `El PDF no trae «${missing.join('')}»: se dibujará con ${o.sysFamily || o.bundledFamily} (equivalente de la misma familia).`)
          : h('div', { style: { color: 'var(--muted)', marginTop: '4px' } }, 'Todas las letras existen en la fuente original: se mantiene exactamente.')));
      break;
    }
    case 'rect':
    case 'ellipse': {
      title = kind === 'rect' ? 'Rectángulo' : 'Elipse';
      rows.push(row('Borde', colorInput(get('stroke', st.stroke) || '#d6284a', (v) => apply({ stroke: v }, { stroke: v }))));
      rows.push(row('Grosor', num(get('strokeWidth', st.strokeWidth), 0.5, 40, 0.5, (v) => apply({ strokeWidth: v }, { strokeWidth: v }))));
      const hasFill = !!get('fill', st.fill);
      const fillIn = colorInput(get('fill', st.fill) || '#ffe433', (v) => apply({ fill: v }, { fill: v }));
      rows.push(row('Relleno', fillIn, h('label', { style: { width: 'auto', display: 'flex', gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: hasFill, onchange: (e) => apply({ fill: e.target.checked ? fillIn.value : '' }, { fill: e.target.checked ? fillIn.value : '' }) }), 'Sí')));
      rows.push(row('Opacidad', range(get('opacity', st.opacity), 0.1, 1, 0.05, (v) => apply({ opacity: v }, { opacity: v }))));
      break;
    }
    case 'line':
    case 'arrow':
    case 'ink':
      title = kind === 'ink' ? 'Dibujo libre' : kind === 'arrow' ? 'Flecha' : 'Línea';
      rows.push(row('Color', colorInput(get('color', st.inkColor), (v) => apply({ color: v }, { inkColor: v }))));
      rows.push(row('Grosor', num(get('strokeWidth', st.inkWidth), 0.5, 40, 0.5, (v) => apply({ strokeWidth: v }, { inkWidth: v }))));
      break;
    case 'highlight':
    case 'area':
      title = 'Resaltado';
      rows.push(row('Color', colorInput(get('color', st.hlColor), (v) => apply({ color: v }, { hlColor: v }))));
      rows.push(row('Opacidad', range(get('opacity', st.hlOpacity), 0.1, 1, 0.05, (v) => apply({ opacity: v }, { hlOpacity: v }))));
      break;
    case 'underline':
    case 'strike':
      title = kind === 'underline' ? 'Subrayado' : 'Tachado';
      rows.push(row('Color', colorInput(get('color', st.markColor), (v) => apply({ color: v }, { markColor: v }))));
      break;
    case 'whiteout':
      title = 'Tapar con blanco';
      rows.push(row('Color', colorInput(typeof get('color', st.whiteColor) === 'string' ? get('color', st.whiteColor) : '#ffffff', (v) => apply({ color: v }, { whiteColor: v }))));
      break;
    case 'image':
      title = 'Imagen / firma';
      rows.push(row('Opacidad', range(get('opacity', 1), 0.1, 1, 0.05, (v) => apply({ opacity: v }))));
      break;
    case 'redact':
      title = 'Redactar';
      rows.push(h('div', { class: 'hint', style: { color: 'var(--muted)', fontSize: '12px' } }, 'Dibuja recuadros sobre lo que quieras ocultar. Al aplicar, esas páginas se convierten en imagen y el texto de debajo se elimina de verdad.'));
      break;
    default:
      return null;
  }
  const head = h('h4', null, title);
  if (o) head.append(h('span', { style: { display: 'flex', gap: '2px' } },
    h('button', { class: 'icon-btn', title: 'Duplicar (Ctrl+D)', style: { height: '24px', minWidth: '24px' }, onclick: () => OV.duplicate() }, icon('copy', 14)),
    h('button', { class: 'icon-btn', title: 'Eliminar (Supr)', style: { height: '24px', minWidth: '24px' }, onclick: () => OV.deleteSelected() }, icon('trash', 14))));
  return h('div', { class: 'props-card' }, head, ...rows);
};

void field; void hexToRgb01;
