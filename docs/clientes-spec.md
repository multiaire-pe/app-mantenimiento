# Gestor de clientes como entidad — Contrato de datos (Etapa 2)

> Estado: **arranque 2026-07-10**. Alcance **completo** (identidad + sedes + contrato/licitación + actividades por cliente), con RIPLEY **ya poblado** desde los datos actuales. Módulo nuevo `clientes.html`.

## Problema que resuelve

Hoy "cliente" **no es una entidad**: es un **string denormalizado** (`'RIPLEY'`) repetido en `maestros_tiendas.cliente` e `inventario.cliente`. No hay dónde guardar datos del cliente (RUC, contacto), su contrato/licitación, ni actividades de mantenimiento propias. La Etapa 2 lo convierte en una **ficha real** (`maestros_clientes`) **sin romper nada**: el string `cliente` sigue siendo la **llave de join** (no se refactoriza a IDs), así el bot productivo y los módulos actuales siguen funcionando igual.

## Regla de oro del modelo

- El **string `cliente`** (ej. `'RIPLEY'`) es la llave que une todo: `maestros_clientes` ⇄ `maestros_tiendas` ⇄ `inventario` ⇄ `operatividad_eventos`.
- **`doc-id` de `maestros_clientes` = ese mismo string** (ej. `maestros_clientes/RIPLEY`). Join directo, sin tablas de traducción.
- Nadie renombra el string a la ligera (rompería el join). Renombrar un cliente = tarea de migración aparte (fuera de alcance).

## 1) Colección NUEVA `maestros_clientes` (doc-id = string cliente)

| Campo | Tipo | Nota |
|---|---|---|
| `nombre` | string | = doc-id = **llave de join**. Es el `cliente` de `maestros_tiendas`/`inventario`. |
| `ruc` | string | RUC (11 díg. en Perú); opcional |
| `razonSocial` | string | |
| `nombreComercial` | string | |
| `contactoNombre` | string | |
| `contactoTelefono` | string | |
| `contactoEmail` | string | |
| `direccion` | string | dirección fiscal |
| `contrato` | map | `{ numero, licitacion, vigenciaDesde:'YYYY-MM-DD', vigenciaHasta:'YYYY-MM-DD', notas }` — datos del contrato/licitación |
| `activo` | bool | default `true` |
| `notas` | string | |
| `createdAt`/`createdBy` | string / string | ISO + email |
| `updatedAt`/`updatedBy` | string / string | ISO + email |

## 2) Sedes — **siguen en `maestros_tiendas`** (join por string `cliente`)

No se migran (el bot de asistencia usa `maestros_tiendas` para geofencing: `latitud/longitud/radio`). El gestor de clientes las **lee y agrupa** por `cliente`, y permite crear/editar sedes (escribe a `maestros_tiendas`, gate super — la regla actual es `write: isSuper`). Estructura vigente de `maestros_tiendas`: `{ id, cliente, tienda, sede, activo, latitud, longitud, radio, obs }`. Los **equipos** de cada sede se cuentan desde `inventario` (por `cliente`+`sede`).

## 3) Actividades de mtto — viven SOLO en el cliente (`tareas_config/{cliente|tipo}`)

Las actividades **salen de la licitación de cada cliente**, así que una plantilla "global para todos" no significa nada: se retiró. El modelo definitivo (2026-07-13):

- **Única fuente:** `tareas_config/{cliente|tipo}` = `{ cliente, tipo, tareas:[nombres], minutos:[mins] }` (ej. `tareas_config/RIPLEY|CHILLER`). **Sin fallback.**
- **Un (cliente, tipo) sin plantilla no tiene actividades.** No se hereda nada: el bot responde *"no tiene actividades configuradas — pedile al administrador que las configure en la app de Clientes"* y la ficha del cliente marca el tipo con **⚠️ sin configurar**. Es a propósito: registrar contra una lista que el cliente no contrató es peor que no registrar.
- **Ajuste por equipo** (`mtto_actividades_equipo`, doc-id = `eq_id`): sigue existiendo y se aplica **encima** de la plantilla del cliente — `(plantilla − quitadas) + agregadas`. Se edita en **Mantenimiento** (⚙️ Ajustar actividades por equipo), no en Clientes.

**Dónde se edita cada cosa:**

| Qué | Dónde | Quién |
|---|---|---|
| Plantilla del cliente por tipo | `clientes.html` → ficha → Actividades | SUPER_ADMIN |
| Ajuste de un equipo puntual | `mantenimiento_multiaire.html` → ⚙️ Ajustar actividades por equipo | `canWrite('mantenimiento')` |

En la ficha del cliente, un tipo sin plantilla se puede **⧉ Copiar de otro cliente** (atajo para no re-tipear una lista idéntica) y una plantilla existente se puede **🗑 Borrar** (con confirm explícito: sus equipos quedan sin actividades).

**Migración ejecutada (2026-07-13):** se creó `RIPLEY|CHILLER` (el único de los 14 tipos que aún dependía del fallback: sus 8 chillers), se borraron los 14 docs `-|{tipo}` del cliente fantasma (la oficina, 0 equipos) y **se retiraron las 14 plantillas globales**. Los 557 equipos tienen la plantilla de su cliente.

## 4) Firestore rules

- `maestros_clientes`: `read` autenticado; `create/update` **ADMIN/SUPER** (`isAdmin()`); `delete` solo SUPER (entidad de negocio, mismo criterio que `maestros_personal`).
- `tareas_config`: **la regla NO cambia** — `match /tareas_config/{doc}` cubre cualquier doc-id; sigue `read: authorized / write: isSuper`. Editar las actividades de un cliente = super.
- `maestros_tiendas`: sin cambios (`write: isSuper`).
- Catch-all fail-closed intacto.

## 5) Backup (`configuracion.html`)

- `maestros_clientes.csv`: patrón JSON-doc (`ID`, `DATA`=`JSON.stringify(doc)`).
- `tareas_config.csv`: columna **`CLIENTE`** + agrupación por (cliente,tipo) en import. Un backup viejo sin `CLIENTE` importa como docs por `tipo` — que ya nadie lee (quedarían inertes, no rompen nada).

## 6) Lectores de `tareas_config`

Todos resuelven **`{cliente|tipo}` y nada más**; los doc-id sin `|` se ignoran (plantillas globales del modelo viejo):

- **Bot** (`api/_lib/mtto.js` `_resolverActs(eqId, tipo, cliente)`): lee `{cliente|tipo}`; sin plantilla → lista vacía → el mensaje explícito de arriba. `esActividadConocida` (detección de intención) usa los nombres de **todas** las plantillas, de todos los clientes (es un Set de nombres, no un map por tipo → no hay colisión).
- **Mantenimiento** (`actividadesDe(eq)` → `plantillaDeEq(eq)`): `TAREAS_CLI['{cliente|tipo}']`. Ya no hay fallback hardcodeado si falla la carga (antes había uno que se desactualizaba en silencio): avisa y deja la lista vacía.
- **Itinerario** (armado del plan): `plantillasCli['{cliente|tipo}']` por equipo.
- **Inventario** (`inventario_multiaire.html`): ya no lee `tareas_config` — el selector de tipos se alimenta del **inventario mismo** (es la fuente de verdad de qué tipos hay), con una opción **"✏️ Otro tipo (escribir)…"** para dar de alta el primer equipo de un tipo nuevo.
- **Configuración** (`configuracion.html`): el editor de plantillas globales **se retiró**. Conserva el backup/restore de `tareas_config`.

## Módulo `clientes.html`

- **Gate:** `MA.canEnter('clientes')` (entrada); edición identidad/contrato = `MA.can('editar','clientes')` (ADMIN/SUPER + supervisor con la app); actividades y sedes = super (reglas de `tareas_config`/`maestros_tiendas`).
- **Lista** de clientes (tarjetas): nombre, RUC, nº de sedes, nº de equipos, activo.
- **Ficha** (detalle): secciones **Identidad**, **Contrato/Licitación**, **Sedes** (de `maestros_tiendas` + conteo de equipos), **Actividades** (por tipo, con badge "propia"/"heredada de la global").
- **Botón "Generar desde datos actuales"** (super, idempotente): crea `maestros_clientes` a partir de los strings `cliente` distintos en `maestros_tiendas`+`inventario`, y copia las actividades globales a `{cliente|tipo}`.

## Fuera de alcance (después)

- Encender el consumo por cliente (§6).
- Renombrar el string de un cliente (migración masiva).
- Vincular contrato ⇄ sedes cubiertas ⇄ SLA/frecuencias.
