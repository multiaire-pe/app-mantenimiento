# Operatividad de equipos — Contrato de datos (Etapa 1)

> Fuente de verdad compartida entre los dos frentes. **Ningún frente inventa nombres de campo ni fórmulas: los toma de aquí.** Si algo hay que cambiar, se cambia acá primero y se avisa en el Tablero de equipo.

## Objetivo (Etapa 1)

Que cada cliente pueda saber el **estado de operatividad de sus equipos por sede**. Un técnico reporta por WhatsApp, tras registrar una observación, en qué **porcentaje** quedó operativo el equipo; el panel muestra un tablero por sede/cliente (ponderado por criticidad) y el historial por equipo.

Fuera de alcance de la Etapa 1 (van en la Etapa 2): gestor de clientes como entidad (`maestros_clientes`), contrato/licitación, actividades de mantenimiento por cliente.

## Decisiones cerradas (con José)

| Tema | Decisión |
|---|---|
| Escala | **% en 5 niveles discretos**: 100 / 75 / 50 / 25 / 0 |
| Captura | El bot pregunta el % **tras registrar una observación** (con opción "omitir") |
| Foto | **Opcional siempre**, con recordatorio (se mantiene el comportamiento actual del flujo de obs) |
| Equipos sin reporte | **Se asumen operativos (100 %)** en el tablero; distinguir "sin verificar" con el badge de frescura |
| % por sede | **Promedio ponderado por criticidad** (peso 1–5 por **tipo** de equipo) |
| Frescura | Sin reporte > **60 días** (o nunca) → señal **interna** "a re-verificar" ⚠️; **NO** baja el % que ve el cliente |
| Alertas | **Sin** aviso automático al grupo en la Etapa 1 |
| Disparador | **Solo tras observación** en la Etapa 1 (no tras mtto) |
| Panel | Módulo nuevo `operatividad.html` |

## Escala % → nivel → color (tabla compartida)

Ambos frentes implementan la MISMA tabla (el bot, para el menú; el panel, para el color). Es una función chica, se copia en cada lado (no hay módulo compartido entre `api/` y el front).

| % | `nivel` (guardar así) | Emoji | Etiqueta para el usuario | Color sugerido (panel) |
|---|---|---|---|---|
| 100 | `OPERATIVO`    | 🟢 | Operativo                 | `#16a34a` |
| 75  | `OBSERVADO`    | 🟡 | Operativo c/observaciones | `#eab308` |
| 50  | `PARCIAL`      | 🟠 | Parcial                   | `#f97316` |
| 25  | `CRITICO`      | 🔴 | Crítico                   | `#dc2626` |
| 0   | `INOPERATIVO`  | ⚫ | Inoperativo               | `#1f2937` |

Valores de `porcentaje` permitidos en Etapa 1: **{0, 25, 50, 75, 100}**.

Firma de la función compartida (mismo comportamiento en ambos lados):
```
nivelDeOperatividad(pct) -> { porcentaje, nivel, emoji, etiqueta, color }
```

## Modelo de datos

### 1) Campos NUEVOS en `inventario` (doc-id = `eq_id`) — estado vivo

Se agregan sin tocar los existentes (`eq_id, sede, cliente, tipo, nombre, area, marca, modelo, serie`):

| Campo | Tipo | Notas |
|---|---|---|
| `operatividad` | `number \| null` | Último % reportado (0/25/50/75/100). `null` = nunca reportado |
| `operatividadFecha` | `string \| null` | `'YYYY-MM-DD'` del último reporte |
| `operatividadPor` | `string \| null` | Nombre de quien reportó (técnico o email admin) |
| `operatividadObsId` | `string \| null` | Id de la observación que originó el reporte (o `null` si fue edición manual) |
| `operatividadOrigen` | `'WHATSAPP' \| 'APP' \| null` | Canal del último reporte |

**Quién escribe:** el bot (Frente A, vía Admin SDK) y el panel en edición manual (Frente B). **Mismo shape en ambos.**

### 2) Colección NUEVA `operatividad_eventos` — historial (append-only)

Un documento por cada reporte (doc-id autogenerado con `.add()`). Nunca se edita ni se borra (salvo super, si el panel lo decide).

| Campo | Tipo | Notas |
|---|---|---|
| `eqId` | string | Referencia a `inventario` |
| `sede` | string | Denormalizado del equipo |
| `cliente` | string | Denormalizado del equipo |
| `tipo` | string | Denormalizado del equipo |
| `nombre` | string | Nombre/descripción del equipo |
| `area` | string | Ubicación física |
| `porcentaje` | number | 0/25/50/75/100 |
| `nivel` | string | `OPERATIVO`/`OBSERVADO`/`PARCIAL`/`CRITICO`/`INOPERATIVO` (derivado, se guarda) |
| `origen` | `'WHATSAPP' \| 'APP'` | |
| `obsId` | `string \| null` | Observación que lo originó (bot); `null` en edición manual |
| `tecnicoId` | `string \| null` | Id en `maestros_personal` (bot) |
| `registradoPor` | string | Nombre del técnico / email del admin |
| `fecha` | string | `'YYYY-MM-DD'` |
| `createdAt` | string | **ISO 8601** (`new Date().toISOString()`) en AMBOS frentes — bot y panel. Se usa como clave de orden del historial; unificado a string para evitar tipos mixtos (Timestamp vs string) en la misma colección. Fallback de orden: `fecha`. |
| `createdBy` | string | Igual que `registradoPor` |

### 3) Colección NUEVA `maestros_criticidad` — pesos por tipo (solo panel)

Doc-id = **tipo** de equipo (ej. `"CHILLER"`). La gestiona 100 % el Frente B; **el bot no la lee**.

| Campo | Tipo | Notas |
|---|---|---|
| `tipo` | string | = doc-id |
| `peso` | number | 1–5 (5 = más crítico) |

**Default = 3** para cualquier tipo que no esté cargado. El Frente B lista los tipos reales desde `inventario`, los siembra con 3 y José ajusta.

## Fórmula del rollup (Frente B)

Para una **sede** (y análogo para un **cliente**, agregando sus sedes):

```
pct(eq)  = eq.operatividad ≠ null ? eq.operatividad : 100     // sin reporte = operativo
w(eq)    = maestros_criticidad[eq.tipo].peso ?? 3
operatividadSede = round( Σ w(eq)·pct(eq) / Σ w(eq) )          // sobre todos los equipos de la sede
```

Bandas de color del agregado continuo (sede/cliente):

| operatividadSede | Color |
|---|---|
| ≥ 90 | 🟢 |
| 75–89 | 🟡 |
| 50–74 | 🟠 |
| 25–49 | 🔴 |
| < 25 | ⚫ |

## Frescura (alerta interna, Frente B)

Se **deriva en el panel**, no se persiste. Es una señal para José/Adrián, no baja el % del cliente:

```
stale(eq) = eq.operatividadFecha == null  ||  (hoy − eq.operatividadFecha) > 60 días
```

Un equipo `stale` se muestra con badge ⚠️ "a re-verificar / sin verificar". El color de operatividad sigue su regla normal (sin dato ⇒ 🟢 100 %).

## Firestore rules (las toca SOLO el Frente B)

El bot usa Admin SDK y **no** pasa por reglas, así que el Frente A no toca `firestore.rules` (así el único archivo compartido queda `CLAUDE.md`). El Frente B agrega:

- `operatividad_eventos`: `read` para autenticado; `create` para **ADMIN/SUPER_ADMIN** (`isAdmin()`); `update/delete` solo SUPER_ADMIN. **Nota:** la edición manual del panel escribe el evento **y** en el mismo `db.batch()` actualiza el estado vivo en `inventario` (update ⇒ exige `canWrite('inventario')` = ADMIN/SUPER). Un SUPERVISOR pasaría el `create` pero fallaría el `update` de inventario (batch a medias); por eso `create` es `isAdmin()` y el gate de UI también (`MA.isAdmin()`). El bot no se ve afectado (Admin SDK ignora reglas). El SUPERVISOR con la app `operatividad` mantiene lectura/entrada al panel, sin edición manual.
- `maestros_criticidad`: `read` para autenticado; `write` para SUPER_ADMIN (maestro ⇒ super-only, mismo criterio que los demás `maestros_*`). El gate de UI del maestro de criticidad es `MA.isSuperAdmin()`.

Seguir el patrón de reglas ya existente en el repo. **Regla de oro del proyecto:** antes de `firebase deploy --only firestore:rules`, `git pull` (un deploy REEMPLAZA todo el ruleset).

## Backup (lo agrega el Frente B en `configuracion.html`)

Sumar al export/import las dos colecciones nuevas: **`operatividad_eventos`** y **`maestros_criticidad`** (regla del proyecto: toda colección nueva va al backup, y "Reemplazar todo" debe vaciarlas si el ZIP no las trae).

## Reparto de frentes (archivos)

| | Frente A — Bot (José + Claude) | Frente B — Panel (Adrián) |
|---|---|---|
| Rama | `feature/operatividad-bot` | `feature/operatividad-panel` |
| Archivos | `api/_lib/operatividad.js` (nuevo) · `conversacion.js` · `escritura.js` · `sesiones.js` | `operatividad.html` (nuevo) · `index.html` · `auth-guard.js` · `configuracion.html` · `firestore.rules` |
| Escribe | `operatividad_eventos`, `inventario.operatividad*` | `operatividad_eventos` (manual), `inventario.operatividad*` (manual), `maestros_criticidad` |
| Lee | `inventario` (ya lo hace) | `inventario`, `operatividad_eventos`, `maestros_criticidad` |
| No toca | `firestore.rules`, la criticidad, el rollup | nada de `api/` |
| Compartido | `CLAUDE.md` (changelog, anchors únicos) | `CLAUDE.md` (changelog, anchors únicos) |

Flujo: `feature/*` desde `develop` → PR a `develop` → Council/Codex antes de subir. `main` solo José. Avisar en el Tablero al empezar y al terminar.
