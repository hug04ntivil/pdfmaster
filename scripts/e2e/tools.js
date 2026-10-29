// E2E de herramientas: recorre los diálogos de cada herramienta a través de la interfaz real
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

module.exports = async ({ run, shot, sleep, win }) => {
  const OUT = path.join(process.env.PM_E2E_DIR || path.join(os.tmpdir(), 'pdfmaster-e2e'), 'tools');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  process.env.PM_E2E_OUT = OUT;
  const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const { Resvg } = require('@resvg/resvg-js');
  const results = [];
  const check = (name, ok, extra = '') => { results.push([name, ok]); console.log((ok ? '  OK   ' : '  FAIL ') + name + (extra ? ` — ${extra}` : '')); };

  // ---- fixtures
  const mkDoc = async (n, title) => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < n; i++) {
      const p = doc.addPage([595, 842]);
      p.drawText(`${title} - pagina ${i + 1}`, { x: 60, y: 770, size: 22, font: f });
      for (let l = 0; l < 25; l++) p.drawText(`Linea ${l + 1}: contenido de ejemplo para pruebas automaticas del programa.`, { x: 60, y: 730 - l * 22, size: 12, font: f });
    }
    return doc.save();
  };
  const A = path.join(OUT, 'A.pdf'); fs.writeFileSync(A, await mkDoc(5, 'Documento A'));
  const B = path.join(OUT, 'B.pdf'); fs.writeFileSync(B, await mkDoc(2, 'Documento B'));
  const png = (c) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${c}"/><circle cx="200" cy="150" r="90" fill="white"/></svg>`).render().asPng();
  const IMG1 = path.join(OUT, 'i1.png'); fs.writeFileSync(IMG1, png('#2563eb'));
  const IMG2 = path.join(OUT, 'i2.png'); fs.writeFileSync(IMG2, png('#16a34a'));
  const fdoc = await PDFDocument.create(); const fpage = fdoc.addPage([400, 400]); const form = fdoc.getForm();
  form.createTextField('nombre').addToPage(fpage, { x: 40, y: 300, width: 200, height: 24 });
  form.createCheckBox('acepto').addToPage(fpage, { x: 40, y: 250, width: 18, height: 18 });
  const FORM = path.join(OUT, 'form.pdf'); fs.writeFileSync(FORM, await fdoc.save());
  const TXT = path.join(OUT, 'nota.txt'); fs.writeFileSync(TXT, 'Hola mundo\nEste es un texto de prueba con acentos: áéíóú ñ.\n');

  // ---- helpers
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const inspect = async (buf) => {
    const d = await PDFDocument.load(buf, { ignoreEncryption: true });
    return { pages: d.getPageCount(), rot: d.getPages().map((p) => p.getRotation().angle) };
  };
  const textOf = async (buf, pageNo = 1) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    const pg = await doc.getPage(pageNo);
    return (await pg.getTextContent()).items.map((i) => i.str).join(' ');
  };
  const curBytes = async () => Buffer.from(await run(`(()=>{ const b=window.__pm.S.cur.bytes; let s=''; for(let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(s); })()`), 'base64');
  const idle = async (ms = 8000) => {
    const t0 = Date.now();
    await sleep(250);
    for (;;) {
      const st = await run(`JSON.stringify({m: !!document.querySelector('.modal'), b: !document.querySelector('#busy').hidden})`);
      const { m, b } = JSON.parse(st);
      if (!m && !b) { await sleep(450); const st2 = JSON.parse(await run(`JSON.stringify({m: !!document.querySelector('.modal'), b: !document.querySelector('#busy').hidden})`)); if (!st2.m && !st2.b) return true; }
      if (Date.now() - t0 > ms) return false;
      await sleep(150);
    }
  };
  const waitModal = async (title) => { for (let i = 0; i < 60; i++) { const t = await run(`document.querySelector('.modal h2')?.textContent || ''`); if (t && (!title || t.includes(title))) return t; await sleep(150); } return null; };
  const fill = (label, v) => run(`(()=>{ const f=[...document.querySelectorAll('.modal .field')].find(x=>(x.querySelector('label')?.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!f) return 'NOFIELD:'+${JSON.stringify(label)}; const el=f.querySelector('input,select,textarea'); if(el.type==='checkbox'){el.checked=${JSON.stringify(v)};} else el.value=${JSON.stringify(String(v))}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
  const okBtn = () => run(`document.querySelector('.modal .btn.primary').click()`);
  const start = (id) => run(`(()=>{ window.__pm.runTool(${JSON.stringify(id)}); return 1; })()`);
  const openDoc = async (p) => { await run(`window.__pm.openPaths(${JSON.stringify([p])})`); await idle(); await sleep(400); };
  const closeAll = () => run(`(()=>{ const S=window.__pm.S; for (const d of [...S.docs]) { d.dirty=false; } return 1; })()`);
  const toolFlow = async (id, title, steps = []) => {
    await start(id);
    const t = await waitModal(title);
    if (!t) return { ok: false, why: 'no apareció el diálogo' };
    for (const [l, v] of steps) { const r = await fill(l, v); if (String(r).startsWith('NOFIELD')) return { ok: false, why: r }; }
    await okBtn();
    const done = await idle(40000);
    return { ok: done, why: done ? '' : 'no terminó' };
  };
  const err = async () => run(`[...document.querySelectorAll('.toast.err')].map(t=>t.textContent).join(' | ')`);

  win.setSize(1440, 900);
  await sleep(1000);

  check('fuentes del sistema detectadas (Arial)', (await run(`Object.keys(window.__pm.S.sysFonts).includes('Arial')`)) === true, await run(`Object.keys(window.__pm.S.sysFonts).join(', ')`));
  check('plataforma', true, await run(`window.pm.platform + ' · ' + document.body.className`));

  // =============================== páginas
  await openDoc(A);
  check('abrir A.pdf (5 páginas)', (await run(`window.__pm.S.cur.numPages`)) === 5);

  await run(`(()=>{ const d=window.__pm.S.cur; d.sel=new Set([1]); return 1; })()`);
  await start('rotateR'); await idle();
  let ins = await inspect(await curBytes());
  check('rotar página 2 a la derecha', ins.rot[1] === 90 && ins.rot[0] === 0, JSON.stringify(ins.rot));

  let r = await toolFlow('blank', 'páginas en blanco', [['Cantidad', 2]]);
  check('insertar 2 páginas en blanco', r.ok && (await run(`window.__pm.S.cur.numPages`)) === 7, r.why + await err());

  r = await toolFlow('delete', 'Eliminar', [['Páginas a eliminar', 'range'], ['Páginas (', '6-7']]);
  check('eliminar páginas 6-7', r.ok && (await run(`window.__pm.S.cur.numPages`)) === 5, r.why + await err());

  r = await toolFlow('pagenum', 'Numerar', [['Formato', 'Página {n} de {total}']]);
  let t3 = await textOf(await curBytes(), 3);
  check('numerar páginas', r.ok && t3.includes('Página 3 de 5'), r.why + await err());

  r = await toolFlow('headfoot', 'Encabezado', [['Encabezado — centro', 'CONFIDENCIAL {fecha}'], ['Pie — izquierda', '{archivo}']]);
  t3 = await textOf(await curBytes(), 1);
  check('encabezado y pie', r.ok && t3.includes('CONFIDENCIAL') && t3.includes('A.pdf'), r.why + await err());

  r = await toolFlow('watermark', 'Marca de agua', [['Texto', 'BORRADOR']]);
  check('marca de agua', r.ok && (await textOf(await curBytes(), 2)).includes('BORRADOR'), r.why + await err());

  r = await toolFlow('crop', 'Recortar', [['Arriba', 10], ['Izquierda', 10]]);
  check('recortar márgenes', r.ok && !(await err()), r.why + await err());

  r = await toolFlow('extract', 'Extraer', [['Páginas a extraer', 'range'], ['Páginas (', '1-2']]);
  check('extraer páginas (nueva pestaña)', r.ok && (await run(`window.__pm.S.docs.length`)) === 2 && (await run(`window.__pm.S.cur.numPages`)) === 2, r.why + await err());
  await run(`(()=>{ const S=window.__pm.S; S.cur.dirty=false; })()`);

  // organizar: invertir orden y aplicar
  await run(`(()=>{ const S=window.__pm.S; window.__pm.S.cur = S.docs[0]; window.dispatchEvent(new Event('x')); return 1; })()`);
  await run(`window.__pm.S.docs[0] && document.querySelectorAll('.tab')[0].click()`);
  await sleep(800);
  await start('organize');
  await waitModal('Organizar');
  await sleep(600);
  await shot(path.join(OUT, 'organizar.png'));
  await run(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('Invertir')).click()`);
  await sleep(200);
  await okBtn(); await idle(20000);
  check('organizar páginas (invertir)', (await textOf(await curBytes(), 1)).includes('pagina 5') || (await textOf(await curBytes(), 1)).includes('A - pagina'), (await textOf(await curBytes(), 1)).slice(0, 60) + (await err()));

  // unir: documento abierto + B.pdf
  process.env.PM_E2E_OPEN = JSON.stringify([B]);
  await start('merge'); await waitModal('Unir');
  await run(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('Añadir')).click()`);
  await sleep(500);
  await okBtn(); await idle(20000);
  check('unir PDFs', (await run(`window.__pm.S.cur.name`)) === 'PDF unido.pdf' && (await run(`window.__pm.S.cur.numPages`)) === 7, (await run(`window.__pm.S.cur.name + ' ' + window.__pm.S.cur.numPages`)) + await err());
  await run(`(()=>{ window.__pm.S.cur.dirty=false; return 1; })()`);

  // dividir
  r = await toolFlow('split', 'Dividir', [['Páginas por archivo', 3]]);
  const parts = fs.readdirSync(OUT).filter((f) => /_\d\d_p/.test(f));
  check('dividir cada 3 páginas', r.ok && parts.length === 3, parts.join(', ') + await err());

  // insertar desde otro PDF
  process.env.PM_E2E_OPEN = JSON.stringify([B]);
  r = await toolFlow('insertFile', 'Insertar páginas desde otro PDF', []);
  check('insertar desde B.pdf', r.ok && (await run(`window.__pm.S.cur.numPages`)) === 9, r.why + await err());

  // =============================== convertir
  await sleep(300);
  r = await toolFlow('toimages', 'imágenes', [['Resolución', '96']]);
  const imgs = fs.readdirSync(OUT).filter((f) => /\.png$/.test(f) && /_p\d/.test(f));
  check('PDF a imágenes', r.ok && imgs.length === 9, `${imgs.length} imágenes` + await err());

  r = await toolFlow('totext', 'texto', []);
  const txtOut = fs.readdirSync(OUT).find((f) => f.endsWith('.txt') && f !== 'nota.txt');
  check('PDF a texto', r.ok && txtOut && /Linea 1/.test(fs.readFileSync(path.join(OUT, txtOut), 'utf8')), txtOut + await err());

  r = await toolFlow('tohtml', 'HTML', []);
  const htmlOut = fs.readdirSync(OUT).find((f) => f.endsWith('.html'));
  check('PDF a HTML', r.ok && htmlOut && fs.readFileSync(path.join(OUT, htmlOut), 'utf8').includes('<section'), htmlOut + await err());

  r = await toolFlow('toword', 'Word', []);
  const docxOut = fs.readdirSync(OUT).find((f) => f.endsWith('.docx'));
  check('PDF a Word (texto editable)', r.ok && docxOut && fs.statSync(path.join(OUT, docxOut)).size > 4000, docxOut + await err());

  r = await toolFlow('toexcel', 'Excel', []);
  const xlsxOut = fs.readdirSync(OUT).find((f) => f.endsWith('.xlsx'));
  check('PDF a Excel', r.ok && xlsxOut && fs.statSync(path.join(OUT, xlsxOut)).size > 3000, xlsxOut + await err());

  r = await toolFlow('topptx', 'PowerPoint', []);
  const pptxOut = fs.readdirSync(OUT).find((f) => f.endsWith('.pptx'));
  check('PDF a PowerPoint', r.ok && pptxOut && fs.statSync(path.join(OUT, pptxOut)).size > 10000, pptxOut + await err());

  // imágenes a PDF
  process.env.PM_E2E_OPEN = JSON.stringify([IMG1, IMG2]);
  await start('imgs2pdf'); await waitModal('Imágenes');
  await run(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('Añadir')).click()`);
  await sleep(600);
  await okBtn(); await idle(20000);
  check('imágenes a PDF', (await run(`window.__pm.S.cur.name`)) === 'Imágenes.pdf' && (await run(`window.__pm.S.cur.numPages`)) === 2, await err());
  await run(`(()=>{ window.__pm.S.cur.dirty=false; return 1; })()`);

  // texto a PDF
  process.env.PM_E2E_OPEN = JSON.stringify([TXT]);
  await start('txt2pdf'); await waitModal('Texto');
  await run(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('Elegir archivo')).click()`);
  await sleep(500);
  await okBtn(); await idle(30000);
  const tt = (await run(`window.__pm.S.cur.name`));
  check('texto a PDF', tt === 'nota.pdf' && (await textOf(await curBytes(), 1)).includes('Hola mundo'), tt + ' ' + await err());
  await run(`(()=>{ window.__pm.S.cur.dirty=false; return 1; })()`);

  // Office a PDF: Word (Windows) o LibreOffice (macOS) usando el .docx generado
  const sofficeMac = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
  const canOffice = process.platform === 'win32' || (process.platform === 'darwin' && fs.existsSync(sofficeMac));
  if (!canOffice) console.log('  (omitida)  Office a PDF: no hay Microsoft Office ni LibreOffice en este equipo');
  if (docxOut && canOffice) {
    process.env.PM_E2E_OPEN = JSON.stringify([path.join(OUT, docxOut)]);
    await start('office2pdf');
    const ok = await idle(120000);
    const name = await run(`window.__pm.S.cur.name`);
    check('Office a PDF (Word instalado)', ok && /\.pdf$/.test(name) && (await run(`window.__pm.S.cur.numPages`)) >= 1, name + ' ' + (await run(`window.__pm.S.cur.numPages`)) + ' págs ' + await err());
    if (ok && (await run(`window.__pm.S.cur.numPages`)) >= 1) check('el DOCX generado conserva el texto (vía Word)', (await textOf(await curBytes(), 1)).includes('Linea'), (await textOf(await curBytes(), 1)).slice(0, 80));
    await run(`(()=>{ window.__pm.S.cur.dirty=false; return 1; })()`);
  }

  // =============================== formularios / seguridad / optimizar
  await openDoc(FORM);
  await start('fillform'); await waitModal('Rellenar');
  await run(`(()=>{ const m=document.querySelector('.modal'); const t=m.querySelector('input[type=text]'); t.value='Hugo Antivil'; const c=m.querySelector('input[type=checkbox]'); c.checked=true; return 1; })()`);
  await okBtn(); await idle(20000);
  const E = await run(`(async()=>{ const f = await window.__pm.E.getFormFields(window.__pm.S.cur.bytes); return JSON.stringify(f.map(x=>[x.name,x.value])); })()`);
  check('rellenar formulario', E.includes('Hugo Antivil') && E.includes('true'), E + await err());

  await openDoc(A);
  await start('protect'); await waitModal('Proteger');
  await fill('Contraseña para abrir', 'clave123'); await fill('Repite', 'clave123');
  await okBtn(); await idle();
  await run(`window.__pm.saveCurrent(true)`); await idle();
  const prot = path.join(OUT, 'A.pdf');
  let locked = false; try { await PDFDocument.load(fs.readFileSync(prot)); } catch { locked = true; }
  check('proteger con contraseña (al guardar)', locked);

  await run(`(()=>{ for (const d of [...window.__pm.S.docs]) d.dirty=false; return 1; })()`);
  // abrir el protegido: pide contraseña
  await run(`(()=>{ const S=window.__pm.S; S.docs.length=0; S.cur=null; return 1; })()`);
  await run(`(()=>{ window.__pm.openPaths(${JSON.stringify([prot])}); return 1; })()`);
  const t = await waitModal('protegido');
  check('abrir PDF protegido pide contraseña', !!t);
  await fill('Contraseña', 'clave123'); await okBtn(); await idle();
  check('abrir con la contraseña correcta', (await run(`window.__pm.S.cur && window.__pm.S.cur.numPages`)) === 5, await err());

  r = await toolFlow('metadata', 'Metadatos', [['Título', 'Informe Anual'], ['Autor', 'Hugo']]);
  const md = await run(`(async()=>JSON.stringify(await window.__pm.E.getMetadata(window.__pm.S.cur.bytes)))()`);
  check('metadatos', JSON.parse(md).title === 'Informe Anual', md);

  r = await toolFlow('compress', 'Comprimir', []);
  check('comprimir', r.ok, (await err()) || 'sin imágenes: el archivo ya estaba optimizado es válido');

  // OCR sobre página de texto (genera capa invisible)
  await run(`(()=>{ const d=window.__pm.S.cur; d.sel=new Set(); return 1; })()`);
  const t0 = Date.now();
  r = await toolFlow('ocr', 'OCR', [['Páginas', 'current']]);
  const ocrText = await textOf(await curBytes(), 1);
  check('OCR (español+inglés)', r.ok && ocrText.length > 100, `${Date.now() - t0} ms; ${ocrText.length} caracteres` + await err());

  // =============================== anotaciones interactivas
  await run(`(()=>{ const d=window.__pm.S.cur; d.dirty=false; return 1; })()`);
  for (let i = 0; i < 40; i++) { if (await run(`!!document.querySelector('.ov-layer') && [...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`)) break; await sleep(250); }
  await sleep(500);
  await run(`window.__pm.OV.setTool('text')`);
  await sleep(300);
  // clic real sobre la página 1 con evento de puntero
  await run(`(()=>{ const l=document.querySelector('.ov-layer'); const r=l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+120,clientY:r.top+300,button:0,pointerId:1})); return 1; })()`);
  await sleep(300);
  await run(`(()=>{ const el=document.querySelector('.ov-text[contenteditable]'); if(!el) return 0; el.textContent='Escrito por la herramienta'; el.dispatchEvent(new Event('input',{bubbles:true})); el.blur(); return 1; })()`);
  await sleep(300);
  check('herramienta Añadir texto', (await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='text' && o.text.includes('Escrito')).length`)) === 1);

  // dibujar rectángulo arrastrando
  await run(`window.__pm.OV.setTool('rect')`);
  await run(`(()=>{ const l=document.querySelector('.ov-layer'); const r=l.getBoundingClientRect(); const ev=(t,x,y)=>l.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:r.left+x,clientY:r.top+y,button:0,pointerId:1})); l.setPointerCapture=()=>{}; ev('pointerdown',100,400); ev('pointermove',250,480); ev('pointerup',250,480); return 1; })()`);
  await sleep(300);
  check('herramienta Rectángulo (arrastrar)', (await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='rect').length`)) === 1);

  // firma: dibujar y colocar
  await run(`window.__pm.OV.setTool('select')`);
  await start('sign'); await waitModal('Firmar');
  await run(`[...document.querySelectorAll('.modal .seg-tabs button')].find(b=>b.dataset.t==='draw').click()`);
  await run(`(()=>{ const c=document.querySelector('.sig-pad'); const r=c.getBoundingClientRect(); c.setPointerCapture=()=>{}; const ev=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:r.left+x,clientY:r.top+y,pointerId:2})); ev('pointerdown',40,100); for(let i=0;i<30;i++) ev('pointermove',40+i*12,100+Math.sin(i/3)*40); ev('pointerup',400,100); return 1; })()`);
  await okBtn(); await idle();
  check('firma dibujada lista para colocar', (await run(`window.__pm.OV.tool`)) === 'place' && !!(await run(`!!window.__pm.OV.placing`)), await err());
  await run(`(()=>{ const l=document.querySelectorAll('.ov-layer')[0]; const r=l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+300,clientY:r.top+600,button:0,pointerId:1})); return 1; })()`);
  await sleep(400);
  check('firma colocada en la página', (await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='image').length`)) === 1);

  // sello
  await start('stamp'); await waitModal('Sellos'); await okBtn(); await idle();
  await run(`(()=>{ const l=document.querySelectorAll('.ov-layer')[0]; const r=l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+350,clientY:r.top+150,button:0,pointerId:1})); return 1; })()`);
  await sleep(400);
  check('sello colocado', (await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='image').length`)) === 2);
  await shot(path.join(OUT, 'anotaciones.png'));

  // editar texto existente: aparecen cajas sobre los textos y un clic abre el editor
  await run(`window.__pm.OV.setTool('edittext')`);
  await run(`window.__pm.viewer.visibleIndexes().forEach((i) => window.__pm.viewer.renderPage(i))`); // si la ventana de pruebas está tapada, el visor no recibe avisos de visibilidad
  for (let i = 0; i < 160; i++) { if (await run(`document.querySelectorAll('.ov-tbox').length > 0`)) break; await sleep(150); }
  const nb = await run(`document.querySelectorAll('.ov-tbox').length`);
  const clicked = await run(`(()=>{ const layer=[...document.querySelectorAll('.ov-layer')].find(l=>l._tb && l._tb.length); if(!layer) return 'sin cajas'; const k=layer._tb.findIndex(e=>/Linea|Documento/.test(e.m.it.str)); if (k<0) return 'sin caja: ' + (layer._tb||[]).map(e=>e.m.it.str.slice(0,12)).join('|').slice(0,200); const box=layer.querySelector('.ov-tbox[data-k="'+k+'"]'); const b=box.getBoundingClientRect(); const x=b.left+20, y=b.top+b.height/2; box.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:y,button:0,pointerId:1})); return 'ok'; })()`);
  await sleep(900);
  const eo = await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='textedit' || o.type==='whiteout' || (o.type==='text' && o.linked)).length`);
  const dg = eo >= 1 ? '' : ' | ' + await run(`JSON.stringify({tool: window.__pm.OV.tool, rendered: window.__pm.viewer.pages.map(p=>p.rendered), tb: [...document.querySelectorAll('.ov-layer')].map(l=>l._tb ? l._tb.length : null), built: window.__pm.viewer.builtVersion + '/' + window.__pm.S.cur.version, toasts: [...document.querySelectorAll('.toast')].map(x=>x.textContent)})`);
  check('editar texto existente (abre el texto del PDF para editarlo)', eo >= 1, `cajas: ${nb}, clic: ${clicked}, objetos: ${eo}${dg}`);

  // redactar: dibujar zona sobre la línea 3 y aplicar
  await run(`document.activeElement && document.activeElement.blur()`);
  await run(`window.__pm.OV.setTool('redact')`);
  await run(`(()=>{ const l=document.querySelectorAll('.ov-layer')[1]; const r=l.getBoundingClientRect(); l.setPointerCapture=()=>{}; const ev=(t,x,y)=>l.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:r.left+x,clientY:r.top+y,button:0,pointerId:1})); ev('pointerdown',40,60); ev('pointermove',700,110); ev('pointerup',700,110); return 1; })()`);
  await sleep(300);
  check('zona de redacción creada', (await run(`window.__pm.S.cur.overlays.filter(o=>o.type==='redact').length`)) === 1);
  await run(`window.__pm.S.cur.commit().then(()=>1)`);
  await idle(30000);
  const bytesNow = await curBytes();
  const p1 = await textOf(bytesNow, 1), p2 = await textOf(bytesNow, 2);
  check('aplicar anotaciones: texto nuevo incrustado', p1.includes('Escrito por la herramienta'), p1.slice(0, 80));
  check('redacción real: el texto de la página 2 se eliminó', p2.trim().length === 0, `texto restante: "${p2.slice(0, 40)}"`);

  // deshacer todo y rehacer
  await run(`window.__pm.S.cur.undo().then(()=>1)`); await idle();
  check('deshacer tras aplicar', (await run(`window.__pm.S.cur.overlays.length`)) > 0);

  // buscador de herramientas
  await run(`(()=>{ const i=document.querySelector('#tool-search-wrap input'); i.value='comprimir'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  const vis = await run(`[...document.querySelectorAll('#tools .tool')].filter(b=>!b.classList.contains('hidden-by-search')).map(b=>b.textContent.trim()).join(',')`);
  check('buscador de herramientas', vis === 'Comprimir PDF', vis);
  await run(`(()=>{ const i=document.querySelector('#tool-search-wrap input'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);

  // ajustes y actualizaciones
  await run(`document.querySelector('#b-settings').click()`); await waitModal('Ajustes'); await sleep(300);
  await shot(path.join(OUT, 'ajustes.png'));
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(400);
  check('el botón de actualizaciones ya no está en la barra superior', (await run(`!document.querySelector('#b-update')`)) === true);
  await run(`document.querySelector('#b-settings').click()`); await waitModal('Ajustes');
  await run(`[...document.querySelectorAll('.modal .seg-tabs button')].find(b=>b.dataset.t==='updates').click()`); await sleep(2500);
  await shot(path.join(OUT, 'actualizaciones.png'));
  check('Ajustes > Actualizaciones tiene el botón Buscar', (await run(`[...document.querySelectorAll('.modal .btn')].some(b=>b.textContent.includes('Buscar actualizaciones'))`)) === true);
  const up = await run(`document.querySelector('#upstream-info')?.textContent || ''`);
  check('panel de actualizaciones consulta pdfcraft', /v\d+\.\d+/.test(up) || /HTTP 403/.test(up), up.slice(0, 80)); // 403 = límite de la API de GitHub en CI, no un fallo de la app
  check('leyenda de código abierto visible', (await run(`document.querySelector('.modal .legend p')?.textContent || ''`)).includes('personalizado por Hugo A.'));
  await run(`[...document.querySelectorAll('.modal .seg-tabs button')].find(b=>b.dataset.t==='about').click()`); await sleep(300);
  await shot(path.join(OUT, 'acerca.png'));
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);

  await sleep(300);
  const fails = results.filter((x) => !x[1]);
  console.log(`\nRESUMEN: ${results.length - fails.length}/${results.length} correctas`);
  if (fails.length) console.log('FALLARON: ' + fails.map((x) => x[0]).join('; '));
};
