// Comprueba la versión EMPAQUETADA (release/win-unpacked) conectándose por CDP. Uso: node scripts/e2e/packaged-smoke.mjs <ruta.pdf>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'release', 'win-unpacked', 'PDF Master.exe');
const pdf = process.argv[2];
const port = 9333;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-packaged-'));
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });
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
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); };

await sleep(1500);
ok('título de la ventana', (await ev('document.title')) === 'PDF Master');
ok('pantalla de bienvenida con herramientas', (await ev(`document.querySelectorAll('.card').length`)) >= 6 && (await ev(`document.querySelectorAll('#tools .tool').length`)) > 40, (await ev(`document.querySelectorAll('#tools .tool').length`)) + ' herramientas');
ok('versión', (await ev('window.pm.info().then(i=>i.version)')) === '1.0.0' && (await ev('window.pm.info().then(i=>i.packaged)')) === true);
if (pdf) {
  await ev(`window.__pm ? 1 : 0`);
  // abre el PDF a través de la API expuesta de la app (la ruta se envía al proceso principal)
  const opened = await ev(`(async()=>{ const f = await window.pm.readFile(${JSON.stringify(pdf)}); const { default: x } = { default: null }; return f.name; })()`);
  ok('lectura de archivo desde el renderer', opened === path.basename(pdf));
  await ev(`window.__pm && window.__pm.openPaths([${JSON.stringify(pdf)}])`);
  for (let i = 0; i < 40; i++) { if (await ev(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`)) break; await sleep(250); }
  ok('PDF abierto y dibujado en el visor', await ev(`[...document.querySelectorAll('.pcanvas')].some(c=>c.width>0)`), (await ev(`document.querySelectorAll('.thumb').length`)) + ' páginas');
  ok('capa de texto presente', (await ev(`document.querySelectorAll('.textLayer span').length`)) > 0);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(os.tmpdir(), 'pdfmaster-packaged.png'), Buffer.from(shot.result.data, 'base64'));
await ev(`document.documentElement.dataset.theme='light'`);
await sleep(400);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(os.tmpdir(), 'pdfmaster-packaged-light.png'), Buffer.from(shot2.result.data, 'base64'));
ws.close();
child.kill();
await sleep(500);
fs.rmSync(userData, { recursive: true, force: true });
console.log(out.every(Boolean) ? '\nVersión empaquetada: todo correcto' : '\nHAY FALLOS');
process.exit(out.every(Boolean) ? 0 : 1);
