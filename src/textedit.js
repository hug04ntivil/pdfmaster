// Edición de texto fiel al original: reescribe las operaciones de texto del propio PDF reutilizando su fuente incrustada.
// Para los caracteres que la fuente (un subconjunto) no trae se usa la misma fuente instalada o una de métricas equivalentes.
// Sin DOM: se prueba en Node con scripts/selftest-textedit.mjs
import { PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream } from '@cantoo/pdf-lib';
import { fontkitSafe, BUNDLED_FILES as BUNDLED } from './engine.js';
export { BUNDLED };

// ---------------------------------------------------------------- tokenizador del contenido
const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach((c) => { WS[c] = 1; });
const DL = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach((ch) => { DL[ch.charCodeAt(0)] = 1; });
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const dec = new TextDecoder('latin1');

/** Convierte el contenido en operaciones {op, args, s (inicio del 1.er operando), os (inicio del operador), e (fin)}. */
export function parseContent(b) {
  const n = b.length;
  let i = 0;
  const ops = [];
  let args = [];
  const skipWs = () => {
    while (i < n) {
      const c = b[i];
      if (WS[c]) i++;
      else if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; } else break;
    }
  };
  const readString = () => {
    const s = i; i++;
    let depth = 1;
    const out = [];
    while (i < n && depth > 0) {
      let c = b[i++];
      if (c === 92) {
        c = b[i++];
        if (c === 110) out.push(10); else if (c === 114) out.push(13); else if (c === 116) out.push(9); else if (c === 98) out.push(8); else if (c === 102) out.push(12);
        else if (c === 40 || c === 41 || c === 92) out.push(c);
        else if (c === 13) { if (b[i] === 10) i++; } else if (c === 10) { /* continuación de línea */ } else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
          out.push(v & 255);
        } else out.push(c);
      } else if (c === 40) { depth++; out.push(c); } else if (c === 41) { depth--; if (depth > 0) out.push(c); } else out.push(c);
    }
    return { t: 's', bytes: Uint8Array.from(out), s, e: i };
  };
  const readHex = () => {
    const s = i; i++;
    const hex = [];
    while (i < n && b[i] !== 62) { const c = b[i++]; if (!WS[c]) hex.push(String.fromCharCode(c)); }
    i++;
    if (hex.length % 2) hex.push('0');
    const out = new Uint8Array(hex.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(hex[k * 2] + hex[k * 2 + 1], 16) || 0;
    return { t: 's', bytes: out, hex: true, s, e: i };
  };
  const readObject = () => {
    skipWs();
    const c = b[i];
    if (c === 40) return readString();
    if (c === 60) {
      if (b[i + 1] === 60) { // diccionario: se omite su contenido
        const s = i; i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (b[i] === 60 && b[i + 1] === 60) { depth++; i += 2; } else if (b[i] === 62 && b[i + 1] === 62) { depth--; i += 2; } else if (b[i] === 40) readString(); else i++;
        }
        return { t: 'd', s, e: i };
      }
      return readHex();
    }
    if (c === 91) {
      const s = i; i++;
      const items = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (b[i] === 93) { i++; break; }
        const o = readObject();
        if (!o) { i++; continue; }
        items.push(o);
      }
      return { t: 'a', items, s, e: i };
    }
    if (c === 47) {
      const s = i; i++;
      while (i < n && !WS[b[i]] && !DL[b[i]]) i++;
      const raw = dec.decode(b.subarray(s + 1, i)).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { t: '/', v: raw, s, e: i };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { i++; return null; }
    const s = i;
    while (i < n && !WS[b[i]] && !DL[b[i]]) i++;
    if (i === s) { i++; return null; }
    const w = dec.decode(b.subarray(s, i));
    if (NUM_RE.test(w)) return { t: 'n', v: parseFloat(w), s, e: i, text: w };
    return { t: 'w', v: w, s, e: i };
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    const tok = readObject();
    if (!tok) continue;
    if (tok.t === 'w') {
      if (tok.v === 'true' || tok.v === 'false' || tok.v === 'null') { args.push({ ...tok, t: 'l' }); continue; }
      if (tok.v === 'BI') { // imagen en línea: se salta hasta EI
        const os = tok.s;
        while (i < n) {
          if (b[i] === 73 && b[i + 1] === 68 && (WS[b[i + 2]] || i + 2 >= n) && (WS[b[i - 1]] || DL[b[i - 1]])) { i += 3; break; }
          i++;
        }
        while (i < n) {
          if (b[i] === 69 && b[i + 1] === 73 && WS[b[i - 1]] && (i + 2 >= n || WS[b[i + 2]] || DL[b[i + 2]])) { i += 2; break; }
          i++;
        }
        ops.push({ op: 'BI', args: [], s: os, os, e: i });
        args = [];
        continue;
      }
      ops.push({ op: tok.v, args, s: args.length ? args[0].s : tok.s, os: tok.s, e: tok.e });
      args = [];
    } else args.push(tok);
  }
  return ops;
}

// ---------------------------------------------------------------- tablas de codificación
const cp1252 = new TextDecoder('windows-1252');
const macRoman = new TextDecoder('macintosh');
const tableOf = (decoder) => Array.from({ length: 256 }, (_, c) => (c < 32 ? '' : decoder.decode(Uint8Array.of(c))));
const WINANSI = tableOf(cp1252);
const MACROMAN = tableOf(macRoman);
const GLYPH_NAMES = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  endash: '–', emdash: '—', quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', bullet: '•', ellipsis: '…', Euro: '€',
  fi: 'ﬁ', fl: 'ﬂ', germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', eth: 'ð', Eth: 'Ð', thorn: 'þ', Thorn: 'Þ', ccedilla: 'ç', Ccedilla: 'Ç',
  ntilde: 'ñ', Ntilde: 'Ñ', oslash: 'ø', Oslash: 'Ø', section: '§', degree: '°', copyright: '©', registered: '®', trademark: '™', exclamdown: '¡',
  questiondown: '¿', guillemotleft: '«', guillemotright: '»', periodcentered: '·', multiply: '×', divide: '÷', cent: '¢', sterling: '£', yen: '¥',
  currency: '¤', brokenbar: '¦', dieresis: '¨', macron: '¯', acute: '´', cedilla: '¸', plusminus: '±', onehalf: '½', onequarter: '¼', threequarters: '¾',
  mu: 'µ', paragraph: '¶', ordfeminine: 'ª', ordmasculine: 'º', logicalnot: '¬', Scaron: 'Š', scaron: 'š', Zcaron: 'Ž', zcaron: 'ž', Ydieresis: 'Ÿ',
};
const ACCENTS = { grave: '̀', acute: '́', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', caron: '̌' };
function glyphNameToUnicode(name) {
  if (GLYPH_NAMES[name] !== undefined) return GLYPH_NAMES[name];
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  if (name.length === 1) return name;
  m = /^([A-Za-z])(grave|acute|circumflex|tilde|dieresis|ring|caron)$/.exec(name);
  if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC');
  return '';
}

// ---------------------------------------------------------------- fuentes del PDF
const nameOf = (o) => (o instanceof PDFName ? o.asString().slice(1) : '');
function streamBytes(ctx, obj) {
  if (!obj) return null;
  if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
  if (typeof obj.getUnencodedContents === 'function') return obj.getUnencodedContents();
  return null;
}
const hexToStr = (h) => {
  let s = '';
  for (let k = 0; k + 3 < h.length + 1; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
  return s;
};
/** Analiza un CMap ToUnicode: devuelve Map código -> cadena Unicode. */
export function parseToUnicode(bytes) {
  const text = dec.decode(bytes);
  const map = new Map();
  let m;
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bfchar.exec(text))) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let p;
    while ((p = re.exec(m[1]))) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrange.exec(text))) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g;
    let p;
    while ((p = re.exec(m[1]))) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
      if (p[3][0] === '<') {
        const base = hexToStr(p[3].slice(1, -1));
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const last = base.charCodeAt(base.length - 1) + (c - lo);
          map.set(c, base.slice(0, -1) + String.fromCharCode(last));
        }
      } else {
        const items = [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToStr(x[1]));
        items.forEach((s, k) => map.set(lo + k, s));
      }
    }
  }
  return map;
}

/** Resumen de una fuente del recurso de la página. */
function buildFontInfo(ctx, dict, res) {
  const subtype = nameOf(dict.get(PDFName.of('Subtype')));
  const baseFull = nameOf(dict.get(PDFName.of('BaseFont'))) || res;
  const info = { res, subtype, baseFull, base: baseFull.replace(/^[A-Z]{6}\+/, ''), composite: subtype === 'Type0', bpc: 1, toUni: new Map(), uniToCode: new Map(), unsupported: '', flags: 0, embedded: false };
  if (subtype === 'Type3') { info.unsupported = 'Type3'; return info; }
  let desc = dict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  if (info.composite) {
    info.bpc = 2;
    const enc = dict.get(PDFName.of('Encoding'));
    const encName = nameOf(enc);
    if (encName !== 'Identity-H' && encName !== 'Identity-V') info.unsupported = 'CMap ' + (encName || 'incrustado');
    const df = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    const d0 = df && ctx.lookupMaybe(df.get(0), PDFDict);
    if (d0) desc = d0.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  }
  if (desc) {
    const fl = desc.get(PDFName.of('Flags'));
    info.flags = fl && typeof fl.asNumber === 'function' ? fl.asNumber() : 0;
    info.embedded = ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(PDFName.of(k)));
  }
  const tu = dict.get(PDFName.of('ToUnicode'));
  const tuBytes = tu ? streamBytes(ctx, ctx.lookup(tu)) : null;
  if (tuBytes) info.toUni = parseToUnicode(tuBytes);
  else if (!info.composite) {
    // fuente simple sin ToUnicode: la codificación define los caracteres
    const enc = dict.get(PDFName.of('Encoding'));
    let base = 'StandardEncoding';
    let diffs = null;
    const encObj = enc instanceof PDFRef ? ctx.lookup(enc) : enc;
    if (encObj instanceof PDFName) base = encObj.asString().slice(1);
    else if (encObj instanceof PDFDict) {
      const be = encObj.get(PDFName.of('BaseEncoding'));
      if (be) base = nameOf(be);
      diffs = encObj.lookupMaybe(PDFName.of('Differences'), PDFArray);
    }
    const table = base === 'MacRomanEncoding' ? MACROMAN : WINANSI;
    for (let c = 32; c < 256; c++) if (table[c]) info.toUni.set(c, table[c]);
    if (diffs) {
      let code = 0;
      for (let k = 0; k < diffs.size(); k++) {
        const o = ctx.lookup(diffs.get(k));
        if (o instanceof PDFName) { const u = glyphNameToUnicode(o.asString().slice(1)); if (u) info.toUni.set(code, u); else info.toUni.delete(code); code++; } else if (o && typeof o.asNumber === 'function') code = o.asNumber();
      }
    } else if (info.embedded && !encObj && /Symbol|Dingbats/i.test(info.base)) info.unsupported = 'símbolos';
  } else info.unsupported = 'sin ToUnicode';
  for (const [code, u] of info.toUni) {
    const cps = [...u];
    if (cps.length === 1 && !info.uniToCode.has(u)) info.uniToCode.set(u, code);
  }
  return info;
}

function pageLeaf(pdfDoc, index) {
  return pdfDoc.getPage(index).node;
}
/** Mapa nombre de recurso -> información de la fuente, para la página. */
export function loadPageFonts(pdfDoc, pageIndex) {
  const ctx = pdfDoc.context;
  const leaf = pageLeaf(pdfDoc, pageIndex);
  const out = new Map();
  const res = leaf.Resources();
  const fd = res && res.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fd) return out;
  for (const [k, v] of fd.entries()) {
    const d = ctx.lookupMaybe(v, PDFDict);
    if (d) out.set(nameOf(k), buildFontInfo(ctx, d, nameOf(k)));
  }
  return out;
}

// ---------------------------------------------------------------- intérprete del texto de la página
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const num = (t) => (t && t.t === 'n' ? t.v : 0);

/** Recorre las operaciones y devuelve cada operación de mostrar texto con su posición y caracteres decodificados. */
export function scanText(ops, fonts, widthOf, bytes) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
  let font = '', fs = 0, fsTok = '', fontOp = null, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
  let fill = '0 g';
  const shows = [];
  const nextLine = () => { tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); };
  const decodeStr = (tok, fi) => {
    const chars = [];
    const bytesArr = tok.bytes;
    for (let p = 0; p < bytesArr.length; p += fi.bpc) {
      const code = fi.bpc === 2 ? (bytesArr[p] << 8) | (bytesArr[p + 1] || 0) : bytesArr[p];
      chars.push({ code, u: fi.toUni.get(code) ?? '�', bpc: fi.bpc });
    }
    return chars;
  };
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    const a = o.args;
    switch (o.op) {
      case 'q': stack.push({ ctm, font, fs, fsTok, fontOp, tc, tw, th, tl, rise, fill }); break;
      case 'Q': { const s = stack.pop(); if (s) ({ ctm, font, fs, fsTok, fontOp, tc, tw, th, tl, rise, fill } = s); break; }
      case 'cm': if (a.length >= 6) ctm = mul(a.slice(0, 6).map(num), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': font = a[0] && a[0].v; fs = num(a[1]); fsTok = a[1] ? a[1].text : '12'; fontOp = o; break;
      case 'Tc': tc = num(a[0]); break;
      case 'Tw': tw = num(a[0]); break;
      case 'Tz': th = num(a[0]) / 100; break;
      case 'TL': tl = num(a[0]); break;
      case 'Ts': rise = num(a[0]); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm.slice(); break;
      case 'TD': tl = -num(a[1]); tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm.slice(); break;
      case 'Tm': if (a.length >= 6) { tlm = a.slice(0, 6).map(num); tm = tlm.slice(); } break;
      case 'T*': nextLine(); break;
      case 'g': case 'rg': case 'k': case 'G': case 'RG': case 'K': if (o.op === 'g' || o.op === 'rg' || o.op === 'k') fill = a.map((t) => t.text).join(' ') + ' ' + o.op; break;
      case 'Tj': case 'TJ': case "'": case '"': {
        let strArgs = a;
        let prefix = '';
        if (o.op === "'") { nextLine(); prefix = 'T*'; } else if (o.op === '"') { tw = num(a[0]); tc = num(a[1]); nextLine(); strArgs = [a[2]]; prefix = `${a[0].text} Tw ${a[1].text} Tc T*`; }
        const fi = fonts.get(font);
        const show = { op: o, k, kind: o.op, prefix, font, fi, fs, fsTok, fontOp, fill, tc, tw, th, ctm: ctm.slice(), tm: tm.slice(), elems: [], unsupported: !fi || !!fi.unsupported };
        const trm0 = mul([fs * th, 0, 0, fs, 0, rise], mul(tm, ctm));
        show.origin = [trm0[4], trm0[5]];
        show.size = Math.hypot(trm0[2], trm0[3]);
        show.upright = Math.abs(trm0[1]) < 1e-6 && Math.abs(trm0[2]) < 1e-6 && trm0[0] > 0 && trm0[3] > 0;
        show.xScale = fs * th ? trm0[0] / (fs * th) : 1; // espacio de texto -> usuario en horizontal
        const items = o.op === 'TJ' ? (strArgs[0] && strArgs[0].items) || [] : strArgs.filter((t) => t.t === 's');
        for (const it of items) {
          if (it.t === 'n') {
            show.elems.push({ kind: 'num', text: it.text, v: it.v });
            tm = mul([1, 0, 0, 1, (-(it.v / 1000) * fs) * th, 0], tm);
          } else if (it.t === 's') {
            if (!fi || fi.unsupported) { show.elems.push({ kind: 'raw', tok: it, chars: [] }); continue; }
            const chars = decodeStr(it, fi);
            show.elems.push({ kind: 'str', tok: it, chars });
            for (const ch of chars) {
              const w = widthOf(fi, ch.code);
              ch.w = w;
              const tx = ((w / 1000) * fs + tc + (ch.code === 32 && fi.bpc === 1 ? tw : 0)) * th;
              tm = mul([1, 0, 0, 1, tx, 0], tm);
            }
          }
        }
        show.text = show.elems.map((e) => (e.kind === 'str' ? e.chars.map((c) => c.u).join('') : '')).join('');
        shows.push(show);
        break;
      }
      default: break;
    }
  }
  void bytes;
  return shows;
}

// ---------------------------------------------------------------- localizar el texto pulsado
const strip = (s) => s.replace(/[\s ]+/g, '');
const isSp = (c) => /[\s ]/.test(c);

/** item: {x, y, str} en espacio de usuario del PDF (origen de línea base). */
export function locateItem(shows, item) {
  const target = strip(item.str);
  if (!target) return null;
  const tryFrom = (idx) => {
    let acc = '';
    const win = [];
    for (let j = idx; j < shows.length; j++) {
      const s = shows[j];
      if (s.unsupported) return null;
      acc += strip(s.text);
      win.push(s);
      if (acc.length >= target.length) return acc.startsWith(target) ? win : null;
      if (!target.startsWith(acc)) return null;
    }
    return null;
  };
  const near = [];
  shows.forEach((s, idx) => { if (Math.abs(s.origin[0] - item.x) < 3 && Math.abs(s.origin[1] - item.y) < 3) near.push(idx); });
  for (const idx of near) { const w = tryFrom(idx); if (w) return w; }
  // sin coincidencia por posición: se acepta si el texto aparece una sola vez
  const hits = [];
  shows.forEach((s, idx) => { if (!s.unsupported && strip(s.text) && target.startsWith(strip(s.text).slice(0, Math.min(target.length, strip(s.text).length)))) { const w = tryFrom(idx); if (w) hits.push(w); } });
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------- fuentes de respaldo
const SYSTEM_FAMILIES = [
  ['timesnewroman', 'Times New Roman'], ['arial', 'Arial'], ['couriernew', 'Courier New'], ['calibri', 'Calibri'], ['cambria', 'Cambria'], ['georgia', 'Georgia'],
  ['verdana', 'Verdana'], ['tahoma', 'Tahoma'], ['segoeui', 'Segoe UI'], ['consolas', 'Consolas'], ['trebuchet', 'Trebuchet'], ['helvetica', 'Arial'],
  ['times', 'Times New Roman'], ['courier', 'Courier New'],
];
/** Familias candidatas (la instalada con el mismo nombre primero, luego la equivalente incluida) para una fuente del PDF. */
export function matchFont(fi) {
  const n = fi.base.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bold = /bold|black|heavy|semibold|demi/.test(n) || !!(fi.flags & 262144);
  const italic = /italic|oblique|slanted/.test(n) || !!(fi.flags & 64);
  const out = [];
  const sys = SYSTEM_FAMILIES.find(([k]) => n.includes(k));
  if (sys) out.push({ kind: 'system', family: sys[1] });
  const fixed = !!(fi.flags & 1), serif = !!(fi.flags & 2);
  let bundled;
  if (/calibri|carlito/.test(n)) bundled = 'Carlito';
  else if (/cambria|caladea/.test(n)) bundled = 'Caladea';
  else if (/courier|cousine|mono|consolas|menlo|lucidaconsole|typewriter/.test(n) || fixed) bundled = 'Cousine';
  else if (/times|tinos|liberationserif|nimbusrom|georgia|garamond|palatino|minion|bookman|century|serif/.test(n) || (serif && !/sans|arial|helvet/.test(n))) bundled = 'Tinos';
  else bundled = 'Arimo';
  out.push({ kind: 'bundled', family: bundled });
  if (bundled !== 'Arimo') out.push({ kind: 'bundled', family: 'Arimo' });
  return { candidates: out, bold, italic };
}

/** Fuente de respaldo: se lee con fontkit para saber qué caracteres trae y solo se incrusta en el PDF si realmente se usa. */
async function getFallbackFont(pdfDoc, ctx, cand, bold, italic) {
  if (!pdfDoc.__pmFb) pdfDoc.__pmFb = new Map();
  const key = `${cand.kind}|${cand.family}|${bold}|${italic}`;
  if (pdfDoc.__pmFb.has(key)) return pdfDoc.__pmFb.get(key);
  let entry = null;
  try {
    let bytes = null;
    if (cand.kind === 'system') {
      const files = ctx.systemFonts && ctx.systemFonts[cand.family];
      const file = files && files[(bold ? 1 : 0) + (italic ? 2 : 0)];
      if (file && ctx.loadFont && !/\.(ttc|otc)$/i.test(file)) bytes = await ctx.loadFont(file);
    } else if (ctx.loadBundled) {
      const files = BUNDLED[cand.family];
      bytes = await ctx.loadBundled(files[(bold ? 1 : 0) + (italic ? 2 : 0)]);
    }
    if (bytes) {
      const fk = fontkitSafe.create(bytes);
      let font = null;
      entry = {
        family: cand.family, kind: cand.kind, cps: new Set(fk.characterSet),
        async embed() {
          if (!font) { pdfDoc.registerFontkit(fontkitSafe); font = await pdfDoc.embedFont(bytes, { subset: true }); }
          return font;
        },
      };
    }
  } catch { entry = null; }
  pdfDoc.__pmFb.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------- aplicar la edición
const hexOf = (codes, bpc) => '<' + codes.map((c) => c.toString(16).toUpperCase().padStart(bpc * 2, '0')).join('') + '>';

function readContents(pdfDoc, leaf) {
  const ctx = pdfDoc.context;
  const c = leaf.get(PDFName.of('Contents'));
  const list = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  const parts = [];
  for (const r of list) {
    const o = ctx.lookup(r);
    const b = streamBytes(ctx, o);
    if (!b) return null;
    parts.push(b);
  }
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; out[off++] = 10; }
  return out;
}

/**
 * Aplica una edición de texto a una página.
 * edit: {x, y, str, newText}  (x,y = origen de la línea base en espacio de usuario; str = texto original mostrado por pdf.js)
 * ctx:  {widthOf(fi, code), systemFonts, loadFont, loadBundled}
 * Devuelve {ok, reason, usedFallback, fontName}.
 */
export async function applyTextEdit(pdfDoc, pageIndex, edit, ctx) {
  const leaf = pageLeaf(pdfDoc, pageIndex);
  const bytes = readContents(pdfDoc, leaf);
  if (!bytes) return { ok: false, reason: 'contenido no editable' };
  const fonts = loadPageFonts(pdfDoc, pageIndex);
  const ops = parseContent(bytes);
  const shows = scanText(ops, fonts, ctx.widthOf || (() => 500), bytes);
  const win = locateItem(shows, edit);
  if (!win) return { ok: false, reason: 'no se encontró el texto en el contenido de la página' };
  if (win.some((s) => !s.upright)) return { ok: false, reason: 'texto girado' };

  // caracteres del PDF en el orden mostrado
  const opChars = [];
  for (const s of win) for (const e of s.elems) if (e.kind === 'str') for (const ch of e.chars) { [...ch.u].forEach((u, k) => opChars.push({ ch, u, k, n: [...ch.u].length, show: s, elem: e })); }
  const oldStr = edit.str, newStr = edit.newText;
  // alinear el texto de pdf.js con los caracteres del PDF (pdf.js puede añadir espacios que no están en el PDF)
  const map = new Array(oldStr.length).fill(-1);
  let j = 0;
  for (let k = 0; k < oldStr.length; k++) {
    const c = oldStr[k];
    while (j < opChars.length && isSp(opChars[j].u) && !isSp(c)) j++;
    if (j < opChars.length && (opChars[j].u === c || (isSp(opChars[j].u) && isSp(c)))) { map[k] = j; j++; } else if (isSp(c)) map[k] = -1;
    else return { ok: false, reason: 'el texto mostrado no coincide con el del PDF' };
  }
  const aligned = j;
  let pre = 0;
  while (pre < oldStr.length && pre < newStr.length && oldStr[pre] === newStr[pre]) pre++;
  let suf = 0;
  while (suf < oldStr.length - pre && suf < newStr.length - pre && oldStr[oldStr.length - 1 - suf] === newStr[newStr.length - 1 - suf]) suf++;
  if (pre === oldStr.length && pre === newStr.length) return { ok: true, reason: 'sin cambios', unchanged: true };
  let startOp = 0;
  for (let k = pre - 1; k >= 0; k--) if (map[k] >= 0) { startOp = map[k] + 1; break; }
  let endOp = aligned;
  for (let k = oldStr.length - suf; k < oldStr.length; k++) if (map[k] >= 0) { endOp = map[k]; break; }
  if (endOp < startOp) endOp = startOp;
  let R = newStr.slice(pre, newStr.length - suf);
  // un glifo con varios caracteres (ligadura "ti", "fi"…) no se puede partir: se sustituye completo y se reponen sus otras letras
  if (startOp < opChars.length && opChars[startOp].k > 0) {
    const back = opChars[startOp].k;
    R = opChars.slice(startOp - back, startOp).map((x) => x.u).join('') + R;
    startOp -= back;
  }
  if (endOp > 0 && endOp <= opChars.length && endOp - 1 < opChars.length) {
    const last = opChars[endOp - 1];
    if (last.k < last.n - 1) {
      const fwd = last.n - 1 - last.k;
      R += opChars.slice(endOp, endOp + fwd).map((x) => x.u).join('');
      endOp += fwd;
    }
  }

  // fuente de referencia para el texto insertado: la del primer carácter sustituido, o la del anterior
  if (startOp === endOp && startOp > 0 && startOp < opChars.length && opChars[startOp].k > 0) {
    const back = opChars[startOp].k;
    R = opChars.slice(startOp - back, startOp).map((x) => x.u).join('') + R;
    const fwd = opChars[startOp].n - opChars[startOp].k;
    R += opChars.slice(startOp, startOp + fwd).map((x) => x.u).join('');
    startOp -= back; endOp = startOp + back + fwd;
  }
  const refIdx = startOp < endOp ? startOp : Math.max(0, startOp - 1);
  const ref = opChars[Math.min(refIdx, opChars.length - 1)];
  const fi = ref.show.fi;
  const style = matchFont(fi);

  // dividir R en tramos: los que la fuente original puede codificar y los que necesitan respaldo
  const segs = [];
  const missing = new Set();
  for (const u of R) {
    const code = fi.uniToCode.get(u);
    const canOrig = code !== undefined && !(u === '\n');
    const last = segs[segs.length - 1];
    if (canOrig) {
      if (last && last.kind === 'orig') { last.codes.push(code); last.text += u; } else segs.push({ kind: 'orig', codes: [code], text: u });
    } else {
      missing.add(u);
      if (last && last.kind === 'fb') last.text += u; else segs.push({ kind: 'fb', text: u });
    }
  }
  // resolver las fuentes de respaldo
  const fbFonts = [];
  for (const cand of style.candidates) {
    const f = await getFallbackFont(pdfDoc, ctx, cand, style.bold, style.italic);
    if (f) fbFonts.push(f);
  }
  let usedFallback = '';
  const outSegs = [];
  const dropped = new Set();
  for (const s of segs) {
    if (s.kind === 'orig') { outSegs.push(s); continue; }
    // por carácter: la primera fuente de respaldo que lo tenga
    let cur = null;
    for (const u of s.text) {
      const f = fbFonts.find((x) => x.cps.has(u.codePointAt(0)));
      if (!f) {
        dropped.add(u);
        const q = fi.uniToCode.get('?');
        if (q !== undefined) { const last = outSegs[outSegs.length - 1]; if (last && last.kind === 'orig') { last.codes.push(q); last.text += '?'; } else outSegs.push({ kind: 'orig', codes: [q], text: '?' }); cur = null; }
        continue;
      }
      if (cur && cur.f === f) cur.text += u; else { cur = { kind: 'fb', f, text: u }; outSegs.push(cur); }
      usedFallback = f.family;
    }
  }
  if (outSegs.some((s) => s.kind === 'fb') && !pdfDoc.__pmFbNames) pdfDoc.__pmFbNames = new Map();
  // registrar las fuentes de respaldo en los recursos de la página
  leaf.normalize();
  for (const s of outSegs) {
    if (s.kind !== 'fb') continue;
    s.pdfFont = await s.f.embed();
    s.pdfFontForWidth = (u) => s.pdfFont.widthOfTextAtSize(u, 1000);
    const key = s.pdfFont.ref.toString();
    const pageKey = `${pageIndex}|${key}`;
    if (!pdfDoc.__pmFbNames.has(pageKey)) pdfDoc.__pmFbNames.set(pageKey, leaf.newFontDictionary('PMF', s.pdfFont.ref).asString());
    s.res = pdfDoc.__pmFbNames.get(pageKey).replace(/^\//, '');
  }

  // variación de ancho (en espacio de texto) de lo que se quita frente a lo que se pone
  const adv = (code, show, bpc) => (((ctx.widthOf ? ctx.widthOf(show.fi, code) : 500) / 1000) * show.fs + show.tc + (code === 32 && bpc === 1 ? show.tw : 0)) * show.th;
  let oldAdv = 0;
  const seenGlyph = new Set();
  for (let k = startOp; k < endOp; k++) { const oc = opChars[k]; if (seenGlyph.has(oc.ch)) continue; seenGlyph.add(oc.ch); oldAdv += adv(oc.ch.code, oc.show, oc.ch.bpc); }
  let newAdv = 0;
  for (const sg of outSegs) {
    if (sg.kind === 'orig') for (const c of sg.codes) newAdv += adv(c, ref.show, ref.ch.bpc);
    else for (const u of sg.text) newAdv += ((sg.pdfFontForWidth ? sg.pdfFontForWidth(u) : 500) / 1000) * ref.show.fs * 1 * ref.show.th + ref.show.tc * ref.show.th;
  }
  const dxUser = (newAdv - oldAdv) * ref.show.xScale;

  // marcar caracteres eliminados y el punto de inserción
  const removed = new Set();
  for (let k = startOp; k < endOp; k++) removed.add(opChars[k].ch);
  let anchor; // {elem, before: char | null}
  if (startOp < endOp) anchor = { elem: opChars[startOp].elem, beforeCh: opChars[startOp].ch };
  else if (startOp > 0) anchor = { elem: opChars[startOp - 1].elem, afterCh: opChars[startOp - 1].ch };
  else anchor = { elem: opChars[0].elem, beforeCh: opChars[0].ch };

  // reconstruir cada operación de mostrar texto afectada
  const edits = [];
  const touched = new Set();
  for (const oc of opChars) if (removed.has(oc.ch)) touched.add(oc.show);
  for (const s of win) if (s.elems.includes(anchor.elem)) touched.add(s);
  const resName = (s) => '/' + s.font.replace(/[^A-Za-z0-9_.-]/g, (m) => '#' + m.charCodeAt(0).toString(16));
  for (const s of touched) {
    const out = []; // piezas: {font:'orig'|segRes, kind:'str'|'num', ...}
    for (const e of s.elems) {
      if (e.kind === 'num') { out.push({ kind: 'num', text: e.text }); continue; }
      if (e.kind === 'raw') { out.push({ kind: 'raw', tok: e.tok }); continue; }
      const emitIns = () => { for (const sg of outSegs) out.push(sg.kind === 'orig' ? { kind: 'str', font: 'orig', codes: sg.codes } : { kind: 'str', font: sg.res, hex: sg.pdfFont.encodeText(sg.text).toString() }); };
      let buf = [];
      const flush = () => { if (buf.length) { out.push({ kind: 'str', font: 'orig', codes: buf }); buf = []; } };
      for (const ch of e.chars) {
        if (e === anchor.elem && anchor.beforeCh === ch) { flush(); emitIns(); }
        if (!removed.has(ch)) buf.push(ch.code);
        if (e === anchor.elem && anchor.afterCh === ch) { flush(); emitIns(); }
      }
      flush();
    }
    // serializar: agrupar por fuente
    const lines = [];
    if (s.prefix) lines.push(s.prefix);
    let curFont = 'orig';
    let group = [];
    const bpc = s.fi.bpc;
    const flushGroup = () => {
      if (!group.length) return;
      const hasNum = group.some((g) => g.kind === 'num');
      if (!hasNum && group.length === 1) lines.push(`${group[0].hex || hexOf(group[0].codes, bpc)} Tj`);
      else lines.push('[' + group.map((g) => (g.kind === 'num' ? g.text : g.hex || hexOf(g.codes, bpc))).join(' ') + '] TJ');
      group = [];
    };
    for (const p of out) {
      if (p.kind === 'raw') continue;
      if (p.kind === 'num') { group.push(p); continue; }
      if (p.kind === 'str' && p.codes && !p.codes.length) continue;
      if (p.font !== curFont) {
        flushGroup();
        lines.push(`/${p.font === 'orig' ? resName(s).slice(1) : p.font} ${s.fsTok} Tf`);
        curFont = p.font;
      }
      group.push(p);
    }
    flushGroup();
    if (curFont !== 'orig') lines.push(`${resName(s)} ${s.fsTok} Tf`);
    if (!lines.length) lines.push(`${s.fi.bpc === 2 ? '<>' : '()'} Tj`);
    edits.push({ s: s.prefix ? s.op.s : s.op.s, e: s.op.e, text: lines.join('\n') });
  }
  // el resto de la línea: los tramos con posición absoluta (Tm) se corren lo mismo que cambió el ancho; los que fluyen detrás se mueven solos
  let shifted = 0;
  if (Math.abs(dxUser) > 0.01) {
    const lastTouched = Math.max(...[...touched].map((s) => win.indexOf(s)));
    for (let wi = lastTouched + 1; wi < win.length; wi++) {
      const S = win[wi];
      let tmOp = null;
      for (let q = S.k - 1; q >= 0; q--) {
        const o = ops[q];
        if (o.op === 'Tj' || o.op === 'TJ' || o.op === "'" || o.op === '"' || o.op === 'ET' || o.op === 'BT' || o.op === 'Td' || o.op === 'TD' || o.op === 'T*') break;
        if (o.op === 'Tm') { tmOp = o; break; }
      }
      if (tmOp && tmOp.args.length >= 6 && !edits.some((e) => e.s === tmOp.args[4].s)) {
        const dxt = dxUser / ((S.tm[0] * S.ctm[0]) || 1);
        edits.push({ s: tmOp.args[4].s, e: tmOp.args[4].e, text: String(Math.round((tmOp.args[4].v + dxt) * 10000) / 10000) });
        shifted++;
      }
    }
  }
  // parchear del final al principio para no mover los desplazamientos
  edits.sort((a, b) => b.s - a.s);
  let buf = bytes;
  const enc = new TextEncoder();
  for (const ed of edits) {
    const pre1 = buf.subarray(0, ed.s), mid = enc.encode(ed.text), post = buf.subarray(ed.e);
    const nb = new Uint8Array(pre1.length + mid.length + post.length);
    nb.set(pre1, 0); nb.set(mid, pre1.length); nb.set(post, pre1.length + mid.length);
    buf = nb;
  }
  const ctxPdf = pdfDoc.context;
  const stream = ctxPdf.flateStream(buf);
  leaf.set(PDFName.of('Contents'), ctxPdf.register(stream));
  return { ok: true, usedFallback, fontName: fi.base, missing: [...missing].join(''), dropped: [...dropped].join(''), replaced: R, removedCount: endOp - startOp, shifted, dx: Math.round(dxUser * 100) / 100 };
}

/** ¿Qué caracteres de `text` no tiene la fuente original? (para avisar al usuario) */
export function missingChars(fi, text) {
  const out = new Set();
  for (const u of text) if (!isSp(u) && !fi.uniToCode.has(u)) out.add(u);
  return [...out];
}

function fillToCss(fill) {
  const p = String(fill || '0 g').trim().split(/\s+/);
  const op = p.pop();
  const n = p.map(Number);
  const hx = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  if (op === 'g' && n.length === 1) return '#' + hx(n[0]).repeat(3);
  if (op === 'rg' && n.length === 3) return '#' + n.map(hx).join('');
  if (op === 'k' && n.length === 4) { const [c, m, y, k] = n; return '#' + [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)].map(hx).join(''); }
  return '#000000';
}

/** ¿Se puede editar este texto reescribiendo el contenido? Devuelve la fuente y el tamaño reales, y los caracteres que la fuente trae. */
export function probeItem(pdfDoc, pageIndex, item, ctx) {
  const leaf = pageLeaf(pdfDoc, pageIndex);
  const bytes = readContents(pdfDoc, leaf);
  if (!bytes) return { ok: false, reason: 'contenido no editable' };
  const fonts = loadPageFonts(pdfDoc, pageIndex);
  const shows = scanText(parseContent(bytes), fonts, ctx.widthOf || (() => 500), bytes);
  const win = locateItem(shows, item);
  if (!win) return { ok: false, reason: 'no se encontró el texto en el contenido de la página' };
  if (win.some((s) => !s.upright)) return { ok: false, reason: 'texto girado' };
  const s0 = win[0];
  const fi = s0.fi;
  const style = matchFont(fi);
  const sys = style.candidates.find((c) => c.kind === 'system');
  const bundled = style.candidates.find((c) => c.kind === 'bundled');
  return {
    ok: true, fontBase: fi.base, size: s0.size, color: fillToCss(s0.fill), avail: [...fi.uniToCode.keys()].join(''),
    bold: style.bold, italic: style.italic, sysFamily: sys ? sys.family : '', bundledFamily: bundled ? bundled.family : 'Arimo',
    embedded: fi.embedded,
  };
}

/** Aplica varias ediciones a un PDF (de derecha a izquierda para que el desplazamiento de una no afecte a la siguiente). */
export async function applyTextEdits(pdfDoc, edits, ctxFor) {
  const order = edits.map((e, i) => ({ e, i })).sort((a, b) => (a.e.page - b.e.page) || (b.e.y - a.e.y) || (b.e.x - a.e.x));
  const results = new Array(edits.length);
  for (const { e, i } of order) {
    try {
      results[i] = await applyTextEdit(pdfDoc, e.page, { x: e.x, y: e.y, str: e.str, newText: e.newText }, await ctxFor(e.page));
    } catch (err) {
      results[i] = { ok: false, reason: String((err && err.message) || err) };
    }
  }
  return results;
}
