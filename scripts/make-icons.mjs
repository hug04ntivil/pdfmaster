// Genera assets/icon.png (512) e icon.ico (multi-tamaño) a partir de assets/icon.svg
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'));
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.writeFileSync(path.join(root, 'assets', 'icon.png'), render(512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = await pngToIco(sizes.map(render));
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);
console.log('Iconos generados en assets/ (icon.png, icon.ico)');
