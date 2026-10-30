// Visor de parámetros en Mantenimiento: extrae el código REAL de mantenimiento_multiaire.html (formatos y
// parBloques) y comprueba que los registros salen en las columnas de las hojas de TOTTUS.
// Uso: node tests/parametros_visor.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../mantenimiento_multiaire.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join('\n');

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

const ini = html.indexOf('const PAR_FILAS = 10;');
const fin = html.indexOf('// ── Pantalla ──');
t('existe el bloque del visor', ini > 0 && fin > ini);
const codigo = html.slice(ini, fin);
const { parBloques, PAR_FORMATOS, PAR_FILAS, parRangoPeriodo } = new Function(`${codigo}\nreturn { parBloques, PAR_FORMATOS, PAR_FILAS, parRangoPeriodo };`)();

const elec = { fases: '3PH', v1: 220, v2: 221, v3: 219, a1: 9.8, a2: 10.1, a3: 'NA' };
const rec = (i, formato, extra = {}) => ({
  id: 'PAR-' + i, formato, eqId: 'MA-X-' + i, nombreEq: 'Equipo ' + i, area: 'AREA ' + i, sede: 'LOS OLIVOS', cliente: 'TOTTUS',
  tecnicoNombre: 'ENRIQUE YARANGA', os: 'OS-9', fecha: '2026-10-29', hora: '10:' + String(i).padStart(2, '0'), estado: 'OP',
  capturadoEn: `2026-10-29T15:${String(i).padStart(2, '0')}:00.000Z`, observaciones: '', electrico: elec,
  datos: {}, ...extra,
});
const SPLIT = (i, x = {}) => rec(i, 'SPLIT', { datos: { presionBaja: 118, presionAlta: 350.5, tempSalidaAire: 'NA' }, ...x });
const cols = (f) => PAR_FORMATOS[f].cols;

// ── columnas = las hojas de Excel ──
{
  const enc = (f) => cols(f).map((c) => (c.s ? c.g + ' ' + c.s : c.g).replace(/\n/g, ' ')).join(' | ');
  t('Split: columnas de la hoja', enc('SPLIT') === 'N° | EQUIPO (código / nombre) | UBICACIÓN | VOLTAJE (V) L1 | VOLTAJE (V) L2 | VOLTAJE (V) L3 | AMPERAJE (A) L1 | AMPERAJE (A) L2 | AMPERAJE (A) L3 | PRESIÓN DE BAJA (psi) | PRESIÓN DE ALTA (psi) | TEMP. SALIDA DE AIRE (°C) | ESTADO (OP / OO / FS)', enc('SPLIT'));
  t('Fan coil y UMA: columnas de la hoja', enc('FANCOIL_UMA').endsWith('POTENCIA DEL MOTOR (hp / W) | MODELO / SERIE DEL MOTOR | MODELO / CANT. DE FAJA | TEMP. ENTRADA AGUA HELADA (°C) | TEMP. SALIDA AGUA HELADA (°C) | ESTADO (OP / OO / FS)'), enc('FANCOIL_UMA'));
  t('Ventilación: columnas de la hoja', enc('VENTILACION').endsWith('POTENCIA DEL MOTOR (hp / W) | MODELO / SERIE DEL MOTOR | MODELO / CANT. DE FAJA | TIPO DE EXTRACTOR | ESTADO (OP / OO / FS)'), enc('VENTILACION'));
  t('Cortinas: columnas de la hoja', enc('CORTINA').endsWith('MEDIDA DE CORTINA | POTENCIA DEL MOTOR (hp / W) | MODELO / SERIE DEL MOTOR | ESTADO (OP / OO / FS)'), enc('CORTINA'));
  t('las 4 hojas empiezan igual (N°, equipo, ubicación, 3 voltajes, 3 amperajes)', Object.keys(PAR_FORMATOS).every((f) => cols(f).slice(0, 9).map((c) => c.s || c.g.split('\n')[0]).join() === 'N°,EQUIPO,UBICACIÓN,L1,L2,L3,L1,L2,L3'));
}

// ── un registro → una fila ──
{
  const b = parBloques([SPLIT(1)]);
  t('un registro: una hoja con una fila', b.length === 1 && b[0].filas.length === 1);
  const f = b[0].filas[0];
  t('fila: N°, equipo (nombre + código), ubicación', f[0] === 1 && f[1] === 'Equipo 1\nMA-X-1' && f[2] === 'AREA 1', JSON.stringify(f));
  t('fila: voltaje y amperaje L1-L3 (NA → N/A)', f.slice(3, 9).join() === '220,221,219,9.8,10.1,N/A', f.slice(3, 9).join());
  t('fila: presiones, N/A y estado', f.slice(9).join() === '118,350.5,N/A,OP', f.slice(9).join());
  t('encabezado de la hoja: sede, fecha, periodo, técnico, OS, cliente', b[0].sede === 'LOS OLIVOS' && b[0].fecha === '2026-10-29' && b[0].periodo === 'SEP-OCT 2026' && b[0].tecnicos === 'ENRIQUE YARANGA' && b[0].os === 'OS-9' && b[0].cliente === 'TOTTUS');
  const mono = parBloques([SPLIT(1, { electrico: { fases: '1PH', v1: 220, v2: null, v3: null, a1: 5, a2: null, a3: null } })])[0].filas[0];
  t('monofásico: L2/L3 quedan vacías (no "null")', mono.slice(3, 9).join() === '220,,,5,,', mono.slice(3, 9).join());
  t('el 0 es un valor, no un vacío', parBloques([SPLIT(1, { electrico: { ...elec, a1: 0 } })])[0].filas[0][6] === '0');
}
// ── ventilación: tipo de extractor como checklist ──
{
  const mk = (t) => parBloques([rec(1, 'VENTILACION', { datos: { potenciaMotor: '1.5 HP', modeloSerieMotor: 'SA-15', modeloCantFaja: 'A55 x1', tipoExtractor: t } })])[0].filas[0];
  const c = mk('CENTRIFUGA');
  const chk = c[c.length - 2];
  t('tipo de extractor: marca ☒ solo el elegido', chk.includes('☒ Centrífuga') && chk.includes('☐ Axial') && chk.includes('☐ Humo') && chk.includes('☐ Hongo') && chk.includes('☐ Cajón') && (chk.match(/☒/g) || []).length === 1, chk);
  t('tipo de extractor: N/A', mk('NA')[mk('NA').length - 2] === 'N/A');
  t('ventilación: potencia, motor y faja', c.slice(9, 12).join() === '1.5 HP,SA-15,A55 x1', c.slice(9, 12).join());
}
// ── agrupación: sede + formato + fecha, 10 equipos por hoja ──
{
  const muchos = Array.from({ length: 23 }, (_, i) => SPLIT(i + 1));
  const b = parBloques(muchos);
  t('23 equipos → 3 hojas de 10/10/3', b.length === 3 && b.map((x) => x.filas.length).join() === '10,10,3', b.map((x) => x.filas.length).join());
  t('las hojas dicen "Hoja n de N"', b.map((x) => x.pagina + '/' + x.paginas).join() === '1/3,2/3,3/3');
  t('el N° de equipo reinicia en cada hoja', b[1].filas[0][0] === 1 && b[2].filas[2][0] === 3);
  t('orden de captura', b[0].filas[0][1].startsWith('Equipo 1\n') && b[2].filas[2][1].startsWith('Equipo 23\n'));
  const mezcla = parBloques([SPLIT(1), rec(2, 'CORTINA', { datos: {} }), SPLIT(3, { sede: 'ATOCONGO' }), SPLIT(4, { fecha: '2026-10-30' })]);
  t('sede / formato / fecha distintos van en hojas distintas', mezcla.length === 4, mezcla.map((x) => x.sede + x.formato + x.fecha).join('|'));
  t('un formato desconocido (versión vieja) se ignora sin romper', parBloques([{ ...SPLIT(1), formato: 'VENTILACION_MECANICA' }, SPLIT(2)]).length === 1);
  t('sin registros → sin hojas', parBloques([]).length === 0);
  const dosTec = parBloques([SPLIT(1), SPLIT(2, { tecnicoNombre: 'LUIS AMPUERO', os: 'OS-10' })])[0];
  t('varios técnicos / OS en la misma hoja se listan', dosTec.tecnicos === 'ENRIQUE YARANGA, LUIS AMPUERO' && dosTec.os === 'OS-9, OS-10');
  const obs = parBloques([SPLIT(1, { observaciones: 'ruido' }), SPLIT(2), SPLIT(3, { observaciones: 'fuga' })])[0];
  t('observaciones numeradas por equipo, solo las que existen', obs.observaciones.join('|') === '1. Equipo 1: ruido|3. Equipo 3: fuga', obs.observaciones.join('|'));
}
// ── periodo ──
{
  const per = (f) => parBloques([SPLIT(1, { fecha: f })])[0].periodo;
  t('periodos bimestrales', per('2026-01-15') === 'ENE-FEB 2026' && per('2026-02-28') === 'ENE-FEB 2026' && per('2026-03-01') === 'MAR-ABR 2026' && per('2026-12-31') === 'NOV-DIC 2026' && per('2026-10-29') === 'SEP-OCT 2026');
}
// ── filtro por período (igual que Desempeño): período + año → rango de fechas ──
{
  const r = (p, a) => JSON.stringify(parRangoPeriodo(p, a));
  t('SEP-OCT 2026', r('SEP-OCT', 2026) === '{"desde":"2026-09-01","hasta":"2026-10-31"}', r('SEP-OCT', 2026));
  t('ENE-FEB: febrero normal y bisiesto', r('ENE-FEB', 2026) === '{"desde":"2026-01-01","hasta":"2026-02-28"}' && r('ENE-FEB', 2028) === '{"desde":"2028-01-01","hasta":"2028-02-29"}', r('ENE-FEB', 2026) + r('ENE-FEB', 2028));
  t('MAR-ABR / MAY-JUN / JUL-AGO / NOV-DIC', r('MAR-ABR', 2026) === '{"desde":"2026-03-01","hasta":"2026-04-30"}' && r('MAY-JUN', 2026) === '{"desde":"2026-05-01","hasta":"2026-06-30"}' && r('JUL-AGO', 2026) === '{"desde":"2026-07-01","hasta":"2026-08-31"}' && r('NOV-DIC', 2026) === '{"desde":"2026-11-01","hasta":"2026-12-31"}');
  t('período o año inválido → null', parRangoPeriodo('XXX', 2026) === null && parRangoPeriodo('SEP-OCT', 'abc') === null && parRangoPeriodo('', 2026) === null);
  const g = parRangoPeriodo('SEP-OCT', 2026), dentro = (f) => f >= g.desde && f <= g.hasta;
  t('los bordes del período entran y los días vecinos no', dentro('2026-09-01') && dentro('2026-10-31') && !dentro('2026-08-31') && !dentro('2026-11-01'));
}
// ── la pantalla ──
t('pestaña Parámetros y su vista', /switchTab\('parametros'\)/.test(html) && /id="tab-parametros"/.test(html) && /if\(tab==='parametros'\) renderParametros\(\);/.test(html));
t('filtros: período + año, sede y tipo de equipo (sin fechas sueltas ni "formato")', /id="par-periodo"/.test(html) && /id="par-anio"/.test(html) && /id="par-sede"/.test(html) && /id="par-tipo"/.test(html) && !/id="par-desde"|id="par-hasta"|id="par-formato"/.test(html));
t('el filtro de tipo usa el tipo del equipo del registro', /\(!tipo \|\| r\.tipo === tipo\)/.test(html));
t('el Excel se nombra por período', /a\.download = `Parametros \$\{periodoTxt\}\.xlsx`/.test(html));
t('lee mtto_parametros por rango de fecha (sin índice compuesto)', /collection\('mtto_parametros'\)\.where\('fecha', '>=', desde\)\.where\('fecha', '<=', hasta\)/.test(html));
t('exportar exige permiso', /async function parExportarExcel\(\) \{\s*\n\s*if \(!MA\.can\('exportar', 'mantenimiento'\)\)/.test(html));
t('ExcelJS cargado desde cdnjs', /cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/exceljs\.min\.js/.test(html));
t('los datos de Firestore se escapan en la lista y la vista', /<td><b>\$\{_actEsc\(r\.nombreEq \|\| r\.eqId\)\}<\/b>/.test(html) && /<b>\$\{_actEsc\(r\.tecnicoNombre/.test(html) === false && /const e = _actEsc;/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
