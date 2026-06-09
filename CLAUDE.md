# Contexto del proyecto — app-mantenimiento (MultiAire Perú)

## Qué es
App web interna de MultiAire Perú para gestión de asistencia del personal técnico.
Vanilla HTML/JS, sin framework. Firebase Firestore como base de datos (SDK compat 9.23.0).
No hay servidor — todo corre en el browser con Firebase Auth + Firestore directo.

## Archivos principales
- `asistencia_multiaire.html` — gestión de asistencia del personal
- `comprobantes.html` — Rendición de Caja: escáner de facturas/boletas con Gemini IA
- `firebase-config.js` — config pública de Firebase (project: `multiaire-fee43`)
- `wsp_import/importar_asistencia.py` — script Python para importar asistencia desde ZIP de WhatsApp

## Rendición de Caja (`comprobantes.html`)
> Antes llamada "ComprobaScan" — renombrada 2026-05-27
App cliente puro — sin backend, sin Firestore para datos. Solo Firebase Auth.
- **IA**: Google Gemini REST API directo desde el browser
- **Auth API**: header `x-goog-api-key: <key>` (NO query param `?key=`)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Modelo default**: `gemini-2.5-flash-lite` (1000 RPD free) | Alternativa: `gemini-2.5-flash` (250 RPD free, más capaz)
- **Modelos retirados**: `gemini-2.0-flash` (deprecated, shutdown jun-2026), `gemini-1.5-flash-latest`, `gemini-1.5-pro-latest` (discontinuados)
- **Selector de modelo**: pills custom (NO `<select>` — el CSS global `appearance:none` lo rompe)
- **File input**: `<label for="file-input">` (NO `.click()` JS — Brave lo bloquea)
- **Imágenes**: comprimidas a máx 1600px JPEG 0.85 antes de enviar
- **API key**: en `localStorage` clave `cs_gemini_key` — persiste entre sesiones; botón 🗑 Borrar en key-status
- **Modelo guardado**: en `localStorage` clave `cs_gemini_model` — validar contra lista VALID_IDS al cargar
- **Columnas Excel**: FECHA, N°BOLETA / FACTURA, NUMERO, RUC, PROVEEDOR, DESCRIPCION (manual, obligatoria), VALOR
- **Tipos de comprobante**: `FT`=Factura, `BO`=Boleta, `TK`=Ticket, `NC`=Nota de Crédito, `OT`=Otro
- **Gemini output**: `responseMimeType:'application/json'` + `responseSchema` con enum de tipos — fuerza JSON válido siempre
- **Prompt**: describe cada campo con ejemplos reales (NO template JSON con valores placeholder)
- **Panel Gestión de accesos**: disponible para ADMIN/SUPER_ADMIN — idéntico al de otras apps
- **Footer**: body `display:flex flex-direction:column` + wrapper `flex:1` siempre visible — footer nunca salta al header durante carga
- **← Inicio**: usa clase `.back-link` (pill semi-transparente) igual que mantenimiento/asistencia
- **Estado en develop**: activa | **Estado en producción**: activa

## Insumos (`insumos.html`)
Gestión de inventario de herramientas/insumos. **Estado**: activa en develop y producción (activada 2026-06-06).
Modelo de 3 niveles:
- **Catálogo** (`insumos_catalogo`) — el *tipo* de ítem. Código único obligatorio. id = código.
- **Instancia** (`insumos_instancias`) — cada *unidad física* del tipo, con su propio id/código, sede, estado y opcional `paqueteId`. Estados: `DISPONIBLE`, `EN_USO`, `MANTENIMIENTO`, `DETERIORADO`, `BAJA`.
- **Paquete** (`insumos_paquetes`) — contenedor que agrupa instancias. Relación **bidireccional**: `paquete.instancias[]` ↔ `instancia.paqueteId`. Tipos: MOCHILA, CAJA, CAJON, **ANAQUEL**, MALETÍN, OTRO.
- Pestañas: Catálogo · Instancias · Movimientos · Por Sede · Paquetes · Por Técnico.
- **Etiquetas**: cada ítem/instancia genera etiqueta descargable (PNG individual o ZIP). Formato seleccionable **QR** (qrcodejs) o **código de barras Code128** (JsBarcode) vía selector `setLabelFmt()`/`labelFmt`; ambos codifican el `id`. Generadores: `generateQRCanvas`/`generateInstQRCanvas`/`generateBarcodeCanvas`, despachados por `genLabelCanvas()`.
- **Etiqueta de barras = media hoja**: `generateBarcodeCanvas` produce una etiqueta de proporción **400×150 mm** (8:3, mitad de un papel 400×300). El código de barras va **alargado** y llena la etiqueta (estirado a ~94% del ancho × ~66% del alto, márgenes mínimos; `imageSmoothingEnabled=false` para bordes nítidos) y el código en texto chiquito debajo, **sin nombre**. Se descarga individual o en ZIP; el usuario acomoda 2 por hoja al imprimir.
- **Ubicación física en almacén** = paquete tipo ANAQUEL (no hay campos `anaquel`/`sitio` en instancia; se modela como contenedor).

### Carga inicial de inventario (2026-06-06)
- Origen: Excel "CONTROL DE INVENTARIO DE HERRAMIENTAS POR TECNICO" → Hoja2 (CONTROL INVENTARIO).
- "ALMACÉN CENTRAL" del Excel = sede **OFICINA** (Chinchón Oficina, `TIE013`).
- Importadas 46 tipos de catálogo + 52 instancias + 1 paquete-anaquel (`ANAQUEL 02`). El plano físico (PLANO 0X) NO es contenedor: queda como detalle en la instancia (campo `plano` + reflejado en `notas`).
- Mapeo estado: BUENO→DISPONIBLE, MALO/INCOMPLETO→DETERIORADO, vacío→DISPONIBLE. Docs marcados con `origen:'IMPORT_HOJA2'`.
- Script de importación: `~/Documents/migrar_db/import_hoja2.js` (firebase-admin + serviceAccount).
- Las otras hojas del Excel (HERR. ROT., CONTROL EQUIPOS, HERR FIJAS por técnico) **NO se importan** — fuera de alcance. La carga del Excel queda completa con el almacén central (Hoja2).
- **Backup**: las 4 colecciones `insumos_*` se exportan/importan en `configuracion.html` (catálogo/instancias en columnas; paquetes con `instancias[]` unidas por `|`; movimientos como doc JSON por su esquema variable). El `parseCSV` se reescribió como parser correcto (maneja `""` y saltos de línea citados) para soportar las celdas JSON.
- **CSV Phomemo**: `exportInstCSVPhomemo()` exporta un CSV (`CODIGO,NOMBRE`, con BOM UTF-8) de las instancias seleccionadas (o todas) para impresión por lotes en impresoras térmicas Phomemo (etiquetas 40×30 mm) vía Print Master/Labelife, donde el barcode lo genera la app desde la columna `CODIGO`. Botón "📄 CSV (Phomemo)" en la barra de selección de Instancias.
- ~~Opcional pendiente: recategorizar los 4 ítems sin categoría (manómetros) que el Excel dejó en blanco.~~ Hecho 2026-06-08: `GEN-01` "MANOMETRO" (4 instancias) → categoría **MEDICION**. Script `~/Documents/migrar_db/recat_manometros.js`.

## Firestore — colecciones
| Colección | Descripción |
|---|---|
| `maestros_personal` | Colaboradores (id, nombre, cargo, telefono, activo, foto) — `foto` = downloadURL de Firebase Storage (`personal/<id>`) |
| `asistencia_registros` | Registros de asistencia diaria |
| `maestros_feriados` | Feriados (campo `fecha`: YYYY-MM-DD) |
| `usuarios` | Usuarios del sistema con roles |
| `insumos_catalogo` | Tipos de ítem/herramienta (nombre, categoria, marca, codigo único, unidad, stockMin, tipoCantidad) |
| `insumos_instancias` | Unidades físicas individuales (itemId→catalogo, sede, estado, paqueteId, responsable, notas) |
| `insumos_movimientos` | Entradas/salidas/transferencias/actualizaciones de instancias |
| `insumos_paquetes` | Contenedores (MOCHILA/CAJA/CAJON/ANAQUEL/MALETÍN) que agrupan instancias vía array `instancias[]` |

### Schema `asistencia_registros`
```js
{
  id, colabId, nombre, cargo, fecha,   // fecha: "YYYY-MM-DD"
  horaEntrada, horaSalida,             // decimal: 8.5 = 08:30
  estado,                              // "A" | "DM" | "F" | "P"
  observacion, heManual, horasExtra,
  registradoPor, timestamp
}
```

### Estados de asistencia
- `A` — Asistencia
- `DM` — Descanso médico
- `F` — Falta
- `P` — Permiso

## Colaboradores (maestros_personal)
| ID | Nombre | Cargo |
|---|---|---|
| PER001 | RAFAEL SANTOS | TECNICO |
| PER002 | ORLANDO MERA | TECNICO |
| PER003 | ENRIQUE YARANGA | TECNICO |
| PER004 | LUIS AMPUERO | AYUDANTE |
| PER005 | MATTIW CABRERA | AYUDANTE |
| PER006 | SEGUNDO INUMA | AYUDANTE |
| PER007 | LUIS CHAVEZ | AYUDANTE |
| PER008 | PETER PIZARRO | AYUDANTE |
| PER009 | HERNAN ZAVALETA | PDR |
| PER010 | JESUS MARTINEZ | PDR |
| PER011 | JOSE VIVAR | PDR |
| PER017563 | JEFFERSON | AYUDANTE |
| PER781233 | JOSE MARCHENA | ASISTENTE |
| PER885474 | ANDRES SAN MARTIN | ADMINISTRADOR |
| PER921832 | LESLIE ZAPATA | ASISTENTE ADMINISTRATIVO |

## Horas extra — lógica
```js
function calcHorasExtra(entrada, salida, fecha) {
  const total = salida - entrada;
  const dow = new Date(fecha + 'T12:00:00').getDay();
  const base = dow === 0 || isFeriado(fecha) ? 0 : dow === 6 ? 4.5 : 9.5;
  return Math.round((total - base) * 100) / 100;
}
// Domingo/feriado: base=0 (todo cuenta como HE)
// Sábado: base=4.5
// Lunes-Viernes: base=9.5
```

## Horarios decimales
- `8.5` = 08:30, `18.0` = 18:00, `19.5` = 19:30
- Redondeo a media hora: `round(h * 2) / 2`

## Orden de cards en index.html
**Configuración es siempre la última card del panel de apps.** Cualquier app nueva se inserta antes de Configuración.
Orden actual: Inv. Equipos → Mantenimiento → Itinerario → Insumos → Asistencia → Rendición de Caja → Configuración

## Tabs de la app
1. **Hoy** — registro del día, entrada/salida por colaborador
2. **Historial** — registros por rango de fechas
3. **Vista E/S** — pivot por colaborador mostrando entrada/salida
4. **Resumen HE** — horas extra por período
5. **Feriados** — gestión de feriados
6. **Ausencias** — reporte de días sin registro, agrupado por colaborador o fecha

## Exportaciones
- **Excel** — pivot table con inline CSS (HTML→XLS via Blob), naranja en domingos/feriados
- **PDF** — mismo formato que Excel, ancho dinámico `Math.max(297, ncols*12+24)mm`
- Ambos exportan: Nombre, Cargo, y por cada día: E/S/HE

## Import WhatsApp (wsp_import/)
Script Python `importar_asistencia.py`:
- Lee `_chat.txt` del ZIP exportado desde celular (formato: `[D/MM/YY, HH:MM:SS] sender: <adjunto: NNNNN-PHOTO-YYYY-MM-DD-HH-MM-SS.jpg>`)
- Extrae timestamp del nombre del archivo (más confiable que el mensaje)
- entrada = min foto antes de 12:00, salida = max foto desde 12:00, redondeado a ½h
- Regex con `\d{1,2}` para día (el formato usa 1 dígito para días 1-9)
- Requiere `serviceAccount.json` (busca en wsp_import/, ~/Documents/migrar_db/, ~/Downloads/)
- Mapeo sender → colabId hardcodeado en `SENDER_ID_MAP`
- Horarios fijos para Leslie, Andres, Jose Marchena (no usan WhatsApp para marcar)

### Importación realizada (2026-05-16)
- Período: 2026-03-25 → 2026-05-14
- 192 registros importados desde WhatsApp (25 abr en adelante)
- Jefferson: estado DM todos los días laborales (descanso médico)
- Andres/Leslie: horario fijo 08:30–18:00
- Jose Marchena: horario fijo 11:00–18:30, heManual=true, horasExtra=0

## Roles de usuario
- `SUPER_ADMIN` — acceso total (marchenaangulojoseluis@gmail.com)
- `ADMIN` — gestión completa
- `SUPERVISOR` — solo lectura

## Responsive — regla general
**Todas las apps deben ser responsivas y funcionar en teléfono.** Breakpoint principal: `@media(max-width:768px)`.
Patrones obligatorios:
- Header: ocultar textos secundarios, reducir padding, avatar circular sin nombre
- Cards/secciones: reducir padding (`14px` en móvil)
- Botones de acción: `width:100%` y `justify-content:center` en móvil
- Tablas: siempre dentro de `<div class="table-scroll">` con `overflow-x:auto`
- Formularios con `flex-row`: `flex-direction:column` en móvil
- Upload zone: soportar cámara con `<input capture="environment">` + botón "📷 Tomar foto"

## Notas técnicas
- Firebase SDK compat (no modular) — `firebase.initializeApp()`
- Brave browser bloquea Firebase longpolling → ERR_BLOCKED_BY_CLIENT en consola, inofensivo
- CSS Grid con `min-width:0` para que las celdas no desborden
- Comentarios en filas: `word-break:break-word` en vez de truncar
- Selector de colaborador: `<select>` dropdown (antes era search+grid)
- `celdasColab()` — verifica registro Firestore ANTES de checar si es día no laboral

## Deploy — Vercel

| Entorno | URL fija |
|---|---|
| Producción | https://multiaire-peru-app.vercel.app |
| Develop | https://multiaire-peru-app-develop.vercel.app |

- Cada `git push origin develop` → deploy automático en develop (GitHub Action)
- Cada `git push origin main` (merge manual) → deploy automático en producción (GitHub Action)
- `vercel --prod` solo si se necesita deploy manual urgente
- SSO protection deshabilitada — URLs públicas sin login de Vercel
- `.vercelignore` excluye `wsp_import/`, `_chat.txt`, `CLAUDE.md`, `*.py`, `*.json` (excepto `firebase-config.js`)

## index.html — lógica por entorno

- **Producción**: todas las cards activas (Insumos activado 2026-06-06; el bloque `if(!isDev)` itera un array vacío).
- **Develop / Localhost**: todas las cards activas
- Versión y entorno se muestran dinámicamente según hostname:
  - Producción → `3.3.0` / `Producción`
  - Develop → `3.3.0-dev` / `Develop`
  - Localhost → `3.3.0-dev` / `Local`

## Firebase — Dominios autorizados

Dominios activos en Firebase Auth:
- `localhost`, `127.0.0.1` — desarrollo local
- `multiaire-fee43.firebaseapp.com`, `multiaire-fee43.web.app` — Firebase defaults
- `marchenaangulojoseluis-dev.github.io` — GitHub Pages (empresa aún en uso)
- `multiaire-peru-app.vercel.app` — producción Vercel
- `multiaire-peru-app-develop.vercel.app` — develop Vercel

Todos los dominios de Cloudflare tunnel fueron eliminados.

## Changelog

| Fecha | Cambio |
|---|---|
| 2026-05-16 | Importación masiva desde WhatsApp: 192 registros, período 2026-03-25 → 2026-05-14 |
| 2026-05-16 | Creación de CLAUDE.md con documentación completa del proyecto |
| 2026-05-16 | Configuración de Vercel — URLs fijas de producción y develop |
| 2026-05-16 | GitHub Actions para deploy automático en develop y producción |
| 2026-05-16 | Cards Insumos y Asistencia deshabilitadas en producción, activas en develop |
| 2026-05-16 | Versión y entorno dinámicos en index.html según hostname |
| 2026-05-16 | Limpieza de dominios Firebase — eliminados tunnels de Cloudflare |
| 2026-05-16 | SSO protection de Vercel deshabilitada — URLs públicas sin login |
| 2026-05-16 | .gitignore actualizado: excluye _chat.txt y settings.local.json |
| 2026-05-17 | Optimización queries Firestore: todas las consultas usan .where('fecha') en lugar de traer colección completa |
| 2026-05-17 | Corrige doble conteo de Faltas en Resumen H.E.: cRegs solo procesa días trabajados, diasRango maneja todas las ausencias |
| 2026-05-17 | Corrige deleteReg: captura fecha antes de closeEditReg para evitar leer editRegData=null |
| 2026-05-17 | Elimina variable dom duplicada en Vista T/A (condición f==='dom' nunca verdadera) |
| 2026-05-17 | Confirmación antes de registrar DM/Permiso/Falta para evitar clicks accidentales |
| 2026-05-17 | Tabla móvil: oculta columnas Cargo y Comentario en pantallas pequeñas |
| 2026-05-17 | Estado del colaborador en sidebar: badge (entrada/salida/DM/permiso/falta/sin registro) al seleccionar colaborador, solo visible cuando fecha=hoy |
| 2026-05-17 | Modo SUPERVISOR solo lectura: sidebar oculto, botones Guardar/Eliminar del modal ocultos via CSS (supervisor-mode class), campos del modal deshabilitados |
| 2026-05-18 | HE automático en modal de edición: se recalcula en tiempo real al cambiar entrada/salida (onchange → updateHeAutoInfo) |
| 2026-05-18 | Auto-refresca el tab activo al guardar o eliminar registro — Vista E/S, T/A, Historial y Resumen se actualizan sin tener que regenerar |
| 2026-05-18 | Fix: tab Ausencias ahora se refresca automáticamente al guardar/eliminar registro |
| 2026-05-18 | Fix: guard defensivo en saveEditReg si editRegData es null o colab no se encuentra |
| 2026-05-18 | Agrega campo `telefono` al maestro de personal — preparación para chatbot WhatsApp |
| 2026-05-18 | Fix: faltas en sábado descuentan -4.5h (no -8h) en Resumen HE y exportaciones — función global heAusencia() |
| 2026-05-18 | Fix: Resumen HE respeta horasExtra guardado en registros individuales — correcciones manuales en faltas prevalecen sobre el cálculo automático |
| 2026-05-18 | Asistencia habilitada en producción — solo Insumos permanece EN DESARROLLO |
| 2026-05-18 | Backup/import ampliado: incluye asistencia_registros, maestros_personal, maestros_tiendas, maestros_grupos, maestros_feriados — con batching para colecciones grandes |
| 2026-05-18 | Backup/import agrega bd_itinerarios y bd_bloques — batchWrite soporta docId separado del campo id interno |
| 2026-05-21 | Mantenimiento: sidebar muestra "Última actualización" del período seleccionado (sede + periodo + año) — se actualiza al cargar desde Firestore/cache y al guardar |
| 2026-05-21 | Mantenimiento: guarda y muestra `updatedBy` (correo del usuario) junto con `updatedAt` en sidebar, Firestore y sessionStorage |
| 2026-05-21 | Mantenimiento PDF: header muestra recuadro de última actualización (fecha/hora + correo); footer muestra línea de última actualización; nombre del archivo incluye fecha/hora de actualización |
| 2026-05-21 | Mantenimiento PDF: se elimina "Generado: [hora]" del header — solo queda en footer |
| 2026-05-27 | Nueva app ComprobaScan (`comprobantes.html`): escáner de facturas/boletas con IA, tabla editable, exportación a Excel (SheetJS) — activa en develop, deshabilitada en producción |
| 2026-05-27 | ComprobaScan: IA usa Google Gemini (REST directo, sin backend). Auth: header `x-goog-api-key`. Modelo default: `gemini-2.5-flash`. Lista: 2.5-flash, 2.0-flash, 1.5-flash-latest, 1.5-pro-latest |
| 2026-05-27 | ComprobaScan: selector de modelo como pills (no `<select>` — CSS global lo rompía). File input con `<label for>` (no `.click()` JS — Brave lo bloqueaba) |
| 2026-05-27 | ComprobaScan: imágenes comprimidas a máx 1600px / JPEG 0.85 antes de enviar a Gemini |
| 2026-05-27 | ComprobaScan: columnas Excel — FECHA, COMP, NUMERO, RUC, PROVEEDOR, DESCRIPCION (manual obligatoria), MONTO |
| 2026-05-27 | SSH configurado: clave ed25519 en ~/.ssh/id_ed25519_github, remote cambiado a git@github.com — no pide contraseña |
| 2026-05-21 | Mantenimiento WSP: mensaje incluye fecha/hora de última actualización en cursiva (_Actualizado: ..._); confirmación de copiado cambia a banner verde centrado en pantalla |
| 2026-05-27 | ComprobaScan: rewrite completo desde cero — header/auth/footer idéntico a insumos.html, todos los bugs corregidos |
| 2026-05-27 | ComprobaScan: tipos de comprobante a 2 siglas — FT=Factura, BO=Boleta, TK=Ticket, NC=Nota de Crédito, OT=Otro |
| 2026-05-27 | ComprobaScan: Gemini fuerza JSON con responseMimeType+responseSchema; prompt reescrito con ejemplos reales |
| 2026-05-27 | ComprobaScan: panel Gestión de accesos para ADMIN/SUPER_ADMIN — lista usuarios, cambia roles, asigna apps |
| 2026-05-27 | ComprobaScan: fix footer jump — wrapper flex:1 permanente evita que footer suba al header durante carga |
| 2026-05-27 | ComprobaScan: ← Inicio usa .back-link (pill transparente) igual que mantenimiento/asistencia |
| 2026-05-27 | ComprobaScan: soporte PDF multi-página — cada página → Gemini independiente → fila propia en tabla |
| 2026-05-27 | ComprobaScan: API key y modelo pasan de sessionStorage a localStorage — persisten entre sesiones; botón 🗑 Borrar |
| 2026-05-27 | ComprobaScan: rate limiter free tier — 6.5s entre llamadas Gemini con cuenta regresiva visible en status |
| 2026-05-27 | ComprobaScan: actualiza lista de modelos — retira gemini-2.0-flash (deprecated jun-2026) y 1.5-flash/pro; agrega gemini-2.5-flash-lite y gemini-3.5-flash |
| 2026-05-27 | Rendición de Caja: renombrada desde ComprobaScan/FacturasIA — card movida antes de Configuración |
| 2026-05-27 | Rendición de Caja: responsive móvil mejorado + botón 📷 Tomar foto (capture=environment) |
| 2026-05-27 | CLAUDE.md: regla general — todas las apps deben ser responsivas, patrones obligatorios documentados |
| 2026-05-27 | index.html: regla permanente — Configuración siempre es la última card del panel |
| 2026-05-27 | Rendición de Caja: default modelo gemini-2.5-flash-lite (1000 RPD), delay 4.5s free tier |
| 2026-05-27 | Rendición de Caja: fix API key input alineado izquierda en móvil (align-items:stretch) |
| 2026-05-27 | Rendición de Caja: col-ruc min-width 130px, col-prov 200px en móvil |
| 2026-05-27 | Rendición de Caja: botón 📷 Tomar foto oculto en desktop, visible solo en móvil |
| 2026-05-27 | Rendición de Caja: habilitada en producción — probada en celular ✓ |
| 2026-06-06 | Insumos: documentado el modelo de 3 niveles (catálogo/instancias/paquetes) en CLAUDE.md |
| 2026-06-06 | Insumos: carga inicial desde Excel Hoja2 — 46 tipos + 52 instancias + 5 paquetes-anaquel en sede OFICINA (Chinchón). Script migrar_db/import_hoja2.js |
| 2026-06-06 | Insumos: ubicación física del almacén = un único paquete tipo ANAQUEL (`ANAQUEL 02`); el plano (PLANO 0X) es solo un detalle de la instancia (campo `plano` + notas), no un contenedor |
| 2026-06-06 | Insumos: etiquetas con formato seleccionable QR o código de barras Code128 (JsBarcode). Selector QR/Barras en modal de etiqueta y en exportación ZIP (catálogo e instancias) |
| 2026-06-06 | Insumos: escáner renombrado "Escanear QR / Barras" (html5-qrcode ya leía ambos); qrbox horizontal adaptable (mejor encuadre de barras 1D en móvil); botones de resultado "Ver QR"→"Ver etiqueta"; flex-wrap en barras de selección para móvil |
| 2026-06-06 | Insumos: scroll horizontal en tablas en TODAS las pantallas — `.table-wrap` base pasa de `overflow:hidden` a `overflow-x:auto` (antes solo en móvil; en desktop con muchas columnas se cortaban) |
| 2026-06-06 | Insumos: columnas fijas (checkbox + Código/ID) al hacer scroll horizontal en tablas Catálogo e Instancias — `position:sticky` con fondo sólido, hover consistente y separador; checkbox ancho fijo 44px |
| 2026-06-06 | Backup (`configuracion.html`): agrega export+import de las 4 colecciones `insumos_*` (catálogo/instancias en columnas, paquetes con instancias por `\|`, movimientos en JSON). `parseCSV` reescrito como parser CSV correcto (comillas escapadas + saltos de línea citados). Verificado round-trip con datos reales |
| 2026-06-06 | Backup: fix — la importación solo cargaba 4 de los 15 CSV (`expected` incompleto), así que asistencia/maestros_*/bd_* se exportaban pero NO se restauraban. Ahora `expected` lista los 15; el backup/restore es completo |
| 2026-06-06 | Insumos: etiqueta de código de barras rediseñada a media hoja (400×150 mm, prop. 8:3) — barra dominante + código chiquito, sin nombre; alta resolución (2000×750) para impresión nítida. Se descarga individual/ZIP y el usuario acomoda 2 por hoja. Se retira la impresión "2/hoja" previa |
| 2026-06-06 | Insumos: barra estirada para llenar la etiqueta (~94% ancho × ~66% alto, márgenes mínimos, `imageSmoothingEnabled=false`) |
| 2026-06-06 | Insumos: **activado en producción** — `index.html` deja de marcarlo "EN DESARROLLO" (array vacío); todas las cards activas en prod. Merge develop→main |
| 2026-06-06 | Insumos: export "📄 CSV (Phomemo)" en barra de selección de Instancias — CSV `CODIGO,NOMBRE` (BOM UTF-8) para impresión por lotes en impresoras térmicas Phomemo 40×30 mm (la app dibuja el barcode desde la columna CODIGO) |
| 2026-06-08 | Fotos del personal: campo `foto` en `maestros_personal` (downloadURL de Firebase Storage, ruta `personal/<id>`). Editor de personal en `configuracion.html` carga `firebase-storage-compat.js`; botón 📷 por fila comprime la imagen a 200×200 (recorte centrado, JPEG 0.82) y la sube; miniatura circular al inicio de cada fila. La URL se persiste al "Guardar cambios" (preservada en `loadMaestros`/`saveMaestros`) |
| 2026-06-08 | Insumos: tab "Por Técnico" muestra cabecera con avatar del técnico (foto de `maestros_personal` o inicial de respaldo) en `renderPorTecnico` |
| 2026-06-08 | Backup (`configuracion.html`): columna `FOTO` agregada al export/import CSV de `maestros_personal` |
| 2026-06-08 | Insumos (datos): recategorizado `GEN-01` "MANOMETRO" (4 instancias) de SIN CATEGORIA → MEDICION en Firestore. Script `migrar_db/recat_manometros.js` |
