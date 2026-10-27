# PDF Master

Programa de escritorio para **Windows y macOS** para hacer **todo** con archivos PDF: ver, editar, firmar, unir, dividir,
organizar, eliminar páginas, convertir a otros formatos, comprimir, proteger, OCR y más.
Uso personal. Interfaz moderna en español (tema claro/oscuro), con el documento en grande al centro,
miniaturas a la izquierda y **todas las herramientas a la derecha**.

## Qué incluye

| Grupo | Herramientas |
|---|---|
| **Editar** | Añadir texto · editar texto existente · añadir imagen · **firmar** (dibujar / escribir / imagen, con firmas guardadas) · sellos · resaltar / subrayar / tachar · dibujo libre · formas, líneas y flechas · tapar con blanco · **redactar** (borrado real del texto) |
| **Páginas** | Organizar (arrastrar, rotar, duplicar, eliminar) · rotar · eliminar · extraer · insertar en blanco · insertar desde otro PDF · recortar márgenes · **dividir** · **unir** |
| **Numeración y marcas** | Numerar páginas · encabezado y pie · marca de agua (texto o imagen) |
| **Formularios** | Rellenar campos · aplanar |
| **Convertir** | PDF → imágenes (PNG/JPG) · Word · Excel · PowerPoint · texto · HTML · Imágenes → PDF · Texto/HTML → PDF · Word/Excel/PowerPoint → PDF (requiere Office instalado) |
| **Optimizar** | Comprimir · **OCR** español/inglés (texto buscable en escaneos) |
| **Seguridad y datos** | Proteger con contraseña (AES-256) · quitar contraseña · metadatos · propiedades |
| **Visor** | Zoom, ajuste a ancho/página, búsqueda con resaltado, pestañas, deshacer/rehacer, imprimir, arrastrar y soltar |

Atajos: `Ctrl+O` abrir · `Ctrl+S` guardar · `Ctrl+Mayús+S` guardar como · `Ctrl+Z / Ctrl+Y` deshacer / rehacer ·
`Ctrl+F` buscar · `Ctrl+P` imprimir · `Ctrl+W` cerrar pestaña · `Ctrl +/-/0` zoom · `Supr` borrar el objeto seleccionado.

## Instalar (usuario)

1. Ejecuta `release/PDF-Master-Setup-<versión>.exe`.
2. Se instala solo para tu usuario (no pide administrador), crea acceso directo en el escritorio y en el menú Inicio.
3. Para abrir los PDF con PDF Master: *Configuración de Windows → Aplicaciones predeterminadas* (también hay un botón en **Ajustes**).

## Desarrollo

```bash
npm install
node node_modules/electron/install.js   # solo si el binario de Electron no se descargó
npm run start        # compila y abre la aplicación
npm run test         # pruebas del motor PDF (Node)
npm run dist         # genera el instalador en release/
```

Pruebas de interfaz completas (abre la app y recorre cada herramienta):

```powershell
powershell -File scripts/e2e/run.ps1 -Script scripts/e2e/tools.js
```

### Estructura

```
main.js / preload.js     proceso principal de Electron (archivos, actualizaciones, HTML→PDF, Office→PDF)
src/engine.js            motor PDF (pdf-lib): páginas, marcas, formularios, anotaciones → contenido, cifrado
src/docs.js              documento abierto, historial deshacer/rehacer, guardado
src/viewer.js            visor (pdf.js), miniaturas, búsqueda
src/overlay.js           capa de edición (texto, firmas, formas…)
src/tools.js             panel de herramientas y sus diálogos
src/convert.js           conversiones y OCR (Tesseract)
src/app.js               interfaz: pestañas, barra superior, ajustes, atajos
```

## macOS (MacBook)

La misma aplicación, con las mismas herramientas, para Mac (Apple Silicon e Intel, macOS 11 o superior).

1. Descarga **PDF-Master-<versión>-mac.dmg** desde [Releases](https://github.com/hug04ntivil/pdfmaster/releases/latest), ábrelo y arrastra **PDF Master** a **Aplicaciones**.
2. La primera vez macOS avisará que no puede verificar al desarrollador (la app no está firmada con una cuenta de Apple Developer, que cuesta US$99 al año). Para abrirla una sola vez:
   - **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**, o
   - en Terminal: `xattr -dr com.apple.quarantine "/Applications/PDF Master.app"`
3. Atajos con ⌘ (⌘O abrir, ⌘S guardar, ⌘Z deshacer, ⌘F buscar…). El menú de la barra superior de macOS incluye Archivo y Edición.

Diferencias con Windows:

- **Clic derecho:** en Finder aparece en **Acciones rápidas** (*PDF Master - Unir PDFs*, *Comprimir*, *Firmar*…). Se instalan solas al abrir la app y se pueden quitar en **Ajustes → General**.
- **Office → PDF:** usa LibreOffice si está instalado o Microsoft Office para Mac (Word, Excel, PowerPoint).
- **Actualizaciones:** sin firma de Apple macOS no permite actualizar solo. **Ajustes → Actualizaciones → Buscar** avisa de la versión nueva y *Descargar el instalador* abre el .dmg; se reemplaza la app en Aplicaciones.
- Las pruebas automáticas (motor, interfaz, menú contextual) se ejecutan en un Mac real de GitHub: pestaña *Actions → Verificar en macOS*.
## Menú contextual de Windows

Al instalar, el clic derecho sobre un archivo añade accesos rápidos (solo para tu usuario, sin administrador):

- **PDF** → submenú **PDF Master**: abrir, unir los PDFs seleccionados, dividir, comprimir, convertir a Word, convertir a imágenes, firmar, proteger con contraseña y OCR.
- **Imágenes** (JPG, PNG, WebP, BMP, GIF) y **Word/Excel/PowerPoint** → *Convertir a PDF con PDF Master* (si seleccionas varios, se agrupan en un solo trabajo).

En Windows 11 aparece en el menú clásico: clic derecho → **Mostrar más opciones** (o Mayús+F10). Se quita solo al desinstalar.

## Mantenerlo actualizado

Hay **dos** cosas que actualizar:

1. **La propia aplicación** — publica versiones en tu repositorio de GitHub y el programa las descarga solo:
   1. Crea un repositorio (p. ej. `hug04ntivil/pdfmaster`) y sube este proyecto.
   2. En **Ajustes → Repositorio de actualizaciones** escribe `hug04ntivil/pdfmaster`
      (y cambia `owner`/`repo` en `electron-builder.yml`, ya apuntan a este repositorio).
   3. Sube la versión en `package.json` y publica una etiqueta: `git tag v1.1.0 && git push --tags`.
      El flujo `.github/workflows/release.yml` compila el instalador y lo adjunta al *Release*.
   4. El botón ⟳ de la barra superior (o la búsqueda automática al abrir) detecta y descarga la novedad.
2. **Los motores de PDF** (pdf.js, pdf-lib, OCR, conversores): `npm run update-engines` actualiza las librerías y recompila.
   `.github/dependabot.yml` te propone esas actualizaciones cada semana como *pull requests*.

El panel **Actualizaciones** también muestra la última versión del proyecto de referencia
[storytold/pdfcraft](https://github.com/storytold/pdfcraft) (Rust, Apache-2.0/MIT) con sus novedades, para que sepas
qué funciones nuevas incorporar.

## Licencias de terceros

PDF Master usa: pdf.js (Apache-2.0), pdf-lib y su fork @cantoo/pdf-lib (MIT), fontkit (MIT), Tesseract.js y datos de idioma
(Apache-2.0), docx, ExcelJS, PptxGenJS (MIT), lucide (ISC), Electron (MIT). *pdfcraft* se usó solo como guía de funciones
(no se copió código).

