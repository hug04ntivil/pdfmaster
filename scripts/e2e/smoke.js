// Prueba E2E básica: arranca la app, abre un PDF de ejemplo, usa herramientas y toma capturas
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

module.exports = async ({ run, shot, sleep, win }) => {
  const out = path.join(os.tmpdir(), 'pdfmaster-e2e');
  fs.mkdirSync(out, { recursive: true });
  const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 4; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Informe de prueba — página ${i + 1}`, { x: 60, y: 770, size: 22, font: fb, color: rgb(0.1, 0.2, 0.5) });
    for (let l = 0; l < 30; l++) p.drawText(`Línea ${l + 1}: PDF Master permite editar, firmar, unir y convertir documentos con facilidad.`, { x: 60, y: 730 - l * 20, size: 11, font: f });
  }
  const file = path.join(out, 'ejemplo.pdf');
  fs.writeFileSync(file, await doc.save());

  win.setSize(1440, 900);
  await sleep(800);
  const waitPaint = async () => { for (let i = 0; i < 60; i++) { if (await run(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`)) return; await sleep(200); } };
  const t0 = Date.now();
  await run(`window.__pm.openPaths(${JSON.stringify([file])})`);
  await waitPaint();
  console.log('first canvas painted after ms:', Date.now() - t0);
  await sleep(500);
  await shot(path.join(out, '02-documento.png'));
  console.log('docs:', await run(`window.__pm.S.docs.length`), 'pages:', await run(`window.__pm.S.cur.numPages`), 'thumbs:', await run(`document.querySelectorAll('.thumb').length`), 'spans:', await run(`document.querySelectorAll('.textLayer span').length`));

  // búsqueda
  await run(`window.__pm.viewer.search('firmar')`);
  await sleep(800);
  console.log('hits:', await run(`window.__pm.viewer.hits.length`), await run(`document.querySelector('#search-hits').textContent`));

  // overlays vía API de la capa
  await run(`(()=>{ const {OV}=window.__pm; OV.setTool('select');
    OV.add({type:'text', page:0, x:80, y:120, text:'Texto añadido', size:18, family:'Helvetica', color:'#c81e3c'});
    OV.add({type:'rect', page:0, x:300, y:100, w:120, h:60, stroke:'#1d4ed8', fill:'#ffe433', strokeWidth:2, opacity:.6});
    OV.add({type:'arrow', page:0, x1:200, y1:300, x2:320, y2:240, color:'#1d4ed8', strokeWidth:3});
    OV.add({type:'highlight', page:0, x:60, y:170, w:240, h:16, color:'#ffe433', opacity:.45});
  })()`);
  await sleep(500);
  await shot(path.join(out, '03-anotaciones.png'));
  console.log('overlays:', await run(`window.__pm.S.cur.overlays.length`), 'dirty:', await run(`window.__pm.S.cur.dirty`));

  // aplicar y comprobar que el texto quedó incrustado en el PDF
  await run(`window.__pm.S.cur.commit()`);
  await sleep(1200);
  const found = await run(`(async()=>{ const d=window.__pm.S.cur; const pg=await d.pdf.getPage(1); const tc=await pg.getTextContent(); return tc.items.some(i=>i.str.includes('Texto añadido')); })()`);
  console.log('texto incrustado en el PDF:', found, '| overlays restantes:', await run(`window.__pm.S.cur.overlays.length`));

  // deshacer
  await run(`window.__pm.S.cur.undo()`);
  await sleep(1200);
  console.log('tras deshacer: overlays =', await run(`window.__pm.S.cur.overlays.length`));
  await shot(path.join(out, '04-deshacer.png'));

  // tema claro
  await run(`document.querySelector('#b-theme').click()`);
  await sleep(600);
  await shot(path.join(out, '05-tema.png'));
};
