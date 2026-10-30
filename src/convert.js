// Conversiones (PDF -> imágenes/texto/Word/Excel/PowerPoint/HTML), OCR, impresión y utilidades de imagen
import { createWorker } from 'tesseract.js';
import { Document, Packer, Paragraph, TextRun, ImageRun, PageOrientation, FrameAnchorType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, LineRuleType } from 'docx';
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
    const h = Math.hypot(t[2], t[3]) || it.height || 10;
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h, rx: it.transform[4], ry: it.transform[5], rotated: Math.abs(t[1]) > h * 0.02 || Math.abs(t[2]) > h * 0.02 });
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

// ---------------------------------------------------------------- diseño fiel (texto editable en su posición exacta)
const TEXT_OPS = () => new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText]);

/** Dibuja la página sin su texto (fondo: imágenes, líneas, colores); el texto se pone aparte, editable. */
export async function renderPageNoText(pdf, pageNo, scale) {
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const text = TEXT_OPS();
  await page.render({ canvasContext: ctx, viewport: vp, operationsFilter: (i, ol) => !text.has(ol.fnArray[i]) }).promise;
  return { canvas: cv, w: vp.width / scale, h: vp.height / scale };
}

/**
 * Los textos de la página tal como están: cada tramo de una misma línea con su fuente, tamaño y color reales.
 * Devuelve segmentos (una línea, o una columna de una línea) con su posición en puntos, y si la página tiene texto girado.
 */
/** Las líneas de la página con la fuente, tamaño y color reales de cada fragmento (it.st; null si no se pudo leer). */
async function styledRows(doc, pageIdx) {
  const pr = await pageRows(await doc.pdf.getPage(pageIdx + 1));
  const flat = pr.rows.flatMap((r) => r.items);
  let styles = flat.map(() => null);
  if (doc.textStyles) styles = await doc.textStyles(pageIdx, flat.map((it) => ({ x: it.rx, y: it.ry, str: it.str })));
  flat.forEach((it, k) => { it.st = styles[k]; });
  return { ...pr, flat };
}
const styleOf = (it) => ({ size: (it.st && it.st.size) || it.h, family: (it.st && it.st.family) || 'Arial', color: ((it.st && it.st.color) || '#000000').replace('#', ''), bold: !!(it.st && it.st.bold), italic: !!(it.st && it.st.italic) });

export async function faithfulLayout(doc, pageIdx) {
  const { rows, w, h, flat } = await styledRows(doc, pageIdx);
  const rotated = flat.some((it) => it.rotated || (it.st && it.st.upright === false));
  const segs = [];
  for (const r of rows) {
    let cur = null;
    for (const it of r.items) {
      if (!it.str.trim()) continue;
      const st = styleOf(it);
      const size = st.size;
      const gap = cur ? it.x - cur.right : 0;
      if (!cur || gap > Math.max(it.h, cur.h) * 1.3 || gap < -it.h) {
        cur = { x: it.x, y: it.y, h: it.h, size, right: it.x + it.w, runs: [] };
        segs.push(cur);
      } else if (gap > size * 0.12 && !/\s$/.test(cur.runs[cur.runs.length - 1].text) && !/^\s/.test(it.str)) {
        cur.runs[cur.runs.length - 1].text += ' '.repeat(Math.max(1, Math.round(gap / (size * 0.27))));
      }
      cur.runs.push({ text: it.str, ...st });
      cur.right = Math.max(cur.right, it.x + it.w);
      cur.h = Math.max(cur.h, it.h);
      cur.size = Math.max(cur.size, size);
    }
  }
  for (const sg of segs) { const last = sg.runs[sg.runs.length - 1]; last.text = last.text.replace(/\s+$/, ''); }
  return { segs, rotated, w, h };
}

// ---------------------------------------------------------------- Word
// Posición del texto dentro de su marco de Word: distancia entre el borde superior de la línea y la línea base, y alto de línea (múltiplos del tamaño de letra)
export const WORD_BASELINE = 0.97;
export const WORD_LINE = 1.2;

export async function toDocx(doc, idxs, { mode = 'faithful' } = {}, progress) {
  const sections = [];
  let asImage = 0;
  for (let k = 0; k < idxs.length; k++) {
    const proxy = await doc.pdf.getPage(idxs[k] + 1);
    const vp = proxy.getViewport({ scale: 1 });
    const portrait = vp.width <= vp.height;
    const size = { width: Math.round(Math.min(vp.width, vp.height) * 20), height: Math.round(Math.max(vp.width, vp.height) * 20), orientation: portrait ? PageOrientation.PORTRAIT : PageOrientation.LANDSCAPE };
    let children = [];
    let margin = 720;
    let lay = null;
    if (mode === 'faithful') lay = await faithfulLayout(doc, idxs[k]);
    if (mode === 'image' || (lay && (lay.rotated || !lay.segs.length))) {
      if (mode !== 'image') asImage++;
      const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 2);
      const data = await blobToBytes(await canvasToBlob(canvas, 'image/png'));
      margin = 0;
      children = [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: 'png', data, transformation: { width: Math.floor(vp.width * (96 / 72) * 0.985), height: Math.floor(vp.height * (96 / 72) * 0.97) } })] })];
    } else if (mode === 'faithful') {
      // fondo (imágenes, líneas y colores) detrás; cada línea de texto es un marco de Word en su posición exacta, con su fuente, tamaño y color
      const { canvas } = await renderPageNoText(doc.pdf, idxs[k] + 1, 2.5);
      const data = await blobToBytes(await canvasToBlob(canvas, 'image/png'));
      margin = 0;
      const tiny = { size: 2, font: 'Arial' };
      children.push(new Paragraph({
        spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
        children: [new ImageRun({
          type: 'png', data, transformation: { width: Math.round(vp.width * (96 / 72)), height: Math.round(vp.height * (96 / 72)) },
          floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, lockAnchor: true },
        })],
      }));
      for (const sg of lay.segs) {
        const lineH = Math.round(sg.size * WORD_LINE * 20);
        children.push(new Paragraph({
          frame: { type: 'absolute', position: { x: Math.round(sg.x * 20), y: Math.max(0, Math.round((sg.y - sg.size * WORD_BASELINE) * 20)) }, anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE } },
          spacing: { before: 0, after: 0, line: lineH, lineRule: LineRuleType.EXACT },
          children: sg.runs.map((r) => new TextRun({ text: r.text, font: r.family, size: Math.max(2, Math.round(r.size * 2)), color: r.color, bold: r.bold, italics: r.italic })),
        }));
      }
      children.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', ...tiny })] }));
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
    sections.push({ properties: { page: { size, margin: { top: margin, bottom: margin, left: margin, right: margin, header: 0, footer: 0 } } }, children });
    progress && progress((k + 1) / idxs.length);
  }
  const d = new Document({ creator: 'PDF Master', title: baseName(doc.name), sections });
  const out = new Uint8Array(await Packer.toArrayBuffer(d));
  if (asImage) out.note = `${asImage} página(s) con texto girado se dejaron como imagen`;
  return out;
}

// ---------------------------------------------------------------- Excel
export async function toXlsx(doc, idxs, { mode = 'faithful' } = {}, progress) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDF Master';
  const faithful = mode === 'faithful';
  for (let k = 0; k < idxs.length; k++) {
    const proxy = await doc.pdf.getPage(idxs[k] + 1);
    const pageW = proxy.getViewport({ scale: 1 }).width;
    const pageH = proxy.getViewport({ scale: 1 }).height;
    const { rows } = faithful ? await styledRows(doc, idxs[k]) : await pageRows(proxy);
    const ws = wb.addWorksheet(`Página ${idxs[k] + 1}`.slice(0, 31));
    // color de fondo de la página dibujada sin texto (así un texto blanco sobre fondo de color sigue viéndose y las tablas conservan su sombreado)
    const bgCtx = faithful ? (await renderPageNoText(doc.pdf, idxs[k] + 1, 1)).canvas.getContext('2d') : null;
    const bgAt = (x, y) => {
      try {
        const d = bgCtx.getImageData(Math.max(0, Math.min(bgCtx.canvas.width - 1, Math.round(x))), Math.max(0, Math.min(bgCtx.canvas.height - 1, Math.round(y))), 1, 1).data;
        return d[0] + d[1] + d[2] > 3 * 245 ? null : [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      } catch { return null; }
    };
    // columnas: agrupa posiciones x de inicio de cada fragmento (en modo fiel, una columna por cada posición distinta para conservar la posición exacta)
    const xs = [];
    rows.forEach((r) => r.items.forEach((it) => xs.push(it.x)));
    xs.sort((a, b) => a - b);
    const cols = [];
    const colIdx = new Map();
    for (const x of xs) {
      const c = cols[cols.length - 1];
      if (!c || (faithful ? x - c.min > 4 : x - c.max > 9)) cols.push({ min: x, max: x });
      else c.max = x;
      colIdx.set(x, cols.length - 1);
    }
    const colOf = faithful ? (x) => colIdx.get(x) : (x) => { let best = 0; for (let c = 0; c < cols.length; c++) if (x >= cols[c].min - 9) best = c; return best; };
    let prevY = null;
    rows.forEach((r, ri) => {
      const cells = new Map();
      // une fragmentos que están muy pegados (palabras de una misma celda)
      let prev = null;
      for (const it of r.items) {
        let c = colOf(it.x);
        if (prev && it.x - (prev.x + prev.w) < it.h * 0.9 && cells.has(prev.c)) {
          cells.get(prev.c).v += (it.str.startsWith(' ') ? '' : ' ') + it.str;
          c = prev.c;
        } else if (cells.has(c)) cells.get(c).v += it.str;
        else cells.set(c, { v: it.str, it });
        prev = { x: it.x, w: it.w, c };
      }
      const row = ws.getRow(ri + 1);
      for (const [c, cell] of cells) {
        const xc = row.getCell(c + 1);
        xc.value = parseNum(cell.v.trim());
        if (faithful) {
          const st = styleOf(cell.it);
          xc.font = { name: st.family, size: Math.max(6, Math.round(st.size * 2) / 2), bold: st.bold, italic: st.italic, color: { argb: 'FF' + st.color.toUpperCase() } };
          xc.alignment = { vertical: 'bottom', horizontal: typeof xc.value === 'number' ? 'right' : 'left', wrapText: false };
        }
      }
      if (faithful) {
        // alto de fila = distancia entre líneas base: el espaciado vertical del PDF se conserva
        row.height = Math.min(409, Math.max(6, prevY === null ? r.h * 1.3 : r.y - prevY));
        prevY = r.y;
      }
      row.commit();
    });
    if (faithful) {
      // sombreado: color de fondo de cada celda (también las vacías) tomado de la página sin texto; solo donde el fondo es liso (no fotos ni logos)
      const flat = (x0, x1, y) => {
        const pts = [0.2, 0.5, 0.8].map((f) => bgAt(x0 + (x1 - x0) * f, y));
        const rgb = (c) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
        if (pts.some((c) => !c)) return null;
        const base = rgb(pts[0]);
        return pts.every((c) => rgb(c).every((v, i) => Math.abs(v - base[i]) <= 24)) ? pts[1] : null;
      };
      rows.forEach((r, ri) => {
        let left = null;
        cols.forEach((c, ci) => {
          const span = (ci + 1 < cols.length ? cols[ci + 1].min : pageW - 20) - c.min;
          // las columnas muy angostas (bordes) heredan el color de la anterior
          const bg = span < 8 ? left : flat(c.min, c.min + Math.min(span, 60), r.y - r.h * 0.3);
          left = bg;
          if (bg) ws.getRow(ri + 1).getCell(ci + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
        });
      });
      // ancho de cada columna = lo que ocupaba en la página
      cols.forEach((c, ci) => {
        const span = (ci + 1 < cols.length ? cols[ci + 1].min : pageW - 20) - c.min;
        ws.getColumn(ci + 1).width = Math.min(120, Math.max(0.2, (span * (96 / 72) - 5) / 7));
      });
      ws.views = [{ showGridLines: false }];
      ws.pageSetup = { orientation: pageW > pageH ? 'landscape' : 'portrait', paperSize: Math.abs(pageW - 612) < 20 ? 1 : 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    } else ws.columns.forEach((col) => { col.width = 18; });
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
// Posición del texto dentro de su cuadro en PowerPoint: distancia entre el borde superior y la línea base (múltiplo del tamaño de letra)
export const PPT_BASELINE = 0.94;

export async function toPptx(doc, idxs, { mode = 'faithful' } = {}, progress) {
  const pptx = new PptxGenJS();
  const first = await doc.pdf.getPage(idxs[0] + 1);
  const vp0 = first.getViewport({ scale: 1 });
  const W = vp0.width / 72, H = vp0.height / 72;
  pptx.defineLayout({ name: 'PDFPAGE', width: W, height: H });
  pptx.layout = 'PDFPAGE';
  pptx.title = baseName(doc.name);
  let asImage = 0;
  for (let k = 0; k < idxs.length; k++) {
    const slide = pptx.addSlide();
    const lay = mode === 'faithful' ? await faithfulLayout(doc, idxs[k]) : null;
    if (lay && !lay.rotated && lay.segs.length) {
      // fondo sin texto + un cuadro de texto editable por línea, en su posición exacta
      const { canvas } = await renderPageNoText(doc.pdf, idxs[k] + 1, 2.5);
      slide.addImage({ data: canvas.toDataURL('image/png'), x: 0, y: 0, w: W, h: H });
      for (const sg of lay.segs) {
        slide.addText(sg.runs.map((r) => ({ text: r.text, options: { fontFace: r.family, fontSize: Math.round(r.size * 100) / 100, color: r.color, bold: r.bold, italic: r.italic } })), {
          x: sg.x / 72, y: (sg.y - sg.size * PPT_BASELINE) / 72, w: (sg.right - sg.x) / 72 * 1.12 + 0.2, h: sg.size * 1.25 / 72,
          margin: 0, valign: 'top', align: 'left', wrap: false, fit: 'none', paraSpaceBefore: 0, paraSpaceAfter: 0,
        });
      }
    } else {
      if (lay) asImage++;
      const { canvas } = await renderPage(doc.pdf, idxs[k] + 1, 2);
      slide.addImage({ data: canvas.toDataURL('image/jpeg', 0.9), x: 0, y: 0, w: W, h: H });
    }
    const { rows } = await pageRows(await doc.pdf.getPage(idxs[k] + 1));
    slide.addNotes(rows.map((r) => r.text).join('\n'));
    progress && progress((k + 1) / idxs.length);
  }
  const out = await pptx.write({ outputType: 'uint8array' });
  const res = out instanceof Uint8Array ? out : new Uint8Array(out);
  if (asImage) res.note = `${asImage} diapositiva(s) con texto girado se dejaron como imagen`;
  return res;
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
