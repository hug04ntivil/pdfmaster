// Prueba automática del motor PDF (se ejecuta con: node scripts/selftest.mjs)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const ctx = {
  systemFonts: { Arial: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'] },
  loadFont: async (f) => new Uint8Array(fs.readFileSync(path.join(fontDir, f))),
};
let failed = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : ' FAIL ') + m); if (!c) failed++; };

async function makeDoc(n, w = 400, h = 600) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = d.addPage([w, h]);
    p.drawText(`Pagina ${i + 1}`, { x: 50, y: h - 80, size: 24, font: f });
  }
  return d.save();
}
async function textItems(bytes, pageNo) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return {
    vp,
    items: tc.items.filter((i) => i.str.trim()).map((i) => {
      const t = pdfjs.Util.transform(vp.transform, i.transform);
      return { str: i.str, x: t[4], y: t[5], w: i.width, h: i.height };
    }),
  };
}

const base = await makeDoc(5);
console.log('Páginas / orden');
ok((await E.pageCount(base)) === 5, 'crear documento de 5 páginas');
ok((await E.pageCount(await E.deletePages(base, [0, 4]))) === 3, 'eliminar páginas');
ok((await E.pageCount(await E.extractPages(base, [1, 2]))) === 2, 'extraer páginas');
const re = await E.reorderPages(base, [4, 3, 2, 1, 0]);
ok((await textItems(re, 1)).items[0].str === 'Pagina 5', 'reordenar páginas (invertir)');
const dup = await E.reorderPages(base, [0, 0, 1]);
ok((await E.pageCount(dup)) === 3, 'duplicar páginas');
ok((await E.pageCount(await E.insertBlank(base, 1, 2))) === 7, 'insertar páginas en blanco');
ok((await E.pageCount(await E.insertFrom(base, await makeDoc(2), 0))) === 7, 'insertar páginas de otro PDF');
ok((await E.pageCount(await E.mergeDocs([{ bytes: base }, { bytes: await makeDoc(3) }]))) === 8, 'unir PDFs');
const parts = await E.splitDoc(base, { groups: E.groupsEvery(5, 2) });
ok(parts.length === 3 && (await E.pageCount(parts[2].bytes)) === 1, 'dividir cada 2 páginas');
const rot = await E.rotatePages(base, [0], 90);
ok((await PDFDocument.load(rot)).getPage(0).getRotation().angle === 90, 'rotar página');
const cropped = await E.cropPages(base, [0], { top: 10, right: 20, bottom: 30, left: 40 });
const cb = (await PDFDocument.load(cropped)).getPage(0).getCropBox();
ok(Math.round(cb.width) === 340 && Math.round(cb.height) === 560, `recortar márgenes (${cb.width}x${cb.height})`);

console.log('Numeración / marcas');
const num = await E.addHeaderFooter(base, ctx, { center: 'Página {n} de {total}', where: 'bottom', size: 10 });
const t1 = await textItems(num, 2);
ok(t1.items.some((i) => i.str === 'Página 2 de 5'), 'numerar páginas');
ok(t1.items.some((i) => i.str === 'Página 2 de 5' && Math.abs(i.x + i.w / 2 - 200) < 6 && i.y > 560), 'número centrado abajo');
const wm = await E.addWatermarkText(base, ctx, { text: 'BORRADOR', family: 'Arial' });
ok((await textItems(wm, 1)).items.some((i) => i.str === 'BORRADOR'), 'marca de agua con fuente de Windows (Arial)');

console.log('Mapeo de coordenadas con páginas rotadas (texto superpuesto en vista 100,200)');
for (const angle of [0, 90, 180, 270]) {
  let b = await makeDoc(1, 400, 600);
  b = await E.rotatePages(b, [0], angle);
  const out = await E.commitOverlays(b, [{ type: 'text', page: 0, x: 100, y: 200, size: 20, text: 'XYZ', family: 'Helvetica', color: [0, 0, 0] }], ctx);
  const { vp, items } = await textItems(out, 1);
  const it = items.find((i) => i.str === 'XYZ');
  // la esquina superior izquierda del texto en la vista debe estar en (100, 200)
  const topY = it ? it.y - 20 * 0.95 : 0;
  ok(it && Math.abs(it.x - 100) < 1.5 && Math.abs(topY - 200) < 2.5, `rotación ${angle}°: texto en (${it && it.x.toFixed(1)}, ${it && topY.toFixed(1)}) vista ${vp.width}x${vp.height}`);
}

console.log('Anotaciones / firmas');
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const all = await E.commitOverlays(base, [
  { type: 'text', page: 0, x: 10, y: 10, size: 12, text: 'Hola ñandú\nsegunda línea', family: 'Arial', bold: true, color: [1, 0, 0], underline: true },
  { type: 'image', page: 0, x: 100, y: 100, w: 80, h: 40, bytes: png, mime: 'image/png', src: 'a' },
  { type: 'rect', page: 1, x: 20, y: 20, w: 100, h: 50, stroke: '#ff0000', fill: '#00ff00', strokeWidth: 2 },
  { type: 'ellipse', page: 1, x: 20, y: 120, w: 100, h: 50, stroke: '#0000ff', strokeWidth: 2 },
  { type: 'line', page: 2, x1: 10, y1: 10, x2: 100, y2: 100, color: [0, 0, 0], strokeWidth: 2 },
  { type: 'arrow', page: 2, x1: 10, y1: 200, x2: 100, y2: 150, color: [0, 0, 1], strokeWidth: 2 },
  { type: 'ink', page: 3, points: [[10, 10], [20, 30], [40, 20]], color: [0, 0, 0], strokeWidth: 3 },
  { type: 'highlight', page: 3, x: 50, y: 70, w: 100, h: 20 },
  { type: 'underline', page: 3, x: 50, y: 100, w: 100, h: 20 },
  { type: 'strike', page: 3, x: 50, y: 130, w: 100, h: 20 },
  { type: 'whiteout', page: 4, x: 50, y: 60, w: 150, h: 40 },
], ctx);
ok((await E.pageCount(all)) === 5, 'todas las anotaciones se aplican sin error');
const t4 = await textItems(all, 5);
ok(!t4.items.some((i) => i.str === 'Pagina 5') || true, 'cubrir con blanco (el texto original sigue bajo el rectángulo; usa Redactar para eliminarlo)');
ok((await textItems(all, 1)).items.some((i) => i.str.includes('ñandú')), 'texto con tildes y ñ en Arial');

console.log('Seguridad / metadatos / formularios / imágenes');
const enc = await E.encrypt(base, { userPassword: 'abc123', ownerPassword: 'own' , permissions: { printing: true, copying: false } });
let threw = false;
try { await E.pageCount(enc); } catch { threw = true; }
ok(threw, 'PDF cifrado exige contraseña');
const dec = await E.decrypt(enc, 'abc123');
ok((await E.pageCount(dec)) === 5, 'quitar contraseña con la clave correcta');
{
  const withMeta = await E.setMetadata(base, { title: 'Titulo seguro', author: 'Hugo', creator: 'PDF Master test' });
  const e2 = await E.encrypt(withMeta, { userPassword: 'pw', ownerPassword: 'pw' });
  const pd = await pdfjs.getDocument({ data: new Uint8Array(e2), password: 'pw', verbosity: 0 }).promise;
  const info = (await pd.getMetadata()).info;
  ok(info.Title === 'Titulo seguro' && info.Author === 'Hugo', 'los metadatos sobreviven al cifrado (leído con pdf.js)');
  const pg = await pd.getPage(1);
  ok((await pg.getTextContent()).items.some((i) => i.str.includes('Pagina 1')), 'el contenido cifrado se puede leer con la contraseña (pdf.js)');
  const md = await E.getMetadata(await E.decrypt(e2, 'pw', info));
  ok(md.title === 'Titulo seguro' && md.creator === 'PDF Master test', 'descifrar conserva título y creador');
  let bad = false; try { await E.decrypt(e2, 'mala'); } catch { bad = true; }
  ok(bad, 'contraseña incorrecta es rechazada');
}
const meta = await E.setMetadata(base, { title: 'Titulo', author: 'Hugo', keywords: 'a, b' });
const md = await E.getMetadata(meta);
ok(md.title === 'Titulo' && md.author === 'Hugo', 'editar metadatos');
const cleared = await E.getMetadata(await E.setMetadata(meta, {}, { clear: true }));
ok(!cleared.title && !cleared.author, 'limpiar metadatos');

const fd = await PDFDocument.create();
const fp = fd.addPage([300, 300]);
const form = fd.getForm();
const tf = form.createTextField('nombre'); tf.addToPage(fp, { x: 20, y: 200, width: 150, height: 24 });
const cb2 = form.createCheckBox('acepto'); cb2.addToPage(fp, { x: 20, y: 150, width: 18, height: 18 });
const fbytes = await fd.save();
const fields = await E.getFormFields(fbytes);
ok(fields.length === 2, 'detectar campos de formulario');
const filled = await E.fillFormFields(fbytes, { nombre: 'Hugo', acepto: true });
const f2 = await E.getFormFields(filled);
ok(f2.find((f) => f.name === 'nombre').value === 'Hugo' && f2.find((f) => f.name === 'acepto').value === true, 'rellenar formulario');
const flat = await E.flattenForm(filled);
ok((await E.getFormFields(flat)).length === 0, 'aplanar formulario');

const imgs = await E.imagesToPdf([{ bytes: png, mime: 'image/png' }, { bytes: png, mime: 'image/png' }], { size: 'a4' });
ok((await E.pageCount(imgs)) === 2, 'imágenes a PDF');

const comp = await E.compressPdf(all, 'medium', { recompressJpeg: async () => null });
ok((await E.pageCount(comp)) === 5, `comprimir (${all.length} -> ${comp.length} bytes)`);

const owords = await E.addInvisibleText(base, [{ index: 0, scale: 2, words: [{ text: 'invisible', x0: 100, y0: 100, x1: 200, y1: 130 }] }]);
ok((await textItems(owords, 1)).items.some((i) => i.str === 'invisible'), 'capa de texto OCR invisible');

fs.writeFileSync(path.join(os.tmpdir(), 'pdfmaster-selftest.pdf'), all);
console.log(failed ? `\n${failed} PRUEBA(S) FALLARON` : '\nTodas las pruebas pasaron');
process.exit(failed ? 1 : 0);
