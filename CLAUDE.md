# Contexto del proyecto — app-mantenimiento (MultiAire Perú)

## Qué es
App web interna de MultiAire Perú para gestión de asistencia del personal técnico.
Vanilla HTML/JS, sin framework. Firebase Firestore como base de datos (SDK compat 9.23.0).
No hay servidor — todo corre en el browser con Firebase Auth + Firestore directo.

## Archivos principales
- `asistencia_multiaire.html` — gestión de asistencia del personal
- `comprobantes.html` — Rendición de Caja: escáner de facturas/boletas con Gemini IA
- `proveedores.html` — Proveedores: directorio CRUD (colección `proveedores`)
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

## Proveedores (`proveedores.html`)
Directorio CRUD de proveedores. Construida sobre el scaffold de `comprobantes.html` (header/auth Google contra `usuarios`, panel "Gestión de accesos", footer, toast) — **sin** nada de Gemini/scanner/pdf.js.
- **Colección**: `proveedores` (ver tabla de colecciones). Doc id auto-generado.
- **Roles**: ADMIN/SUPER_ADMIN editan (botón "＋ Nuevo proveedor", lápiz ✎, eliminar); SUPERVISOR solo lectura (sin botón nuevo; el ojo 👁 abre el modal en modo readonly — inputs `disabled`, sin botón Guardar/Eliminar). Gate central: `isProvAdmin()`.
- **UI**: toolbar (búsqueda en vivo + Exportar Excel + Nuevo proveedor) + tabla (estado·RUC·razón social·nombre comercial·rubro·teléfono·contacto·cond. pago·**notas**·acción). Doble clic en fila abre el detalle. Modal de alta/edición con todos los campos (`PROV_FIELDS`); `notas` es un `<textarea>` y en la tabla se muestra truncado con `title` completo.
- **Notas**: texto libre para observaciones internas (horarios de atención, vendedor asignado, descuentos acordados, plazos de entrega, incidencias, web/catálogo, etc.).
- **Búsqueda** (`provFilter`): filtra por ruc, razón social, nombre comercial, rubro, contacto, teléfono, email, notas.
- **Validación**: RUC obligatorio y `^\d{8,11}$`; razón social obligatoria (se guarda en MAYÚSCULAS); RUC duplicado bloqueado al crear.
- **Excel** (`exportProveedores`, SheetJS): RUC, RAZÓN SOCIAL, NOMBRE COMERCIAL, RUBRO, TELÉFONO, EMAIL, CONTACTO, DIRECCIÓN, CONDICIONES DE PAGO, BANCO, CUENTA/CCI, ACTIVO.
- **Backup**: incluida en export/import de `configuracion.html` (`proveedores.csv`).
- **Estado en develop**: activa | **Estado en producción**: activa (merge a main 2026-06-10).

## Insumos (`insumos.html`)
Gestión de inventario de herramientas/insumos. **Estado**: activa en develop y producción (activada 2026-06-06).
Modelo de 3 niveles:
- **Catálogo** (`insumos_catalogo`) — el *tipo* de ítem. Código único obligatorio. id = código.
- **Instancia** (`insumos_instancias`) — cada *unidad física* del tipo, con su propio id/código, sede, estado y opcional `paqueteId`. Estados: `DISPONIBLE`, `EN_USO`, `MANTENIMIENTO`, `DETERIORADO`, `BAJA`.
- **Paquete** (`insumos_paquetes`) — contenedor que agrupa instancias. Relación **bidireccional**: `paquete.instancias[]` ↔ `instancia.paqueteId`. Tipos: MOCHILA, CAJA, CAJON, **ANAQUEL**, MALETÍN, OTRO.
- Pestañas: Catálogo · Instancias · Movimientos · Por Sede · Paquetes · Por Persona (antes "Por Técnico"; ids internos `tecnicos`/`tab-tecnicos` sin cambiar).
- **Exportar material**: por persona en el tab *Por Persona* (botón "⬇ Exportar material" al seleccionar una persona → sus instancias sueltas + todas las de sus paquetes) y por paquete en el tab *Paquetes* y en las tarjetas de paquete del detalle de persona (botón "⬇ Material"/"⬇" → instancias de ese paquete). El botón abre un **selector de formato** (modal `modal-export-mat`): **PDF** (principal, recomendado), **PNG** (segunda), **Excel/CSV** (última opción), + checkbox **"Incluir foto de cada instancia"** (solo PDF/PNG). `exportMaterialPersona`/`exportMaterialPaquete` arman el contexto `_exportMat` y abren el selector; `doExportMat(fmt)` lee el checkbox (`_exportMat.conFotos`) y despacha. PDF/PNG comparten un reporte dibujado en canvas (**`_matReportCanvas` es async** — precarga las fotos base64 con `_loadImg` antes de dibujar; columnas CÓDIGO/ÍTEM/CATEGORÍA/SEDE/ESTADO[/PAQUETE], y una columna **FOTO** con miniatura recortada cuadrada cuando `conFotos`, placeholder "s/f" sin foto); el PDF usa **jsPDF** (UMD CDN, `window.jspdf.jsPDF`, addImage paginado A4); el CSV (UTF-8 BOM, columnas completas + RESPONSABLE + **FOTO SÍ/NO**) reutiliza `_descargarMaterial`. Las fotos salen de `instFotos` (colección `insumos_instancias_fotos`).
- **Etiquetas**: cada ítem/instancia genera etiqueta descargable (PNG individual o ZIP). Formato seleccionable **QR** (qrcodejs) o **código de barras Code128** (JsBarcode) vía selector `setLabelFmt()`/`labelFmt`; ambos codifican el `id`. Generadores: `generateQRCanvas`/`generateInstQRCanvas`/`generateBarcodeCanvas`, despachados por `genLabelCanvas()`.
- **Etiqueta de barras = media hoja**: `generateBarcodeCanvas` produce una etiqueta de proporción **400×150 mm** (8:3, mitad de un papel 400×300). El código de barras va **alargado** y llena la etiqueta (estirado a ~94% del ancho × ~66% del alto, márgenes mínimos; `imageSmoothingEnabled=false` para bordes nítidos) y el código en texto chiquito debajo, **sin nombre**. Se descarga individual o en ZIP; el usuario acomoda 2 por hoja al imprimir.
- **Ubicación física en almacén** = paquete tipo ANAQUEL (no hay campos `anaquel`/`sitio` en instancia; se modela como contenedor).
- **Salida / Baja en lote** (tab *Instancias*): la barra de selección múltiple (`selectedInstQRIds`) suma botones "⬆ Salida en lote" / "⚠️ Baja en lote" (gating `can('salida')===1`, se muestran/ocultan en `updateInstQRSelectionBar`). `openModalSalidaLote(tipo)` abre `modal-salida-lote` con la lista de instancias seleccionadas + responsable + motivo (obligatorio si BAJA) + **N° de guía de remisión** y **foto de guía** + **foto de entrega**, todo opcional. `saveSalidaLote()` crea **UN** movimiento `SALIDA`/`BAJA` con `instancias[]` (igual que la salida individual, que sigue existiendo) + `instanciasSnapshot[]` (copia de cada instancia borrada para poder revertir fielmente lotes mixtos en ítem/sede) + `guiaNumero`/`tieneFotos`; borra las instancias por batch (troceado a 450) y guarda las fotos en `insumos_movimientos_fotos` (doc id = id del movimiento). `renderMovimientos` muestra "📎 Guía Nº" + miniaturas clicables (lightbox vía `openMovFoto`). La reversión (`revertirMovimiento`) y la cascada (`eliminarMovsCascada`) manejan `instancias[]` + snapshot y borran la foto del movimiento.
- **Transferencia en lote** (tab *Instancias*): botón "🔄 Transferir en lote" en la misma barra (gating propio `can('transferencia')===1`). `openModalTransfLote()` abre `modal-transf-lote` (checkboxes Sede/Responsable como en la individual, destino, "realizado por", observación + guía/fotos opcionales). `saveTransfLote()` crea UN movimiento `TRANSFERENCIA` con `instancias[]` + `instanciasSnapshot[]` (valores **previos** de los campos transferidos, no objeto completo) + `camposTransferidos` (`['sede','responsable']`); aplica el destino a cada instancia y la saca de su paquete si pertenece a uno. La reversión restaura sede/responsable previos por instancia (igual que la individual, **no** re-inserta en el paquete previo) y borra la foto. La infraestructura de fotos del lote es compartida (`loteFotos`, `setLoteFoto`, `refreshLoteFotoPreview` con `loteFotoPrefix` = `flote`/`ftl` según el modal activo; `compressFit`).
- **Carga masiva (Excel/`.xlsx`, SheetJS)**: botón "📊 Carga masiva" en el sidebar (gate `can('crearItem')`, ADMIN/SUPER_ADMIN). Modal `modal-carga-masiva` con 3 acciones: **descargar plantilla** (`descargarPlantillaInsumos`), **exportar base actual** (`exportarBaseInsumos`) e **importar** (`onCargaMasivaFile` → preview → `confirmarImportInsumos`). El archivo tiene 3 hojas: **Catalogo** (`CM_CAT_COLS`, **sin columna ID** — la llave es `CODIGO`), **Instancias** (`CM_INST_COLS`; la 1ª columna `ID` es interna del sistema y va **oculta** en el Excel) y **Valores validos** (categorías/unidades/tipos/estados/sedes + lista de ítems con CODIGO/NOMBRE como referencia para `ITEM_ID`). **Upsert**: catálogo por `CODIGO` (los nuevos autogeneran su docId, el usuario nunca toca el ID); instancias por su `ID` oculto (las nuevas lo dejan vacío → se autogenera con prefijo del código + correlativo, como `saveEntrada`; gracias al ID oculto, re-importar un export NO duplica). `ITEM_ID` = el CODIGO del ítem. `_cmValidar` valida fila a fila y devuelve `{nuevos, upd, err}` por colección; `_cmRenderPreview` muestra "＋nuevos · ↻actualizar · ⚠error" antes de escribir. Escritura por batch (450), `origen:'IMPORT_XLSX'`. **Plantilla guiada**: el `.xlsx` incluye una primera hoja **"Instrucciones"** (`_cmInstruccionesSheet`, generada desde `CM_GUIA_CAT`/`CM_GUIA_INST`/`CM_REGLAS`) que explica cada columna (obligatoria/opcional + valores) con ejemplos; las hojas de datos van **vacías** (solo encabezados + desplegables). Botón **"📖 Manual (PDF)"** (`descargarManualCargaMasiva`, jsPDF) genera una guía paso a paso descargable reutilizando las mismas constantes de guía. **Menús desplegables en el Excel**: el `.xlsx` trae *data validation* (dropdowns) en CATEGORIA/UNIDAD/TIPO_CANTIDAD/ESTADO (listas inline) y SEDE/ITEM_ID/RESPONSABLE (referencian una hoja oculta `_listas`). Como SheetJS Community **no escribe** validación de datos, se inyecta el XML `<dataValidations>` post-proceso: `_cmXlsxBlob` escribe el wb con `XLSX.write({type:'array'})`, lo abre con **JSZip**, ubica el worksheet de cada hoja vía `_cmSheetFile` (parsea `workbook.xml`+rels, robusto al orden) e inserta el bloque tras `</sheetData>` (queda antes de `ignoredErrors`/`pageMargins` → orden OOXML válido). Las listas cerradas bloquean valores inválidos; ITEM_ID/RESPONSABLE solo sugieren. `descargarPlantillaInsumos`/`exportarBaseInsumos` son **async** y descargan el Blob resultante. **Decisiones**: carga **silenciosa** (NO genera movimientos en el historial, igual que la carga inicial); el **nombre de instancia siempre se deriva del catálogo** (mantiene la denormalización + propaga a hijas como la Etapa 1); la importación **NO toca `paqueteId`** (merge preserva la pertenencia; los paquetes se gestionan en su pestaña). SheetJS vía CDN (`xlsx.full.min.js 0.18.5`). No requiere cambios de backup (usa colecciones ya respaldadas; `ORIGEN` ya es columna del CSV).

### Carga inicial de inventario (2026-06-06)
- Origen: Excel "CONTROL DE INVENTARIO DE HERRAMIENTAS POR TECNICO" → Hoja2 (CONTROL INVENTARIO).
- "ALMACÉN CENTRAL" del Excel = sede **OFICINA** (Chinchón Oficina, `TIE013`).
- Importadas 46 tipos de catálogo + 52 instancias + 1 paquete-anaquel (`ANAQUEL 02`). El plano físico (PLANO 0X) NO es contenedor; quedó reflejado en `notas`. **El campo `plano` fue eliminado de Firestore y de la app el 2026-06-18** (no se mostraba en ninguna pantalla; ver changelog).
- Mapeo estado: BUENO→DISPONIBLE, MALO/INCOMPLETO→DETERIORADO, vacío→DISPONIBLE. Docs marcados con `origen:'IMPORT_HOJA2'`.
- Script de importación: `~/Documents/migrar_db/import_hoja2.js` (firebase-admin + serviceAccount).
- Las otras hojas del Excel (HERR. ROT., CONTROL EQUIPOS, HERR FIJAS por técnico) **NO se importan** — fuera de alcance. La carga del Excel queda completa con el almacén central (Hoja2).
- **Backup**: las 4 colecciones `insumos_*` se exportan/importan en `configuracion.html` (catálogo/instancias en columnas; paquetes con `instancias[]` unidas por `|`; movimientos como doc JSON por su esquema variable). El `parseCSV` se reescribió como parser correcto (maneja `""` y saltos de línea citados) para soportar las celdas JSON.
- **CSV Phomemo**: `exportInstCSVPhomemo()` exporta un CSV (`CODIGO,NOMBRE`, con BOM UTF-8) de las instancias seleccionadas (o todas) para impresión por lotes en impresoras térmicas Phomemo (etiquetas 40×30 mm) vía Print Master/Labelife, donde el barcode lo genera la app desde la columna `CODIGO`. Botón "📄 CSV (Phomemo)" en la barra de selección de Instancias.
- ~~Opcional pendiente: recategorizar los 4 ítems sin categoría (manómetros) que el Excel dejó en blanco.~~ Hecho 2026-06-08: `GEN-01` "MANOMETRO" (4 instancias) → categoría **MEDICION**. Script `~/Documents/migrar_db/recat_manometros.js`.

## Observaciones (`observaciones.html`)
"Manta de Observaciones" — sábana de observaciones de mantenimiento sobre el inventario real (`inventario`, 557 equipos · 12 sedes · 14 tipos). **MULTI-CLIENTE** (proyectado a crecimiento: hoy RIPLEY, el próximo año TOTTUS, etc.): selector Cliente → Sede → Tipo → Equipo (con un solo cliente, el campo Cliente se autoselecciona/oculta). Reemplaza el Excel manual `MANTA GENERAL`. Construida sobre el scaffold de `proveedores.html` (auth Google/`usuarios`, panel de accesos, footer/toast, responsive). **Estado**: activa en develop y **producción** (merge a main 2026-06-20). **Bot WhatsApp (Fases 1-5)**: EN VIVO en el número real (+51 972 416 669), Gemini paid tier (`gemini-2.5-flash`). Backend en **Vercel Functions**, no Firebase, para no requerir Blaze.
- **Modelo = log**: cada observación es un documento de `manta_observaciones` (un equipo puede tener varias). El default "Sin observaciones." es relleno de exportación para equipos sin hallazgos (NO se guarda como dato).
- **Maestro de equipos = `inventario`** (557 equipos · 12 sedes · 14 tipos — la app inventario_multiaire.html), NO `manta_equipos` (deprecado, era solo 56 Roof Tops Ripley). Alimenta los **desplegables dependientes sede→tipo→equipo** (`fillSedeSelect`/`fillTipoSelect`/`fillEquipoSelect`/`onObsSedeChange`/`onObsTipoChange`; el `<option>` de equipo lleva el `eqId` como value) y el export. Al guardar, la observación referencia el `eqId` + denormaliza `sede`/`equipo`(nombre)/`tipo` + `tienda`=`cliente+sede`.
- **Roles**: `isObsAdmin()` (ADMIN/SUPER_ADMIN editan; SUPERVISOR solo lectura, modal readonly).
- **Toolbar**: búsqueda viva (`obsFilter`) + filtros tienda/estado/fecha (`obs-f-*`) + Exportar **Excel** (`exportObsExcel`, sábana completa con relleno) + **PDF** (`exportObsPDF`, jsPDF agrupado por tienda/equipo) + "Nueva observación". Tabla: estado(dot) · tienda · equipo · observación · estado(badge) · fecha · foto(thumb→lightbox) · origen · acción. Doble clic = detalle.
- **Fotos**: `manta_observaciones_fotos` (base64 aparte). Subida con `setObsFoto`/`obsCompress` (proporción, 1100px/0.7), preview + lightbox; estado del modal en `_obsFotoVal`/`_obsFotoDirty`.
- **Card** en `index.html` (entre Proveedores y Configuración). `observaciones` añadida a `ALL_APPS` de `proveedores.html` y `comprobantes.html` (los `ALL_APPS` del resto de apps están desactualizados, estado preexistente). Backup en `configuracion.html` (las 4 colecciones `manta_*`, incluida `manta_guia`).
- **Editor de la guía del bot** (`manta_guia`): menú de usuario → **🤖 Guía del bot** (solo ADMIN/SUPER_ADMIN). Modal lista de temas + modal alta/edición (título, palabras clave, checklist una línea por punto, orden, activo). Escribe en `manta_guia` (doc id `MGUIA-<slug título>` para nuevos; conserva id/`tipo` al editar). `guiaList`, `openGuiaPanel`/`renderGuiaList`/`openGuiaEdit`/`saveGuia`/`deleteGuia`.
- **Nota de esquema**: se usa `equipo` (etiqueta del maestro) en vez de `equipoId`/`equipoCodigo` del plan original, porque los equipos son etiquetas dentro de una tienda. Nombre de tienda = "RIPLEY <SEDE>".

### Bot de WhatsApp (Parte B) — backend serverless en `api/`
Alimenta `manta_observaciones` desde WhatsApp. **No** es Firebase Functions: son **Vercel Functions** en el mismo repo (`api/whatsapp.js` + módulos en `api/_lib/`, ESM, `package.json` con `type:module`). El prefijo `_lib` evita que Vercel los trate como endpoints. Secretos solo en env vars de Vercel (ver `api/README.md`), NUNCA en el front.
- **Fase 1** — webhook GET (verificación Meta) + POST (firma `X-Hub-Signature-256`, body crudo, `timingSafeEqual`).
- **Fase 2** — identidad por `maestros_personal.telefono` (últimos 9 dígitos) + idempotencia (`wa_mensajes`).
- **Fase 3** — `gemini.js` estructura el mensaje en `{tienda,equipo,observacion,estado}` (`gemini-2.5-flash` + `responseSchema`); `manta.js` empareja tienda/equipo contra `manta_equipos`.
- **Fase 4** — **motor conversacional** (`conversacion.js`): máquina de estados sobre `wa_sesiones` (RECOLECTANDO→CONFIRMANDO, TTL 30 min). Repregunta lo mínimo (tienda/equipo no resueltos, o **un** detalle sugerido por la guía `manta_guia` vía `guia.js`); siempre permite "guardar así"; **confirma antes de escribir** y el técnico fija/corrige el estado; al confirmar, `escritura.js` crea la observación en `manta_observaciones` (origen WHATSAPP). `analizar`/`guardar` se inyectan en `manejarMensaje` → testeable sin Meta ni Gemini. Probado contra Firestore real (`migrar_db/test_fase4.mjs`).
- **Fase 5** — **foto desde WhatsApp** (`media.js` descarga vía Graph API; `fotos.js` guarda la foto pendiente en `wa_sesiones_fotos` hasta el "SÍ"; al confirmar, `escritura.js` la escribe en `manta_observaciones_fotos` como dataURL + `tieneFoto:true`, igual que la app) + **aviso a supervisores** (`avisos.js`: destinatarios = `maestros_personal` con `recibeAvisos` + teléfono; `enviarPlantilla` para plantilla "utility" de Meta vía `WHATSAPP_TEMPLATE_AVISO`, o texto libre si no hay plantilla; no avisa a quien reportó; el aviso no rompe el flujo si falla). `guardar` del handler = escribir + notificar. Probado contra Firestore real (`migrar_db/test_fase5.mjs`, 17/17). **Falta para producción:** deploy con env vars + setup Meta (número + plantilla aprobada) + prueba end-to-end.

## Firestore — colecciones
| Colección | Descripción |
|---|---|
| `maestros_personal` | Colaboradores (id, nombre, cargo, telefono, activo, foto) — `foto` = imagen base64 (dataURL JPEG ~320×320) guardada en el propio documento. **No usa Firebase Storage** (el plan Spark ya no lo incluye; Storage exigiría Blaze). Campo opcional **`recibeAvisos`** (bool): el bot de WhatsApp avisa a estos colaboradores (con teléfono) cuando se registra una observación (Fase 5). Editable con el botón **📣/🔕** por fila en el editor de personal de `configuracion.html` (`toggleAviso`); en el backup como columna `RECIBE_AVISOS` (SI/NO) |
| `asistencia_registros` | Registros de asistencia diaria |
| `maestros_feriados` | Feriados (campo `fecha`: YYYY-MM-DD) |
| `usuarios` | Usuarios del sistema con roles |
| `insumos_catalogo` | Tipos de ítem/herramienta (nombre, categoria, marca, codigo único, unidad, stockMin, tipoCantidad) |
| `insumos_instancias` | Unidades físicas individuales (itemId→catalogo, sede, estado, paqueteId, responsable, notas) |
| `insumos_movimientos` | Entradas/salidas/transferencias/actualizaciones de instancias |
| `insumos_paquetes` | Contenedores (MOCHILA/CAJA/CAJON/ANAQUEL/MALETÍN) que agrupan instancias vía array `instancias[]` |
| `insumos_instancias_fotos` | Foto (identificación) de cada instancia. Doc id = id de instancia. Campo `foto` = base64 (dataURL JPEG 320×320). **Colección aparte** (no dentro del doc de instancia) para no inflar las lecturas/exportaciones de `insumos_instancias`; se carga junto al resto en `loadAll` |
| `insumos_movimientos_fotos` | Adjuntos opcionales de un movimiento (hoy: salida/baja en lote). Doc id = id del movimiento. Campos: `guiaNumero`, `guiaFoto` (base64), `entregaFoto` (base64), `movimientoId`, `createdAt/By`. **Colección aparte** (igual criterio que las fotos de instancia); se carga en `loadAll` al global `movFotos` (`{guia,entrega}` por movId). Las fotos usan `compressFit` (mantiene proporción, no recorte cuadrado: son documentos/escenas). Se borran al revertir el movimiento o por cascada |
| `proveedores` | Directorio de proveedores (`proveedores.html`). Campos: `ruc`, `razonSocial` (MAYÚSCULAS), `nombreComercial`, `rubro`, `telefono`, `email`, `contacto`, `direccion`, `condicionesPago`, `banco`, `cuenta`, `notas` (texto libre multilínea), `activo` (`SI`/`NO`), + `createdAt/By`, `updatedAt/By`. Doc id = auto-generado (no el RUC, para permitir corregir el RUC sin orfandato; se evita RUC duplicado al crear). ADMIN/SUPER_ADMIN editan; SUPERVISOR solo lectura |
| `manta_equipos` | Maestro de equipos de la manta Ripley (`observaciones.html`). Doc id `MEQ-<slug tienda>__<slug equipo>`. Campos: `tienda` (ej. "RIPLEY SANTA ANITA"), `equipo` (ej. "AA Roof Top 03"), `orden`, `activo`, `origen`. Sembrado del Excel (56 equipos en 8 tiendas) con `migrar_db/seed_manta_equipos.js`. Alimenta los desplegables dependientes tienda→equipo y el export con relleno "Sin observaciones." |
| `manta_observaciones` | Observaciones de mantenimiento (`observaciones.html`). **Log**: 1 doc = 1 observación (un equipo tiene varias). Campos: `tienda`, `equipo`, `observacion`, `estado` (`PENDIENTE`/`EN_PROCESO`/`OK`), `fecha` (YYYY-MM-DD), `tieneFoto`, `tecnicoId` (opcional → `maestros_personal`), `origen` (`APP`/`WHATSAPP`), `registradoPor`, `createdAt/By`, `updatedAt/By`. **Obs v2 (bot):** además `sede` (ATOCONGO…), `eqId` (referencia a `inventario`, ej. MA-ATO-CAI-001), `tipo` (CORTINA DE AIRE…); `tienda`=`cliente + sede` (ej. "RIPLEY ATOCONGO") y `equipo`=nombre del equipo. ADMIN/SUPER_ADMIN editan; SUPERVISOR solo lectura |
| `manta_observaciones_fotos` | Foto opcional de una observación. Doc id = id de la observación. Campo `foto` = base64 (dataURL JPEG, `obsCompress` mantiene proporción, máx 1100px). **Colección aparte** (igual criterio que las fotos de instancia); se carga en `loadAll` al global `obsFotos` |
| `manta_guia` | Guía editable del bot de WhatsApp (Fase 4). Checklist por tipo de hallazgo: qué debe cubrir una buena observación. El bot la inyecta en el prompt de Gemini para decidir si repreguntar UN dato. Campos: `tipo`, `titulo`, `palabrasClave[]`, `checklist[]`, `orden`, `activo`, `origen`. Doc id `MGUIA-<tipo>`. Sembrada con `migrar_db/seed_manta_guia.js` (7 temas: filtros, refrigerante, eléctrico, compresor, drenaje, ventilación, general). **Editable por admin** desde `observaciones.html` (menú usuario → 🤖 Guía del bot, ADMIN/SUPER_ADMIN). En backup de `configuracion.html` (`manta_guia.csv`, arrays unidos por `\|`) |
| `wa_mensajes` | **Idempotencia** del bot (Fase 2): 1 doc por `messageId` de WhatsApp (Meta reenvía). `doc.create()` atómico → cada mensaje se procesa una sola vez. Transitoria/operativa (no se respalda) |
| `wa_sesiones` | **Estado de conversación** del bot (Fase 4): 1 doc por número (doc id = wa_id). Campos: `from`, `tecnicoId`, `fase` (RECOLECTANDO/CONFIRMANDO), `borrador{tienda,equipo,observacion,estado}`, `faltante`, `intentos`, `preguntoDetalle`, `historial[]`, `updatedAt`, `expiraEn` (TTL 30 min, chequeo en lectura). Transitoria/operativa (no se respalda) |
| `wa_sesiones_fotos` | **Foto pendiente** de una conversación del bot (Fase 5): 1 doc por número (doc id = wa_id). Campos: `base64`, `mime`, `updatedAt`. La foto llega en un mensaje y se confirma la obs en otro → se guarda aparte (no en `wa_sesiones`) hasta el "SÍ", y se borra al guardar/cancelar. Tope ~900KB. Transitoria/operativa (no se respalda) |
| `wa_ultima_obs` | **Última observación guardada** por número (doc id = wa_id), para "agregar foto a la última" que el técnico olvidó. Campos: `obsId`, `etiqueta` (nombre del equipo), `expiraEn` (TTL 30 min). Se escribe al guardar una obs y se borra al adjuntar la foto/cancelar. Transitoria/operativa (no se respalda) |

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
Orden actual: Inv. Equipos → Mantenimiento → Itinerario → Insumos → Asistencia → Rendición de Caja → Proveedores → Observaciones → Configuración

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
- `app.multiaire.com.pe` — **dominio corporativo de producción** (conectado 2026-06-19; CNAME→cname.vercel-dns.com en ChileCL)

Todos los dominios de Cloudflare tunnel fueron eliminados.

> **Dominio corporativo `app.multiaire.com.pe`**: el subdominio se sirve por **CNAME** (no se delegan los nameservers del dominio a Vercel — el correo corporativo vive en cPanel de ChileCL). Apunta al proyecto Vercel `app-mantenimiento` (producción/main = la misma deployment que `multiaire-peru-app.vercel.app`). SSL emitido por Vercel.

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
| 2026-06-08 | Fotos del personal: campo `foto` en `maestros_personal` = **imagen base64** (dataURL JPEG 200×200, recorte centrado, calidad 0.8) guardada en el propio documento de Firestore. Editor de personal en `configuracion.html`: botón 📷 por fila comprime y guarda la imagen; miniatura circular al inicio de cada fila. Se persiste al "Guardar cambios" (preservada en `loadMaestros`/`saveMaestros`). **Sin Firebase Storage** — Storage exige plan Blaze; base64 en Firestore funciona en Spark (gratis) y basta para esta escala (~15 colaboradores, fotos diminutas) |
| 2026-06-08 | Insumos: tab "Por Técnico" muestra cabecera con avatar del técnico (foto de `maestros_personal` o inicial de respaldo) en `renderPorTecnico` |
| 2026-06-08 | Backup (`configuracion.html`): columna `FOTO` agregada al export/import CSV de `maestros_personal` |
| 2026-06-08 | Insumos (datos): recategorizado `GEN-01` "MANOMETRO" (4 instancias) de SIN CATEGORIA → MEDICION en Firestore. Script `migrar_db/recat_manometros.js` |
| 2026-06-10 | Fotos del personal: avatar del tab "Por Técnico" agrandado de 56px → 96px (inicial 38px); captura de foto subida de 200×200 → 320×320 (sigue base64 en Firestore, ~40 KB). La miniatura del editor de personal se mantiene en 34px |
| 2026-06-10 | Insumos tab "Por Técnico": opción **"👥 Todos"** en el selector (es el valor por defecto al abrir el tab) — muestra una grilla de tarjetas de todo el personal (avatar + cargo + nº paquetes/instancias sueltas); clic en una tarjeta abre su detalle. `renderPorTecnico` ahora es dispatcher (`renderTodosTecnicos`/`renderTecnicoDetalle`); helper `tecnicoResponsables()` unifica la lista (personal activo + responsables de paquetes/instancias) |
| 2026-06-10 | Insumos: tab renombrado **"👤 Por Técnico" → "👥 Por Persona"** (textos visibles: botón, placeholder del selector y empty state). Los ids internos `tecnicos`/`tab-tecnicos`/`f-tec-persona` se mantienen |
| 2026-06-10 | Personal: rellenadas 11 fotos faltantes desde "DATOS PARA FOTOCHECK.docx" (emparejadas por nombre, recorte cuadrado 320×320 base64). Scripts en `~/Documents/migrar_db/fotocheck/`. Sin foto: ENRIQUE YARANGA, JESÚS MARTÍNEZ, JOSE MARCHENA (no estaban en el docx) |
| 2026-06-10 | Insumos: **foto por instancia** (identificación). Nueva colección `insumos_instancias_fotos` (base64, colección aparte). Subida desde el modal de edición de instancia (botón 📷, `setInstanciaFoto`/`removeInstanciaFoto`); miniatura en la celda ID/QR de la tabla (`instThumb`). Añadida al backup/import de `configuracion.html` |
| 2026-06-10 | Insumos foto de instancia: **lightbox** para ampliar (clic en preview del modal o en miniatura de la tabla → visor `foto-lightbox` a pantalla completa), botón **📸 Tomar foto** (`capture=environment`, clase `.cam-only-mobile` visible solo en móvil) además del de subir, y resolución de captura subida a **480×480** para que ampliar se vea bien. Responsive verificado (modal tipo sheet en móvil, lightbox en vw/vh) |
| 2026-06-10 | Deploy: **eliminado el deploy duplicado**. Cada push generaba 2 deployments (el GitHub Action `vercel deploy` + el auto-deploy de la integración Git de Vercel), duplicando el consumo del plan gratuito. Se añade `vercel.json` con `"git":{"deploymentEnabled":false}` (y excepción en `.vercelignore` para no excluirlo) → los GitHub Actions quedan como **único** mecanismo de deploy (conservan el alias a las URLs fijas) |
| 2026-06-10 | **Nueva app Proveedores (`proveedores.html`)**: directorio CRUD sobre la colección `proveedores`. Construida sobre el scaffold de `comprobantes.html` (header/auth/accesos/footer/toast), retirado todo Gemini/scanner/pdf.js. Toolbar con búsqueda en vivo + Exportar Excel + "Nuevo proveedor" (solo admin) + tabla; modal de alta/edición; SUPERVISOR solo lectura (`isProvAdmin`). Validación de RUC (`^\d{8,11}$`), razón social en MAYÚSCULAS, RUC duplicado bloqueado al crear |
| 2026-06-10 | Proveedores: card 🏢 en `index.html` antes de Configuración; `{id:'proveedores'}` agregado a `ALL_APPS` del panel de accesos; backup export/import de `proveedores.csv` en `configuracion.html` (14ª colección). Activa en develop, pendiente de merge a main |
| 2026-06-10 | Proveedores: campo **`notas`** (texto libre multilínea) — `<textarea>` en el modal, columna "Notas" en la tabla (truncada con `title` completo), incluida en búsqueda, export Excel y backup CSV (`proveedores.csv`). Para observaciones internas (horarios, vendedor, descuentos, plazos, incidencias, links) |
| 2026-06-10 | Proveedores: **merge develop→main → activa en producción**. Probado con un proveedor piloto (FRIO COMPONENTES DEL PERU S.A.C.) creado vía firebase-admin y luego eliminado; la colección `proveedores` queda vacía para datos reales |
| 2026-06-11 | Insumos: **exportar material** a CSV (Excel-compatible, BOM UTF-8). Por persona (tab *Por Persona*, botón "⬇ Exportar material": sueltas + las de sus paquetes) y por paquete (tab *Paquetes* y tarjetas de paquete en detalle de persona, botón "⬇ Material"). Columnas CODIGO/ITEM/COD. CATALOGO/CATEGORIA/SEDE/ESTADO/PAQUETE/RESPONSABLE. Funciones `exportMaterialPersona`/`exportMaterialPaquete`/`_descargarMaterial`, sin dependencias |
| 2026-06-11 | Insumos: el export de material pasa a **selector de formato** (modal `modal-export-mat`): **PDF** principal (jsPDF UMD, reporte en canvas paginado A4), **PNG** segunda (mismo canvas, `toDataURL`), **Excel/CSV** última. `doExportMat(fmt)` despacha; PDF/PNG comparten `_matReportCanvas`. Se agrega jsPDF 2.5.1 vía CDN |
| 2026-06-11 | Insumos: opción **"Incluir foto de cada instancia"** (checkbox en el selector, solo PDF/PNG) → columna FOTO con miniatura recortada por fila (de `insumos_instancias_fotos`/`instFotos`); `_matReportCanvas` pasa a **async** (precarga base64 con `_loadImg`). El CSV gana columna FOTO (SÍ/NO) |
| 2026-06-16 | Insumos (fix): al editar el **nombre** de un ítem del catálogo (`saveInsumo`), ahora se **propaga a las instancias hijas** (`insumos_instancias` con `itemId===docId`) vía batch (troceado a 450 por el límite de 500 de Firestore) + actualización en memoria; antes el nombre denormalizado de cada instancia quedaba desactualizado (se veía viejo en exports de material e historial). Toast informa cuántas instancias se renombraron. El historial de `insumos_movimientos` conserva el `itemNombre` del momento (registro histórico) |
| 2026-06-17 | Insumos: **salida / baja en lote** desde la selección múltiple del tab *Instancias* (botones "⬆ Salida en lote" / "⚠️ Baja en lote", gating `can('salida')===1`). Modal `modal-salida-lote`: lista de seleccionadas + responsable + motivo (obligatorio si baja) + **N° de guía + foto de guía** y **foto de entrega**, todo opcional. `saveSalidaLote` crea UN movimiento `SALIDA`/`BAJA` con `instancias[]` + `instanciasSnapshot[]` (para reversión fiel de lotes mixtos) y borra las instancias por batch (450). Fotos en nueva colección **`insumos_movimientos_fotos`** (doc id = id del movimiento; `compressFit` mantiene proporción). `renderMovimientos` muestra 📎 guía + miniaturas (lightbox). Reversión/cascada adaptadas a lote + borrado de fotos. Se limpia código muerto duplicado en `guardarEdicionMovimiento` |
| 2026-06-17 | Backup (`configuracion.html`): agrega export/import de **`insumos_movimientos_fotos.csv`** (columnas ID/GUIA_NUMERO/GUIA_FOTO/ENTREGA_FOTO/CREATED_AT/CREATED_BY); añadida a `expected` (18ª colección) y a la lista visual de archivos |
| 2026-06-17 | Insumos: **transferencia en lote** desde la selección múltiple del tab *Instancias* (botón "🔄 Transferir en lote", gating `can('transferencia')===1`). Modal `modal-transf-lote` reutiliza el patrón de la transferencia individual (checkboxes Sede/Responsable, destino, realizado por, observación) + guía/fotos opcionales (infra compartida con la salida en lote vía `loteFotoPrefix`). `saveTransfLote` crea UN movimiento `TRANSFERENCIA` con `instancias[]` + `instanciasSnapshot[]` (valores previos) + `camposTransferidos`; aplica el destino a cada instancia y la saca de su paquete. Reversión por instancia (restaura sede/responsable previos; no re-inserta en paquete, igual que la individual) + cascada + borrado de fotos. `renderMovimientos`/`editarMovimiento` adaptados al lote. La transferencia individual (`saveTransferencia`, `instanciaId` + `diffsData`) sigue intacta |
| 2026-06-17 | Insumos: **carga masiva Excel** (`.xlsx`, SheetJS vía CDN). Botón "📊 Carga masiva" en el sidebar (gate `can('crearItem')`). Modal `modal-carga-masiva`: descargar plantilla, exportar base actual, importar con preview (＋nuevos · ↻actualizar · ⚠error) antes de escribir. Archivo de 3 hojas (Catalogo / Instancias / Valores validos). Upsert: catálogo por `CODIGO`, instancias por `ID` (autogenera el id de instancia si falta). Carga **silenciosa** (`origen:'IMPORT_XLSX'`, sin movimientos); nombre de instancia derivado del catálogo (+ propaga a hijas como Etapa 1); NO toca `paqueteId`. Escritura por batch (450). Cierra el plan de 4 etapas de mejoras a insumos |
| 2026-06-17 | Insumos: carga masiva **más intuitiva** — la plantilla/exportación gana una 1ª hoja **"Instrucciones"** (explica cada columna, obligatoriedad, valores válidos y reglas) + anchos de columna; las filas de ejemplo se marcan con `ID=EJEMPLO` y el importador las **ignora** automáticamente. Nuevo botón **"📖 Manual (PDF)"** (jsPDF) con la guía paso a paso descargable. Constantes de guía compartidas `CM_GUIA_CAT`/`CM_GUIA_INST`/`CM_REGLAS` |
| 2026-06-18 | Insumos: la plantilla/export de carga masiva ahora trae **menús desplegables** (Excel data validation) en CATEGORIA/UNIDAD/TIPO_CANTIDAD/ESTADO (inline) y SEDE/ITEM_ID/RESPONSABLE (hoja oculta `_listas`). Como SheetJS Community no escribe validación, se inyecta el XML `<dataValidations>` post-proceso con JSZip (`_cmXlsxBlob`/`_cmValidacionesXml`/`_cmSheetFile`/`_cmListasSheet`); descargas ahora **async** (Blob). Probado round-trip con SheetJS+JSZip reales (genera, inyecta, re-lee; orden OOXML válido) |
| 2026-06-18 | Insumos: carga masiva — **ejemplo guiado** (constante `CM_EJEMPLO`: agregar un ítem "TALADRO" + 2 unidades hijas vía `ITEM_ID=CODIGO`) embebido en la hoja "Instrucciones" de la plantilla/export y en el manual PDF |
| 2026-06-18 | Insumos: carga masiva **más amigable** — se quita la columna **ID del Catálogo** (la llave visible es CODIGO) y se **oculta** la columna ID en Instancias (interna, evita duplicar al reimportar). Se elimina la columna **PLANO** de la carga masiva y del backup, y el **campo `plano` se borra de Firestore** en las 52 instancias que lo tenían (no se mostraba en ninguna pantalla; script `migrar_db/borrar_plano.js`). Las hojas de datos van vacías (los ejemplos pasan a la hoja Instrucciones); se retira el mecanismo de filas `ID=EJEMPLO`. Dropdowns reposicionados (catálogo: CATEGORIA→B, UNIDAD→C, TIPO_CANTIDAD→H) |
| 2026-06-18 | **Nueva app Observaciones (`observaciones.html`)** — "Manta de Observaciones" de mantenimiento Ripley, sobre el scaffold de `proveedores.html`. Colección `manta_observaciones` (log: 1 doc = 1 observación) + `manta_observaciones_fotos` (base64 aparte) + maestro `manta_equipos` (8 tiendas + 56 equipos, sembrado del Excel con `migrar_db/seed_manta_equipos.js`). Desplegables dependientes tienda→equipo, filtros tienda/estado/fecha, estados PENDIENTE/EN_PROCESO/OK, foto con lightbox, export Excel (sábana completa con relleno "Sin observaciones.") y PDF (jsPDF). `isObsAdmin()` (SUPERVISOR solo lectura). Card en `index.html` antes de Configuración; `observaciones` en `ALL_APPS` de proveedores/comprobantes; 3 colecciones `manta_*` al backup. **Parte A** del encargo del bot WhatsApp; **Parte B (bot) pendiente** — backend acordado en Vercel Functions (sin Blaze) |
| 2026-06-19 | **Bot WhatsApp Fase 4 (motor conversacional)** — `api/_lib/conversacion.js`: máquina de estados sobre **`wa_sesiones`** (RECOLECTANDO→CONFIRMANDO, TTL 30 min, doc id = wa_id). Repregunta lo mínimo (tienda/equipo no resueltos contra `manta_equipos`, o **un** detalle sugerido por la guía editable **`manta_guia`**); siempre permite "guardar así"; **confirma antes de escribir** y el técnico fija/corrige el estado; comandos cancelar/nueva/ayuda. Nuevos módulos `sesiones.js`, `guia.js`, `escritura.js`; `gemini.js` ahora devuelve `faltaDetalle`/`pregunta` guiados por `manta_guia`. Al confirmar, escribe en `manta_observaciones` (origen WHATSAPP). `manejarMensaje` con `analizar`/`guardar` inyectables → testeable sin Meta ni Gemini. Guía sembrada con `migrar_db/seed_manta_guia.js` (7 temas). Probado contra Firestore real (`migrar_db/test_fase4.mjs`, 17/17). Pendiente Fase 5: foto desde WhatsApp + aviso a supervisores |
| 2026-06-19 | **Dominio corporativo `app.multiaire.com.pe` EN VIVO** — DNS resuelto en ChileCL (CNAME→cname.vercel-dns.com, serial `2026062002`); conectado al proyecto Vercel `app-mantenimiento` (producción/main) vía `vercel domains add`; SSL OK (HTTP 200, sirve el Panel de Apps); agregado a **Authorized domains** de Firebase Auth (solo append; script `migrar_db/add_authorized_domain.js`). Subdominio por CNAME (no se delegan NS — el correo cPanel sigue en ChileCL). Pendiente de la migración corporativa: pasar la PROPIEDAD de Vercel/GCP/GitHub a `plataforma@multiaire.com.pe` (transfers que requieren login de esa cuenta) |
| 2026-06-20 | **Bot fix (prueba EN VIVO con Gemini real):** `gemini.js` fallaba intermitente al parsear el JSON — gemini-2.5-flash es modelo con *thinking* y el razonamiento truncaba/malformaba el JSON. Fix: `thinkingConfig:{thinkingBudget:0}` (sin thinking → JSON estructurado fiable y más rápido) + `maxOutputTokens` 1024→2048 + parseo defensivo (extrae el primer `{...}`). Verificado en vivo contra el inventario real (`migrar_db/test_bot_live.mjs`): extrae bien sede/equipo y resuelve el código (MA-COM-EXT-002, etc.). Nota: el free tier de Gemini puede dar 429 con muchas llamadas seguidas (el bot lo maneja con gracia) |
| 2026-06-20 | **Observaciones v2 — lado APP (`observaciones.html`) alineado a `inventario`** — desplegables del modal pasan de tienda→equipo (`manta_equipos`) a **sede→tipo→equipo** desde `inventario` (557 equipos; el filtro de tipo ayuda con sedes de hasta 96). `loadAll` carga `inventario`; `saveObs` guarda `sede`/`eqId`/`tipo` (+ `tienda`=cliente+sede). Export Excel = sábana completa del inventario (CLIENTE/SEDE/TIPO/EQUIPO/CÓDIGO/…); PDF = reporte de hallazgos por sede. Filtro de la toolbar poblado desde las observaciones. `manta_observaciones` estaba vacía → pivot limpio sin migración. Cierra el pivot completo (bot + app) |
| 2026-06-20 | **Observaciones v2 — bot alineado al inventario REAL** (`inventario`, 557 equipos · 12 sedes · 14 tipos, en vez de los 56 Roof Tops Ripley de `manta_equipos`). Nuevos `api/_lib/inventario.js` (carga+cachea `inventario`, contexto sedes/tipos) y `equipos.js` (`resolverEquipo`: sede fuzzy + equipo por eq_id exacto / scoring tipo+número / candidatos agrupados por tipo si hay muchos — ATOCONGO tiene 96). `gemini.js` extrae `sede`+`equipo` con contexto. `conversacion.js` usa el nuevo resolver (mensajes sede/equipo/código). `escritura.js`+`manta_observaciones` añaden `sede`/`eqId`/`tipo` (+ `tienda`=cliente+sede compat). `manta.js`/`manta_equipos` quedan **deprecados** (el bot ya no los usa). Probado contra inventario real (`migrar_db/test_obs_v2.mjs`, 15/15). **Pendiente:** lado app observaciones.html (desplegables sede→equipo desde inventario + export) |
| 2026-06-20 | **Bot WhatsApp Fase 5 (foto + avisos a supervisores)** — `media.js` descarga la foto vía Graph API; `fotos.js` la guarda pendiente en **`wa_sesiones_fotos`** (doc por nº, tope ~900KB) hasta el "SÍ"; al confirmar, `escritura.js` la escribe en `manta_observaciones_fotos` (dataURL, igual que la app) + `tieneFoto:true`. `avisos.js` notifica 1:1 a `maestros_personal` con flag **`recibeAvisos`** (+ teléfono, no a quien reportó); `enviarPlantilla` (Graph API template) para plantilla "utility" de Meta (`WHATSAPP_TEMPLATE_AVISO`), o texto libre si no hay plantilla; el aviso no rompe el flujo si falla. El handler descarga la imagen y su `guardar` = escribir + notificar. La confirmación/guardado muestran 📷. Probado contra Firestore real (`migrar_db/test_fase5.mjs`, 17/17). Falta para prod: deploy + env vars + setup Meta (número + plantilla) |
| 2026-06-19 | **Observaciones: editor de la guía del bot (`manta_guia`)** + backup — menú de usuario → 🤖 Guía del bot (ADMIN/SUPER_ADMIN): modal lista de temas + modal alta/edición (título, palabras clave, checklist, orden, activo); CRUD sobre `manta_guia` (`guiaList`, `openGuiaPanel`/`saveGuia`/`deleteGuia`). `manta_guia` añadida al backup export/import de `configuracion.html` (`manta_guia.csv`, 8 columnas, `palabrasClave`/`checklist` unidos por `\|`; 22ª colección). Cierra el "editable por admin" de la Fase 4 |
| 2026-06-20 | **Bot fix (auditoría pre-producción): foto huérfana no se adjunta a una observación nueva** — la foto pendiente (`wa_sesiones_fotos`) solo se borraba al confirmar/cancelar; si la sesión expiraba en silencio (TTL 30 min) la foto quedaba y se adjuntaba a la **siguiente** observación (otro equipo). Fix en `conversacion.js`: al inicio del turno, si no hay sesión viva (`!ses`), se descarta cualquier foto pendiente huérfana **antes** de guardar la del turno actual — sin riesgo de perder la foto dentro de una conversación viva (ahí `getSesion` sí devuelve sesión). Regresión cubierta en `migrar_db/test_fase5.mjs` (caso 6). De paso se **restauraron** `test_fase4.mjs` y `test_fase5.mjs`, que el pivot Obs v2 había dejado obsoletos (stubs con esquema `{tienda}`/"roof top" → ahora `{sede}` + eq_id real del `inventario`). Suite del bot en verde: fase4 17/17 · fase5 22/22 · obs_v2 15/15 |
| 2026-06-20 | **Merge develop→main → App Observaciones + bot WhatsApp + Obs v2 EN PRODUCCIÓN** (`8ee7e65`). `observaciones.html` activa en producción (desplegables sede→tipo→equipo desde `inventario`, fotos, export Excel/PDF, editor de `manta_guia`). El backend del bot (`api/whatsapp.js` + `_lib`, Fases 1-5) queda **desplegado pero inerte** hasta cablear Meta (sin env vars el webhook solo responde 401/403). También a prod: flag `recibeAvisos` en el editor de personal + colecciones `manta_*`/`wa_*` en backup. Verificado: `app.multiaire.com.pe/observaciones.html` y `multiaire-peru-app.vercel.app/observaciones.html` → 200, card en el index. **Pendiente go-live del bot:** marcar ≥1 supervisor con `recibeAvisos`, setup Meta, env vars en Vercel |
| 2026-06-20 | **Bot WhatsApp EN VIVO en número real** (+51 972 416 669) — setup Meta completo: app "MultiAire Bot", WABA de producción `4327823754136219`, número registrado en Cloud API, token permanente (Usuario del sistema, no caduca), webhook por API. Env vars en Vercel (Preview/develop). Probado end-to-end por WhatsApp: identifica al técnico, Gemini estructura, resuelve el equipo, conversa y guarda en `manta_observaciones`. (Detalle operativo en memoria [[project_migracion_corporativa]].) |
| 2026-06-20 | **Bot: identificación de equipo por UBICACIÓN** (`equipos.js`) — los técnicos nombran el equipo por su sitio ("el extractor del comedor", "gran volumen 1"), no por "extractor 1/2/3". El `matchEquipo` ahora: (1) **detecta el TIPO** mencionado y restringe el pool a ese tipo (arregla que "extractor …" devolviera un Split); (2) puntúa las palabras de **`area`** (ubicación del inventario, poblada en 545/557) con **+2** (distintivas) vs +1 del nombre; (3) el número del nombre/eq_id pesa +3 (canónico) y el del área +1 (desempata, p.ej. "gran volumen 1"→GRAN VOLUMEN 01). `conversacion.js` muestra **📍 Ubicación** en la confirmación y el `area` en la lista de candidatos; `escritura.js` guarda `area` en la observación (`sesiones.js` borrador añade `area`). Probado contra inventario real (11/11 casos ubicación/tipo/código) + obs_v2 15/15 + fase4 17/17 + fase5 22/22 |
| 2026-06-20 | **Bot: reintento ante rate limit de Gemini** (`gemini.js`) — el free tier de Gemini da **429** (y a veces 5xx transitorios) cuando el técnico manda mensajes muy seguidos; el bot respondía "🤔 No pude procesar eso, ¿puedes repetir?" y obligaba a repetir (síntoma: el MISMO texto fallaba y al reenviarlo funcionaba). Ahora `estructurarObservacion` **reintenta** ante 429/5xx con backoff (1.5s, 3s; 3 intentos) → se recupera solo sin pedir repetir. (Para alto volumen, considerar habilitar billing de Gemini para límites mayores.) |
| 2026-06-20 | **Bot: límite diario de Gemini + robustez de foto** — diagnóstico en vivo: la 1ª prueba con foto falló por **429 cuota DIARIA del free tier** (`gemini-2.5-flash` = solo **~20 req/día**), agotada por las pruebas del día (no era la imagen ni un bug). Arreglos: (1) `GEMINI_MODEL=gemini-2.5-flash-lite` en Vercel (cuota diaria separada y más alta; verificado que resuelve texto **e** imagen igual de bien); (2) `conversacion.js`: si el análisis **con imagen** falla, **reintenta solo con el texto** (la foto igual se adjunta — el caption es la señal principal, Gemini "verla" es opcional). **Recomendación para producción real: habilitar billing en Gemini** (pago por uso, ~fracciones de centavo por observación) → quita el tope diario. |
| 2026-06-20 | **Gemini en tier PAGADO + modelo `gemini-2.5-flash`** — el usuario habilitó **billing** en el proyecto `multiaire-fee43` (AI Studio → Configurar facturación; prepago/Cloud Prepay en PEN — Firebase pasa a Blaze pero a su uso sigue ~$0). Tier pagado activo → sin tope diario. `GEMINI_MODEL=gemini-2.5-flash` en Vercel (calidad/precio con margen; verificado texto+imagen sin 429). |
| 2026-06-20 | **Bot: agregar foto a la última observación** (la olvidó al registrar) — tras guardar, el bot recuerda la obs ~30 min (colección **`wa_ultima_obs`**, doc por nº, TTL). Si el técnico manda una **foto sin texto** justo después → pregunta *"¿La adjunto a tu última observación (X)?"* → **SÍ** la adjunta; o escribe *"agregar foto a la última"* → *"mándame la foto"* y la pega. Si en cambio describe un equipo nuevo, arranca una observación nueva (con esa foto). `escritura.js agregarFotoAObservacion(obsId, foto)` escribe en `manta_observaciones_fotos` + `tieneFoto:true`; `conversacion.js` añade el estado `ADJUNTAR_FOTO` + `manejarAdjuntarFoto`; `sesiones.js` guarda/lee `wa_ultima_obs`; `resumenGuardado` sugiere mandar la foto si se guardó sin ella. Probado contra Firestore real (`migrar_db/test_foto_ultima.mjs`, 8/8) + suite fase4 17 · fase5 22 · obs_v2 15 |
| 2026-06-20 | **Aviso a supervisores incluye la UBICACIÓN** (`avisos.js`) — no mostraba el `area`. `textoAviso` (texto libre) añade "📍 Ubicación: {area}", y la **plantilla** de Meta `nueva_observacion` pasa a **5 variables**: `{{1}}`sede · `{{2}}`equipo · `{{3}}`ubicación · `{{4}}`estado · `{{5}}`detalle (params saneados: sin saltos de línea + placeholder "—" si vacío, que Meta rechaza). **Pendiente:** aprobar la plantilla de 5 vars en Meta + `WHATSAPP_TEMPLATE_AVISO=nueva_observacion` en Vercel |
| 2026-06-20 | **Observaciones: columna UBICACIÓN en la app** (`observaciones.html`) — la app no mostraba el `area`. Nueva columna **Ubicación** en la tabla (entre Equipo y Observación; helper `obsArea(o)` que la deriva del `inventario` por `eqId` si el doc no la trae), hint **📍 Ubicación** en el modal al elegir equipo (`onObsEquipoChange`), `saveObs` persiste `area`, y el **Excel** suma columna UBICACIÓN. *(Nota: el backup CSV de `manta_observaciones` en configuracion.html sigue sin exportar los campos de Obs v2 — sede/eqId/tipo/area —, gap preexistente desde el pivot; pendiente de completar.)* |
| 2026-06-20 | **Observaciones MULTI-CLIENTE** (proyectado al crecimiento: Tottus el próximo año, etc.) — el panel estaba atado a Ripley. El modelo de datos YA era multi-cliente (`inventario.cliente`, `maestros_tiendas.cliente`); se destrabó la UI y el bot. **App (`observaciones.html`):** título genérico ("Manta de observaciones", sin "— Ripley"); selector **Cliente → Sede → Tipo → Equipo** (con UN solo cliente el campo Cliente se autoselecciona y se oculta → UX idéntica a hoy; al entrar otro cliente aparece). `fillClienteSelect`/`applyClienteVisibility`/`onObsClienteChange`; fills filtran por `(cliente, sede)`; `saveObs` guarda `cliente`. **Bot:** `equipos.js` recorta el nombre de cualquier cliente (no solo "RIPLEY") con `sinClientes`, detecta el cliente nombrado (`clienteMencionado`) y `matchEquipo` filtra por `(cliente, sede)` → desambigua sedes compartidas (ej. "tottus plaza norte" vs "ripley plaza norte"); `inventario.js` expone `clientes`; `escritura.js` guarda `cliente`. Probado: con TOTTUS temporal en PLAZA NORTE, "tottus…"→TOTTUS, sin cliente→pregunta. Suite verde (obs_v2 15 · fase4 17 · fase5 22 · foto_ultima 8). **Agregar un cliente = solo cargar su inventario + tiendas; cero cambio de código.** |
| 2026-06-20 | **Observaciones: ver detalle al click + filtro de cliente** (`observaciones.html`) — (1) **click en una fila** abre un modal de **detalle solo-lectura** (`modal-obs-ver`/`openObsVer`): tienda, cliente (si hay >1), equipo, 📍 ubicación, observación completa (caja legible, `white-space:pre-wrap`), estado, fecha, técnico, origen y foto (clic→lightbox), con botón **✎ Editar** para admins (→`openEditObs`). Antes era doble-click directo a editar. La foto-thumb y el botón de acción usan `event.stopPropagation()` para no disparar el detalle. (2) **filtro de Cliente** en la toolbar (`obs-f-cliente`/`populateClienteFilter`/`obsClienteDe`) — oculto con un solo cliente, visible con ≥2 (multi-cliente); en `obsFilter` + `clearObsFilters`. |
