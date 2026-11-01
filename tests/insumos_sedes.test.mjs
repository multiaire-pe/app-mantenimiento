// Insumos: una sede compartida por varios clientes (Miraflores, Jockey Plaza) se distingue por cliente.
// Extrae la función REAL de insumos.html. Uso: node tests/insumos_sedes.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../insumos.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join('\n');
let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

const a = html.indexOf('const CLIENTE_PENDIENTE');
const b = html.indexOf('let maUser=null');
t('existe armarSedes', a > 0 && b > a);
const { armarSedes, CLIENTE_PENDIENTE } = new Function(`${html.slice(a, b)}\nreturn { armarSedes, CLIENTE_PENDIENTE };`)();

const TIENDAS = [
  { sede: 'Miraflores', cliente: 'TOTTUS' }, { sede: 'MIRAFLORES', cliente: 'RIPLEY' },
  { sede: 'JOCKEY PLAZA', cliente: 'RIPLEY' }, { sede: 'JOCKEY PLAZA', cliente: 'TOTTUS' },
  { sede: 'ATOCONGO', cliente: 'RIPLEY' }, { sede: 'OFICINA', cliente: '-' },
  { sede: 'CERRADA', cliente: 'RIPLEY', activo: 'NO' }, { sede: '', cliente: 'RIPLEY' },
  { sede: 'MEGAPLAZA' },
];
const nombres = (l) => l.map((s) => s.sede).join('|');

{
  const l = armarSedes(TIENDAS, []);
  t('sede compartida → una entrada por cliente, con el cliente en el nombre', l.some((s) => s.sede === 'MIRAFLORES (TOTTUS)' && s.cliente === 'TOTTUS') && l.some((s) => s.sede === 'MIRAFLORES (RIPLEY)' && s.cliente === 'RIPLEY'), nombres(l));
  t('Jockey Plaza también', l.some((s) => s.sede === 'JOCKEY PLAZA (TOTTUS)') && l.some((s) => s.sede === 'JOCKEY PLAZA (RIPLEY)'));
  t('sin instancias viejas, el nombre a secas de una compartida NO aparece', !l.some((s) => s.sede === 'MIRAFLORES' || s.sede === 'JOCKEY PLAZA'), nombres(l));
  t('sede de un solo cliente no cambia de nombre', l.some((s) => s.sede === 'ATOCONGO' && s.cliente === 'RIPLEY') && l.some((s) => s.sede === 'OFICINA'));
  t('sin cliente → MULTIAIRE', l.find((s) => s.sede === 'MEGAPLAZA').cliente === 'MULTIAIRE');
  t('inactivas y sin nombre se ignoran', !l.some((s) => s.sede === 'CERRADA') && l.every((s) => s.sede));
  t('ordenadas por nombre', nombres(l) === [...l.map((s) => s.sede)].sort((x, y) => x.localeCompare(y)).join('|'));
  t('el nombre en minúsculas se normaliza a mayúsculas', !l.some((s) => /[a-z]/.test(s.sede)));
}
{
  // instancias antiguas guardadas con el nombre a secas: siguen visibles, sin cliente
  const l = armarSedes(TIENDAS, [{ sede: 'MIRAFLORES' }, { sede: 'MIRAFLORES' }, { sede: 'ATOCONGO' }]);
  const viejas = l.filter((s) => s.cliente === CLIENTE_PENDIENTE);
  t('la sede vieja "MIRAFLORES" sigue existiendo como opción (sin cliente)', viejas.length === 1 && viejas[0].sede === 'MIRAFLORES', nombres(l));
  t('Jockey Plaza no aparece sin cliente si ninguna instancia la usa', !l.some((s) => s.sede === 'JOCKEY PLAZA'));
  t('una sede NO compartida usada por instancias no se duplica', l.filter((s) => s.sede === 'ATOCONGO').length === 1);
  t('las instancias nuevas ("MIRAFLORES (TOTTUS)") son una sede válida', armarSedes(TIENDAS, [{ sede: 'MIRAFLORES (TOTTUS)' }]).some((s) => s.sede === 'MIRAFLORES (TOTTUS)'));
}
t('sin datos no rompe', armarSedes([], []).length === 0 && armarSedes(undefined, undefined).length === 0);
t('la carga usa armarSedes (y ya no arma las sedes a mano)', /sedes=armarSedes\(tiendasS\.docs\.map\(d=>d\.data\(\)\), instanciasData\);/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
