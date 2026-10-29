// Pruebas de la edición de texto fiel (se ejecuta con: node scripts/selftest-textedit.mjs [--save carpeta])
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as E from '../src/engine.js';
import * as T from '../src/textedit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saveDir = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : null;
let failed = 0;
const ok = (c, m, x = '') => { console.log((c ? '  OK  ' : ' FAIL ') + m + (x ? ' — ' + x : '')); if (!c) failed++; };

// fuentes del sistema y de respaldo según la plataforma
const mac = process.platform === 'darwin';
const fontDir = mac ? '/System/Library/Fonts/Supplemental' : path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const sysFonts = mac
  ? { Arial: ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Arial Bold Italic.ttf'], 'Times New Roman': ['Times New Roman.ttf', 'Times New Roman Bold.ttf', 'Times New Roman Italic.ttf', 'Times New Roman Bold Italic.ttf'] }
  : { Arial: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'], Calibri: ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf'], 'Times New Roman': ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'], Cambria: ['cambria.ttc', 'cambria.ttc', 'cambria.ttc', 'cambria.ttc'] };
for (const k of Object.keys(sysFonts)) if (!fs.existsSync(path.join(fontDir, sysFonts[k][0])) || /\.ttc$/i.test(sysFonts[k][0])) delete sysFonts[k];
const bundledPath = (file) => {
  const fam = file.split('_')[0].toLowerCase();
  return path.join(root, 'node_modules', '@expo-google-fonts', fam, file.replace(/^[A-Za-z]+_/, '').replace(/\.ttf$/, ''), file);
};

async function pdfjsInfo(bytes, pageNo = 1) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), fontExtraProperties: true, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  await page.getOperatorList();
  const fonts = {};
  for (const n of new Set(tc.items.map((i) => i.fontName))) { try { const f = page.commonObjs.get(n); fonts[f.name] = { widths: f.widths, defaultWidth: f.defaultWidth, loaded: n }; } catch { /* sin datos */ } }
  const loadedToName = {};
  for (const [name, f] of Object.entries(fonts)) loadedToName[f.loaded] = name;
  return { items: tc.items.filter((i) => i.str.length).map((i) => ({ str: i.str, w: i.width, x: i.transform[4], y: i.transform[5], font: loadedToName[i.fontName] || i.fontName })), fonts };
}
const mkctx = (fonts) => ({
  widthOf: (fi, code) => { const f = fonts[fi.baseFull]; const w = f && f.widths && f.widths[code]; return typeof w === 'number' ? w : (f && f.defaultWidth) || 500; },
  systemFonts: sysFonts,
  loadFont: async (f) => new Uint8Array(fs.readFileSync(path.join(fontDir, f))),
  loadBundled: async (f) => new Uint8Array(fs.readFileSync(bundledPath(f))),
});
async function edit(bytes, str, newText, pageIndex = 0) {
  const info = await pdfjsInfo(bytes, pageIndex + 1);
  const item = info.items.find((i) => i.str.trim() && i.str.includes(str));
  if (!item) throw new Error('no hay elemento con ' + str);
  const doc = await E.loadDoc(bytes);
  const r = await T.applyTextEdit(doc, pageIndex, { x: item.x, y: item.y, str: item.str, newText: item.str.replace(str, newText) }, mkctx(info.fonts));
  return { r, bytes: r.ok ? await E.saveDoc(doc) : bytes, item };
}

const lineOf = (info, key) => {
  const seed = info.items.find((i) => i.str.trim() && i.str.includes(key));
  if (!seed) return '';
  const row = info.items.filter((i) => Math.abs(i.y - seed.y) < 1.5).sort((a, b) => a.x - b.x);
  return row.map((i) => i.str).join('').replace(/\s+$/, '');
};

console.log('Tokenizador');
{
  const ops = T.parseContent(new TextEncoder().encode('q 1 0 0 1 10 20 cm BT /F1 12 Tf (Hola \\(mundo\\)) Tj [(A) -20 <0042>] TJ ET Q % comentario\nBI /W 1 ID xx EI 0 g'));
  ok(ops.map((o) => o.op).join(' ') === 'q cm BT Tf Tj TJ ET Q BI g', 'operaciones reconocidas', ops.map((o) => o.op).join(' '));
  const tj = ops.find((o) => o.op === 'Tj');
  ok(new TextDecoder().decode(tj.args[0].bytes) === 'Hola (mundo)', 'cadenas con paréntesis y escapes');
  const tJ = ops.find((o) => o.op === 'TJ');
  ok(tJ.args[0].items.length === 3 && tJ.args[0].items[2].bytes[1] === 0x42, 'arreglos TJ con números y hexadecimales');
}

console.log('Word (Calibri, Times, Arial, Cambria, Courier — fuentes incrustadas en subconjunto)');
const word = new Uint8Array(fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'word-calibri.pdf')));
const before = await pdfjsInfo(word);
{
  const { r, bytes, item } = await edit(word, 'Monto total', 'Monto neto');
  ok(r.ok && !r.usedFallback, 'cambio con letras que ya existen: conserva la fuente original', JSON.stringify(r));
  const after = await pdfjsInfo(bytes);
  const line = after.items.find((i) => i.str.includes('Monto neto'));
  ok(!!line, 'el texto nuevo aparece al extraer el PDF', line && line.str);
  ok(line && line.font === item.font, 'misma fuente incrustada que antes', `${item.font} → ${line && line.font}`);
  const same = before.items.filter((i) => !i.str.includes('Monto')).every((i) => after.items.some((a) => a.str === i.str && a.font === i.font));
  ok(same, 'el resto de las líneas queda intacto (mismo texto y fuente)');
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-1.pdf'), bytes);
}
{
  const { r, bytes, item } = await edit(word, '1.250.000', '1.299.000');
  ok(r.ok, 'cambio de cifras con dígitos ausentes del subconjunto (9)', JSON.stringify(r));
  const after = await pdfjsInfo(bytes);
  const line = lineOf(after, 'Monto');
  ok(line.includes('$1.299.000 más IVA'), 'las cifras nuevas se leen bien', line);
  ok(r.usedFallback === 'Calibri' || r.usedFallback === 'Carlito', 'usa Calibri instalada o Carlito (equivalente) solo para el dígito faltante', r.usedFallback);
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-2.pdf'), bytes);
  void item;
}
{
  const { r, bytes } = await edit(word, 'Av. Providencia 1234', 'Av. Apoquindo 5678');
  ok(r.ok, 'cambio de dirección en Arial (letras ausentes)', JSON.stringify(r));
  const after = await pdfjsInfo(bytes);
  ok(lineOf(after, 'Dirección').includes('Av. Apoquindo 5678, Santiago, Chile.'), 'texto nuevo presente', lineOf(after, 'Dirección'));
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-3.pdf'), bytes);
}
{
  const { r, bytes } = await edit(word, 'Total a pagar: 1.487.500', 'Total a pagar: 2.999.123 ñandú');
  ok(r.ok, 'negrita (Calibri-Bold) con caracteres nuevos', JSON.stringify(r));
  const after = await pdfjsInfo(bytes);
  ok(lineOf(after, 'Total a pagar').includes('Total a pagar: 2.999.123 ñandú'), 'texto nuevo presente en negrita', lineOf(after, 'Total a pagar'));
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-4.pdf'), bytes);
}
{
  const { r, bytes } = await edit(word, 'Cotización', 'Cotizaciones');
  ok(r.ok, 'insertar letras al final de una palabra', JSON.stringify(r));
  const after = await pdfjsInfo(bytes);
  ok(lineOf(after, 'Cotiz').includes('Cotizaciones de servicios'), 'inserción correcta', lineOf(after, 'Cotiz'));
}
{
  const { r, bytes } = await edit(word, 'entrega en 15', 'entrega en 7');
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-5.pdf'), bytes);
  const after = await pdfjsInfo(bytes);
  ok(r.ok && /entrega en 7 d.*as h.*biles/.test(lineOf(after, 'Observaciones')), 'eliminar caracteres (Cambria)', lineOf(after, 'Observaciones'));
}
{
  const { r } = await edit(word, 'REF-2026', 'REF-2099');
  ok(r.ok, 'Courier New (monoespaciada)', JSON.stringify(r));
}

console.log('Mover y borrar texto');
{
  const info = await pdfjsInfo(word);
  const item = info.items.find((i) => i.str.includes('Condiciones'));
  const doc = await E.loadDoc(word);
  const r = await T.moveText(doc, 0, { x: item.x, y: item.y, str: item.str, moveX: 30, moveY: -12 }, mkctx(info.fonts));
  const out = await E.saveDoc(doc);
  const after = await pdfjsInfo(out);
  const moved = after.items.find((i) => i.str.includes('Condiciones'));
  ok(r.ok && moved && Math.abs(moved.x - (item.x + 30)) < 0.1 && Math.abs(moved.y - (item.y - 12)) < 0.1, 'mover un texto 30 pt a la derecha y 12 hacia abajo', `${item.x.toFixed(1)},${item.y.toFixed(1)} → ${moved && moved.x.toFixed(1)},${moved && moved.y.toFixed(1)}`);
  ok(moved && moved.font === item.font && moved.str === item.str, 'el texto movido conserva fuente y contenido');
  const rest = info.items.filter((i) => i.str.trim() && !i.str.includes('Condiciones')).every((i) => after.items.some((a) => a.str === i.str && Math.abs(a.x - i.x) < 0.1 && Math.abs(a.y - i.y) < 0.1));
  ok(rest, 'el resto de los textos no se mueve');
  if (saveDir) fs.writeFileSync(path.join(saveDir, 'word-mover.pdf'), out);
}
{
  const { r, bytes } = await edit(word, 'Dirección: Av. Providencia 1234, Santiago, Chile.', '');
  const after = await pdfjsInfo(bytes);
  ok(r.ok && !after.items.some((i) => /Providencia|Dirección/.test(i.str)), 'borrar una línea completa de texto', JSON.stringify(r));
  ok(after.items.some((i) => i.str.includes('Condiciones generales')) && after.items.some((i) => i.str.includes('Total a pagar')), 'las demás líneas siguen en su sitio');
  // editar y mover a la vez (aplicando el lote como lo hace la aplicación)
  const info = await pdfjsInfo(word);
  const item = info.items.find((i) => i.str.includes('Monto total'));
  const doc = await E.loadDoc(word);
  const res = await T.applyTextEdits(doc, [{ page: 0, x: item.x, y: item.y, str: item.str, newText: item.str.replace('total', 'neto'), moveX: 0, moveY: 20 }], async () => mkctx(info.fonts));
  const after2 = await pdfjsInfo(await E.saveDoc(doc));
  const l = after2.items.find((i) => i.str.includes('Monto neto'));
  ok(res[0].ok && l && Math.abs(l.y - (item.y + 20)) < 0.1, 'editar y mover a la vez', JSON.stringify(res[0]) + ' ' + (l ? l.y.toFixed(1) : '-'));
}

console.log('PDF creado con fuentes estándar (Helvetica sin incrustar)');
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  d.addPage([400, 200]).drawText('Factura numero 12345 de la empresa', { x: 30, y: 100, size: 14, font: f });
  const bytes = await d.save();
  const { r, bytes: out } = await edit(bytes, '12345', '98765');
  const after = await pdfjsInfo(out);
  ok(r.ok && !r.usedFallback && lineOf(after, 'Factura').includes('numero 98765 de'), 'fuente estándar: sin respaldo, mismo tipo de letra', lineOf(after, 'Factura'));
  const r2 = await edit(bytes, 'empresa', 'compañía ā');
  const after2 = await pdfjsInfo(r2.bytes);
  ok(r2.r.ok && lineOf(after2, 'Factura').includes('compañía ā'), 'fuente estándar con ñ y símbolo fuera de WinAnsi', lineOf(after2, 'Factura'));
}

console.log(failed ? `\n${failed} PRUEBA(S) FALLARON` : '\nTodas las pruebas de edición fiel pasaron');
process.exit(failed ? 1 : 0);
void os;
