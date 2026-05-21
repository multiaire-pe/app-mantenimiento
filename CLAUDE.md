# Contexto del proyecto — app-mantenimiento (MultiAire Perú)

## Qué es
App web interna de MultiAire Perú para gestión de asistencia del personal técnico.
Vanilla HTML/JS, sin framework. Firebase Firestore como base de datos (SDK compat 9.23.0).
No hay servidor — todo corre en el browser con Firebase Auth + Firestore directo.

## Archivos principales
- `asistencia_multiaire.html` — app principal, todo en un solo archivo
- `firebase-config.js` — config pública de Firebase (project: `multiaire-fee43`)
- `wsp_import/importar_asistencia.py` — script Python para importar asistencia desde ZIP de WhatsApp

## Firestore — colecciones
| Colección | Descripción |
|---|---|
| `maestros_personal` | Colaboradores (id, nombre, cargo, telefono, activo) |
| `asistencia_registros` | Registros de asistencia diaria |
| `maestros_feriados` | Feriados (campo `fecha`: YYYY-MM-DD) |
| `usuarios` | Usuarios del sistema con roles |

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

- **Producción**: card Insumos en gris, no clickeable, tag "EN DESARROLLO". Asistencia activa.
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
