// Conversiones (PDF -> imágenes/texto/Word/Excel/PowerPoint/HTML), OCR, impresión y utilidades de imagen
import { createWorker } from 'tesseract.js';
import { Document, Packer, Paragraph, TextRun, ImageRun, PageOrientation } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { pdfjs } from './docs.js';
import * as E from './engine.js';
import { canvasToBlob, blobToBytes, baseName } from './util.js';

// ---------------------------------------------------------------- render
export async function renderPage(pdf, pageNo, scale, { background = '#fff' } = {}) {
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = background; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: cv, w: vp.width / scale, h: vp.height / scale };
}

export async function pagesToImages(doc, idxs, { dpi = 150, format = 'png', quality = 0.92 }, progress) {
  const out = [];
  const base = baseName(doc.name);
  for (let k = 0; k < idxs.length; k++) {
    const i = idxs[k];
    const { canvas } = await renderPage(doc.pdf, i + 1, dpi / 72);
    const blob = await canvasToBlob(canvas, format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
    out.push({ name: `${base}_p${String(i + 1).padStart(String(doc.numPages).length, '0')}.${format === 'jpg' ? 'jpg' : 'png'}`, data: await blobToBytes(blob) });
    progress && progress((k + 1) / idxs.length);
  }
  return out;
}

// ---------------------------------------------------------------- extracción de texto por líneas
export async function pageRows(proxy) {
  const vp = proxy.getViewport({ scale: 1 });
  const tc = await proxy.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform);
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) || it.height || 10 });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= Math.max(2, Math.min(it.h, last.h) * 0.5)) {
      last.items.push(it);
      last.h = Math.max(last.h, it.h);
    } else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = joinItems(r.items);
    r.x = r.items[0].x;
    const lastIt = r.items[r.items.length - 1];
    r.right = lastIt.x + lastIt.w;
  }
  return { rows: rows.filter((r) => r.text.trim()), w: vp.width, h: vp.height };
}
function joinItems(items) {
  let s = '';
  let prev = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > it.h * 0.15 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += gap > it.h * 2.5 ? '   ' : ' ';
    }
    s += it.str;
    prev = it;
  }
  return s.trim();
}
/** Agrupa líneas en párrafos con una heurística simple (mismo interlineado y línea anterior "llena"). */
function toParagraphs(rows, pageW) {
  const maxRight = Math.max(...rows.map((r) => r.right), 1);
  const minX = Math.min(...rows.map((r) => r.x), pageW);
  const paras = [];
  for (const r of rows) {
    const p = paras[paras.length - 1];
    const prevRow = p && p.last;
    const bullet = /^([•\-–*·]|\d+[.)])\s/.test(r.text);
    if (p && !bullet && Math.abs(r.h - prevRow.h) < 1.2 && r.y - prevRow.y <= prevRow.h * 1.7 && prevRow.right > maxRight * 0.88 && Math.abs(r.x - prevRow.x) < 12) {
      p.text += (p.text.endsWith('-') ? '' : ' ') + r.text;
      p.last = r;
    } else paras.push({ text: r.text, h: r.h, x: r.x - minX, y: r.y, last: r });
  }
  return paras;
}

export async function toText(doc, idxs, progress) {
  const parts = [];
  for (let k = 0; k < idxs.length; k++) {
    const { rows } = await pageRows(await doc.pdf.getPage(idxs[k] + 1));
    parts.push(`--- Página ${idxs[k] + 1} ---\n` + rows.map((r) => r.text).join('\n'));
    progress && progress((k + 1) / idxs.length);
  }
  return new TextEncoder().encode(parts.join('\n\n') + '\n');
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function toHtml(doc, idxs, { images = false }, progress) {
  const sections = [];
  for (let k = 0; k < idxs.length; k++) {
    const proxy = await doc.pdf.getPage(idxs[k] + 1);
    const { rows, w } = await pageRows(proxy);
    const paras = toParagraphs(rows, w);
    const med = median(rows.map((r) => r.h)) || 11;
    let html = paras.map((p) => (p.h > med * 1.3 ? `<h2>${esc(p.text)}</h2>` : `<p>${esc(p.text)}</p>`)).join('\n');
    if (images) {
      const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 1.5);
      html = `<img src="${canvas.toDataURL('image/jpeg', 0.85)}" alt="Página ${idxs[k] + 1}" style="max-width:100%">` + html;
    }
    sections.push(`<section class="page"><h6>Página ${idxs[k] + 1}</h6>\n${html}</section>`);
    progress && progress((k + 1) / idxs.length);
  }
  const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(baseName(doc.name))}</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#222}section.page{border-bottom:1px solid #ddd;padding:1rem 0}h6{color:#999;margin:0 0 .5rem}</style></head><body>\n${sections.join('\n')}\n</body></html>`;
  return new TextEncoder().encode(page);
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ---------------------------------------------------------------- Word
export async function toDocx(doc, idxs, { mode = 'text' }, progress) {
  const sections = [];
  for (let k = 0; k < idxs.length; k++) {
    const proxy = await doc.pdf.getPage(idxs[k] + 1);
    const vp = proxy.getViewport({ scale: 1 });
    const portrait = vp.width <= vp.height;
    const size = { width: Math.round(Math.min(vp.width, vp.height) * 20), height: Math.round(Math.max(vp.width, vp.height) * 20), orientation: portrait ? PageOrientation.PORTRAIT : PageOrientation.LANDSCAPE };
    let children = [];
    let margin = 720;
    if (mode === 'image') {
      const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 2);
      const data = await blobToBytes(await canvasToBlob(canvas, 'image/png'));
      margin = 0;
      children = [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: 'png', data, transformation: { width: Math.floor(vp.width * (96 / 72) * 0.985), height: Math.floor(vp.height * (96 / 72) * 0.97) } })] })];
    } else {
      const { rows, w } = await pageRows(proxy);
      const med = median(rows.map((r) => r.h)) || 11;
      const paras = toParagraphs(rows, w);
      children = paras.map((p) => new Paragraph({
        spacing: { after: Math.round(p.h * 8), line: 252 },
        indent: p.x > 14 ? { left: Math.min(Math.round(p.x * 20), 6000) } : undefined,
        children: [new TextRun({ text: p.text, size: Math.max(12, Math.min(96, Math.round(p.h * 2 * 0.98))), bold: p.h > med * 1.25 })],
      }));
      if (!children.length) children = [new Paragraph('')];
    }
    sections.push({ properties: { page: { size, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children });
    progress && progress((k + 1) / idxs.length);
  }
  const d = new Document({ creator: 'PDF Master', title: baseName(doc.name), sections });
  return new Uint8Array(await Packer.toArrayBuffer(d));
}

// ---------------------------------------------------------------- Excel
export async function toXlsx(doc, idxs, progress) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDF Master';
  for (let k = 0; k < idxs.length; k++) {
    const proxy = await doc.pdf.getPage(idxs[k] + 1);
    const { rows } = await pageRows(proxy);
    const ws = wb.addWorksheet(`Página ${idxs[k] + 1}`.slice(0, 31));
    // columnas: agrupa posiciones x de inicio de cada fragmento
    const xs = [];
    rows.forEach((r) => r.items.forEach((it) => xs.push(it.x)));
    xs.sort((a, b) => a - b);
    const cols = [];
    for (const x of xs) {
      const c = cols[cols.length - 1];
      if (!c || x - c.max > 9) cols.push({ min: x, max: x });
      else c.max = x;
    }
    const colOf = (x) => { let best = 0; for (let c = 0; c < cols.length; c++) if (x >= cols[c].min - 9) best = c; return best; };
    rows.forEach((r, ri) => {
      const cells = new Map();
      // une fragmentos que están muy pegados (palabras de una misma celda)
      let prev = null;
      for (const it of r.items) {
        let c = colOf(it.x);
        if (prev && it.x - (prev.x + prev.w) < it.h * 0.9 && cells.has(prev.c)) {
          cells.set(prev.c, cells.get(prev.c) + (it.str.startsWith(' ') ? '' : ' ') + it.str);
          c = prev.c;
        } else cells.set(c, (cells.get(c) || '') + it.str);
        prev = { x: it.x, w: it.w, c };
      }
      const row = ws.getRow(ri + 1);
      for (const [c, v] of cells) row.getCell(c + 1).value = parseNum(v.trim());
      row.commit();
    });
    ws.columns.forEach((col) => { col.width = 18; });
    progress && progress((k + 1) / idxs.length);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
function parseNum(s) {
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16 && !/^0\d/.test(s)) return parseFloat(s);
  return s;
}

// ---------------------------------------------------------------- PowerPoint
export async function toPptx(doc, idxs, progress) {
  const pptx = new PptxGenJS();
  const first = await doc.pdf.getPage(idxs[0] + 1);
  const vp0 = first.getViewport({ scale: 1 });
  const W = vp0.width / 72, H = vp0.height / 72;
  pptx.defineLayout({ name: 'PDFPAGE', width: W, height: H });
  pptx.layout = 'PDFPAGE';
  pptx.title = baseName(doc.name);
  for (let k = 0; k < idxs.length; k++) {
    const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 2);
    const slide = pptx.addSlide();
    slide.addImage({ data: canvas.toDataURL('image/jpeg', 0.9), x: 0, y: 0, w: W, h: H });
    const { rows } = await pageRows(await doc.pdf.getPage(idxs[k] + 1));
    slide.addNotes(rows.map((r) => r.text).join('\n'));
    progress && progress((k + 1) / idxs.length);
  }
  const out = await pptx.write({ outputType: 'uint8array' });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// ---------------------------------------------------------------- OCR
export async function runOcr(doc, idxs, { lang = 'spa+eng', dpi = 250 }, progress) {
  const base = new URL('.', document.baseURI).href;
  let done = 0;
  const worker = await createWorker(lang, 1, {
    workerPath: base + 'tesseract/worker.min.js',
    corePath: base + 'tesseract/core',
    langPath: base + 'tessdata',
    workerBlobURL: false,
    gzip: true,
    logger: (m) => { if (m.status === 'recognizing text' && progress) progress((done + m.progress) / idxs.length, `Reconociendo texto — página ${done + 1} de ${idxs.length}`); },
  });
  const pages = [];
  try {
    for (const i of idxs) {
      const scale = dpi / 72;
      const { canvas } = await renderPage(doc.pdf, i + 1, scale);
      const res = await worker.recognize(canvas, {}, { blocks: true });
      const words = [];
      for (const b of res.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
        if (w.text && w.text.trim() && w.confidence > 30) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
      }
      pages.push({ index: i, scale, words });
      done++;
      progress && progress(done / idxs.length, `Reconociendo texto — página ${Math.min(done + 1, idxs.length)} de ${idxs.length}`);
    }
  } finally {
    await worker.terminate();
  }
  return E.addInvisibleText(doc.bytes, pages);
}

// ---------------------------------------------------------------- imprimir
export async function printPages(doc, idxs, progress) {
  const root = document.getElementById('print-root');
  root.innerHTML = '';
  for (let k = 0; k < idxs.length; k++) {
    const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 150 / 72);
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.92);
    root.append(img);
    progress && progress((k + 1) / idxs.length);
  }
  await Promise.all([...root.querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
  window.print();
  setTimeout(() => { root.innerHTML = ''; }, 1500);
}

// ---------------------------------------------------------------- imágenes
function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let p = 2;
  while (p < b.length - 4) {
    if (b[p] !== 0xff) break;
    const m = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78) {
      const t = p + 10;
      const le = b[t] === 0x49;
      const rd16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const rd32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0 : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0);
      const ifd = rd32(4);
      const n = rd16(ifd);
      for (let i = 0; i < n; i++) if (rd16(ifd + 2 + i * 12) === 0x0112) return rd16(ifd + 2 + i * 12 + 8);
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}
/** Normaliza una imagen a JPEG/PNG apto para PDF. */
export async function prepareImage(entry) {
  const ext = entry.name.toLowerCase().split('.').pop();
  const bytes = entry.data;
  if ((ext === 'jpg' || ext === 'jpeg') && jpegOrientation(bytes) === 1) return { bytes, mime: 'image/jpeg' };
  if (ext === 'png') return { bytes, mime: 'image/png' };
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d');
  if (ext === 'jpg' || ext === 'jpeg') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0);
    return { bytes: await blobToBytes(await canvasToBlob(cv, 'image/jpeg', 0.95)), mime: 'image/jpeg' };
  }
  ctx.drawImage(bmp, 0, 0);
  return { bytes: await blobToBytes(await canvasToBlob(cv, 'image/png')), mime: 'image/png' };
}

export async function recompressJpeg(bytes, { quality, scale }) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'none' });
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await cv.convertToBlob({ type: 'image/jpeg', quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
  } catch {
    return null;
  }
}

export function textToHtml(text, { mono = false, size = 11 } = {}) {
  return `<!doctype html><meta charset="utf-8"><style>@page{margin:0}body{font:${size}pt ${mono ? 'Consolas,monospace' : '"Segoe UI",Arial,sans-serif'};white-space:pre-wrap;line-height:1.45;color:#000}</style><body>${esc(text)}</body>`;
}
