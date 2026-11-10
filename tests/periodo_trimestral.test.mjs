// Clientes con períodos definibles (TOTTUS): T1, T2… con los meses que un admin elige; RIPLEY sigue bimestral.
// El bot resuelve el período por las fechas de esas definiciones. Uso: node tests/periodo_trimestral.test.mjs
import fs from 'node:fs';
import { periodoLima, esClienteTrimestral, periodosDe, periodoDeFechaDef, DEFAULT_PERIODOS, ALIAS_LEGACY } from '../api/_lib/mtto.js';
await import('../programacion.js');   // script clásico del navegador: se cuelga de globalThis.PROG
const PROG = globalThis.PROG;

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
const f = (iso) => Date.parse(iso + 'T15:00:00-05:00');   // mediodía Lima
const leer = (x) => fs.readFileSync(new URL('../' + x, import.meta.url), 'utf8');

t('TOTTUS tiene períodos definibles, RIPLEY no', esClienteTrimestral('TOTTUS') && esClienteTrimestral('tottus') && !esClienteTrimestral('RIPLEY') && !esClienteTrimestral(''));

// ── bot: período efectivo de TOTTUS
const nov = { cliente: 'TOTTUS', anio: 2026, periodo: 'T2', mesInicio: 11, mesFin: 12 };
t('sin definiciones, T1 2026 (sep-oct) lee del bimestre viejo SEP-OCT (no parte el período)', periodoLima(f('2026-09-20'), 'TOTTUS').periodo === 'SEP-OCT');
t('en noviembre sin T2 creado: sigue T1 → SEP-OCT', periodoLima(f('2026-11-10'), 'TOTTUS').periodo === 'SEP-OCT');
t('con T2 (nov-dic) creado: en noviembre rige T2', periodoLima(f('2026-11-10'), 'TOTTUS', [nov]).periodo === 'T2' && periodoLima(f('2026-11-10'), 'TOTTUS', [nov]).anio === 2026);
t('un período de un solo mes (nov) y otro de dos (dic-ene no cruza año)', periodoLima(f('2026-12-20'), 'TOTTUS', [{ ...nov, mesInicio: 11, mesFin: 11 }]).periodo === 'T2');
t('año sin períodos definidos → T1', periodoLima(f('2027-02-10'), 'TOTTUS').periodo === 'T1' && periodoLima(f('2027-02-10'), 'TOTTUS').anio === 2027);
t('RIPLEY (o sin cliente) sigue bimestral', periodoLima(f('2026-11-10'), 'RIPLEY').periodo === 'NOV-DIC' && periodoLima(f('2026-11-10')).periodo === 'NOV-DIC' && periodoLima(f('2026-09-02')).periodo === 'SEP-OCT');

// ── el bot (ESM) y la app (programacion.js) deben decidir igual
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);
t('mismos períodos precargados', iguales(DEFAULT_PERIODOS, PROG.DEFAULT_PERIODOS));
t('mismo alias legado', iguales(ALIAS_LEGACY, PROG.ALIAS_LEGACY));
const defs = [nov, { cliente: 'TOTTUS', anio: 2026, periodo: 'T3', mesInicio: 12, mesFin: 12 }, { cliente: 'TOTTUS', anio: 2027, periodo: 'T1', mesInicio: 1, mesFin: 3 }];
t('mismas listas por cliente/año', iguales(periodosDe(defs, 'TOTTUS', 2026), PROG.periodosDe(defs, 'TOTTUS', 2026)) && iguales(periodosDe(defs, 'TOTTUS', 2027), PROG.periodosDe(defs, 'TOTTUS', 2027)));
const fechas = ['2026-01-05', '2026-09-30', '2026-10-31', '2026-11-01', '2026-12-31', '2027-02-14', '2028-06-01'];
t('mismo período vigente en cada fecha', fechas.every((d) => iguales(periodoDeFechaDef(defs, 'TOTTUS', d), PROG.periodoDeFecha(defs, 'TOTTUS', d))), fechas.map((d) => d + ':' + (periodoDeFechaDef(defs, 'TOTTUS', d) || {}).periodo + '/' + (PROG.periodoDeFecha(defs, 'TOTTUS', d) || {}).periodo).join(' '));

// ── cableado en la app
const html = leer('mantenimiento_multiaire.html');
t('selector de cliente + botón para crear período', /id="selCliente"/.test(html) && /function onClienteChange\(/.test(html) && /id="btnNuevoPeriodo"/.test(html) && /function guardarPeriodo\(/.test(html));
t('el filtro de cliente se oculta en la vista Global', /grpCliente'\)\.style\.display\s*=\s*\(_clienteMultiple && !global\)/.test(html) && /aplicarVistaCliente\(global\)/.test(html));
t('el selector de período de un cliente con períodos definibles muestra solo T1, T2… (sin meses ni bimestres)', /lista\.map\(d => opt\(d\.periodo, d\.periodo\)\)/.test(html));
t('los datos del período se leen con la clave real (alias legado) y no se copian', /currentPeriodo = periodoDatosSel\(/.test(html));
t('lista de clientes con períodos definibles coincide app ↔ bot', /CLIENTES_TRIMESTRALES\s*=\s*new Set\(\['TOTTUS'\]\)/.test(html) && /CLIENTES_TRIMESTRALES\s*=\s*new Set\(\['TOTTUS'\]\)/.test(leer('api/_lib/mtto.js')));
// ── reglas + backup de la colección nueva
t('reglas: mtto_periodos lee autorizado, escribe ADMIN', /match \/mtto_periodos\/\{doc\}\s*\{\s*allow read: if authorized\(\);\s*allow create, update: if isAdmin\(\);\s*allow delete: if isAdmin\(\);\s*\}/.test(leer('firestore.rules')));
const conf = leer('configuracion.html');
t('backup incluye mtto_periodos (export, import y lista)', /mtto_periodos\.csv/.test(conf) && (conf.match(/mtto_periodos/g) || []).length >= 5);

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
