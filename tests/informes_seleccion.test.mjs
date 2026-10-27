// Informes: solo los equipos SELECCIONADOS en Mantenimiento entran al documento; los demás se ven en
// rojo en pantalla con el motivo. Extrae el código REAL de informes.html. Uso: node tests/informes_seleccion.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../informes.html', import.meta.url), 'utf8');

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

// ── lectura de la selección ──
const fn = html.match(/function seleccionadosDe\(data\) \{[\s\S]*?\n\}/)?.[0];
const idFn = html.match(/const idDocMtto = [^\n]+/)?.[0];
t('existe seleccionadosDe', !!fn);
t('existe idDocMtto', !!idFn);
const seleccionadosDe = new Function(`${fn}; return seleccionadosDe;`)();
const idDocMtto = new Function(`${idFn}; return idDocMtto;`)();
const lista = (s) => [...s].sort().join();

t('objeto: solo los marcados en true', lista(seleccionadosDe({ seleccionados: { A: true, B: false, C: true } })) === 'A,C');
t('texto JSON (así lo guardaban versiones viejas)', lista(seleccionadosDe({ seleccionados: '{"A":true,"B":false}' })) === 'A');
t('texto que no es JSON → ninguno (no revienta)', seleccionadosDe({ seleccionados: '{no es json' }).size === 0);
t('sin campo / null / documento inexistente → ninguno', seleccionadosDe({}).size === 0 && seleccionadosDe(null).size === 0 && seleccionadosDe(undefined).size === 0);
t('mapa vacío → ninguno', seleccionadosDe({ seleccionados: {} }).size === 0);
t('un valor que no es true NO cuenta ("true", 1, "si")', seleccionadosDe({ seleccionados: { A: 'true', B: 1, C: 'si', D: true } }).size === 1);
t('valor primitivo en vez de mapa → ninguno', seleccionadosDe({ seleccionados: 5 }).size === 0 && seleccionadosDe({ seleccionados: true }).size === 0);
t('la "/" de la sede se guarda como "∕" (igual que Mantenimiento)', idDocMtto('DOMINICOS / T. VALLE|SEP-OCT|2026') === 'DOMINICOS ∕ T. VALLE|SEP-OCT|2026');
t('una sede sin "/" no cambia', idDocMtto('ATOCONGO|SEP-OCT|2026') === 'ATOCONGO|SEP-OCT|2026');

// ── el código usa esa selección donde corresponde ──
t('preparar() lee el doc de Mantenimiento de la sede+período+año', /db\.collection\('mantenimiento'\)\.doc\(idDocMtto\(`\$\{sede\}\|\$\{periodo\}\|\$\{anio\}`\)\)\.get\(\)/.test(html));
t('si falla esa lectura NO se asume "nada seleccionado" (va dentro del Promise.all/try)', /const \[ejSnap, foSnap, mtSnap\] = await Promise\.all\(\[/.test(html));
t('el informe sale de equiposInforme (los seleccionados)', /const equiposInforme = equipos\.filter\(\(e\) => sel\.has\(e\.eq_id \|\| e\.id\)\)/.test(html));
t('el DOCUMENTO usa solo los seleccionados', /const tipos = porTipo\(d\.equiposInforme\);\s*\n\s*const orden/.test(html));
t('la PANTALLA muestra todos (los no seleccionados, en rojo)', /const tipos = porTipo\(d\.equipos\);\s*\/\/ la pantalla muestra TODOS/.test(html));
t('generar() no vuelve a usar d.equipos para armar tablas', !/porTipo\(d\.equipos\)[\s\S]{0,200}hijos\.push/.test(html.slice(html.indexOf('async function generar'))));
t('fila en rojo + motivo al pasar el cursor', /class="nosel" title="\$\{esc\(tipNoSel\)\}"/.test(html) && /\.tb tr\.nosel td\{background:var\(--red-bg\);color:var\(--red\)/.test(html));
t('el motivo dice que no se crea su cuadro', /no fue seleccionado en Mantenimiento para .*por lo tanto no se va a crear su cuadro en el informe/.test(html));
t('badge visible también en celular (no depende del cursor)', /<span class="bnosel">No seleccionado<\/span>/.test(html));
t('sin equipos seleccionados no se puede generar', /btn-gen'\)\.disabled = !equiposInforme\.length/.test(html));
t('los contadores hablan solo de los seleccionados', /d\.equiposInforme\.filter\(\(e\) => !String\(e\.capacidad/.test(html) && /d\.equiposInforme\.filter\(esInoperativo\)/.test(html) && /filter\(\(k\) => d\.sel\.has\(k\)\)/.test(html));
t('no se puede elegir fotos de un equipo no seleccionado', /\$\{fo && !noSel \? `<button/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
