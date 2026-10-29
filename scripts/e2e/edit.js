// E2E de la edición de texto fiel: edita líneas de un PDF real de Word y de uno generado por Chromium
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

module.exports = async ({ run, shot, sleep, win }) => {
  const OUT = path.join(process.env.PM_E2E_DIR || path.join(os.tmpdir(), 'pdfmaster-e2e'), 'edit');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (n, ok, x = '') => { results.push(ok); console.log((ok ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };
  const fixture = path.join(OUT, 'word.pdf');
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'word-calibri.pdf'), fixture);

  const idle = async () => { await sleep(300); for (let i = 0; i < 80; i++) { const b = await run(`!document.querySelector('#busy').hidden || !!document.querySelector('.modal')`); if (!b) { await sleep(400); if (!(await run(`!document.querySelector('#busy').hidden`))) return; } await sleep(150); } };
  const waitPaint = async () => { for (let i = 0; i < 60; i++) { if (await run(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0) && document.querySelectorAll('.textLayer span').length>0`)) return; await sleep(200); } };
  const lineOf = (key) => run(`(async()=>{ const d=window.__pm.S.cur; const pg=await d.pdf.getPage(1); const tc=await pg.getTextContent(); const seed=tc.items.find(i=>i.str.trim() && i.str.includes(${JSON.stringify(key)})); if(!seed) return ''; const row=tc.items.filter(i=>Math.abs(i.transform[5]-seed.transform[5])<1.5).sort((a,b)=>a.transform[4]-b.transform[4]); return row.map(i=>i.str).join('').trim(); })()`);
  const fontOf = (key) => run(`(async()=>{ const d=window.__pm.S.cur; const pg=await d.pdf.getPage(1); const tc=await pg.getTextContent(); await pg.getOperatorList(); const seed=tc.items.find(i=>i.str.trim() && i.str.includes(${JSON.stringify(key)})); if(!seed) return ''; try { return pg.commonObjs.get(seed.fontName).name; } catch(e) { return 'sin datos'; } })()`);
  const clickItem = (key) => run(`(async()=>{ const v=window.__pm.viewer; const pt=await v.pageText(0); const m=pt.map.find(m=>m.it.str.includes(${JSON.stringify(key)})); const r=v.rectsFor(pt,m.start,m.end)[0]; const l=document.querySelector('.ov-layer'); const b=l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+(r.x+Math.min(r.w/2,30))*v.scale,clientY:b.top+(r.y+r.h/2)*v.scale,button:0,pointerId:1})); return 1; })()`);
  const waitEditor = async () => { const t0 = Date.now(); for (let i = 0; i < 100; i++) { if (await run(`!!document.querySelector('.ov-textedit[contenteditable]') || window.__pm.S.cur.overlays.some(o=>o.type==='text' && o.linked)`)) return Date.now() - t0; await sleep(100); } return -1; };
  const settle = async () => { for (let i = 0; i < 80; i++) { if (await run('window.__pm.viewer.builtVersion === window.__pm.S.cur.version')) break; await sleep(150); } await idle(); await waitPaint(); await sleep(400); };
  const typeOnly = (text) => run(`(()=>{ const el=document.querySelector('.ov-textedit[contenteditable]'); if(!el) return 0; el.textContent=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  const finishEdit = async () => {
    const ver = await run('window.__pm.S.cur.version');
    await run(`(()=>{ const el=document.querySelector('.ov-textedit[contenteditable]'); if(el) { el.blur(); if (!document.hasFocus()) el.dispatchEvent(new FocusEvent('blur')); } return 1; })()`);
    // esperar a que el cambio llegue al PDF (nueva versión de los bytes) y a que el visor termine de dibujar
    for (let i = 0; i < 80; i++) { if ((await run('window.__pm.S.cur.version')) !== ver) break; await sleep(150); }
    for (let i = 0; i < 80; i++) { if (await run('window.__pm.viewer.builtVersion === window.__pm.S.cur.version')) break; await sleep(150); }
    await idle(); await waitPaint(); await sleep(400);
  };
  const typeText = async (text) => { await typeOnly(text); await finishEdit(); };

  win.setSize(1440, 900);
  await sleep(1000);
  await run(`(()=>{ window.__pm.openPaths(${JSON.stringify([fixture])}); return 1; })()`);
  await waitPaint();
  await run(`window.__pm.OV.setTool('edittext')`);
  await sleep(300);

  // 1) letras que ya existen en la fuente: se conserva exactamente
  await clickItem('Monto total');
  console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
  const ov1 = JSON.parse(await run(`JSON.stringify(window.__pm.S.cur.overlays.map(o=>({t:o.type,f:o.fontBase,loaded:!!o.loaded,size:o.size&&Math.round(o.size*10)/10})))`));
  check('clic en texto → edición fiel (reconoce la fuente incrustada)', ov1.length === 1 && ov1[0].t === 'textedit' && /Calibri/.test(ov1[0].f), JSON.stringify(ov1));
  await typeOnly('Monto neto: $1.299.000 más IVA. Vigencia 30 días.');
  await sleep(300);
  const hint = await run(`document.querySelector('#props')?.innerText || ''`);
  check('el panel indica la fuente original y los caracteres que faltan', /Fuente original/.test(hint) && /Calibri/.test(hint) && /9/.test(hint), hint.replace(/\s+/g, ' ').slice(0, 160));
  await shot(path.join(OUT, '1-edicion.png'));
  await finishEdit();
  const l1 = await lineOf('Monto');
  check('texto reescrito en el PDF', l1.includes('Monto neto: $1.299.000 más IVA. Vigencia 30 días.'), l1);
  check('misma fuente incrustada (Calibri) en la línea editada', /Calibri/.test(await fontOf('Monto')), await fontOf('Monto'));
  const other = await lineOf('Condiciones');
  check('las demás líneas no cambian', other.includes('Condiciones generales: el pago se realizará contra factura.'), other);
  await shot(path.join(OUT, '2-resultado.png'));

  // 2) deshacer vuelve al texto original
  await run(`window.__pm.S.cur.undo().then(()=>1)`);
  await settle();
  check('deshacer devuelve el texto original', (await lineOf('Monto')).includes('Monto total: $1.250.000'), await lineOf('Monto'));
  await run(`window.__pm.S.cur.redo().then(()=>1)`); await settle();

  // 3) borrar texto completo y reescribir una línea larga en Arial con letras nuevas
  await run(`window.__pm.OV.setTool('edittext')`);
  await sleep(300);
  await clickItem('Providencia');
  console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
  await typeText('Dirección: Av. Apoquindo 5678, Las Condes, Santiago, Chile.');
  const l3 = await lineOf('Dirección');
  check('línea más larga con letras nuevas (Arial) reescrita', l3.includes('Apoquindo 5678, Las Condes'), l3);
  check('sigue siendo Arial', /Arial/.test(await fontOf('Dirección')), await fontOf('Dirección'));

  // 4) PDF generado por Chromium (fuentes TrueType incrustadas en otro formato)
  const html = '<html><body style="font:18px Georgia,serif;margin:40px"><p>Presupuesto número 4521 aprobado por gerencia.</p><p style="font:16px Arial,sans-serif">Cliente: Constructora del Sur Ltda.</p></body></html>';
  await run(`(async()=>{ const bytes = await window.pm.htmlToPdf({html:${JSON.stringify(html)}, pageSize:'A4', margin:10}); await window.__pm.openEntry({name:'chromium.pdf', path:null, data:bytes}); return 1; })()`);
  await sleep(1500); await waitPaint();
  await run(`window.__pm.OV.setTool('edittext')`);
  await sleep(300);
  await clickItem('Presupuesto');
  console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
  const ov4 = JSON.parse(await run(`JSON.stringify(window.__pm.S.cur.overlays.map(o=>({t:o.type,f:o.fontBase})))`));
  console.log('     (Chromium) ' + JSON.stringify(ov4));
  check('PDF de Chromium: se puede editar (fiel o con fuente equivalente)', ov4.length >= 1);
  await typeText('Presupuesto número 9876 aprobado por gerencia.');
  const l4 = await lineOf('Presupuesto');
  check('Chromium: texto nuevo presente', l4.includes('9876'), l4);
  await shot(path.join(OUT, '3-chromium.png'));

  // 5) PDF generado por LibreOffice (fuentes TrueType simples con codificación propia): solo donde está instalado
  const so = process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : '';
  if (so && fs.existsSync(so)) {
    const htmlFile = path.join(OUT, 'lo.html');
    fs.writeFileSync(htmlFile, '<html><body><p style="font-family:Liberation Serif;font-size:14pt">Contrato de arriendo número 2026-77 firmado.</p><p style="font-family:Liberation Sans;font-size:12pt">Arrendatario: Juan Pérez González.</p></body></html>');
    try { execFileSync(so, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', OUT, htmlFile], { timeout: 120000 }); } catch (err) { console.log('     (LibreOffice) ' + err.message.split('\n')[0]); }
    const lo = path.join(OUT, 'lo.pdf');
    if (fs.existsSync(lo)) {
      await run(`(()=>{ window.__pm.openPaths(${JSON.stringify([lo])}); return 1; })()`);
      await sleep(1500); await waitPaint();
      await run(`window.__pm.OV.setTool('edittext')`);
      await sleep(300);
      await clickItem('Contrato');
      console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
      const ovLo = JSON.parse(await run(`JSON.stringify(window.__pm.S.cur.overlays.map(o=>({t:o.type,f:o.fontBase})))`));
      console.log('     (LibreOffice) ' + JSON.stringify(ovLo));
      check('LibreOffice: se reconoce la fuente incrustada', ovLo.length === 1 && ovLo[0].t === 'textedit', JSON.stringify(ovLo));
      await typeText('Contrato de arriendo número 2027-98 firmado hoy.');
      const lLo = await lineOf('Contrato');
      check('LibreOffice: texto nuevo presente', lLo.includes('2027-98 firmado hoy'), lLo);
      await shot(path.join(OUT, '4-libreoffice.png'));
    }
  }

  console.log(`\nRESUMEN: ${results.filter(Boolean).length}/${results.length}`);
};
