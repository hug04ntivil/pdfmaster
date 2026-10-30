// Visor de PDF: páginas continuas con zoom, capa de texto, búsqueda y miniaturas
import { pdfjs, S, emit } from './docs.js';
import { h, $, clamp, debounce, showContextMenu, icon } from './util.js';

const CSS_PER_PT = 96 / 72;

export class Viewer {
  constructor(scrollEl, viewerEl) {
    this.scroll = scrollEl;
    this.el = viewerEl;
    this.doc = null;
    this.pages = []; // {el, canvas, text, hl, ov, w, h, proxy, rendered, task, textTask}
    this.scale = CSS_PER_PT; // px CSS por punto
    this.current = 0;
    this.hooks = {}; // onPage(i), onZoom(), onMountPage(el, i)
    this.hits = [];
    this.hitIdx = -1;
    this.query = '';
    this.textCache = new Map();
    this.gen = 0;
    this.io = null;
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    new ResizeObserver(debounce(() => { if (this.doc && this.doc.zoomMode !== 'custom') this.applyZoom(this.doc.zoomMode); }, 120)).observe(this.scroll);
    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !this.doc) return;
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
  }

  get pct() { return Math.round((this.scale / CSS_PER_PT) * 100); }

  async show(doc, { keepScroll = false } = {}) {
    const top = keepScroll ? this.scroll.scrollTop : doc ? doc.scrollTop : 0;
    this.doc = doc;
    this.gen++;
    const gen = this.gen;
    this.cancelAll();
    this.el.innerHTML = '';
    this.pages = [];
    this.textCache.clear();
    this.hits = []; this.hitIdx = -1;
    if (this.io) this.io.disconnect();
    if (!doc) return;
    const pdf = doc.pdf;
    const proxies = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      proxies.push(pdf.getPage(i));
      if (i % 40 === 0) await Promise.all(proxies.slice(-40));
    }
    const resolved = await Promise.all(proxies);
    if (gen !== this.gen) return;
    this.io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        const i = +en.target.dataset.i;
        if (en.isIntersecting) this.renderPage(i);
        else this.unrenderLater(i);
      }
    }, { root: this.scroll, rootMargin: '900px 0px' });
    resolved.forEach((proxy, i) => {
      const vp = proxy.getViewport({ scale: 1 });
      const el = h('div', { class: 'page', 'data-i': i });
      const canvas = h('canvas', { class: 'pcanvas' });
      const text = h('div', { class: 'textLayer' });
      const hl = h('div', { class: 'hl-layer' });
      const ov = h('div', { class: 'ov-layer', 'data-i': i });
      el.append(canvas, text, hl, ov);
      this.el.append(el);
      this.pages.push({ el, canvas, text, hl, ov, w: vp.width, h: vp.height, proxy, rendered: false, task: null, textTask: null, tl: null });
      if (this.hooks.onMountPage) this.hooks.onMountPage(el, i, ov);
    });
    this.applyZoom(doc.zoomMode === 'custom' ? doc.zoom : doc.zoomMode, true);
    this.pages.forEach((p) => this.io.observe(p.el));
    this.scroll.scrollTop = top;
    this.builtVersion = doc.version; // versión del documento cuyas páginas ya están montadas
    if (this.hooks.onBuilt) this.hooks.onBuilt(); // la capa de edición no espera al dibujo de las páginas
    this.onScroll();
    if (this.query) this.search(this.query);
  }

  cancelAll() {
    for (const p of this.pages) {
      try { p.task && p.task.cancel(); } catch {}
      try { p.textTask && p.textTask.cancel && p.textTask.cancel(); } catch {}
    }
  }

  layoutSizes() {
    const s = this.scale;
    for (const p of this.pages) {
      p.el.style.width = `${p.w * s}px`;
      p.el.style.height = `${p.h * s}px`;
      p.el.style.setProperty('--total-scale-factor', s);
      p.el.style.setProperty('--scale-round-x', '1px');
      p.el.style.setProperty('--scale-round-y', '1px');
    }
  }

  applyZoom(mode, silent = false) {
    if (!this.doc || !this.pages.length) return;
    const availW = this.scroll.clientWidth - 56;
    const availH = this.scroll.clientHeight - 36;
    const maxW = Math.max(...this.pages.map((p) => p.w));
    const maxH = Math.max(...this.pages.map((p) => p.h));
    let scale;
    if (mode === 'fit-width') scale = availW / maxW;
    else if (mode === 'fit-page') scale = Math.min(availW / maxW, availH / maxH);
    else scale = Number(mode) * CSS_PER_PT;
    scale = clamp(scale, 0.1 * CSS_PER_PT, 8 * CSS_PER_PT);
    const anchor = this.anchor();
    this.scale = scale;
    this.doc.zoomMode = typeof mode === 'string' ? mode : 'custom';
    if (this.doc.zoomMode === 'custom') this.doc.zoom = scale / CSS_PER_PT;
    this.cancelAll();
    this.layoutSizes();
    for (const p of this.pages) {
      p.rendered = false;
      p.canvas.width = 0; p.canvas.height = 0;
      p.text.innerHTML = '';
      p.hl.innerHTML = '';
    }
    this.restoreAnchor(anchor);
    // vuelve a pintar lo visible
    this.visibleIndexes().forEach((i) => this.renderPage(i));
    this.drawHits();
    if (this.hooks.onZoom) this.hooks.onZoom();
    if (!silent) emit('zoom');
  }
  setZoom(z) { this.applyZoom(clamp(z, 0.1, 8)); }
  zoomBy(f) { this.setZoom((this.scale / CSS_PER_PT) * f); }

  anchor() {
    const p = this.pages[this.current];
    if (!p) return null;
    return { i: this.current, frac: (this.scroll.scrollTop - p.el.offsetTop) / Math.max(1, p.el.offsetHeight) };
  }
  restoreAnchor(a) {
    if (!a || !this.pages[a.i]) return;
    const p = this.pages[a.i];
    this.scroll.scrollTop = p.el.offsetTop + a.frac * p.el.offsetHeight;
  }

  visibleIndexes() {
    const top = this.scroll.scrollTop - 400;
    const bottom = this.scroll.scrollTop + this.scroll.clientHeight + 400;
    const out = [];
    for (let i = 0; i < this.pages.length; i++) {
      const el = this.pages[i].el;
      if (el.offsetTop + el.offsetHeight >= top && el.offsetTop <= bottom) out.push(i);
      else if (el.offsetTop > bottom) break;
    }
    return out;
  }

  async renderPage(i) {
    const p = this.pages[i];
    if (!p || p.rendered) return;
    p.rendered = true;
    const gen = this.gen;
    const scale = this.scale;
    if (this.hooks.beforeRender) { try { await this.hooks.beforeRender(i); } catch { /* sin cajas de texto */ } }
    if (gen !== this.gen || scale !== this.scale) return; // el visor se reconstruyó o cambió el zoom: otra llamada se encarga
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let k = scale * dpr;
    const px = p.w * p.h * k * k;
    if (px > 36e6) k *= Math.sqrt(36e6 / px);
    const vp = p.proxy.getViewport({ scale: k });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    try {
      p.task = p.proxy.render({ canvasContext: ctx, viewport: vp });
      await p.task.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') { p.rendered = false; return; }
      console.warn('render', i, e);
    }
    if (gen !== this.gen || scale !== this.scale) { return; }
    p.canvas.width = cv.width; p.canvas.height = cv.height;
    p.canvas.getContext('2d', { alpha: false }).drawImage(cv, 0, 0);
    // capa de texto
    try {
      p.text.innerHTML = '';
      const tl = new pdfjs.TextLayer({ textContentSource: p.proxy.streamTextContent(), container: p.text, viewport: p.proxy.getViewport({ scale }) });
      p.tl = tl;
      await tl.render();
    } catch (e) { if (!(e && /cancel/i.test(e.message || ''))) console.warn('textLayer', e); }
    if (gen !== this.gen) return;
    this.drawHits(i);
    if (this.hooks.onPageRendered) this.hooks.onPageRendered(i);
  }

  unrenderLater(i) {
    const p = this.pages[i];
    if (!p || !p.rendered) return;
    clearTimeout(p.unrenderTimer);
    p.unrenderTimer = setTimeout(() => {
      const vis = this.visibleIndexes();
      if (vis.some((v) => Math.abs(v - i) <= 3)) return;
      try { p.task && p.task.cancel(); } catch {}
      p.canvas.width = 0; p.canvas.height = 0; p.text.innerHTML = ''; p.rendered = false;
    }, 1500);
  }

  onScroll() {
    if (!this.pages.length) return;
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      const mid = this.scroll.scrollTop + this.scroll.clientHeight * 0.35;
      let best = 0;
      for (let i = 0; i < this.pages.length; i++) {
        const el = this.pages[i].el;
        if (el.offsetTop + el.offsetHeight < mid) best = Math.min(i + 1, this.pages.length - 1);
        else break;
      }
      if (this.doc) this.doc.scrollTop = this.scroll.scrollTop;
      if (best !== this.current) {
        this.current = best;
        if (this.hooks.onPage) this.hooks.onPage(best);
      }
    });
  }

  goTo(i, smooth = false) {
    const p = this.pages[clamp(i, 0, this.pages.length - 1)];
    if (!p) return;
    this.scroll.scrollTo({ top: p.el.offsetTop - 14, behavior: smooth ? 'smooth' : 'auto' });
    this.current = clamp(i, 0, this.pages.length - 1);
    if (this.hooks.onPage) this.hooks.onPage(this.current);
  }

  // ------------------------------------------------------------ búsqueda
  async pageText(i) {
    if (this.textCache.has(i)) return this.textCache.get(i);
    const proxy = this.pages[i].proxy;
    const vp = proxy.getViewport({ scale: 1 });
    const tc = await proxy.getTextContent();
    let str = '';
    const map = []; // por ítem: {start, end, item, t}
    for (const it of tc.items) {
      if (!it.str && !it.hasEOL) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      map.push({ start: str.length, end: str.length + it.str.length, it, t });
      str += it.str + (it.hasEOL ? ' ' : '');
    }
    const r = { str, map, norm: normalize(str) };
    this.textCache.set(i, r);
    return r;
  }

  async search(q) {
    this.query = q;
    const gen = ++this._sgen || (this._sgen = 1);
    this.hits = []; this.hitIdx = -1;
    this.clearHits();
    if (!q || !this.pages.length) { if (this.hooks.onSearch) this.hooks.onSearch(0, -1); return; }
    const nq = normalize(q);
    for (let i = 0; i < this.pages.length; i++) {
      if (gen !== this._sgen) return;
      const pt = await this.pageText(i);
      let from = 0;
      for (;;) {
        const at = pt.norm.indexOf(nq, from);
        if (at < 0) break;
        this.hits.push({ page: i, rects: this.rectsFor(pt, at, at + nq.length) });
        from = at + Math.max(1, nq.length);
      }
      if (i === 0 || i % 10 === 0) { this.drawHits(); if (this.hooks.onSearch) this.hooks.onSearch(this.hits.length, this.hitIdx); }
    }
    if (gen !== this._sgen) return;
    if (this.hits.length) {
      const first = this.hits.findIndex((x) => x.page >= this.current);
      this.hitIdx = first < 0 ? 0 : first;
      this.focusHit();
    }
    this.drawHits();
    if (this.hooks.onSearch) this.hooks.onSearch(this.hits.length, this.hitIdx);
  }
  rectsFor(pt, a, b) {
    const rects = [];
    for (const m of pt.map) {
      const s = Math.max(a, m.start), e = Math.min(b, m.end);
      if (e <= s) continue;
      const len = Math.max(1, m.end - m.start);
      const f0 = (s - m.start) / len, f1 = (e - m.start) / len;
      const [a0, a1, c0, c1, tx, ty] = m.t;
      const wLen = m.it.width;
      const dirx = a0, diry = a1; // dirección del texto en la vista (por punto de ancho unitario)
      const n = Math.hypot(dirx, diry) || 1;
      const ux = dirx / n, uy = diry / n;
      const vx = c0 / (Math.hypot(c0, c1) || 1), vy = c1 / (Math.hypot(c0, c1) || 1); // hacia arriba del glifo (negativo en y de vista)
      const hh = m.it.height || Math.hypot(c0, c1);
      const x0 = tx + ux * wLen * f0, y0 = ty + uy * wLen * f0;
      const x1 = tx + ux * wLen * f1, y1 = ty + uy * wLen * f1;
      const pts = [[x0, y0], [x1, y1], [x1 + vx * hh, y1 + vy * hh], [x0 + vx * hh, y0 + vy * hh]];
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      rects.push({ x: Math.min(...xs), y: Math.min(...ys) - hh * 0.05, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + hh * 0.1 });
    }
    return rects;
  }
  clearHits() { this.pages.forEach((p) => { p.hl.innerHTML = ''; }); }
  drawHits(only) {
    const idxs = only !== undefined ? [only] : this.pages.map((_, i) => i);
    for (const i of idxs) {
      const p = this.pages[i];
      if (!p) continue;
      p.hl.innerHTML = '';
      this.hits.forEach((hit, hi) => {
        if (hit.page !== i) return;
        for (const r of hit.rects) {
          const d = h('i', { class: hi === this.hitIdx ? 'cur' : '' });
          d.style.cssText = `left:${r.x * this.scale}px;top:${r.y * this.scale}px;width:${r.w * this.scale}px;height:${r.h * this.scale}px`;
          p.hl.append(d);
        }
      });
    }
  }
  focusHit() {
    const hit = this.hits[this.hitIdx];
    if (!hit) return;
    const p = this.pages[hit.page];
    const r = hit.rects[0];
    this.scroll.scrollTo({ top: p.el.offsetTop + (r ? r.y * this.scale : 0) - this.scroll.clientHeight * 0.3, behavior: 'smooth' });
  }
  nextHit(d = 1) {
    if (!this.hits.length) return;
    this.hitIdx = (this.hitIdx + d + this.hits.length) % this.hits.length;
    this.drawHits();
    this.focusHit();
    if (this.hooks.onSearch) this.hooks.onSearch(this.hits.length, this.hitIdx);
  }

  pageEl(i) { return this.pages[i] && this.pages[i].el; }
}

function normalize(s) {
  let out = '';
  for (const ch of s) {
    const r = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += r.length === 1 ? r : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Miniaturas (barra izquierda). Permite seleccionar, reordenar arrastrando y menú contextual.
export class Thumbs {
  constructor(container, hooks) {
    this.el = container;
    this.hooks = hooks; // onGo(i), onReorder(order), onAction(name, idxs)
    this.doc = null;
    this.items = [];
    this.io = null;
    this.lastClicked = 0;
    this.gen = 0;
    this.cur = 0;
  }

  async show(doc) {
    this.doc = doc;
    this.gen++;
    const gen = this.gen;
    this.el.innerHTML = '';
    this.items = [];
    if (this.io) this.io.disconnect();
    if (!doc) return;
    this.io = new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting) this.renderThumb(+en.target.dataset.i);
    }, { root: this.el, rootMargin: '400px 0px' });
    const pdf = doc.pdf;
    const first = await pdf.getPage(1);
    const W = 108;
    for (let i = 0; i < pdf.numPages; i++) {
      if (gen !== this.gen) return;
      const proxy = i === 0 ? first : null;
      const cv = h('canvas', { class: 'tcanvas' });
      const t = h('div', { class: 'thumb', 'data-i': i, draggable: true }, cv, h('div', { class: 'tnum' }, String(i + 1)));
      const vp0 = first.getViewport({ scale: 1 });
      cv.style.width = W + 'px'; cv.style.height = (W * vp0.height) / vp0.width + 'px';
      this.bind(t, i);
      this.el.append(t);
      this.items.push({ el: t, cv, proxy, done: false });
      this.io.observe(t);
    }
    this.refreshSel();
  }

  async renderThumb(i) {
    const it = this.items[i];
    if (!it || it.done) return;
    it.done = true;
    const gen = this.gen;
    try {
      const proxy = it.proxy || (await this.doc.pdf.getPage(i + 1));
      it.proxy = proxy;
      const vp1 = proxy.getViewport({ scale: 1 });
      const W = 108;
      const k = (W * 2) / vp1.width;
      const vp = proxy.getViewport({ scale: k });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await proxy.render({ canvasContext: ctx, viewport: vp }).promise;
      if (gen !== this.gen) return;
      it.cv.width = cv.width; it.cv.height = cv.height;
      it.cv.style.height = (W * vp1.height) / vp1.width + 'px';
      it.cv.getContext('2d').drawImage(cv, 0, 0);
    } catch (e) { /* miniatura opcional */ }
  }

  bind(t, i) {
    t.addEventListener('click', (e) => {
      const sel = this.doc.sel;
      if (e.shiftKey) {
        const [a, b] = [Math.min(this.lastClicked, i), Math.max(this.lastClicked, i)];
        if (!e.ctrlKey) sel.clear();
        for (let k = a; k <= b; k++) sel.add(k);
      } else if (e.ctrlKey || e.metaKey) {
        sel.has(i) ? sel.delete(i) : sel.add(i);
        this.lastClicked = i;
      } else {
        sel.clear(); sel.add(i);
        this.lastClicked = i;
      }
      this.refreshSel();
      this.hooks.onGo(i);
      emit('selection');
    });
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.doc.sel.has(i)) { this.doc.sel.clear(); this.doc.sel.add(i); this.refreshSel(); }
      const idx = [...this.doc.sel].sort((a, b) => a - b);
      const n = idx.length > 1 ? ` (${idx.length} páginas)` : '';
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rotar a la derecha' + n, icon: 'rotateCw', fn: () => this.hooks.onAction('rotateR', idx) },
        { label: 'Rotar a la izquierda' + n, icon: 'rotateCcw', fn: () => this.hooks.onAction('rotateL', idx) },
        { label: 'Duplicar' + n, icon: 'copy', fn: () => this.hooks.onAction('duplicate', idx) },
        { label: 'Extraer a un PDF nuevo' + n, icon: 'extract', fn: () => this.hooks.onAction('extract', idx) },
        '-',
        { label: 'Insertar página en blanco después', icon: 'filePlus', fn: () => this.hooks.onAction('blankAfter', idx) },
        { label: 'Insertar páginas de otro PDF…', icon: 'filePlus2', fn: () => this.hooks.onAction('insertFile', idx) },
        '-',
        { label: 'Eliminar' + n, icon: 'trash', fn: () => this.hooks.onAction('delete', idx) },
      ]);
    });
    t.addEventListener('dragstart', (e) => {
      if (!this.doc.sel.has(i)) { this.doc.sel.clear(); this.doc.sel.add(i); this.refreshSel(); }
      e.dataTransfer.setData('application/x-pm-pages', JSON.stringify([...this.doc.sel]));
      e.dataTransfer.effectAllowed = 'move';
      t.classList.add('dragging');
    });
    t.addEventListener('dragend', () => { t.classList.remove('dragging'); this.items.forEach((x) => x.el.classList.remove('dragover-before', 'dragover-after')); });
    t.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('application/x-pm-pages')) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      this.items.forEach((x) => x.el.classList.remove('dragover-before', 'dragover-after'));
      t.classList.add(after ? 'dragover-after' : 'dragover-before');
    });
    t.addEventListener('drop', (e) => {
      const raw = e.dataTransfer.getData('application/x-pm-pages');
      if (!raw) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const moving = JSON.parse(raw).sort((a, b) => a - b);
      const n = this.items.length;
      const rest = Array.from({ length: n }, (_, k) => k).filter((k) => !moving.includes(k));
      let at = rest.findIndex((k) => k >= i + (after ? 1 : 0));
      if (at < 0) at = rest.length;
      const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      if (order.every((v, k) => v === k)) return;
      this.hooks.onReorder(order, moving.map((m) => order.indexOf(m)));
    });
  }

  refreshSel() {
    this.items.forEach((it, i) => it.el.classList.toggle('sel', this.doc && this.doc.sel.has(i)));
  }
  setCurrent(i) {
    this.cur = i;
    this.items.forEach((it, k) => it.el.classList.toggle('cur', k === i));
    const it = this.items[i];
    if (it) {
      const r = it.el.getBoundingClientRect(), c = this.el.getBoundingClientRect();
      if (r.top < c.top + 4 || r.bottom > c.bottom - 4) it.el.scrollIntoView({ block: 'nearest' });
    }
  }
}
void icon; void $;
