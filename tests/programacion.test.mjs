// Gantt de programación de mantenimientos: lógica pura (programacion.js) + cableado en Mantenimiento y reglas.
// Uso: node tests/programacion.test.mjs
import fs from 'node:fs';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
await import('../programacion.js');   // el repo es ESM: el archivo (script clásico en el navegador) se cuelga de globalThis.PROG
const PROG = globalThis.PROG;
const leer = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ── días del período
const sepOct = PROG.diasDelPeriodo('SEP-OCT', 2026);
t('SEP-OCT tiene 30 + 31 días', sepOct.length === 61 && sepOct[0] === '2026-09-01' && sepOct[60] === '2026-10-31');
t('ENE-FEB de un año no bisiesto tiene 59 días, de uno bisiesto 60', PROG.diasDelPeriodo('ENE-FEB', 2026).length === 59 && PROG.diasDelPeriodo('ENE-FEB', 2028).length === 60);
t('un período desconocido no da días', PROG.diasDelPeriodo('XXX', 2026).length === 0);
t('dow: 2026-11-01 es domingo', PROG.dow('2026-11-01') === 0 && PROG.dow('2026-11-02') === 1);

// ── validación
const base = { cliente: 'TOTTUS', sede: 'MIRAFLORES', desde: '2026-09-03', hasta: '2026-09-05', cuadrilla: '1' };
t('visita válida', PROG.validarVisita(base, 'SEP-OCT', 2026) === '');
t('exige sede', PROG.validarVisita({ ...base, sede: '' }, 'SEP-OCT', 2026) !== '');
t('exige fechas', PROG.validarVisita({ ...base, desde: '' }, 'SEP-OCT', 2026) !== '');
t('fin antes que inicio se rechaza', PROG.validarVisita({ ...base, desde: '2026-09-06' }, 'SEP-OCT', 2026) !== '');
t('fuera del período se rechaza', PROG.validarVisita({ ...base, hasta: '2026-11-02' }, 'SEP-OCT', 2026) !== '');
t('una visita de un solo día es válida', PROG.validarVisita({ ...base, hasta: '2026-09-03' }, 'SEP-OCT', 2026) === '');
t('sin cuadrilla es válida', PROG.validarVisita({ ...base, cuadrilla: '' }, 'SEP-OCT', 2026) === '');
t('cuadrilla inexistente se rechaza', PROG.validarVisita({ ...base, cuadrilla: '9' }, 'SEP-OCT', 2026) !== '');

// ── choques de cuadrilla
const otras = [
  { id: 'a', cliente: 'RIPLEY', sede: 'ATOCONGO', desde: '2026-09-04', hasta: '2026-09-08', cuadrilla: '1' },
  { id: 'b', cliente: 'RIPLEY', sede: 'COMAS', desde: '2026-09-04', hasta: '2026-09-08', cuadrilla: '2' },
  { id: 'c', cliente: 'TOTTUS', sede: 'MIRAFLORES', desde: '2026-09-04', hasta: '2026-09-04', cuadrilla: '1' },   // la misma fila
];
t('misma cuadrilla en otra sede y días cruzados = choque', PROG.choques(otras, { ...base, id: 'n' }).map((x) => x.id).join() === 'a');
t('otra cuadrilla no choca', PROG.choques(otras, { ...base, id: 'n', cuadrilla: '2' }).map((x) => x.id).join() === 'b');
t('sin cuadrilla no hay choque', PROG.choques(otras, { ...base, cuadrilla: '' }).length === 0);
t('días que no se cruzan no chocan', PROG.choques(otras, { ...base, desde: '2026-09-20', hasta: '2026-09-21' }).length === 0);
t('al editar, la visita no choca consigo misma', !PROG.choques(otras, { ...otras[0] }).some((x) => x.id === 'a'));
t('dos visitas de la misma sede (misma fila) no cuentan como choque', PROG.choques(otras, { ...base, id: 'n', desde: '2026-09-04', hasta: '2026-09-04' }).every((x) => !(x.cliente === 'TOTTUS' && x.sede === 'MIRAFLORES')));

// ── tramo en la grilla
t('tramo normal', JSON.stringify(PROG.tramo({ desde: '2026-09-03', hasta: '2026-09-05' }, sepOct)) === '{"ini":2,"n":3}');
t('tramo que empieza antes del período se recorta', PROG.tramo({ desde: '2026-08-30', hasta: '2026-09-02' }, sepOct).ini === 0);
t('tramo fuera del período es null', PROG.tramo({ desde: '2026-12-01', hasta: '2026-12-02' }, sepOct) === null);

// ── filas: toda sede con equipos aparece, aunque no tenga visitas; RIPLEY y TOTTUS no se mezclan
const equipos = [
  { cliente: 'RIPLEY', sede: 'MIRAFLORES' }, { cliente: 'RIPLEY', sede: 'MIRAFLORES' },
  { cliente: 'TOTTUS', sede: 'MIRAFLORES' }, { cliente: 'TOTTUS', sede: 'VILLA EL SALVADOR' },
];
const vis = [{ id: '1', cliente: 'TOTTUS', sede: 'MIRAFLORES', desde: '2026-09-09', hasta: '2026-09-10', cuadrilla: '1' }];
const f = PROG.filas(equipos, vis);
t('3 filas: Miraflores de cada cliente por separado + Villa El Salvador', f.length === 3, JSON.stringify(f.map((r) => r.cliente + '|' + r.sede)));
t('la visita cae solo en la fila de su cliente', f.find((r) => r.cliente === 'TOTTUS' && r.sede === 'MIRAFLORES').visitas.length === 1 && f.find((r) => r.cliente === 'RIPLEY').visitas.length === 0);
t('filtro por cliente', PROG.filas(equipos, vis, { cliente: 'RIPLEY' }).length === 1);
t('filtro por cuadrilla deja solo las sedes con esa cuadrilla', PROG.filas(equipos, vis, { cuadrilla: '1' }).length === 1 && PROG.filas(equipos, vis, { cuadrilla: '2' }).length === 0);
t('filtro "sin programar" deja las sedes sin visitas', PROG.filas(equipos, vis, { cuadrilla: '-' }).length === 2);
t('una visita de una sede sin equipos igual se muestra', PROG.filas([], vis).length === 1);

// ── cableado
const html = leer('mantenimiento_multiaire.html');
t('Mantenimiento carga programacion.js', /<script src="programacion\.js"><\/script>/.test(html));
t('el tab Programación está entre los globales y repinta al cambiar de período', /switchTab\('programacion'\)/.test(html) && /id="tab-programacion"/.test(html) && /if\(tabActivo\(\)==='programacion'\) renderProgramacion\(\);/.test(html));
t('solo ADMIN/SUPER edita la programación', /function _prgPuedeEditar\(\)\{ return MA\.isAdmin\(\); \}/.test(html));
t('guardar/eliminar vuelven a comprobar el permiso', (html.match(/if\(!_prgPuedeEditar\(\)/g) || []).length >= 3);
const rules = leer('firestore.rules');
t('reglas: todos leen, solo ADMIN escribe', /match \/mtto_programacion\/\{doc\}\s*\{\s*allow read: if authorized\(\);\s*allow create, update: if isAdmin\(\);\s*allow delete: if isAdmin\(\);\s*\}/.test(rules));
const conf = leer('configuracion.html');
t('el backup incluye mtto_programacion (export, import y lista)', /mtto_programacion\.csv/.test(conf) && (conf.match(/mtto_programacion/g) || []).length >= 4);

// ── trimestres (clientes de visita trimestral: TOTTUS)
{
  t('T1 2026 = ene-mar (90 días)', PROG.diasDelPeriodo('T1', 2026).length === 90 && PROG.diasDelPeriodo('T1', 2026)[0] === '2026-01-01' && PROG.diasDelPeriodo('T1', 2026).at(-1) === '2026-03-31');
  t('T1 de año bisiesto = 91 días', PROG.diasDelPeriodo('T1', 2028).length === 91);
  t('T4 2026 = oct-dic', PROG.diasDelPeriodo('T4', 2026)[0] === '2026-10-01' && PROG.diasDelPeriodo('T4', 2026).at(-1) === '2026-12-31');
  t('el bimestre sigue igual (SEP-OCT 61 días)', PROG.diasDelPeriodo('SEP-OCT', 2026).length === 61);
  t('período desconocido → sin días', PROG.diasDelPeriodo('T5', 2026).length === 0 && PROG.mesesDelPeriodo('XYZ').length === 0);
  t('visita TOTTUS válida dentro de T4', PROG.validarVisita({ cliente: 'TOTTUS', sede: 'MALL DEL SUR', desde: '2026-11-03', hasta: '2026-11-05', cuadrilla: '1' }, 'T4', 2026) === '');
  t('visita fuera del trimestre se rechaza', PROG.validarVisita({ cliente: 'TOTTUS', sede: 'MALL DEL SUR', desde: '2026-09-28', hasta: '2026-10-02' }, 'T4', 2026) !== '');
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
