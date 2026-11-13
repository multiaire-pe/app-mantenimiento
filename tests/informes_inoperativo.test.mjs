// Regla de "inoperativo" del informe: extrae la función REAL de informes.html y la prueba.
// Uso: node tests/informes_inoperativo.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../informes.html', import.meta.url), 'utf8');

// Los <script> inline: todos deben compilar.
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
scripts.forEach((s, i) => { try { new Function(s); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

const frase = html.match(/const FRASE_INOPERATIVO = '([^']+)'/)?.[1];
const fnSrc = html.match(/function esInoperativo\(e\) \{[\s\S]*?\n\}/)?.[0];
t('existe la frase', !!frase && /inoperativo/.test(frase), frase);
t('existe esInoperativo', !!fnSrc);
const esInoperativo = new Function(`${fnSrc}; return esInoperativo;`)();

t('0% reportado → inoperativo', esInoperativo({ operatividad: 0 }));
t('"0" (string) → inoperativo', esInoperativo({ operatividad: '0' }));
t('sin reporte (undefined) NO es inoperativo', !esInoperativo({}));
t('sin reporte (null) NO es inoperativo — Number(null)===0 es la trampa', !esInoperativo({ operatividad: null }));
t('cadena vacía NO es inoperativo', !esInoperativo({ operatividad: '' }));
t('25% NO es inoperativo', !esInoperativo({ operatividad: 25 }));
t('100% NO es inoperativo', !esInoperativo({ operatividad: 100 }));
t('desmontado con 0% NO es inoperativo', !esInoperativo({ operatividad: 0, desmontado: true }));
t('basura (NaN) NO es inoperativo', !esInoperativo({ operatividad: 'abc' }));

// El documento: la frase va DESPUÉS de las observaciones del equipo y solo para inoperativos.
const bloque = html.match(/const tituloEq = [\s\S]*?\}\)\.filter\(\(g\) => g\.items\.length\);/)?.[0];
t('existe el armado de obsPorEquipo', !!bloque);
const armar = new Function('esInoperativo', 'FRASE_INOPERATIVO', 'd', 'eqs', `${bloque}; return obsPorEquipo;`);
const d = { obsPorEq: { A: [{ observacion: 'obs 1' }, { observacion: 'obs 2' }, { observacion: 'obs 3' }], B: [{ observacion: 'solo una' }] } };
const eqs = [
  { eq_id: 'A', nombre: 'AA Roof Top 01', operatividad: 0 },   // inoperativo con 3 obs
  { eq_id: 'B', nombre: 'Extractor 02', operatividad: 75 },    // operativo con 1 obs
  { eq_id: 'C', nombre: 'AA Split 03', operatividad: 0 },      // inoperativo sin obs
  { eq_id: 'D', nombre: 'AA Split 04' },                       // sin reporte, sin obs
  { eq_id: 'E', nombre: 'AA Split 05', operatividad: 0, desmontado: true },
];
const r = armar(esInoperativo, frase, d, eqs);
const g = (titulo) => r.find((x) => x.titulo === titulo);
const deA = g('ROOFTOP N°1')?.items.map((x) => x.texto) || [];
t('encabezado por equipo: «ROOFTOP N°1», «EXTRACTOR N°2»', !!g('ROOFTOP N°1') && !!g('EXTRACTOR N°2'), JSON.stringify(r.map((x) => x.titulo)));
t('inoperativo con 3 obs: las 3 y luego la frase', deA.length === 4 && deA.slice(0, 3).join('|') === 'obs 1|obs 2|obs 3' && deA[3] === frase, JSON.stringify(deA));
t('la frase va marcada', g('ROOFTOP N°1')?.items.find((x) => x.inop)?.texto === frase);
t('operativo: sin frase', g('EXTRACTOR N°2')?.items.length === 1 && !g('EXTRACTOR N°2').items.some((x) => x.inop));
t('inoperativo sin obs: igual lleva la frase', g('SPLIT N°3')?.items.map((x) => x.texto).join() === frase);
t('sin reporte: nada', !g('SPLIT N°4'));
t('desmontado: nada', !g('SPLIT N°5'));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
