// PDF Master - accesos rápidos de Finder en macOS (clic derecho → Acciones rápidas).
// Crea "Acciones rápidas" (flujos de Automator de tipo Servicio) en ~/Library/Services. Cada una ejecuta:
//   "PDF Master" --pm-action=<acción> <archivos seleccionados>
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PREFIX = 'PDF Master - ';
const UTI_PDF = ['com.adobe.pdf'];
const UTI_IMG = ['public.image'];
const UTI_OFFICE = [
  'org.openxmlformats.wordprocessingml.document', 'com.microsoft.word.doc',
  'org.openxmlformats.spreadsheetml.sheet', 'com.microsoft.excel.xls',
  'org.openxmlformats.presentationml.presentation', 'com.microsoft.powerpoint.ppt',
];

const ACTIONS = [
  { action: 'open', label: 'Abrir', utis: UTI_PDF },
  { action: 'merge', label: 'Unir PDFs', utis: UTI_PDF },
  { action: 'split', label: 'Dividir PDF', utis: UTI_PDF },
  { action: 'compress', label: 'Comprimir PDF', utis: UTI_PDF },
  { action: 'toword', label: 'Convertir a Word', utis: UTI_PDF },
  { action: 'toimages', label: 'Convertir a imágenes', utis: UTI_PDF },
  { action: 'sign', label: 'Firmar', utis: UTI_PDF },
  { action: 'protect', label: 'Proteger con contraseña', utis: UTI_PDF },
  { action: 'ocr', label: 'Hacer buscable (OCR)', utis: UTI_PDF },
  { action: 'imgs2pdf', label: 'Imágenes a PDF', utis: UTI_IMG },
  { action: 'office2pdf', label: 'Office a PDF', utis: UTI_OFFICE },
];

const servicesDir = () => process.env.PM_SERVICES_DIR || path.join(os.homedir(), 'Library', 'Services');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// UUID estable (mismo resultado en cada arranque) para no reescribir los flujos innecesariamente
const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(String(seed)).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

function script(execPath, action) {
  return [
    `APP=${shq(execPath)}`,
    '[ -x "$APP" ] || APP="/Applications/PDF Master.app/Contents/MacOS/PDF Master"',
    `"$APP" --pm-action=${action} "$@" >/dev/null 2>&1 &`,
  ].join('\n');
}

function infoPlist(label, utis) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${esc(PREFIX + label)}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
${utis.map((u) => `				<string>${esc(u)}</string>`).join('\n')}
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

function documentWflow(execPath, action) {
  const cmd = esc(script(execPath, action));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${cmd}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${uuid(`${action}:in`)}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>${uuid(`${action}:out`)}</string>
				<key>UUID</key>
				<string>${uuid(`${action}:id`)}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:253.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}

const bundleName = (a) => `${PREFIX}${a.label}.workflow`;

function writeIfChanged(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return false; } catch { /* no existe */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function refreshServices() {
  // Pide a macOS que vuelva a leer los servicios (si no, aparecen tras cerrar sesión).
  try {
    const p = spawn('/System/Library/CoreServices/pbs', ['-update'], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch { /* opcional */ }
}

/** Instala (o actualiza) las acciones rápidas. Devuelve cuántos archivos cambiaron. */
function install(execPath, { refresh = true } = {}) {
  const dir = servicesDir();
  let changed = 0;
  for (const a of ACTIONS) {
    const base = path.join(dir, bundleName(a), 'Contents');
    // solo se reescribe lo que cambió (por ejemplo si la app se movió a otra carpeta)
    if (writeIfChanged(path.join(base, 'Info.plist'), infoPlist(a.label, a.utis))) changed++;
    if (writeIfChanged(path.join(base, 'document.wflow'), documentWflow(execPath, a.action))) changed++;
  }
  if (changed && refresh && !process.env.PM_SERVICES_DIR) refreshServices();
  return changed;
}

function uninstall() {
  const dir = servicesDir();
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(PREFIX) && name.endsWith('.workflow')) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        removed++;
      }
    }
  } catch { /* la carpeta no existe */ }
  if (removed && !process.env.PM_SERVICES_DIR) refreshServices();
  return removed;
}

function status() {
  const dir = servicesDir();
  let n = 0;
  for (const a of ACTIONS) if (fs.existsSync(path.join(dir, bundleName(a), 'Contents', 'document.wflow'))) n++;
  return { supported: true, installed: n === ACTIONS.length, count: n, total: ACTIONS.length, dir };
}

module.exports = { install, uninstall, status, ACTIONS, infoPlist, documentWflow, script, bundleName };
