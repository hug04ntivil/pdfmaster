const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
module.exports = async ({ run, sleep, shot, win }) => {
  win.setSize(1440, 900);
  const file = path.join(os.tmpdir(), 'pdfmaster-e2e', 'tools', 'B.pdf');
  await sleep(800);
  await run(`window.__pm.openPaths(${JSON.stringify([file])})`);
  await sleep(1200);
  console.log(await run(`(async()=>{ const v=window.__pm.viewer; const pt=await v.pageText(0); const m=pt.map[2]; const r=v.rectsFor(pt,m.start,m.end)[0]; return JSON.stringify({n:pt.map.length, str:m.it.str.slice(0,30), t:m.t, r, scale:v.scale}); })()`));
  await run(`window.__pm.OV.setTool('edittext')`);
  await sleep(200);
  const p = JSON.parse(await run(`(async()=>{ const v=window.__pm.viewer; const pt=await v.pageText(0); const m=pt.map[2]; const r=v.rectsFor(pt,m.start,m.end)[0]; const l=document.querySelector('.ov-layer').getBoundingClientRect(); return JSON.stringify({x:l.left+(r.x+r.w/2)*v.scale, y:l.top+(r.y+r.h/2)*v.scale}); })()`));
  console.log('click en', p);
  await run(`(()=>{ const l=document.querySelector('.ov-layer'); l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:${p.x},clientY:${p.y},button:0,pointerId:1})); return 1; })()`);
  await sleep(800);
  console.log('overlays:', await run(`JSON.stringify(window.__pm.S.cur.overlays.map(o=>[o.type,o.text&&o.text.slice(0,20),o.size]))`));
  await shot(path.join(os.tmpdir(), 'pdfmaster-e2e', 'edittext.png'));
};
