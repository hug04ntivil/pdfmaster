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
  const waitBoxes = async () => { for (let i = 0; i < 80; i++) { if (await run(`document.querySelectorAll('.ov-tbox').length > 0`)) return true; await sleep(150); } return false; };
  const boxOf = (key) => `(()=>{ const layer=[...document.querySelectorAll('.ov-layer')].find(l=>l._tb && l._tb.length); if(!layer) return null; const k=layer._tb.findIndex(e=>e.items.some(x=>x.m.it.str.includes(${JSON.stringify(key)}))); return layer.querySelector('.ov-tbox[data-k="'+k+'"]'); })()`;
  const clickOnce = (key) => run(`(()=>{ const box=${boxOf(key)}; if(!box) return 0; const b=box.getBoundingClientRect(); const x=b.left+Math.min(b.width/2,30), y=b.top+b.height/2; box.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:y,button:0,pointerId:1})); return 1; })()`);
  // si el visor reconstruye las cajas justo entre buscar y hacer clic, el clic cae en una caja vieja: se reintenta
  const clickItem = async (key) => {
    for (let t = 0; t < 4; t++) {
      await waitBoxes();
      await clickOnce(key);
      for (let i = 0; i < 25; i++) { if (await run(`!!document.querySelector('.ov-textedit[contenteditable]') || window.__pm.S.cur.overlays.some(o=>o.type==='text' && o.linked)`)) return 1; await sleep(100); }
    }
    return 0;
  };
  const dragItem = async (key, dx, dy) => { await waitBoxes(); return run(`(async()=>{ const box=${boxOf(key)}; const b=box.getBoundingClientRect(); const x=b.left+10, y=b.top+b.height/2; const ev=(t,px,py,tg)=>(tg||window).dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:px,clientY:py,button:0,pointerId:1})); ev('pointerdown',x,y,box); for (let s=1;s<=6;s++) { ev('pointermove',x+${dx}*s/6,y+${dy}*s/6); await new Promise(r=>setTimeout(r,20)); } ev('pointerup',x+${dx},y+${dy}); return 1; })()`); };
  const deleteItem = async (key) => { await waitBoxes(); return run(`(()=>{ const box=${boxOf(key)}; const x=box.querySelector('.x'); const b=x.getBoundingClientRect(); x.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+5,clientY:b.top+5,button:0,pointerId:1})); return 1; })()`); };
  const clickOutside = () => run(`(()=>{ const l=document.querySelector('.ov-layer'); const b=l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+b.width*0.8,clientY:b.top+b.height*0.85,button:0,pointerId:1})); return 1; })()`);
  const waitVersion = async (ver) => { for (let i = 0; i < 80; i++) { if ((await run('window.__pm.S.cur.version')) !== ver) break; await sleep(150); } await settle(); };
  const itemPos = (key) => run(`(async()=>{ const d=window.__pm.S.cur; const pg=await d.pdf.getPage(1); const tc=await pg.getTextContent(); const it=tc.items.find(i=>i.str.trim() && i.str.includes(${JSON.stringify(key)})); return it ? JSON.stringify({x:it.transform[4], y:it.transform[5]}) : 'null'; })()`).then((s) => JSON.parse(s));
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
  await run(`window.__pm.viewer.visibleIndexes().forEach((i) => window.__pm.viewer.renderPage(i))`); // con la ventana tapada el visor no recibe avisos de visibilidad
  if (!(await waitBoxes())) {
    console.log('     (depuración, sin cajas) ' + await run(`(async()=>{ const v=window.__pm.viewer; const pt=await v.pageText(0); const rects=pt.map.filter(m=>m.it.str.trim()).map(m=>v.rectsFor(pt,m.start,m.end)[0]); return JSON.stringify({tool:window.__pm.OV.tool, pages:v.pages.length, rendered:v.pages.map(p=>p.rendered), map:pt.map.length, rects:rects.filter(Boolean).length, tb:[...document.querySelectorAll('.ov-layer')].map(l=>l._tb?l._tb.length:null), hidden:document.hidden, vis:document.visibilityState}); })()`));
  }

  // 1) letras que ya existen en la fuente: se conserva exactamente
  await clickItem('Monto total');
  console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
  const caret = JSON.parse(await run(`(()=>{ const el=document.querySelector('.ov-textedit[contenteditable]'); const s=getSelection(); return JSON.stringify({collapsed:s.isCollapsed, inside: !!el && el.contains(s.anchorNode), len: el ? el.textContent.length : 0, grip: !!document.querySelector('.ov-grip')}); })()`));
  check('clic en el texto pone el cursor (no selecciona todo) y muestra el asa de mover', caret.collapsed && caret.inside && caret.grip, JSON.stringify(caret));
  const ov1 = JSON.parse(await run(`JSON.stringify(window.__pm.S.cur.overlays.map(o=>({t:o.type,f:o.fontBase,loaded:!!o.loaded,size:o.size&&Math.round(o.size*10)/10})))`));
  check('clic en texto → edición fiel (reconoce la fuente incrustada)', ov1.length === 1 && ov1[0].t === 'textedit' && /Calibri/.test(ov1[0].f), JSON.stringify(ov1));
  // si la ventana de pruebas pierde el foco del sistema, el editor puede cerrarse solo antes de escribir: se reabre
  if (!(await run(`!!document.querySelector('.ov-textedit[contenteditable]')`))) { console.log('     (el editor se cerró solo; se reabre)'); await settle(); await run(`window.__pm.OV.setTool('edittext')`); await clickItem('Monto total'); await waitEditor(); }
  await typeOnly('Monto neto: $1.299.000 más IVA. Vigencia 30 días.');
  await sleep(150);
  const hint = await run(`document.querySelector('#props')?.innerText || ''`);
  if (!/Fuente original/.test(hint)) console.log('     (depuración) ' + await run(`JSON.stringify({sel: window.__pm.OV.selId, tool: window.__pm.OV.tool, ov: window.__pm.S.cur.overlays.map(o=>o.type+':'+o.id), editor: !!document.querySelector('.ov-textedit[contenteditable]'), active: document.activeElement && document.activeElement.className, toasts: [...document.querySelectorAll('.toast')].map(x=>x.textContent)})`));
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

  // 3b) todas las cajas de texto visibles, arrastrar, borrar con × y clic fuera para aplicar
  await run(`window.__pm.OV.setTool('edittext')`);
  await waitBoxes();
  const nBoxes = await run(`document.querySelectorAll('.ov-tbox').length`);
  await settle();
  await shot(path.join(OUT, '3a-cajas.png'));
  check('al activar "Editar texto" se muestran todos los textos de la página como cajas', nBoxes >= 6, nBoxes + ' cajas');
  const p0 = await itemPos('Condiciones');
  const scale = await run('window.__pm.viewer.scale');
  let ver = await run('window.__pm.S.cur.version');
  await dragItem('Condiciones', 90, 36);
  await waitVersion(ver);
  const p1 = await itemPos('Condiciones');
  check('arrastrar una caja mueve el texto en el PDF', Math.abs((p1.x - p0.x) - 90 / scale) < 0.6 && Math.abs((p1.y - p0.y) + 36 / scale) < 0.6, `Δx=${(p1.x - p0.x).toFixed(1)} (esperado ${(90 / scale).toFixed(1)}), Δy=${(p1.y - p0.y).toFixed(1)} (esperado ${(-36 / scale).toFixed(1)})`);
  check('el texto movido conserva su fuente', /Times|Georgia|Cambria|Tinos/.test(await fontOf('Condiciones')), await fontOf('Condiciones'));
  await shot(path.join(OUT, '3b-movido.png'));
  await run(`window.__pm.OV.setTool('edittext')`);
  await waitBoxes();
  ver = await run('window.__pm.S.cur.version');
  await deleteItem('Código de referencia');
  await waitVersion(ver);
  check('la × borra el texto del PDF', !(await lineOf('Código de referencia')) , await lineOf('Código'));
  await run(`window.__pm.OV.setTool('edittext')`);
  await waitBoxes();
  await clickItem('Total a pagar');
  console.log('     (análisis del texto: ' + (await waitEditor()) + ' ms)');
  await typeOnly('Total a pagar: 3.450.000');
  ver = await run('window.__pm.S.cur.version');
  await clickOutside();
  await waitVersion(ver);
  check('clic fuera del texto aplica el cambio de inmediato', (await lineOf('Total a pagar')).includes('3.450.000'), await lineOf('Total a pagar'));

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

  // 4b) una línea formada por varios fragmentos (negrita, cursiva...): la caja es la línea completa y se mueve entera
  const html2 = '<html><body style="font:18px Georgia,serif;margin:40px"><p>Palabra <b>negrita</b> <i>cursiva</i> final.</p></body></html>';
  await run(`(async()=>{ const bytes = await window.pm.htmlToPdf({html:${JSON.stringify(html2)}, pageSize:'A4', margin:10}); await window.__pm.openEntry({name:'lineas.pdf', path:null, data:bytes}); return 1; })()`);
  await sleep(1500); await waitPaint();
  await run(`window.__pm.OV.setTool('edittext')`);
  await waitBoxes();
  const grp = JSON.parse(await run(`JSON.stringify((document.querySelector('.ov-layer')._tb||[]).map(e=>e.items.length))`));
  check('los fragmentos de una misma línea forman una sola caja', grp.length === 1 && grp[0] >= 2, JSON.stringify(grp));
  const a0 = await itemPos('Palabra'), b0 = await itemPos('final');
  ver = await run('window.__pm.S.cur.version');
  await dragItem('Palabra', 70, 0);
  await waitVersion(ver);
  const a1 = await itemPos('Palabra'), b1 = await itemPos('final');
  const sc2 = await run('window.__pm.viewer.scale');
  check('arrastrar la caja mueve la línea completa (todos sus fragmentos)', Math.abs((a1.x - a0.x) - 70 / sc2) < 0.6 && Math.abs((b1.x - b0.x) - 70 / sc2) < 0.6, `Δ primero=${(a1.x - a0.x).toFixed(1)}, Δ último=${(b1.x - b0.x).toFixed(1)}, esperado ${(70 / sc2).toFixed(1)}`);

  // 4c) asa de mover mientras se edita: el cuadro de edición se desplaza y al salir se aplica
  await run(`window.__pm.OV.setTool('edittext')`);
  await waitBoxes();
  await clickItem('negrita'); // un fragmento del medio de la línea: el asa debe mover la línea completa
  await waitEditor();
  const c0 = await itemPos('Palabra'), e0 = await itemPos('final'), n0 = await itemPos('negrita');
  ver = await run('window.__pm.S.cur.version');
  await run(`(async()=>{ const g=document.querySelector('.ov-grip'); const b=g.getBoundingClientRect(); const x=b.left+8,y=b.top+8; const ev=(t,px,py,tg)=>(tg||window).dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:px,clientY:py,button:0,pointerId:1})); ev('pointerdown',x,y,g); for (let s=1;s<=4;s++) { ev('pointermove',x,y+60*s/4); await new Promise(r=>setTimeout(r,20)); } ev('pointerup',x,y+60); return 1; })()`);
  console.log('     (asa) ' + await run(`JSON.stringify(window.__pm.S.cur.overlays.filter(o=>o.type==='textedit').map(o=>({x:o.x,y:o.y,moveX:o.moveX,moveY:o.moveY})))`));
  await finishEdit();
  const c1 = await itemPos('Palabra'), e1 = await itemPos('final'), n1 = await itemPos('negrita');
  const want = -60 / sc2;
  check('el asa mueve la línea completa mientras se edita (todos los fragmentos)', [[c0, c1], [n0, n1], [e0, e1]].every(([a, b]) => Math.abs((b.y - a.y) - want) < 0.8), `Δy primero=${(c1.y - c0.y).toFixed(1)}, medio=${(n1.y - n0.y).toFixed(1)}, último=${(e1.y - e0.y).toFixed(1)} (esperado ${want.toFixed(1)})`);

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
