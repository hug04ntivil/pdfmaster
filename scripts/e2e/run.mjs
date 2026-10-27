// Ejecuta una prueba E2E de PDF Master en Electron en cualquier sistema (Windows, macOS).
// Uso: node scripts/e2e/run.mjs scripts/e2e/tools.js [segundos]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = process.argv[2] || 'scripts/e2e/smoke.js';
const timeout = (parseInt(process.argv[3], 10) || 500) * 1000;
const electron = createRequire(import.meta.url)(path.join(root, 'node_modules', 'electron'));

const build = spawn(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, PM_DEBUG: '1' } });
await new Promise((res, rej) => build.on('close', (c) => (c === 0 ? res() : rej(new Error('falló la compilación del renderer')))));

const outDir = path.join(os.tmpdir(), 'pdfmaster-e2e');
fs.mkdirSync(outDir, { recursive: true });
const child = spawn(electron, [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
  cwd: root,
  env: { ...process.env, PM_E2E: script, PM_DEBUG: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { const s = String(d); if (!/ERROR:(net|gpu|ui|viz|dbus|sandbox)|Autofill|DevTools|Fontconfig/.test(s)) process.stderr.write(d); });
const timer = setTimeout(() => { console.log('KILLED (timeout)'); child.kill('SIGKILL'); }, timeout);
await new Promise((r) => child.on('close', r));
clearTimeout(timer);
// código de salida distinto de cero si alguna comprobación falló
const failed = /\bFAIL\b/.test(out) || /E2E ERROR/.test(out) || /KILLED/.test(out);
process.exit(failed ? 1 : 0);
