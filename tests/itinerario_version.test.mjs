// Itinerario: editar un BORRADOR (versión sin confirmar) se guarda en esa misma versión; solo una versión CONFIRMADA
// genera versión nueva al editar. Pruebas estáticas del cableado (el módulo es un HTML monolítico sin DOM de test).
// Uso: node tests/itinerario_version.test.mjs
import fs from 'node:fs';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
const html = fs.readFileSync(new URL('../itinerario.html', import.meta.url), 'utf8');

// la regla de versión, ejecutada tal cual
const m = html.match(/const enPlace = !!\(iti && !iti\.confirmado\);\s*const version = (iti \? \(enPlace \? Number\(iti\.version\) : Number\(iti\.version\) \+ 1\) : 1);/);
t('renderModal decide la versión según el sello', !!m);
const versionDe = new Function('iti', 'enPlace', `return ${m ? m[1] : '0'};`);
t('itinerario nuevo → v1', versionDe(null, false) === 1);
t('borrador v1 → sigue siendo v1 (no crea versión)', versionDe({ version: 1, confirmado: false }, true) === 1);
t('borrador v3 → sigue siendo v3', versionDe({ version: 3 }, true) === 3);
t('confirmada v1 → v2', versionDe({ version: 1, confirmado: true }, false) === 2);
t('confirmada v3 → v4', versionDe({ version: 3, confirmado: true }, false) === 4);

t('el formulario lleva la marca de edición en la misma versión', /id="modal-inplace" value="' \+ \(enPlace \? '1' : ''\) \+ '"/.test(html));
t('el título distingue "Editar borrador" de "Nueva versión"', /Editar borrador \(v\$\{version\}\)/.test(html) && /Nueva versión \(v\$\{version\}\)/.test(html));
t('guardar lee la marca', /const enPlace = !!document\.getElementById\('modal-inplace'\)\?\.value;/.test(html));
t('antes de sobrescribir se revalida que siga sin confirmar', /previa\.exists && previa\.data\(\)\.confirmado/.test(html) && /se confirmó mientras la editabas/.test(html));
t('si no se puede verificar, no se escribe (fail-closed)', /No se pudo verificar si la versión sigue sin confirmar/.test(html));
t('los bloques sobrantes de la misma versión se borran', /for \(let n = bloques\.length \+ 1; n <= totalAntes; n\+\+\)[\s\S]{0,200}batch\.delete\(doc\(window\.__db, 'bd_bloques'/.test(html));
t('en edición en la misma versión se reajusta el plan de mtto; en versión nueva se migra', /if \(enPlace\) \{ await _reajustarPlanMismaVersion\(idIti, version, bloques\); \}\s*else if \(version >= 2\) \{ await _migrarPlanAVersionNueva/.test(html));
t('el reajuste solo toca el plan de ESA versión', /Number\(pd\.data\(\)\.itiVersion \?\? 1\) === Number\(version\)/.test(html));
t('el sello se toma del dato fresco al abrir el formulario', /currentIti\.confirmado = !!res\.itinerario\.confirmado;/.test(html));
t('el botón dice Editar (borrador) o Nueva versión (confirmada)', /\$\{iti\.confirmado \? '✏️ Nueva versión' : '✏️ Editar'\}/.test(html) && !/Editar \/ Nueva versión/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
