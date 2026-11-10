// Clientes con visita trimestral (TOTTUS): el bot resuelve T1..T4 por calendario; RIPLEY sigue bimestral.
// Uso: node tests/periodo_trimestral.test.mjs
import fs from 'node:fs';
import { periodoLima, esClienteTrimestral } from '../api/_lib/mtto.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
const f = (iso) => Date.parse(iso + 'T15:00:00-05:00');   // mediodía Lima

t('TOTTUS es trimestral, RIPLEY no', esClienteTrimestral('TOTTUS') && esClienteTrimestral('tottus') && !esClienteTrimestral('RIPLEY') && !esClienteTrimestral(''));
t('TOTTUS ene→T1, mar→T1, abr→T2, sep→T3, oct→T4, dic→T4',
  ['2026-01-15', '2026-03-31', '2026-04-01', '2026-09-30', '2026-10-01', '2026-12-31'].map((d) => periodoLima(f(d), 'TOTTUS').periodo).join() === 'T1,T1,T2,T3,T4,T4');
t('TOTTUS arrastra el año', periodoLima(f('2026-11-10'), 'TOTTUS').anio === 2026);
t('RIPLEY (o sin cliente) sigue bimestral', periodoLima(f('2026-11-10'), 'RIPLEY').periodo === 'NOV-DIC' && periodoLima(f('2026-11-10')).periodo === 'NOV-DIC' && periodoLima(f('2026-09-02')).periodo === 'SEP-OCT');

// Cableado en la app: selector de cliente + períodos por cliente
const html = fs.readFileSync(new URL('../mantenimiento_multiaire.html', import.meta.url), 'utf8');
t('la app tiene selector de cliente', /id="selCliente"/.test(html) && /function onClienteChange\(/.test(html));
t('la app define los trimestres de TOTTUS', /PERIODOS_TRIM\s*=\s*\['T1','T2','T3','T4'\]/.test(html) && /CLIENTES_TRIMESTRALES\s*=\s*new Set\(\['TOTTUS'\]\)/.test(html));
t('la lista de clientes trimestrales coincide app ↔ bot', /new Set\(\['TOTTUS'\]\)/.test(fs.readFileSync(new URL('../api/_lib/mtto.js', import.meta.url), 'utf8')));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
