# Brief — Frente A: Operatividad en el bot de WhatsApp

> Responsable: **José + Claude**. Rama: `feature/operatividad-bot` desde `develop`.
> Contrato de datos: **`docs/operatividad-spec.md`** (léelo primero; los nombres de campo salen de ahí).

## Qué construye

Que, **después de que el técnico confirme una observación**, el bot le pregunte en qué **porcentaje** quedó operativo el equipo, y persista ese dato. La foto sigue siendo opcional (no se toca ese comportamiento).

## Flujo actual (referencia)

El flujo de observación vive en `api/_lib/conversacion.js`, con sesión en `wa_sesiones` (`api/_lib/sesiones.js`) y fases:
`RECOLECTANDO → CONFIRMANDO → (al "SÍ" guarda la obs y sugiere foto opcional) → ADJUNTAR_FOTO`.
La escritura de la observación está en `api/_lib/escritura.js`.

## Flujo nuevo (objetivo)

```
RECOLECTANDO → CONFIRMANDO
   └─ "SÍ" → guarda la observación (obtiene obsId) → fase OPERATIVIDAD
                 └─ técnico responde % (o "omitir")
                       → registra operatividad (evento + inventario)
                       → sigue el recordatorio de foto opcional (igual que hoy)
```

La operatividad se pregunta **una sola vez, después de guardar la observación**, y antes/junto al recordatorio de foto. "Omitir" no bloquea nada.

## Pasos

1. **`api/_lib/operatividad.js` (NUEVO)** — tres piezas puras + una de escritura:
   - `nivelDeOperatividad(pct)` → `{ porcentaje, nivel, emoji, etiqueta }` (tabla del spec).
   - `menuOperatividad()` → el texto del menú a enviar:
     > ¿En qué estado quedó el equipo? Responde el número:
     > 1️⃣ 100 % Operativo 🟢
     > 2️⃣ 75 % Operativo c/observaciones 🟡
     > 3️⃣ 50 % Parcial 🟠
     > 4️⃣ 25 % Crítico 🔴
     > 5️⃣ 0 % Inoperativo ⚫
     > _(o escribe "omitir")_
   - `parsearOperatividad(texto)` → `100/75/50/25/0` | `'OMITIR'` | `null` (no entendido). Acepta `1..5`, los propios `100/75/50/25/0`, y sinónimos de omitir (`omitir`, `no`, `skip`, `-`).
   - `registrarOperatividad({eqId, sede, cliente, tipo, nombre, area, porcentaje, obsId, tecnicoId, registradoPor, origen:'WHATSAPP'})`:
     - `.add()` a **`operatividad_eventos`** con todos los campos del spec (incluye `nivel` derivado).
     - `update` en **`inventario/{eqId}`** de los 5 campos vivos (`operatividad`, `operatividadFecha`, `operatividadPor`, `operatividadObsId`, `operatividadOrigen`).
     - Usar el helper de Firestore Admin del proyecto (`api/_lib/firestore.js`).

2. **`api/_lib/escritura.js`** — que `guardarObservacion` (o equivalente) **retorne el `obsId`** (el id del `.add()`), para pasarlo a la operatividad. Hoy ya hace el `.add()`; solo hay que devolver `ref.id`.

3. **`api/_lib/sesiones.js`** — agregar la fase `OPERATIVIDAD`. Guardar en la sesión el borrador del equipo (eqId/sede/cliente/tipo/nombre/area) + `obsId` para tenerlos disponibles en el turno siguiente. TTL igual al actual (30 min).

4. **`api/_lib/conversacion.js`** — enganchar la fase:
   - Al confirmar la obs (donde hoy pasa a sugerir foto): guardar el `obsId`, setear fase `OPERATIVIDAD` y enviar `menuOperatividad()`.
   - Manejar la fase `OPERATIVIDAD`: `parsearOperatividad(texto)`:
     - número → `registrarOperatividad(...)`, confirmar corto (ej. "✅ Operatividad registrada: 75 % 🟡") y **continuar al recordatorio de foto** (misma lógica de hoy).
     - `'OMITIR'` → no registra, salta directo al recordatorio de foto.
     - `null` → repreguntar una vez (reenviar el menú); a la 2ª entrada inválida, omitir para no trabar al técnico.

## Criterios de aceptación

- [ ] Tras confirmar una observación, el bot pregunta el % con las 5 opciones + "omitir".
- [ ] Responder `1`–`5` **o** `100/75/50/25/0` escribe **1 doc** en `operatividad_eventos` y actualiza los campos `operatividad*` del equipo en `inventario`.
- [ ] `nivel` y el emoji del acuse coinciden con la tabla del spec.
- [ ] "omitir" (y sinónimos) no registra nada y no bloquea; el flujo sigue al recordatorio de foto.
- [ ] El recordatorio de foto opcional funciona **igual que antes** (no se rompe `ADJUNTAR_FOTO`).
- [ ] Entrada inválida repregunta una vez y luego omite; sesión expirada no rompe.
- [ ] `obsId` del evento coincide con el id de la observación recién creada.

## Cierre

- `node --check` sobre los `.js` tocados (extraer no aplica, son módulos reales).
- Harness que ejerza el **código real** de `operatividad.js` (parseo + niveles) contra casos, y opcionalmente contra Firestore real read-only (patrón del proyecto).
- **Council (`/auditar`)** sobre el diff antes de subir.
- Changelog en `CLAUDE.md` (anchor único).
- Commit + push a `feature/operatividad-bot` → PR a `develop`. **No** merge a `main` sin OK de José.
- **No** tocar `firestore.rules` (el bot usa Admin SDK).
