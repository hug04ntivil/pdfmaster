// Mide cuánto tarda en aparecer las cajas de texto al activar "Editar texto existente" (debe ser casi instantáneo)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

module.exports = async ({ run, sleep, win }) => {
  const OUT = path.join(process.env.PM_E2E_DIR || path.join(os.tmpdir(), 'pdfmaster-e2e'), 'speed');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = path.join(OUT, 'word.pdf');
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'word-calibri.pdf'), fixture);
  const results = [];
  const check = (n, ok, x = '') => { results.push(ok); console.log((ok ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };
  // milisegundos hasta que aparece la primera caja (se mide dentro de la página)
  const boxesIn = (limit) => run(`new Promise((res)=>{ const t0=performance.now(); const tick=()=>{ if (document.querySelectorAll('.ov-tbox').length>0) return res(Math.round(performance.now()-t0)); if (performance.now()-t0>${limit}) return res(-1); requestAnimationFrame(tick); }; tick(); })`);

  win.setSize(1440, 900);
  await sleep(1000);

  // 1) el visor ya está dibujado: al activar la herramienta las cajas deben salir de inmediato
  await run(`(()=>{ window.__pm.openPaths(${JSON.stringify([fixture])}); return 1; })()`);
  for (let i = 0; i < 60; i++) { if (await run(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0) && document.querySelectorAll('.textLayer span').length>0`)) break; await sleep(200); }
  await run(`window.__pm.OV.setTool('select')`);
  await sleep(300);
  await run(`window.__pm.OV.setTool('edittext')`);
  const t1 = await boxesIn(5000);
  check('cajas de texto al activar la herramienta (página ya dibujada)', t1 >= 0 && t1 < 150, t1 + ' ms');

  // 2) caso más lento: se activa la herramienta justo después de abrir, sin esperar a que se dibuje la página
  const fixture2 = path.join(OUT, 'word2.pdf');
  fs.copyFileSync(fixture, fixture2);
  await run(`window.__pm.OV.setTool('select')`);
  const t2 = await run(`(async()=>{ const old=document.querySelector('.ov-layer'); window.__pm.OV.setTool('edittext'); window.__pm.openPaths(${JSON.stringify([fixture2])}); const t0=performance.now(); return await new Promise((res)=>{ const tick=()=>{ const l=document.querySelector('.ov-layer'); if (l && l!==old && l.querySelector('.ov-tbox')) return res(Math.round(performance.now()-t0)); if (performance.now()-t0>8000) return res(-1); requestAnimationFrame(tick); }; tick(); }); })()`);
  check('cajas de texto sin esperar el dibujo de la página', t2 >= 0 && t2 < 3000, t2 + ' ms');

  // 3) tras aplicar un cambio (se reconstruye el visor) las cajas vuelven enseguida
  await run(`window.__pm.OV.setTool('edittext')`);
  await boxesIn(5000);
  const t3 = await run(`(async()=>{ const d=window.__pm.S.cur; const old=document.querySelector('.ov-layer'); await d.applyBytes(d.bytes.slice(), 'Prueba'); const t0=performance.now(); return await new Promise((res)=>{ const tick=()=>{ const l=document.querySelector('.ov-layer'); if (l && l!==old && l.querySelector('.ov-tbox')) return res(Math.round(performance.now()-t0)); if (performance.now()-t0>8000) return res(-1); requestAnimationFrame(tick); }; tick(); }); })()`);
  check('cajas de texto tras reconstruir el visor', t3 >= 0 && t3 < 3000, t3 + ' ms');

  // 4) página pesada de dibujar (miles de trazos): las cajas no deben esperar al dibujo
  const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const hd = await PDFDocument.create();
  const font = await hd.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const pg = hd.addPage([595, 842]);
    for (let k = 0; k < 14000; k++) pg.drawLine({ start: { x: (k * 7) % 595, y: (k * 13) % 842 }, end: { x: (k * 11) % 595, y: (k * 5) % 842 }, thickness: 0.3, color: rgb(0.7, 0.7, 0.9) });
    for (let k = 0; k < 12; k++) pg.drawText(`Línea de texto número ${k + 1} de la página ${p + 1}`, { x: 50, y: 780 - k * 40, size: 14, font });
  }
  const heavy = path.join(OUT, 'pesado.pdf');
  fs.writeFileSync(heavy, await hd.save());
  await run(`window.__pm.OV.setTool('select')`);
  const t4 = await run(`(async()=>{ const old=document.querySelector('.ov-layer'); window.__pm.OV.setTool('edittext'); window.__pm.openPaths(${JSON.stringify([heavy])}); const t0=performance.now(); return await new Promise((res)=>{ const tick=()=>{ const l=document.querySelector('.ov-layer'); if (l && l!==old && l.querySelector('.ov-tbox')) return res(Math.round(performance.now()-t0)); if (performance.now()-t0>20000) return res(-1); requestAnimationFrame(tick); }; tick(); }); })()`);
  check('cajas de texto en una página pesada de dibujar', t4 >= 0 && t4 < 1500, t4 + ' ms');

  console.log(`\nRESUMEN: ${results.filter(Boolean).length}/${results.length}`);
};
