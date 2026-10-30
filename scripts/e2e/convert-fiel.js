// Conversión "Fiel al original": se genera el archivo, se abre con Word/Excel/PowerPoint de verdad, se exporta a PDF y se comparan las posiciones del texto
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

module.exports = async ({ run, sleep, win }) => {
  const OUT = path.join(process.env.PM_E2E_DIR || path.join(os.tmpdir(), 'pdfmaster-e2e'), 'fiel');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (n, ok, x = '') => { results.push(ok); console.log((ok ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };
  const only = (process.env.PM_FIEL || 'word,excel,pptx').split(',');
  const inputs = (process.env.PM_FIEL_PDFS ? process.env.PM_FIEL_PDFS.split('|') : [path.join(__dirname, '..', 'fixtures', 'word-calibri.pdf')]);

  win.setSize(1440, 900);
  await sleep(1000);

  const open = async (p) => {
    await run(`window.__pm.openPaths(${JSON.stringify([p])})`);
    for (let i = 0; i < 80; i++) { if (await run(`!!(window.__pm.S.cur && window.__pm.S.cur.pdf && window.__pm.S.cur.name === ${JSON.stringify(path.basename(p))})`)) break; await sleep(200); }
    await sleep(500);
  };
  const itemsOf = (page = 1) => run(`(async()=>{ const d=window.__pm.S.cur; const pg=await d.pdf.getPage(${page}); const tc=await pg.getTextContent(); return JSON.stringify({ n: d.numPages, items: tc.items.filter(i=>i.str.trim()).map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],h:Math.hypot(i.transform[2],i.transform[3])})) }); })()`).then(JSON.parse);
  const allText = () => run(`(async()=>{ const d=window.__pm.S.cur; let t=''; for (let p=1;p<=d.numPages;p++){ const pg=await d.pdf.getPage(p); const tc=await pg.getTextContent(); t+=' '+tc.items.map(i=>i.str).join(' '); } return t.replace(/\s+/g,' '); })()`);
  const snap = async (file) => { const d = await run(`(async()=>{ const { C, S } = window.__pm; const { canvas } = await C.renderPage(S.cur.pdf, 1, 1.1); return canvas.toDataURL('image/png'); })()`); fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')); };
  const compare = (orig, out) => {
    const dx = [], dy = [], rel = [];
    let matched = 0;
    const missing = [];
    for (const o of orig.items) {
      const s = o.s.trim();
      let best = null, bd = 1e9, whole = true;
      for (const e of out.items) {
        const t = e.s.trim();
        const exact = t === s || (t.length >= 3 && s.startsWith(t)) || t.startsWith(s + ' ');
        const inside = !exact && s.length >= 2 && t.includes(s) && Math.abs(e.y - o.y) < o.h;
        if (!exact && !inside) continue;
        const d = exact ? Math.hypot(e.x - o.x, e.y - o.y) : Math.abs(e.y - o.y) + 30;
        if (d < bd) { bd = d; best = e; whole = exact; }
      }
      if (best && bd < 60) { matched++; if (whole) dx.push(best.x - o.x); dy.push(best.y - o.y); rel.push((best.y - o.y) / o.h); } else missing.push(s);
    }
    const med = (a) => { if (!a.length) return NaN; const q = [...a].sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };
    const p90 = (a) => { const q = a.map(Math.abs).sort((x, y) => x - y); return q[Math.floor(q.length * 0.9)] || 0; };
    return { missing, matched, total: orig.items.length, dxMed: med(dx), dyMed: med(dy), relMed: med(rel), dxP90: p90(dx), dyP90: p90(dy) };
  };
  const office = (kind, file, pdf) => {
    const ps = path.join(OUT, 'export.ps1');
    const script = {
      word: `$a = New-Object -ComObject Word.Application; $a.Visible = $false; $a.DisplayAlerts = 0; try { $d = $a.Documents.Open('${file}', $false, $true); $d.ExportAsFixedFormat('${pdf}', 17); $d.Close($false) } finally { $a.Quit() }`,
      excel: `$a = New-Object -ComObject Excel.Application; $a.Visible = $false; $a.DisplayAlerts = $false; try { $w = $a.Workbooks.Open('${file}'); $w.ExportAsFixedFormat(0, '${pdf}'); $w.Close($false) } finally { $a.Quit() }`,
      pptx: `$a = New-Object -ComObject PowerPoint.Application; try { $p = $a.Presentations.Open('${file}', $true, $false, $false); $p.SaveAs('${pdf}', 32); $p.Close() } finally { $a.Quit() }`,
    }[kind];
    fs.writeFileSync(ps, '﻿' + script, 'utf8'); // con BOM para que PowerShell 5.1 lea bien las tildes de los nombres
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 180000 });
    return r.status === 0 && fs.existsSync(pdf) ? '' : (r.stderr || r.stdout || 'sin salida').slice(0, 300);
  };

  // en los tres diálogos, "Fiel al original" debe venir elegido por defecto
  {
    const first = path.join(OUT, path.basename(inputs[0]));
    fs.copyFileSync(inputs[0], first);
    await open(first);
    for (const [id, title] of [['toword', 'Word'], ['toexcel', 'Excel'], ['topptx', 'PowerPoint']]) {
      await run(`(()=>{ window.__pm.runTool(${JSON.stringify(id)}); return 1; })()`); // sin esperar: la promesa termina cuando se cierra el diálogo
      let t = '';
      for (let i = 0; i < 40 && !t.includes(title); i++) { await sleep(150); t = await run(`document.querySelector('.modal h2')?.textContent || ''`); }
      const sel = await run(`(()=>{ const f=[...document.querySelectorAll('.modal .field')].find(x=>(x.querySelector('label')?.textContent||'').startsWith('Tipo de conversión')); const s=f && f.querySelector('select'); return s ? s.value + ' | ' + s.options[s.selectedIndex].textContent : 'sin campo'; })()`);
      if (sel === 'sin campo') console.log('  (diálogo)', t, '|', (await run(`document.querySelector('.modal')?.innerText || 'sin modal'`)).slice(0, 300).replace(/\s+/g, ' '));
      check(`${title}: "Fiel al original" es lo predeterminado`, sel.startsWith('faithful |') && /Fiel al original/.test(sel), sel);
      await run(`(()=>{ const b=[...document.querySelectorAll('.modal .btn')].find(x=>/Cancelar/.test(x.textContent)); if (b) b.click(); return 1; })()`);
      await sleep(300);
    }
  }
  const ext = { word: 'docx', excel: 'xlsx', pptx: 'pptx' };
  const call = { word: `C.toDocx(d, idx, { mode: 'faithful' })`, excel: `C.toXlsx(d, idx, { mode: 'faithful' })`, pptx: `C.toPptx(d, idx, { mode: 'faithful' })` };
  for (const src of inputs) {
    const base = path.basename(src);
    const local = path.join(OUT, base);
    fs.copyFileSync(src, local);
    await open(local);
    const orig = await itemsOf(1);
    await snap(path.join(OUT, base.replace(/\.pdf$/i, '') + '-original.png'));
    console.log(`\n== ${base} (${orig.items.length} textos, ${orig.n} pág.)`);
    for (const kind of only) {
      const file = path.join(OUT, base.replace(/\.pdf$/i, '') + '.' + ext[kind]);
      const t0 = Date.now();
      const b64 = await run(`(async()=>{ const { C, S } = window.__pm; const d = S.cur; const idx = [...Array(Math.min(d.numPages, 1)).keys()]; const out = await ${call[kind]}; let s=''; for (let i=0;i<out.length;i+=0x8000) s+=String.fromCharCode.apply(null,out.subarray(i,i+0x8000)); return btoa(s); })()`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      const pdf = file.replace(/\.[a-z]+$/, '') + `-${kind}.pdf`;
      const err = office(kind, file, pdf);
      if (err) { check(`${kind}: abrir con Office y exportar`, false, err); continue; }
      await open(pdf);
      const out = await itemsOf(1);
      await snap(pdf.replace(/\.pdf$/, '.png'));
      const c = compare(orig, out);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${kind}: ${c.matched}/${c.total} textos emparejados · Δx mediana ${c.dxMed.toFixed(2)} (p90 ${c.dxP90.toFixed(2)}) · Δy mediana ${c.dyMed.toFixed(2)} pt = ${c.relMed.toFixed(3)}×tamaño (p90 ${c.dyP90.toFixed(2)}) · ${out.n} pág. · ${secs}s`);
      if (c.missing.length) console.log('  sin emparejar:', c.missing.slice(0, 14).map((m) => JSON.stringify(m)).join(' '));
      if (kind !== 'excel') check(`${kind}: casi todos los textos aparecen en el PDF exportado`, c.matched >= c.total * 0.85, `${c.matched}/${c.total}`);
      if (kind === 'excel') {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(file);
        const ws = wb.worksheets[0];
        let blob = '', fills = 0, fonts = new Set();
        ws.eachRow((row) => row.eachCell((cell) => { blob += String(cell.value ?? '').replace(/\s+/g, ''); if (cell.fill && cell.fill.fgColor) fills++; if (cell.font && cell.font.name) fonts.add(cell.font.name); }));
        const found = orig.items.filter((o) => blob.includes(o.s.replace(/\s+/g, ''))).length;
        console.log(`  excel: ${ws.rowCount} filas × ${ws.columnCount} columnas · ${fills} celdas con color de fondo · fuentes: ${[...fonts].join(', ')}`);
        check('excel: todos los textos están en las celdas', found >= orig.items.length * 0.97, `${found}/${orig.items.length}`);
      } else { // en Excel el PDF exportado se reduce para caber en el ancho de la hoja: las posiciones no son comparables
        check(`${kind}: posición horizontal fiel (p90 < 3 pt)`, c.dxP90 < 3, c.dxP90.toFixed(2));
        check(`${kind}: posición vertical fiel (p90 < 3 pt)`, c.dyP90 < 3, c.dyP90.toFixed(2));
      }
    }
  }
  console.log(`\nRESUMEN: ${results.filter(Boolean).length}/${results.length}`);
};
