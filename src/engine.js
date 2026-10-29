// Motor PDF de PDF Master: operaciones sobre bytes (sin DOM, probado con scripts/selftest.mjs)
import {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, PDFArray, PDFInvalidObject, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup,
  PDFButton, PDFSignature, StandardFonts, rgb, degrees, BlendMode, LineCapStyle,
} from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';

export const PRODUCER = 'PDF Master';

/** Fuentes libres incluidas en la aplicación (métricas idénticas a Calibri, Cambria, Arial, Times New Roman y Courier New). [normal, negrita, cursiva, negrita-cursiva] */
export const BUNDLED_FILES = {
  Carlito: ['Carlito_400Regular.ttf', 'Carlito_700Bold.ttf', 'Carlito_400Regular_Italic.ttf', 'Carlito_700Bold_Italic.ttf'],
  Caladea: ['Caladea_400Regular.ttf', 'Caladea_700Bold.ttf', 'Caladea_400Regular_Italic.ttf', 'Caladea_700Bold_Italic.ttf'],
  Arimo: ['Arimo_400Regular.ttf', 'Arimo_700Bold.ttf', 'Arimo_400Regular_Italic.ttf', 'Arimo_700Bold_Italic.ttf'],
  Tinos: ['Tinos_400Regular.ttf', 'Tinos_700Bold.ttf', 'Tinos_400Regular_Italic.ttf', 'Tinos_700Bold_Italic.ttf'],
  Cousine: ['Cousine_400Regular.ttf', 'Cousine_700Bold.ttf', 'Cousine_400Regular_Italic.ttf', 'Cousine_700Bold_Italic.ttf'],
};

/**
 * fontkit sin las tablas de mapas de bits/color: fuentes como Calibri o Courier New de Windows traen tablas CBDT/EBDT y
 * fontkit las trata como glifos de imagen, lo que rompe la creación de subconjuntos al incrustarlas.
 */
export const fontkitSafe = {
  ...fontkit,
  create(bytes, ...rest) {
    const f = fontkit.create(bytes, ...rest);
    const fonts = f.fonts || [f];
    for (const x of fonts) for (const t of ['CBDT', 'CBLC', 'EBDT', 'EBLC', 'sbix']) if (x.directory && x.directory.tables) delete x.directory.tables[t];
    return f;
  },
};

// ---------------------------------------------------------------- carga / guardado
export async function loadDoc(bytes, password) {
  return PDFDocument.load(bytes, { password: password || undefined, updateMetadata: false });
}
export async function saveDoc(doc, { objectStreams = true } = {}) {
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: objectStreams });
}
export async function pageCount(bytes, password) {
  return (await loadDoc(bytes, password)).getPageCount();
}
export function isEncryptedError(e) {
  return /encrypt|password/i.test(String(e && e.message));
}
/** Devuelve una copia sin cifrar del PDF (requiere la contraseña si la tiene). */
export async function decrypt(bytes, password, info) {
  const doc = await loadDoc(bytes, password);
  // Al cargar con contraseña la librería conserva el diccionario Encrypt, los flujos ObjStm ya expandidos y el
  // flujo XRef antiguo (que menciona /Encrypt): hay que quitarlos o el archivo guardado sigue pareciendo cifrado.
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj && obj.dict instanceof PDFDict ? obj.dict : null;
    const type = dict && dict.get(PDFName.of('Type'));
    const isEncryptDict = dict && dict.has(PDFName.of('O')) && dict.has(PDFName.of('U')) && dict.get(PDFName.of('Filter')) === PDFName.of('Standard');
    if (obj instanceof PDFInvalidObject || type === PDFName.of('ObjStm') || type === PDFName.of('XRef') || isEncryptDict) ctx.delete(ref);
  }
  delete ctx.trailerInfo.Encrypt;
  // La librería no descifra bien las cadenas del diccionario Info (metadatos): se restauran desde la lectura de pdf.js.
  const tryDo = (fn) => { try { fn(); } catch { /* metadato opcional */ } };
  if (info) {
    tryDo(() => doc.setTitle(info.Title || ''));
    tryDo(() => doc.setAuthor(info.Author || ''));
    tryDo(() => doc.setSubject(info.Subject || ''));
    tryDo(() => doc.setKeywords(info.Keywords ? [info.Keywords] : []));
    tryDo(() => doc.setCreator(info.Creator || ''));
  }
  return saveDoc(doc, { objectStreams: false });
}
export async function encrypt(bytes, { userPassword, ownerPassword, permissions, algorithm = 'AES-256' }) {
  const doc = await loadDoc(bytes);
  doc.setProducer(PRODUCER);
  doc.encrypt({ userPassword: userPassword || '', ownerPassword: ownerPassword || userPassword, permissions, algorithm });
  // Con flujos de objetos los metadatos (Info) se cifran correctamente; sin ellos la librería los corrompe.
  return doc.save({ useObjectStreams: true });
}

// ---------------------------------------------------------------- geometría (vista -> espacio de usuario)
export function pageBox(page) {
  const b = page.getCropBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height, rot: ((page.getRotation().angle % 360) + 360) % 360 };
}
/** Tamaño de la página tal como se ve (con rotación aplicada). */
export function viewSize(box) {
  return box.rot === 90 || box.rot === 270 ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
}
/** Punto de la vista (origen arriba-izquierda, y hacia abajo) -> espacio de usuario PDF. */
export function toUser(box, vx, vy) {
  const { x, y, w, h, rot } = box;
  switch (rot) {
    case 90: return { x: x + vy, y: y + vx };
    case 180: return { x: x + w - vx, y: y + vy };
    case 270: return { x: x + w - vy, y: y + h - vx };
    default: return { x: x + vx, y: y + h - vy };
  }
}

// ---------------------------------------------------------------- fuentes
const STD = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
export const STANDARD_FAMILIES = Object.keys(STD);

/** ctx: { loadFont(file) => Promise<Uint8Array>, systemFonts: {familia: [regular,bold,italic,boldItalic]} } */
export async function getFont(doc, ctx, family, bold = false, italic = false) {
  if (!doc.__fonts) doc.__fonts = new Map();
  const key = `${family}|${bold}|${italic}`;
  if (doc.__fonts.has(key)) return doc.__fonts.get(key);
  const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
  // orden de la tabla: [regular, bold, italic, boldItalic]
  const tableIdx = bold && italic ? 3 : bold ? 1 : italic ? 2 : 0;
  let font;
  if (STD[family]) {
    const names = STD[family];
    font = await doc.embedFont(StandardFonts[names[tableIdx]]);
  } else if (BUNDLED_FILES[family] && ctx && ctx.loadBundled) {
    doc.registerFontkit(fontkitSafe);
    font = await doc.embedFont(await ctx.loadBundled(BUNDLED_FILES[family][tableIdx]), { subset: true });
  } else if (ctx && ctx.systemFonts && ctx.systemFonts[family] && ctx.loadFont) {
    doc.registerFontkit(fontkitSafe);
    const files = ctx.systemFonts[family];
    const bytes = await ctx.loadFont(files[tableIdx] || files[0]);
    font = await doc.embedFont(bytes, { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts[STD.Helvetica[tableIdx]]);
  }
  void idx;
  doc.__fonts.set(key, font);
  return font;
}
/** Sustituye por "?" los caracteres que la fuente estándar no puede codificar. */
export function safeText(font, text) {
  let set = null;
  try { set = font.getCharacterSet ? new Set(font.getCharacterSet()) : null; } catch { set = null; }
  if (!set || font.name === undefined || !/^(Helvetica|Times|Courier|Symbol|ZapfDingbats)/.test(font.name)) return text;
  let out = '';
  for (const ch of text) out += set.has(ch.codePointAt(0)) || ch === '\n' ? ch : '?';
  return out;
}

// ---------------------------------------------------------------- dibujo en coordenadas de vista
export function drawLineText(page, box, font, text, vx, vyBase, size, { color = [0, 0, 0], opacity = 1, angle = 0 } = {}) {
  const P = toUser(box, vx, vyBase);
  page.drawText(safeText(font, text), {
    x: P.x, y: P.y, size, font, color: rgb(...color), opacity, rotate: degrees(angle + box.rot),
  });
}
export function drawTextBlock(page, box, font, text, vx, vyTop, size, opts = {}) {
  const lines = String(text).split('\n');
  lines.forEach((ln, i) => {
    if (ln === '') return;
    drawLineText(page, box, font, ln, vx, vyTop + size * 0.95 + i * size * 1.2, size, opts);
  });
}
export function drawRect(page, box, vx, vy, w, h, { fill, stroke, strokeWidth = 1, opacity = 1, strokeOpacity, blend } = {}) {
  const A = toUser(box, vx, vy);
  const B = toUser(box, vx + w, vy + h);
  page.drawRectangle({
    x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), width: Math.abs(B.x - A.x), height: Math.abs(B.y - A.y),
    color: fill ? rgb(...fill) : undefined, borderColor: stroke ? rgb(...stroke) : undefined, borderWidth: stroke ? strokeWidth : 0,
    opacity: fill ? opacity : undefined, borderOpacity: stroke ? (strokeOpacity ?? 1) : undefined, blendMode: blend,
  });
}
export function drawEllipse(page, box, vx, vy, w, h, { fill, stroke, strokeWidth = 1, opacity = 1 } = {}) {
  const C = toUser(box, vx + w / 2, vy + h / 2);
  const swap = box.rot === 90 || box.rot === 270;
  page.drawEllipse({
    x: C.x, y: C.y, xScale: (swap ? h : w) / 2, yScale: (swap ? w : h) / 2,
    color: fill ? rgb(...fill) : undefined, borderColor: stroke ? rgb(...stroke) : undefined, borderWidth: stroke ? strokeWidth : 0,
    opacity: fill ? opacity : undefined, borderOpacity: stroke ? 1 : undefined,
  });
}
export function drawSeg(page, box, x1, y1, x2, y2, { color = [0, 0, 0], width = 1, opacity = 1 } = {}) {
  const A = toUser(box, x1, y1);
  const B = toUser(box, x2, y2);
  page.drawLine({ start: A, end: B, thickness: width, color: rgb(...color), opacity, lineCap: LineCapStyle.Round });
}
export function drawImageView(page, box, img, vx, vy, w, h, opacity = 1) {
  const P = toUser(box, vx, vy + h);
  page.drawImage(img, { x: P.x, y: P.y, width: w, height: h, rotate: degrees(box.rot), opacity });
}
async function embedImage(doc, bytes, mime) {
  return /jpe?g/i.test(mime) ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

// ---------------------------------------------------------------- páginas
export async function rotatePages(bytes, idxs, delta) {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  for (const i of idxs) {
    const p = pages[i];
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return saveDoc(doc);
}
export async function deletePages(bytes, idxs) {
  const doc = await loadDoc(bytes);
  if (idxs.length >= doc.getPageCount()) throw new Error('No puedes eliminar todas las páginas del documento.');
  [...idxs].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return saveDoc(doc);
}
export async function extractPages(bytes, idxs) {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  copyInfo(src, out);
  const copied = await out.copyPages(src, idxs);
  copied.forEach((p) => out.addPage(p));
  return saveDoc(out);
}
function copyInfo(src, out) {
  const tryDo = (fn) => { try { fn(); } catch { /* metadato opcional o mal formado */ } };
  tryDo(() => { const t = src.getTitle(); if (t) out.setTitle(t); });
  tryDo(() => { const a = src.getAuthor(); if (a) out.setAuthor(a); });
  tryDo(() => { const s = src.getSubject(); if (s) out.setSubject(s); });
  tryDo(() => { const k = src.getKeywords(); if (k) out.setKeywords([k]); });
}
/** Reordena/duplica páginas: `order` es la lista de índices originales en el orden final. */
export async function reorderPages(bytes, order) {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  copyInfo(src, out);
  const copied = await out.copyPages(src, order);
  copied.forEach((p) => out.addPage(p));
  return saveDoc(out);
}
export async function insertBlank(bytes, afterIdx, count = 1, size) {
  const doc = await loadDoc(bytes);
  const ref = doc.getPage(Math.max(0, Math.min(afterIdx < 0 ? 0 : afterIdx, doc.getPageCount() - 1)));
  const v = viewSize(pageBox(ref));
  const [w, h] = size || [v.w, v.h];
  for (let i = 0; i < count; i++) doc.insertPage(afterIdx + 1 + i, [w, h]);
  return saveDoc(doc);
}
export async function insertFrom(bytes, otherBytes, afterIdx, otherIdxs, otherPassword) {
  const doc = await loadDoc(bytes);
  const other = await loadDoc(otherBytes, otherPassword);
  const idxs = otherIdxs || other.getPageIndices();
  const copied = await doc.copyPages(other, idxs);
  copied.forEach((p, i) => doc.insertPage(afterIdx + 1 + i, p));
  return saveDoc(doc);
}
export async function mergeDocs(list) {
  const out = await PDFDocument.create();
  let first = true;
  for (const item of list) {
    const src = await loadDoc(item.bytes, item.password);
    if (first) { copyInfo(src, out); first = false; }
    const idxs = item.pages || src.getPageIndices();
    const copied = await out.copyPages(src, idxs);
    copied.forEach((p) => out.addPage(p));
  }
  return saveDoc(out);
}
/** mode: 'ranges' (value: "1-3,5") | 'every' (value: n) | 'each' | 'parts' (value: n partes iguales) | 'ranges-sep' (cada rango un archivo) */
export async function splitDoc(bytes, { mode, groups }) {
  const src = await loadDoc(bytes);
  const outs = [];
  for (let g = 0; g < groups.length; g++) {
    const out = await PDFDocument.create();
    copyInfo(src, out);
    const copied = await out.copyPages(src, groups[g]);
    copied.forEach((p) => out.addPage(p));
    outs.push({ label: groups[g].length === 1 ? `p${groups[g][0] + 1}` : `p${groups[g][0] + 1}-${groups[g][groups[g].length - 1] + 1}`, bytes: await saveDoc(out) });
  }
  void mode;
  return outs;
}
export function groupsEvery(total, n) {
  const g = [];
  for (let i = 0; i < total; i += n) g.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return g;
}
export async function cropPages(bytes, idxs, { top = 0, right = 0, bottom = 0, left = 0 }) {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  for (const i of idxs) {
    const p = pages[i];
    const box = pageBox(p);
    const v = viewSize(box);
    const A = toUser(box, left, top);
    const B = toUser(box, v.w - right, v.h - bottom);
    const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
    const w = Math.abs(B.x - A.x), h = Math.abs(B.y - A.y);
    if (w < 10 || h < 10) throw new Error('Los márgenes de recorte son demasiado grandes.');
    p.setCropBox(x, y, w, h);
  }
  return saveDoc(doc);
}
/** items: [{index, bytes, mime, w, h}] -> reemplaza cada página por una imagen (w/h en puntos). Elimina el texto/vectores originales. */
export async function replacePagesWithImages(bytes, items) {
  const doc = await loadDoc(bytes);
  for (const it of items) {
    const img = await embedImage(doc, it.bytes, it.mime);
    const np = doc.insertPage(it.index, [it.w, it.h]);
    np.drawImage(img, { x: 0, y: 0, width: it.w, height: it.h });
    doc.removePage(it.index + 1);
  }
  return saveDoc(doc, { objectStreams: true });
}

// ---------------------------------------------------------------- numeración, encabezados, marcas de agua
const fill = (tpl, n, total, extra = {}) =>
  String(tpl)
    .replace(/\{n\}/g, n).replace(/\{total\}/g, total)
    .replace(/\{fecha\}/g, extra.date || new Date().toLocaleDateString('es-CL'))
    .replace(/\{archivo\}/g, extra.file || '');

/** zones: {left, center, right, y: 'top'|'bottom'} */
export async function addHeaderFooter(bytes, ctx, { idxs, left = '', center = '', right = '', where = 'bottom', margin = 28, size = 10, family = 'Helvetica', color = [0.25, 0.25, 0.25], startAt = 1, file = '' }) {
  const doc = await loadDoc(bytes);
  const font = await getFont(doc, ctx, family);
  const pages = doc.getPages();
  const total = pages.length;
  const list = idxs || pages.map((_, i) => i);
  list.forEach((i, k) => {
    const page = pages[i];
    const box = pageBox(page);
    const v = viewSize(box);
    const n = startAt + k;
    const baseY = where === 'top' ? margin + size * 0.8 : v.h - margin;
    const put = (tpl, align) => {
      if (!tpl) return;
      const t = safeText(font, fill(tpl, n, total + startAt - 1, { file }));
      const tw = font.widthOfTextAtSize(t, size);
      const x = align === 'left' ? margin : align === 'right' ? v.w - margin - tw : (v.w - tw) / 2;
      drawLineText(page, box, font, t, x, baseY, size, { color });
    };
    put(left, 'left'); put(center, 'center'); put(right, 'right');
  });
  return saveDoc(doc);
}

export async function addWatermarkText(bytes, ctx, { idxs, text, size = 72, color = [0.8, 0.1, 0.1], opacity = 0.25, angle = 45, family = 'Helvetica', bold = true }) {
  const doc = await loadDoc(bytes);
  const font = await getFont(doc, ctx, family, bold);
  const pages = doc.getPages();
  const list = idxs || pages.map((_, i) => i);
  const t = safeText(font, text);
  const tw = font.widthOfTextAtSize(t, size);
  for (const i of list) {
    const page = pages[i];
    const box = pageBox(page);
    const v = viewSize(box);
    const th = (angle * Math.PI) / 180;
    // inicio de la línea base para que el texto quede centrado en la página (y de vista hacia abajo)
    const cx = v.w / 2, cy = v.h / 2;
    const bx = cx - (tw / 2) * Math.cos(th) - (size * 0.35) * Math.sin(th);
    const by = cy + (tw / 2) * Math.sin(th) - (size * 0.35) * Math.cos(th);
    drawLineText(page, box, font, t, bx, by, size, { color, opacity, angle });
  }
  return saveDoc(doc);
}
export async function addWatermarkImage(bytes, { idxs, image, mime, scale = 0.5, opacity = 0.3 }) {
  const doc = await loadDoc(bytes);
  const img = await embedImage(doc, image, mime);
  const pages = doc.getPages();
  for (const i of idxs || pages.map((_, k) => k)) {
    const page = pages[i];
    const box = pageBox(page);
    const v = viewSize(box);
    const w = v.w * scale;
    const h = (img.height / img.width) * w;
    drawImageView(page, box, img, (v.w - w) / 2, (v.h - h) / 2, w, h, opacity);
  }
  return saveDoc(doc);
}

// ---------------------------------------------------------------- metadatos
export async function getMetadata(bytes, password) {
  const doc = await loadDoc(bytes, password);
  // algunos PDFs traen fechas o textos mal formados: cada campo se lee de forma independiente
  const safe = (fn) => { try { const v = fn(); return v instanceof Date ? v.toISOString() : v || ''; } catch { return ''; } };
  return {
    title: safe(() => doc.getTitle()), author: safe(() => doc.getAuthor()), subject: safe(() => doc.getSubject()), keywords: safe(() => doc.getKeywords()),
    creator: safe(() => doc.getCreator()), producer: safe(() => doc.getProducer()), created: safe(() => doc.getCreationDate()), modified: safe(() => doc.getModificationDate()),
    pages: doc.getPageCount(), encrypted: doc.isEncrypted,
  };
}
export async function setMetadata(bytes, m, { clear = false } = {}) {
  const doc = await loadDoc(bytes);
  if (clear) {
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer('');
    try { doc.catalog.delete(PDFName.of('Metadata')); } catch { /* sin XMP */ }
    return doc.save({ useObjectStreams: true });
  }
  doc.setTitle(m.title || ''); doc.setAuthor(m.author || ''); doc.setSubject(m.subject || '');
  doc.setKeywords(m.keywords ? m.keywords.split(/\s*[,;]\s*/) : []); doc.setCreator(m.creator || '');
  return saveDoc(doc);
}

// ---------------------------------------------------------------- formularios
export async function getFormFields(bytes) {
  const doc = await loadDoc(bytes);
  const form = doc.getForm();
  const out = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) out.push({ name, type: 'text', value: f.getText() || '', multiline: f.isMultiline(), readOnly: f.isReadOnly() });
    else if (f instanceof PDFCheckBox) out.push({ name, type: 'check', value: f.isChecked(), readOnly: f.isReadOnly() });
    else if (f instanceof PDFDropdown) out.push({ name, type: 'select', options: f.getOptions(), value: f.getSelected()[0] || '', readOnly: f.isReadOnly() });
    else if (f instanceof PDFOptionList) out.push({ name, type: 'select', options: f.getOptions(), value: f.getSelected()[0] || '', readOnly: f.isReadOnly() });
    else if (f instanceof PDFRadioGroup) out.push({ name, type: 'select', options: f.getOptions(), value: f.getSelected() || '', readOnly: f.isReadOnly() });
    else if (f instanceof PDFButton) continue;
    else if (f instanceof PDFSignature) continue;
  }
  return out;
}
export async function fillFormFields(bytes, values, { flatten = false } = {}) {
  const doc = await loadDoc(bytes);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, val] of Object.entries(values)) {
    let f;
    try { f = form.getField(name); } catch { continue; }
    if (f instanceof PDFTextField) f.setText(String(val ?? ''));
    else if (f instanceof PDFCheckBox) val ? f.check() : f.uncheck();
    else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (val) f.select(String(val)); }
    else if (f instanceof PDFRadioGroup) { if (val) f.select(String(val)); }
  }
  form.updateFieldAppearances(font);
  if (flatten) form.flatten();
  return saveDoc(doc);
}
export async function flattenForm(bytes) {
  const doc = await loadDoc(bytes);
  const form = doc.getForm();
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  form.flatten();
  return saveDoc(doc);
}

// ---------------------------------------------------------------- imágenes -> PDF
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
/** images: [{bytes, mime}] mime: image/jpeg | image/png */
export async function imagesToPdf(images, { size = 'fit', margin = 0, orientation = 'auto' } = {}) {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = await embedImage(doc, im.bytes, im.mime);
    let iw = img.width, ih = img.height;
    if (size === 'fit') {
      // 1 px = 0.75 pt (96 dpi); limita el lado largo a 1700 pt
      const k = Math.min(0.75, 1700 / Math.max(iw, ih));
      const w = iw * k, h = ih * k;
      const p = doc.addPage([w + margin * 2, h + margin * 2]);
      p.drawImage(img, { x: margin, y: margin, width: w, height: h });
    } else {
      let [pw, ph] = PAGE_SIZES[size] || PAGE_SIZES.a4;
      const landscape = orientation === 'landscape' || (orientation === 'auto' && iw > ih);
      if (landscape) [pw, ph] = [ph, pw];
      const p = doc.addPage([pw, ph]);
      const bw = pw - margin * 2, bh = ph - margin * 2;
      const k = Math.min(bw / iw, bh / ih);
      const w = iw * k, h = ih * k;
      p.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return saveDoc(doc);
}

// ---------------------------------------------------------------- compresión
/**
 * level: 'low' | 'medium' | 'high'. deps.recompressJpeg(bytes, {quality, scale}) => Promise<{bytes,width,height}|null>
 */
export async function compressPdf(bytes, level, deps, onProgress) {
  const cfg = { low: { quality: 0.85, scale: 1, rebuild: false }, medium: { quality: 0.7, scale: 0.75, rebuild: true }, high: { quality: 0.5, scale: 0.5, rebuild: true } }[level] || { quality: 0.7, scale: 0.75, rebuild: true };
  let doc = await loadDoc(bytes);
  const ctx = doc.context;
  const entries = ctx.enumerateIndirectObjects();
  let done = 0;
  for (const [ref, obj] of entries) {
    done++;
    if (onProgress && done % 20 === 0) onProgress(done / entries.length);
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const filter = d.get(PDFName.of('Filter'));
    const isDct = filter === PDFName.of('DCTDecode') || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of('DCTDecode'));
    if (!isDct || d.has(PDFName.of('Mask')) || d.has(PDFName.of('Decode'))) continue;
    const cs = d.get(PDFName.of('ColorSpace'));
    if (cs === PDFName.of('DeviceCMYK')) continue;
    if (cs instanceof PDFArray) continue; // ICC / indexed: no tocar
    const orig = obj.getContents();
    if (orig.length < 12000) continue;
    const res = await deps.recompressJpeg(orig, { quality: cfg.quality, scale: cfg.scale });
    if (!res || res.bytes.length >= orig.length * 0.95) continue;
    const nd = PDFDict.withContext(ctx);
    for (const [k, v] of d.entries()) nd.set(k, v);
    nd.set(PDFName.of('Width'), PDFNumber.of(res.width));
    nd.set(PDFName.of('Height'), PDFNumber.of(res.height));
    nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    ctx.assign(ref, PDFRawStream.of(nd, res.bytes));
  }
  let best = await saveDoc(doc, { objectStreams: true });
  if (cfg.rebuild) {
    // Reconstruir copiando solo lo referenciado elimina objetos huérfanos (p. ej. tras borrar páginas)
    try {
      const src = await loadDoc(best);
      const out = await PDFDocument.create();
      copyInfo(src, out);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
      const rebuilt = await saveDoc(out);
      if (rebuilt.length < best.length) best = rebuilt;
    } catch { /* si falla, se conserva la versión sin reconstruir */ }
  }
  return best;
}

// ---------------------------------------------------------------- capas de edición (anotaciones) -> contenido
/**
 * overlays: objetos en coordenadas de vista (puntos). Tipos: text, image, rect, ellipse, line, arrow, ink,
 * highlight, underline, strike, whiteout.  (los 'redact' los gestiona la aplicación)
 */
export async function commitOverlays(bytes, overlays, ctx) {
  const list = overlays.filter((o) => o.type !== 'redact');
  if (!list.length) return bytes;
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  const imgCache = new Map();
  for (const o of list) {
    const page = pages[o.page];
    if (!page) continue;
    const box = pageBox(page);
    const col = o.color || [0, 0, 0];
    switch (o.type) {
      case 'text': {
        const font = await getFont(doc, ctx, o.family || 'Helvetica', !!o.bold, !!o.italic);
        const lines = String(o.text || '').split('\n');
        lines.forEach((ln, i) => {
          if (!ln) return;
          let dx = 0;
          if (o.align && o.align !== 'left') {
            const tw = font.widthOfTextAtSize(safeText(font, ln), o.size);
            const bw = o.w || tw;
            dx = o.align === 'center' ? (bw - tw) / 2 : bw - tw;
          }
          drawLineText(page, box, font, ln, o.x + dx, o.y + o.size * 0.95 + i * o.size * 1.2, o.size, { color: col, opacity: o.opacity ?? 1 });
        });
        if (o.underline) {
          const font2 = font;
          lines.forEach((ln, i) => {
            if (!ln) return;
            const tw = font2.widthOfTextAtSize(safeText(font2, ln), o.size);
            const y = o.y + o.size * 0.95 + i * o.size * 1.2 + o.size * 0.12;
            drawSeg(page, box, o.x, y, o.x + tw, y, { color: col, width: Math.max(0.6, o.size / 16), opacity: o.opacity ?? 1 });
          });
        }
        break;
      }
      case 'image': {
        let img = imgCache.get(o.src);
        if (!img) {
          img = await embedImage(doc, o.bytes, o.mime);
          imgCache.set(o.src, img);
        }
        drawImageView(page, box, img, o.x, o.y, o.w, o.h, o.opacity ?? 1);
        break;
      }
      case 'rect':
        drawRect(page, box, o.x, o.y, o.w, o.h, { fill: o.fill ? hex(o.fill) : null, stroke: o.stroke ? hex(o.stroke) : null, strokeWidth: o.strokeWidth, opacity: o.opacity ?? 1 });
        break;
      case 'ellipse':
        drawEllipse(page, box, o.x, o.y, o.w, o.h, { fill: o.fill ? hex(o.fill) : null, stroke: o.stroke ? hex(o.stroke) : null, strokeWidth: o.strokeWidth, opacity: o.opacity ?? 1 });
        break;
      case 'whiteout':
        drawRect(page, box, o.x, o.y, o.w, o.h, { fill: o.color || [1, 1, 1], opacity: 1 });
        break;
      case 'highlight':
        drawRect(page, box, o.x, o.y, o.w, o.h, { fill: o.color || [1, 0.93, 0.2], opacity: o.opacity ?? 0.45, blend: BlendMode.Multiply });
        break;
      case 'underline':
        drawSeg(page, box, o.x, o.y + o.h - 1, o.x + o.w, o.y + o.h - 1, { color: col, width: 1.1, opacity: 1 });
        break;
      case 'strike':
        drawSeg(page, box, o.x, o.y + o.h * 0.55, o.x + o.w, o.y + o.h * 0.55, { color: col, width: 1.1, opacity: 1 });
        break;
      case 'line':
      case 'arrow': {
        const { x1, y1, x2, y2 } = o;
        const w = o.strokeWidth || 2;
        drawSeg(page, box, x1, y1, x2, y2, { color: col, width: w, opacity: o.opacity ?? 1 });
        if (o.type === 'arrow') {
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const len = Math.max(8, w * 4.5);
          for (const s of [-1, 1]) {
            const a = ang + Math.PI - s * 0.45;
            drawSeg(page, box, x2, y2, x2 + len * Math.cos(a), y2 + len * Math.sin(a), { color: col, width: w, opacity: o.opacity ?? 1 });
          }
        }
        break;
      }
      case 'ink': {
        const pts = o.points || [];
        for (let i = 1; i < pts.length; i++) {
          drawSeg(page, box, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], { color: col, width: o.strokeWidth || 2, opacity: o.opacity ?? 1 });
        }
        if (pts.length === 1) drawSeg(page, box, pts[0][0], pts[0][1], pts[0][0] + 0.1, pts[0][1], { color: col, width: o.strokeWidth || 2 });
        break;
      }
      default:
        break;
    }
  }
  return saveDoc(doc);
}
const hex = (s) => {
  if (Array.isArray(s)) return s;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
};

// ---------------------------------------------------------------- OCR: capa de texto invisible
/** pages: [{index, scale, words:[{text,x0,y0,x1,y1}]}] con coordenadas de píxel de la imagen rasterizada (scale = px por punto). */
export async function addInvisibleText(bytes, pages) {
  const doc = await loadDoc(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  for (const pg of pages) {
    const page = all[pg.index];
    const box = pageBox(page);
    for (const w of pg.words) {
      const text = safeText(font, w.text);
      if (!text.trim()) continue;
      const hPts = (w.y1 - w.y0) / pg.scale;
      const wPts = (w.x1 - w.x0) / pg.scale;
      let size = Math.max(4, hPts * 0.8);
      const tw = font.widthOfTextAtSize(text, size);
      if (tw > 0 && Math.abs(tw - wPts) / wPts > 0.15) size = Math.max(3, Math.min(size * (wPts / tw), hPts * 1.2));
      drawLineText(page, box, font, text, w.x0 / pg.scale, w.y1 / pg.scale - hPts * 0.2, size, { color: [0, 0, 0], opacity: 0 });
    }
  }
  return saveDoc(doc);
}

export { PDFDocument };
