// Prueba (solo macOS) de las Acciones rápidas de Finder: valida los plist y ejecuta el flujo con Automator.
// Uso: node scripts/e2e/qa-mac.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') { console.log('Solo se puede probar en macOS'); process.exit(0); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ms = createRequire(import.meta.url)(path.join(root, 'mac-services.js'));
let failed = 0;
const ok = (n, c, x = '') => { console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? ' — ' + x : '')); if (!c) failed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-qa-'));
process.env.PM_SERVICES_DIR = path.join(dir, 'Services');
const log = path.join(dir, 'llamada.txt');
const stub = path.join(dir, 'PDF Master stub.sh'); // se usa como si fuera el ejecutable de la app
fs.writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });

const n = ms.install(stub, { refresh: false });
ok('se crean 11 acciones rápidas (22 archivos)', n === 22 && ms.status().installed, `${n} archivos`);
for (const a of ms.ACTIONS) {
  const base = path.join(process.env.PM_SERVICES_DIR, ms.bundleName(a), 'Contents');
  for (const f of ['Info.plist', 'document.wflow']) {
    const r = spawnSync('plutil', ['-lint', path.join(base, f)], { encoding: 'utf8' });
    if (r.status !== 0) ok(`${a.action}/${f} es un plist válido`, false, r.stdout + r.stderr);
  }
}
ok('todos los plist pasan plutil -lint', failed === 0);

// Ejecuta la acción "Unir PDFs" como lo haría Finder: recibe los archivos seleccionados como argumentos
const a = path.join(dir, 'uno.pdf'), b = path.join(dir, 'dos.pdf');
fs.writeFileSync(a, '%PDF-1.4'); fs.writeFileSync(b, '%PDF-1.4');
const wf = path.join(process.env.PM_SERVICES_DIR, ms.bundleName(ms.ACTIONS.find((x) => x.action === 'merge')));
const r = spawnSync('automator', ['-i', a, wf], { encoding: 'utf8', timeout: 60000 });
console.log('  automator →', r.status, (r.stdout || '').trim().slice(0, 200), (r.stderr || '').trim().slice(0, 300));
await new Promise((res) => setTimeout(res, 2000));
const called = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
ok('Automator ejecuta la acción y entrega --pm-action y el archivo', /--pm-action=merge/.test(called) && called.includes('uno.pdf'), called.trim());
// varios archivos a la vez (Finder entrega todos los seleccionados); la entrada por stdin separa por saltos de línea
fs.rmSync(log, { force: true });
spawnSync('automator', ['-i', '-', wf], { encoding: 'utf8', input: `${a}\n${b}\n`, timeout: 60000 });
await new Promise((res) => setTimeout(res, 2000));
const called2 = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
console.log('  (informativo) varios archivos →', called2.trim() || '(sin salida)');

ok('desinstalar elimina las acciones', ms.uninstall() === 11 && !ms.status().installed);
process.exit(failed ? 1 : 0);
