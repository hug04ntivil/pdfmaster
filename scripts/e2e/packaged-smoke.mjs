// Comprueba la versión EMPAQUETADA (release/win-unpacked) conectándose por CDP. Uso: node scripts/e2e/packaged-smoke.mjs <ruta.pdf>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Aplicación empaquetada según la plataforma (Windows: win-unpacked; macOS: mac-universal o mac-arm64/mac)
const exe = process.platform === 'darwin'
  ? ['mac-universal', 'mac-arm64', 'mac'].map((d) => path.join(root, 'release', d, 'PDF Master.app', 'Contents', 'MacOS', 'PDF Master')).find((p) => fs.existsSync(p))
  : path.join(root, 'release', 'win-unpacked', 'PDF Master.exe');
if (!exe) throw new Error('No se encontró la aplicación empaquetada en release/');
const pdf = process.argv[2];
const port = 9333;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-packaged-'));
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* aún no */ }
}
if (!target) { child.kill(); throw new Error('La aplicación empaquetada no abrió ninguna ventana'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push(m.params.args.map((a) => a.value || a.description).join(' ')); });
const send = (method, params = {}, ms = 15000) => new Promise((res) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); res({ result: {}, timeout: true }); }, ms); pend.set(i, (m) => { clearTimeout(to); res(m); }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };

await send('Runtime.enable');
await send('Page.bringToFront'); // la ventana puede quedar tapada por otra: sin esto Chromium no pinta
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await sleep(1500);
ok('título de la ventana', (await ev('document.title')) === 'PDF Master');
ok('pantalla de bienvenida con herramientas', (await ev(`document.querySelectorAll('.card').length`)) >= 6 && (await ev(`document.querySelectorAll('#tools .tool').length`)) > 40, (await ev(`document.querySelectorAll('#tools .tool').length`)) + ' herramientas');
const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
ok('versión y empaquetado', (await ev('window.pm.info().then(i=>i.version)')) === expected && (await ev('window.pm.info().then(i=>i.packaged)')) === true, `${expected} en ${process.platform}`);
ok('plataforma de la interfaz', (await ev('document.body.classList.contains("mac") || document.body.classList.contains("win")')) === true);
ok('fuentes del sistema', (await ev('window.pm.listFonts().then(f=>Object.keys(f).includes("Arial"))')) === true);
if (pdf) {
  await ev(`window.__pm ? 1 : 0`);
  // abre el PDF a través de la API expuesta de la app (la ruta se envía al proceso principal)
  const opened = await ev(`(async()=>{ const f = await window.pm.readFile(${JSON.stringify(pdf)}); const { default: x } = { default: null }; return f.name; })()`);
  ok('lectura de archivo desde el renderer', opened === path.basename(pdf));
  await ev(`window.__pm && window.__pm.openPaths([${JSON.stringify(pdf)}])`);
  for (let i = 0; i < 40; i++) { if (await ev(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`)) break; await sleep(250); }
  console.log('  estado tras abrir:', await ev(`JSON.stringify({docs: window.__pm.S.docs.length, cur: !!window.__pm.S.cur, np: window.__pm.S.cur && window.__pm.S.cur.numPages, vpages: window.__pm.viewer.pages.length, canvases: [...document.querySelectorAll('.pcanvas')].map(c=>c.width), toasts: [...document.querySelectorAll('.toast')].map(t=>t.textContent), welcome: !document.querySelector('#welcome').hidden, win: innerWidth + 'x' + innerHeight, hidden: document.hidden, vis: document.visibilityState, scrollH: document.querySelector('#viewer-scroll').clientHeight, pageH: window.__pm.viewer.pages[0] && window.__pm.viewer.pages[0].el.offsetHeight, rendered: window.__pm.viewer.pages.map(p=>p.rendered), scrollVis: getComputedStyle(document.querySelector('#viewer-scroll')).visibility})`));
  ok('PDF abierto y dibujado en el visor', await ev(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`), (await ev(`document.querySelectorAll('.thumb').length`)) + ' páginas');
  for (let i = 0; i < 40; i++) { if ((await ev(`document.querySelectorAll('.textLayer span').length`)) > 0) break; await sleep(250); } // la capa de texto se dibuja después del lienzo
  ok('capa de texto presente', (await ev(`document.querySelectorAll('.textLayer span').length`)) > 0);
}
if (errs.length) console.log('  errores en la consola:\n   ' + errs.slice(0, 5).join('\n   ').slice(0, 900));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result.data) fs.writeFileSync(path.join(os.tmpdir(), 'pdfmaster-packaged.png'), Buffer.from(shot.result.data, 'base64'));
await ev(`document.documentElement.dataset.theme='light'`);
await sleep(400);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
if (shot2.result.data) fs.writeFileSync(path.join(os.tmpdir(), 'pdfmaster-packaged-light.png'), Buffer.from(shot2.result.data, 'base64'));
ws.close();
child.kill();
await sleep(500);
fs.rmSync(userData, { recursive: true, force: true });
console.log(out.every(Boolean) ? '\nVersión empaquetada: todo correcto' : '\nHAY FALLOS');
process.exit(out.every(Boolean) ? 0 : 1);
