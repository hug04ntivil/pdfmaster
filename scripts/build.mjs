// Empaqueta el renderer (src/) en dist/ y copia los recursos de los motores (pdf.js, OCR).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  outfile: path.join(dist, 'renderer.js'),
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  minify: process.env.PM_DEBUG ? false : true,
  sourcemap: !!process.env.PM_DEBUG,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
});

copy(path.join(root, 'src', 'index.html'), path.join(dist, 'index.html'));
copy(path.join(root, 'src', 'styles.css'), path.join(dist, 'styles.css'));
copy(nm('pdfjs-dist', 'web', 'pdf_viewer.css'), path.join(dist, 'pdf_viewer.css'));
copy(path.join(root, 'assets', 'icon.png'), path.join(dist, 'icon.png'));
copy(path.join(root, 'assets', 'icon.svg'), path.join(dist, 'icon.svg'));

// Fuentes de respaldo para la edición de texto (Carlito, Caladea, Arimo, Tinos, Cousine: licencias libres OFL/Apache)
for (const fam of ['carlito', 'caladea', 'arimo', 'tinos', 'cousine']) {
  const dir = nm('@expo-google-fonts', fam);
  for (const sub of fs.readdirSync(dir)) {
    const d = path.join(dir, sub);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (/^(Carlito|Caladea|Arimo|Tinos|Cousine)_(400Regular|700Bold)(_Italic)?\.ttf$/.test(f)) copy(path.join(d, f), path.join(dist, 'fonts', f));
  }
}

// pdf.js: worker + recursos (cmaps, fuentes estándar, decodificadores wasm)
copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), path.join(dist, 'pdfjs', 'pdf.worker.mjs'));
copy(nm('pdfjs-dist', 'cmaps'), path.join(dist, 'pdfjs', 'cmaps'));
copy(nm('pdfjs-dist', 'standard_fonts'), path.join(dist, 'pdfjs', 'standard_fonts'));
copy(nm('pdfjs-dist', 'wasm'), path.join(dist, 'pdfjs', 'wasm'));
copy(nm('pdfjs-dist', 'iccs'), path.join(dist, 'pdfjs', 'iccs'));

// OCR (tesseract.js): worker, núcleo wasm (solo LSTM) y datos de idioma español/inglés
copy(nm('tesseract.js', 'dist', 'worker.min.js'), path.join(dist, 'tesseract', 'worker.min.js'));
for (const f of fs.readdirSync(nm('tesseract.js-core'))) {
  if (f.endsWith('-lstm.wasm.js')) copy(nm('tesseract.js-core', f), path.join(dist, 'tesseract', 'core', f));
}
for (const lang of ['eng', 'spa']) {
  copy(
    nm('@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
    path.join(dist, 'tessdata', `${lang}.traineddata.gz`)
  );
}

console.log('Renderer compilado en dist/');
