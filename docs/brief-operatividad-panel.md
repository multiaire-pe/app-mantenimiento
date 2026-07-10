# Brief — Frente B: Panel de operatividad

> Responsable: **Adrián**. Rama: `feature/operatividad-panel` desde `develop`.
> Contrato de datos: **`docs/operatividad-spec.md`** (léelo primero; nombres de campo, fórmula del rollup, escala de color y frescura salen de ahí).
> ⚠️ Antes de empezar: `git pull` en `develop` (el bot no toca tus archivos, pero el spec/briefs se suben ahí).

## Qué construye

El módulo nuevo **`operatividad.html`**: un tablero para que José/Adrián (y de cara al cliente) vean el **estado de operatividad de los equipos por sede/cliente**, el historial por equipo, puedan editarlo a mano, y configuren la criticidad por tipo. **No tocas `api/`.**

## Alcance

### 1) `operatividad.html` (NUEVO)
- Scaffold igual al de los otros módulos (header "solo módulo", sin footer/reloj — ver `index.html` y los módulos existentes) + **auth-guard** (la app es solo ADMIN/SUPERVISOR).
- Carga: `inventario` (mismo patrón que `observaciones.html`, ~557 equipos), `operatividad_eventos`, `maestros_criticidad`.
- **Vista "Por Sede"** (la que se le muestra al cliente):
  - Tarjetas agrupadas Cliente → Sede, con el **% ponderado** de la sede (fórmula del spec) y su color de banda.
  - Badge de frescura ⚠️ "a re-verificar" cuando la sede tiene equipos `stale` (regla del spec: sin reporte > 60 días o nunca).
  - Drill-down: al abrir una sede, lista sus equipos con su % actual, color, última fecha/quién, y el ⚠️ por equipo.
- **Vista "Por Equipo"**:
  - Reusa el selector Cliente→Sede→Tipo→Equipo de `observaciones.html`.
  - Muestra el % actual del equipo (color + etiqueta), última actualización y **historial** (timeline leyendo `operatividad_eventos` filtrado por `eqId`, orden desc por fecha).
- **Edición manual** (ADMIN/SUPERVISOR): botón para fijar el % de un equipo con las 5 opciones (100/75/50/25/0). Al guardar:
  - `.add()` a `operatividad_eventos` con `origen:'APP'`, `obsId:null`, `registradoPor` = email del usuario, `nivel` derivado.
  - `update` de los campos `operatividad*` en `inventario/{eqId}`.
  - Mismo shape que escribe el bot (ver spec) para que ambos orígenes sean intercambiables.

### 2) Maestro de criticidad (`maestros_criticidad`)
- UI (dentro de `operatividad.html` o en `configuracion.html`, a tu criterio) para setear **peso 1–5 por tipo** de equipo.
- Sembrar: listar los tipos reales que existen en `inventario`, crear cada uno con `peso:3` por default; José ajusta los pesos (ej. chiller/UMA altos, split/cortina bajos).
- El rollup usa `peso ?? 3`.

### 3) `index.html` + `auth-guard.js`
- Tile/tarjeta del módulo en el índice (con su ícono).
- Registrar el módulo en `auth-guard.js` con los roles que correspondan (patrón de los módulos existentes).

### 4) `configuracion.html` — backup
- Sumar al export/import las dos colecciones nuevas: **`operatividad_eventos`** y **`maestros_criticidad`**.
- "Reemplazar todo" debe **vaciarlas** si el ZIP no las trae (mismo patrón que las demás colecciones nuevas).

### 5) `firestore.rules`
- `operatividad_eventos`: `read` autenticado; `create` ADMIN/SUPERVISOR; `update/delete` solo SUPER_ADMIN.
- `maestros_criticidad`: `read` autenticado; `write` SUPER_ADMIN (o ADMIN, según el patrón que ya usás).
- **Regla de oro:** antes de `firebase deploy --only firestore:rules`, `git pull` (el deploy REEMPLAZA todo el ruleset — ver el incidente del 2026-07-08 en el Tablero).

## Criterios de aceptación

- [ ] "Por Sede" muestra el % ponderado correcto (verificable a mano con 2–3 equipos y sus pesos).
- [ ] Un equipo sin reporte cuenta como 100 % y aparece 🟢, pero con badge ⚠️ de frescura.
- [ ] Un equipo con reporte viejo (>60 días) muestra ⚠️ sin que su color deje de reflejar el último %.
- [ ] "Por Equipo" muestra el historial completo desde `operatividad_eventos`.
- [ ] La edición manual escribe evento (`origen:'APP'`) + actualiza `inventario`, y se refleja al instante.
- [ ] El maestro de criticidad persiste y cambia el % ponderado de las sedes.
- [ ] Backup export/import incluye ambas colecciones; "Reemplazar todo" las vacía si faltan en el ZIP.
- [ ] Reglas desplegadas sin borrar las existentes (`git pull` antes del deploy).

## Cierre

- **Council (`/auditar`)** sobre el diff antes de subir (ojo XSS: escapar datos de Firestore en todos los renders, como en los otros módulos).
- Changelog en `CLAUDE.md` (anchor único — es el único archivo que comparten los dos frentes).
- Commit + push a `feature/operatividad-panel` → PR a `develop`. Anotar en el Tablero al empezar y al abrir el PR.
