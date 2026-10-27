// Modelo de documento abierto: bytes, pdf.js, historial (deshacer/rehacer), guardado
import * as pdfjs from 'pdfjs-dist';
import * as E from './engine.js';
import { uid, dataUrlToBytes, canvasToBlob, blobToBytes, hexToRgb01, modal, h, field, toast } from './util.js';

const base = new URL('.', document.baseURI).href;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.mjs', base).href;
export { pdfjs };

export const PDF_OPTS = {
  cMapUrl: new URL('pdfjs/cmaps/', base).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
  wasmUrl: new URL('pdfjs/wasm/', base).href,
  iccUrl: new URL('pdfjs/iccs/', base).href,
  isEvalSupported: false,
};

/** Estado global de la aplicación */
export const S = {
  docs: [],
  cur: null,
  settings: {},
  info: {},
  sysFonts: {}, // { familia: [archivos] }
  listeners: new Set(),
};
export const onChange = (fn) => S.listeners.add(fn);
export const emit = (what) => S.listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

export const engineCtx = {
  get systemFonts() { return S.sysFonts; },
  loadFont: (file) => window.pm.readFont(file),
};

export async function askPassword(name, wrong) {
  const f = field({ type: 'password', label: 'Contraseña' });
  const ok = await modal({
    title: 'Documento protegido', icon: 'lock', sub: `«${name}» está cifrado.${wrong ? ' La contraseña no es correcta.' : ''}`,
    body: f.el, okText: 'Abrir', onOk: () => { if (!f.get()) throw new Error('Escribe la contraseña'); return f.get(); },
  });
  return ok === true ? f.get() : ok;
}

export class PdfDoc {
  constructor({ name, path, bytes }) {
    this.id = uid();
    this.name = name;
    this.path = path || null;
    this.bytes = bytes;
    this.pdf = null;
    this.numPages = 0;
    this.overlays = [];
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.protect = null; // {userPassword, ownerPassword, permissions}: se cifra al guardar
    this.scrollTop = 0;
    this.zoomMode = 'fit-width';
    this.zoom = 1;
    this.sel = new Set(); // miniaturas seleccionadas
    this.version = 0; // aumenta cuando cambian los bytes
  }

  async destroyPdf() {
    try { if (this.task) await this.task.destroy(); } catch { /* ya liberado */ }
    this.task = null;
    this.pdf = null;
  }

  async openPdf() {
    await this.destroyPdf();
    this.task = pdfjs.getDocument({ ...PDF_OPTS, data: this.bytes.slice() });
    this.pdf = await this.task.promise;
    this.numPages = this.pdf.numPages;
    this.version++;
  }

  /** Abre el documento; si está cifrado pide la contraseña y trabaja con una copia descifrada. */
  async init() {
    let password = null;
    let tries = 0;
    for (;;) {
      const task = pdfjs.getDocument({ ...PDF_OPTS, data: this.bytes.slice(), password: password || undefined });
      try {
        this.pdf = await task.promise;
        this.task = task;
        break;
      } catch (e) {
        if (e && e.name === 'PasswordException') {
          const pw = await askPassword(this.name, tries > 0);
          if (!pw) throw new Error('cancelado');
          password = pw;
          tries++;
          continue;
        }
        throw e;
      }
    }
    if (password) {
      let info = null;
      try { info = (await this.pdf.getMetadata()).info; } catch { /* sin metadatos */ }
      this.bytes = await E.decrypt(this.bytes, password, info);
      this.protect = { userPassword: password, ownerPassword: password };
      await this.openPdf();
      return;
    }
    this.numPages = this.pdf.numPages;
    this.version++;
  }

  // ---- historial
  snapshot(label) { return { bytes: this.bytes, overlays: structuredClone(this.overlays), label }; }
  checkpoint(label) {
    this.undoStack.push(this.snapshot(label));
    // limita memoria: máx 40 pasos y ~600 MB de bytes distintos
    let total = 0;
    const seen = new Set();
    for (const s of this.undoStack) if (!seen.has(s.bytes)) { seen.add(s.bytes); total += s.bytes.length; }
    while (this.undoStack.length > 40 || (total > 600e6 && this.undoStack.length > 3)) {
      const old = this.undoStack.shift();
      if (!this.undoStack.some((s) => s.bytes === old.bytes) && old.bytes !== this.bytes) total -= old.bytes.length;
    }
    this.redoStack = [];
    this.dirty = true;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  async undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot('redo'));
    await this.restore(this.undoStack.pop());
    return true;
  }
  async redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot('undo'));
    await this.restore(this.redoStack.pop());
    return true;
  }
  async restore(s) {
    const changed = s.bytes !== this.bytes;
    this.bytes = s.bytes;
    this.overlays = structuredClone(s.overlays);
    this.dirty = true;
    if (changed) await this.openPdf();
    emit(changed ? 'bytes' : 'overlays-restored');
  }

  /** Sustituye los bytes por el resultado de una operación (con punto de restauración). */
  async applyBytes(newBytes, label) {
    this.checkpoint(label);
    this.bytes = newBytes;
    await this.openPdf();
    this.sel.clear();
    emit('bytes');
  }

  /** Incrusta en el PDF las anotaciones pendientes (texto, firmas, formas...). */
  async commit() {
    if (!this.overlays.length) return;
    const list = this.overlays;
    const prepared = list.filter((o) => o.type !== 'redact').map((o) => {
      const c = { ...o };
      if (typeof c.color === 'string') c.color = hexToRgb01(c.color);
      if (c.type === 'image') {
        c.bytes = dataUrlToBytes(c.src);
        c.mime = c.src.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
      }
      return c;
    });
    let out = await E.commitOverlays(this.bytes, prepared, engineCtx);
    const redacts = list.filter((o) => o.type === 'redact');
    if (redacts.length) out = await this.applyRedactions(out, redacts);
    this.checkpoint('Aplicar cambios');
    this.overlays = [];
    this.bytes = out;
    await this.openPdf();
    emit('bytes');
  }

  /** Redacción real: las páginas con zonas tachadas se convierten en imagen para eliminar el texto subyacente. */
  async applyRedactions(bytes, redacts) {
    const tmpTask = pdfjs.getDocument({ ...PDF_OPTS, data: bytes.slice() });
    const tmp = await tmpTask.promise;
    const byPage = new Map();
    redacts.forEach((r) => { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); });
    const items = [];
    for (const [pi, rects] of byPage) {
      const page = await tmp.getPage(pi + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const k = 3; // ~216 ppp
      const vp = page.getViewport({ scale: k });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.fillStyle = '#000';
      rects.forEach((r) => ctx.fillRect(r.x * k, r.y * k, r.w * k, r.h * k));
      const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
      items.push({ index: pi, bytes: await blobToBytes(blob), mime: 'image/jpeg', w: vp1.width, h: vp1.height });
    }
    await tmpTask.destroy();
    return E.replacePagesWithImages(bytes, items);
  }

  /** Bytes finales listos para escribir en disco. */
  async finalBytes() {
    await this.commit();
    return this.protect ? E.encrypt(this.bytes, this.protect) : this.bytes;
  }

  async save(forceDialog = false) {
    const data = await this.finalBytes();
    let p = this.path;
    if (!p || forceDialog) {
      p = await window.pm.saveDialog({ defaultName: this.name.replace(/\.pdf$/i, '') + '.pdf', data });
      if (!p) return false;
    } else {
      await window.pm.writeFile(p, data);
    }
    this.path = p;
    this.name = p.split(/[\\/]/).pop();
    this.dirty = false;
    emit('saved');
    return true;
  }
}

export async function openEntry({ name, path, data }) {
  const doc = new PdfDoc({ name, path, bytes: data });
  try {
    await doc.init();
  } catch (e) {
    if (e && e.message === 'cancelado') return null;
    console.error(e);
    toast(`No se pudo abrir «${name}»: ${e && e.message ? e.message : e}`, 'err', 7000);
    return null;
  }
  S.docs.push(doc);
  S.cur = doc;
  emit('docs');
  return doc;
}

/** Crea un documento nuevo a partir de bytes generados (sin ruta, con cambios pendientes de guardar). */
export async function openGenerated(name, bytes) {
  const doc = await openEntry({ name, path: null, data: bytes });
  if (doc) { doc.dirty = true; emit('docs'); }
  return doc;
}

export function closeDoc(doc) {
  const i = S.docs.indexOf(doc);
  if (i < 0) return;
  S.docs.splice(i, 1);
  doc.destroyPdf();
  if (S.cur === doc) S.cur = S.docs[Math.min(i, S.docs.length - 1)] || null;
  emit('docs');
}
export function setCurrent(doc) {
  S.cur = doc;
  emit('docs');
}
void h;
