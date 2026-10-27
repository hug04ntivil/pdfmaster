// E2E de las acciones del menú contextual: lanza procesos reales "PDF Master --pm-action=... archivo" como lo hace Explorer
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

module.exports = async ({ run, sleep, win, shot }) => {
  const OUT = path.join(process.env.PM_E2E_DIR || path.join(os.tmpdir(), 'pdfmaster-e2e'), 'launch');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');
  const { Resvg } = require('@resvg/resvg-js');
  const results = [];
  const check = (n, ok, x = '') => { results.push(ok); console.log((ok ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };
  const mk = async (name, n) => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 0; i < n; i++) d.addPage([400, 500]).drawText(`${name} ${i + 1}`, { x: 40, y: 450, size: 20, font: f }); const p = path.join(OUT, name + '.pdf'); fs.writeFileSync(p, await d.save()); return p; };
  const png = (n, c) => { const p = path.join(OUT, n); fs.writeFileSync(p, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="${c}"/></svg>`).render().asPng()); return p; };
  const A = await mk('Uno', 2), B = await mk('Dos', 3);
  const I1 = png('a.png', '#2563eb'), I2 = png('b.png', '#16a34a');

  const exe = require(path.join(__dirname, '..', '..', 'node_modules', 'electron')); // ruta del ejecutable en cualquier sistema
  const root = path.join(__dirname, '..', '..');
  // Explorer lanza un proceso por archivo; aquí se hace igual
  const explorer = async (action, files) => {
    for (const f of files) { spawn(exe, [root, `--pm-action=${action}`, f], { stdio: 'ignore', detached: true }).unref(); await sleep(250); }
  };
  const modalTitle = () => run(`document.querySelector('.modal h2')?.textContent || ''`);
  const waitModal = async (t) => { const t0 = Date.now(); for (let i = 0; i < 100; i++) { if ((await modalTitle()).includes(t)) { console.log(`     (diálogo «${t}» tras ${Date.now() - t0} ms)`); return true; } await sleep(200); } console.log(`     (sin diálogo «${t}»; modal actual: «${await modalTitle()}»)`); return false; };
  const closeModal = async () => { await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(500); };

  win.setSize(1440, 900);
  await sleep(1000);

  await explorer('merge', [A, B]);
  check('Unir PDFs: dos procesos se agrupan en un solo diálogo', await waitModal('Unir PDFs'));
  check('el diálogo trae los 2 archivos seleccionados', (await run(`document.querySelectorAll('.modal .fileitem').length`)) === 2, String(await run(`document.querySelectorAll('.modal .fileitem').length`)));
  await shot(path.join(OUT, 'merge.png'));
  await closeModal();

  await explorer('compress', [A]);
  check('Comprimir: abre el PDF y muestra el diálogo', await waitModal('Comprimir'));
  check('el documento de la acción está abierto', (await run(`window.__pm.S.cur && window.__pm.S.cur.name`)) === 'Uno.pdf');
  await closeModal();

  await explorer('imgs2pdf', [I1, I2]);
  check('Imágenes a PDF: agrupa las 2 imágenes', await waitModal('Imágenes a PDF') && (await run(`document.querySelectorAll('.modal .fileitem').length`)) === 2);
  await closeModal();

  await explorer('open', [B]);
  for (let i = 0; i < 30 && (await run(`window.__pm.S.docs.length`)) < 2; i++) await sleep(200);
  check('Abrir con PDF Master', (await run(`window.__pm.S.docs.map(d=>d.name).join(',')`)).includes('Dos.pdf'));

  await explorer('sign', [B]);
  check('Firmar: abre el diálogo de firma', await waitModal('Firmar'));
  await closeModal();

  console.log(`\nRESUMEN: ${results.filter(Boolean).length}/${results.length}`);
};
