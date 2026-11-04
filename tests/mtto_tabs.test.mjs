// Mantenimiento: los tabs Global/Historial/Desempeño no dependen de la sede del panel izquierdo
// y Parámetros es solo por sede + período. Uso: node tests/mtto_tabs.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../mantenimiento_multiaire.html', import.meta.url), 'utf8');

let ok = 0, mal = 0;
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n); } };

const nav = html.match(/<div class="tab-nav" id="tabNav"[^>]*>[\s\S]*?<\/div>/)?.[0] || '';
t('la barra de tabs existe y NO arranca oculta', !!nav && !/display:none/.test(nav));
const orden = [...nav.matchAll(/switchTab\('(\w+)'\)/g)].map((m) => m[1]);
t('grupo por sede primero, luego los globales', orden.join() === 'checklist,dashboard,parametros,global,historial,desempeno', orden.join());
t('la vista inicial es Global (aún no hay sede)', /<div class="tab-view active" id="tab-global">/.test(html) && /<div class="tab-view" id="tab-checklist">/.test(html));

t('los tabs globales están declarados', /const TABS_GLOBALES = \['global','historial','desempeno'\];/.test(html));
t('renderMain y showEmpty ya no esconden/muestran la barra de tabs', !/getElementById\('tabNav'\)\.style/.test(html));
t('la barra de sede solo se ve con sede y fuera de un tab global', /tb\.style\.display = \(currentSede && !global\) \? 'flex' : 'none'/.test(html));
t('el panel izquierdo se atenúa en los tabs globales', /sb\.classList\.toggle\('sb-vista-global', global\)/.test(html) && /\.sb-vista-global \.sb-solo-sede\{opacity:\.4;pointer-events:none\}/.test(html));
t('el período NO se atenúa (Global lo usa)', !/id="selPeriodo"[^>]*sb-solo-sede/.test(html) && /<div class="sb-label">Período<\/div>/.test(html));
t('elegir una sede desde un tab global lleva al checklist', /if\(TABS_GLOBALES\.includes\(tabActivo\(\)\)\) switchTab\('checklist'\);/.test(html));
t('Global usa el período del panel aunque no haya sede', /const perG = document\.getElementById\('selPeriodo'\)\.value, anioG = document\.getElementById\('selAnio'\)\.value;/.test(html));
t('las tarjetas de Global abren esa sede', /onclick="irASede\(this\.dataset\.sede\)"/.test(html) && /function irASede\(sede\)/.test(html));

t('Parámetros: sin selectores propios de sede/período/año', !/id="par-sede"|id="par-periodo"|id="par-anio"/.test(html) && /id="par-tipo"/.test(html));
t('Parámetros: filtra por la sede efectiva del panel', /sedeEfectiva\(r\.sede, r\.cliente\) === currentSede/.test(html));
t('Parámetros: sin sede pide elegirla', /Selecciona una sede y un período en el panel izquierdo para ver sus parámetros/.test(html));
t('Parámetros se repinta al cambiar de sede/período', /tab-parametros'\)\.classList\.contains\('active'\)\) renderParametros\(\)/.test(html) && /function refrescarTabSede\(\)/.test(html));
t('Historial y Desempeño conservan sus filtros propios', /id="hl-sede"/.test(html) && /id="dsp-sede"/.test(html) && /id="dsp-periodo"/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
