// La lista de equipos que ve el técnico sale en orden NATURAL por nombre, no en el orden de los
// códigos del inventario. Uso: node tests/equipos_orden.test.mjs
import { opcionesEquipo, ordenarPorNombre } from '../api/_lib/equipos.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

// Caso real de Comandante Espinar: el código NO sigue la numeración del nombre.
// Los Jet Fan se numeraron 1..26 por su número, pero sus códigos quedaron en orden alfabético.
const mk = (id, nombre) => ({ eq_id: id, nombre, tipo: 'INYECTOR', area: 'SOTANO' });
const jet = [
  mk('MA-CES-INY-033', 'Inyector 33 (Jet Fan 1)'),
  mk('MA-CES-INY-034', 'Inyector 43 (Jet Fan 10)'),     // el código dice 034, el nombre dice 43
  mk('MA-CES-INY-035', 'Inyector 44 (Jet Fan 11)'),
  mk('MA-CES-INY-044', 'Inyector 34 (Jet Fan 2)'),
  mk('MA-CES-INY-052', 'Inyector 35 (Jet Fan 3)'),
  mk('MA-CES-INY-058', 'Inyector 42 (Jet Fan 9)'),
];
const nombres = (o) => o.texto.split('\n').filter((l) => l.includes('•')).map((l) => l.replace(/^[\s•]+/, '').replace(/^.*?(Inyector \d+).*$/, '$1'));

const o = opcionesEquipo(jet);
t('modo equipos', o && o.modo === 'equipos');
t('sale en orden de numeración (33, 34, 35, 42, 43, 44)', nombres(o).join(',') === 'Inyector 33,Inyector 34,Inyector 35,Inyector 42,Inyector 43,Inyector 44', nombres(o).join(','));

// 2 dígitos vs 1 dígito: "02" antes que "10" (orden numérico, no alfabético)
t('numérico, no alfabético', ordenarPorNombre([mk('a', 'Inyector 10'), mk('b', 'Inyector 02'), mk('c', 'Inyector 9')]).map((e) => e.nombre).join() === 'Inyector 02,Inyector 9,Inyector 10');

// Los especiales siguen a los normales porque su número es mayor
const ext = [
  { eq_id: 'e1', nombre: 'Extractor 37 (Humo 1)', tipo: 'EXTRACTOR', area: 'N1' },
  { eq_id: 'e2', nombre: 'Extractor 02', tipo: 'EXTRACTOR', area: 'A' },
  { eq_id: 'e3', nombre: 'Extractor 32 (Grasa)', tipo: 'EXTRACTOR', area: 'B' },
  { eq_id: 'e4', nombre: 'Extractor 31', tipo: 'EXTRACTOR', area: 'C' },
];
t('extractores: normales, grasa, humo', ordenarPorNombre(ext).map((e) => e.nombre.match(/\d+/)[0]).join() === '02,31,32,37');

// No muta la lista original ni rompe con datos incompletos
const orig = [mk('x', 'B 2'), mk('y', 'A 1')];
ordenarPorNombre(orig);
t('no muta la entrada', orig[0].nombre === 'B 2');
t('tolera nombre vacío / equipo sin nombre', ordenarPorNombre([{ eq_id: '1' }, { eq_id: '2', nombre: 'A' }, { eq_id: '3', equipo: 'B' }]).length === 3);
t('lista vacía → null', opcionesEquipo([]) === null && opcionesEquipo(null) === null);
t('empates conservan el orden de llegada (sort estable)', ordenarPorNombre([{ eq_id: 'p', nombre: 'Igual' }, { eq_id: 'q', nombre: 'Igual' }]).map((e) => e.eq_id).join() === 'p,q');

// Con muchas áreas (modo agrupado por ubicación) el orden también sale por número
const varios = [mk('1', 'Inyector 05'), mk('2', 'Inyector 01'), mk('3', 'Inyector 03')].map((e, i) => ({ ...e, area: 'ZONA ' + (i % 2) }));
const o2 = opcionesEquipo(varios);
t('agrupado por ubicación: primero el 01', o2.texto.indexOf('Inyector 01') < o2.texto.indexOf('Inyector 03') && o2.texto.indexOf('Inyector 03') < o2.texto.indexOf('Inyector 05'), o2.texto);

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
