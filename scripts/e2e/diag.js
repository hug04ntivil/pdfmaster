const path = require('node:path');
const os = require('node:os');
module.exports = async ({ run, sleep, win, shot }) => {
  win.setSize(1440, 900);
  await sleep(1200);
  await run(`document.documentElement.dataset.theme='dark'`);
  await sleep(300);
  await shot(path.join(os.tmpdir(), 'pdfmaster-e2e', 'bienvenida.png'));
};
