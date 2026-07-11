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

## 3) Actividades de mtto **por cliente** — `tareas_config` con doc-id `cliente|tipo` + fallback

Hoy `tareas_config/{tipo}` = `{ tipo, tareas:[nombres], minutos:[mins] }` es **global por tipo** (misma plantilla para todos). Como las actividades **varían por licitación** (confirmado por José), el modelo pasa a:

- **Override por cliente:** `tareas_config/{cliente|tipo}` = `{ cliente, tipo, tareas:[...], minutos:[...] }` (ej. `tareas_config/RIPLEY|SPLIT`).
- **Fallback:** si no existe `{cliente|tipo}`, se usa la global `{tipo}` (los docs actuales, sin `|`, quedan como **plantilla base**).
- **Retrocompatible:** los lectores actuales (bot, mantenimiento, itinerario) leen `tareas_config/{tipo}` y **siguen funcionando sin cambios** (usan la global). El "leer por cliente" es un **interruptor futuro** (ver §6).

**Backfill (RIPLEY ya poblado):** por cada `tareas_config/{tipo}` global se genera `tareas_config/RIPLEY|{tipo}` con las mismas `tareas`/`minutos` + `cliente:'RIPLEY'`. Así RIPLEY arranca con sus actividades "ya establecidas" (idénticas a las de hoy) y editables por cliente.

## 4) Firestore rules (las agrega el gestor)

- `maestros_clientes`: `read` autenticado; `create/update` **ADMIN/SUPER** (`isAdmin()`); `delete` solo SUPER (entidad de negocio, mismo criterio que `maestros_personal`).
- `tareas_config`: **la regla NO cambia** — `match /tareas_config/{doc}` cubre cualquier doc-id (`tipo` o `cliente|tipo`); sigue `read: authorized / write: isSuper`. Editar actividades por cliente = super, igual que hoy.
- `maestros_tiendas`: sin cambios (`write: isSuper`).
- Catch-all fail-closed intacto.

## 5) Backup (`configuracion.html`)

- `maestros_clientes.csv`: patrón JSON-doc (`ID`, `DATA`=`JSON.stringify(doc)`).
- `tareas_config.csv`: se le agrega columna **`CLIENTE`** y se **agrupa por (cliente,tipo)** en import (de paso corrige un bug previo que colapsaba las tareas a la última fila). Backward-compatible: un backup viejo sin `CLIENTE` → cliente vacío → docs globales por `tipo`.

## 6) Retrocompat de lectores + consumo por cliente

**Blindaje de lectores (SÍ hecho en este arranque — hallazgo CRÍTICO del Council):** los lectores actuales de `tareas_config` agrupan por el **campo `tipo`**, así que si conviven `tareas_config/RIPLEY|SPLIT` y `tareas_config/SPLIT` (ambos con `tipo:'SPLIT'`), un override podría **sobrescribir la plantilla global en memoria**. Por eso todos los lectores **globales** ahora **ignoran los doc-id con `|`**: `api/_lib/mtto.js` (`esActividadConocida`), `itinerario.html`, `mantenimiento_multiaire.html`, `inventario_multiaire.html` y el editor global de `configuracion.html`. El editor global preserva overrides al guardar (`if(id.includes('|'))return` en su delete-all), y el import de `tareas_config` solo hace delete-all en modo `replace`. `api/_lib/mtto.js` `_resolverActs` lee `tareas_config/{tipo}` por doc-id directo → no colisiona. **Esto NO cambia el comportamiento actual** (hoy no hay docs `cliente|tipo`); solo protege ante el backfill.

**Consumo por cliente (ENCENDIDO 2026-07-11):** el bot, Mantenimiento e Itinerario ahora **resuelven la plantilla del cliente del equipo** (`tareas_config/{cliente|tipo}`) **con fallback a la global** (`tareas_config/{tipo}`) cuando el cliente no tiene override. Puntos:
- **Bot** (`api/_lib/mtto.js` `_resolverActs(eqId, tipo, cliente)`): lee `{cliente|tipo}` ?? `{tipo}`; el caller pasa `r.equipo.cliente` y la sesión guarda `ses.cliente` (para los minutos al guardar). `esActividadConocida` (detección de intención) incluye también los nombres de actividades por cliente (Set, sin colisión).
- **Mantenimiento** (`actividadesDe(eq)`): `TAREAS_CLI['{cliente|tipo}']` ?? `TAREAS[tipo]`; carga ambas plantillas (globales y por cliente) y las cachea.
- **Itinerario** (armado del plan): `plantillasCli['{cliente|tipo}']` ?? `plantillas[tipo]` por equipo.
El override **por equipo** (`mtto_actividades_equipo`) se aplica igual **encima** de la plantilla resuelta. Como RIPLEY (backfill) tiene `RIPLEY|tipo == global`, **no cambia nada observable hoy**; el efecto aparece cuando un cliente edita su plantilla o entra un 2.º cliente. Validado con harness sobre el código real del bot (8/8). Los lectores que solo necesitan la lista de tipos (selector de `inventario_multiaire.html`) o editan la plantilla global (`configuracion.html`) siguen usando solo las globales.

## Módulo `clientes.html`

- **Gate:** `MA.canEnter('clientes')` (entrada); edición identidad/contrato = `MA.can('editar','clientes')` (ADMIN/SUPER + supervisor con la app); actividades y sedes = super (reglas de `tareas_config`/`maestros_tiendas`).
- **Lista** de clientes (tarjetas): nombre, RUC, nº de sedes, nº de equipos, activo.
- **Ficha** (detalle): secciones **Identidad**, **Contrato/Licitación**, **Sedes** (de `maestros_tiendas` + conteo de equipos), **Actividades** (por tipo, con badge "propia"/"heredada de la global").
- **Botón "Generar desde datos actuales"** (super, idempotente): crea `maestros_clientes` a partir de los strings `cliente` distintos en `maestros_tiendas`+`inventario`, y copia las actividades globales a `{cliente|tipo}`.

## Fuera de alcance (después)

- Encender el consumo por cliente (§6).
- Renombrar el string de un cliente (migración masiva).
- Vincular contrato ⇄ sedes cubiertas ⇄ SLA/frecuencias.
