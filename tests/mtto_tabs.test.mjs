// Mantenimiento: los tabs Global/Historial/Desempeño no dependen de la sede del panel izquierdo
// y Parámetros es solo por sede + período. Uso: node tests/mtto_tabs.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../mantenimiento_multiaire.html', import.meta.url), 'utf8');

let ok = 0, mal = 0;
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n); } };

const nav = html.slice(html.indexOf('<div class="tab-nav" id="tabNav"'), html.indexOf('<div class="tab-view" id="tab-checklist">'));
t('la barra de tabs existe y NO arranca oculta', !!nav && !/id="tabNav"[^>]*display:none/.test(nav));
const orden = [...nav.matchAll(/switchTab\('(\w+)'\)/g)].map((m) => m[1]);
t('seis tabs: tres por sede y tres de todas las sedes', orden.join() === 'checklist,dashboard,parametros,global,historial,desempeno', orden.join());
const panel = html.slice(html.indexOf('<div class="sidebar" id="sidebar">'), html.indexOf('<div class="main">'));
t('el interruptor "Por sede | Global" vive en el panel izquierdo, no en la barra de tabs', /setModo\('sede'\)/.test(panel) && /setModo\('global'\)/.test(panel) && !/setModo/.test(nav));
t('el interruptor dice "Global" (no "Todas las sedes")', /id="modoGlobal"[^>]*>🌐 Global<\/button>/.test(panel));
const ids = ['modoSede', 'selSede', 'selPeriodo', 'wspPeriodoGroup', 'statusBar', 'btnSelEq', 'openActsEditor'].map((k) => panel.indexOf(k));
t('orden del panel: interruptor, sede, período, usar período, progreso, y abajo seleccionar equipos y ajustar actividades', ids.every((n) => n > 0) && ids.every((n, i) => !i || n > ids[i - 1]), ids.join());
t('en "Todas las sedes" se OCULTA lo de la sede (queda interruptor + período)', /\.sb-vista-global \.sb-solo-sede\{display:none!important\}/.test(html) && !/id="selPeriodo"[^>]*sb-solo-sede/.test(panel) && /<div class="sb-label">Período<\/div>\s*<div class="periodo-grid">/.test(panel));
t('arranca en el modo de todas las sedes (aún no hay sede)', /id="grpSede" style="display:none"/.test(nav) && /id="modoGlobal" onclick|class="modo-btn active" id="modoGlobal"/.test(panel));
t('el tab Global se llama Resumen (no repite el nombre del grupo)', /📈 Resumen/.test(nav) && !/>🌐 Global</.test(nav));
t('solo se ve el grupo de tabs del modo activo', /getElementById\('grpSede'\)\.style\.display = global \? 'none' : 'flex'/.test(html) && /getElementById\('grpGlobal'\)\.style\.display = global \? 'flex' : 'none'/.test(html));
t('al volver a "Por sede" se retoma el último tab usado', /switchTab\(_ultimoTabSede\)/.test(html) && /_ultimoTabSede = tab;/.test(html));
t('la vista inicial es Global (aún no hay sede)', /<div class="tab-view active" id="tab-global">/.test(html) && /<div class="tab-view" id="tab-checklist">/.test(html));

t('los tabs globales están declarados', /const TABS_GLOBALES = \['global','historial','desempeno'\];/.test(html));
t('renderMain y showEmpty ya no esconden/muestran la barra de tabs', !/getElementById\('tabNav'\)\.style/.test(html));
t('la barra de sede solo se ve con sede y fuera de un tab global', /tb\.style\.display = \(currentSede && !global\) \? 'flex' : 'none'/.test(html));
t('el panel cambia de modo según el tab activo', /sb\.classList\.toggle\('sb-vista-global', global\)/.test(html));
t('el período NO se atenúa (Global lo usa)', !/id="selPeriodo"[^>]*sb-solo-sede/.test(html) && /<div class="sb-label">Período<\/div>/.test(html));
t('elegir una sede desde un tab global lleva al checklist', /if\(TABS_GLOBALES\.includes\(tabActivo\(\)\)\) switchTab\('checklist'\);/.test(html));
t('Global usa el período del panel aunque no haya sede', /const perG = document\.getElementById\('selPeriodo'\)\.value, anioG = document\.getElementById\('selAnio'\)\.value;/.test(html));
t('las tarjetas de Global abren esa sede', /onclick="irASede\(this\.dataset\.sede\)"/.test(html) && /function irASede\(sede\)/.test(html));

t('Parámetros: sin selectores propios de sede/período/año', !/id="par-sede"|id="par-periodo"|id="par-anio"/.test(html) && /id="par-tipo"/.test(html));
t('Parámetros: filtra por la sede efectiva del panel', /sedeEfectiva\(r\.sede, r\.cliente\) === currentSede/.test(html));
t('Parámetros: sin sede pide elegirla', /Selecciona una sede y un período en el panel izquierdo para ver sus parámetros/.test(html));
t('Parámetros se repinta al cambiar de sede/período', /tab-parametros'\)\.classList\.contains\('active'\)\) renderParametros\(\)/.test(html) && /function refrescarTabSede\(\)/.test(html));
t('Historial y Desempeño conservan sus filtros propios (sede, tipo, técnico)', /id="hl-sede"/.test(html) && /id="dsp-sede"/.test(html) && /id="dsp-tipo"/.test(html) && /id="dsp-tecnico"/.test(html));

t('Desempeño: sin selector propio de período, usa el del panel', !/id="dsp-periodo"|id="dsp-anio"/.test(html) && /const periodo = document\.getElementById\('selPeriodo'\)\.value;/.test(html));
t('cambiar el período repinta Resumen y Desempeño', /if\(tabActivo\(\)==='global'\) renderGlobal\(\);\s*if\(tabActivo\(\)==='desempeno'\) renderDesempeno\(\);/.test(html));
t('el orden de los tabs globales es Resumen, Historial, Desempeño', orden.slice(3).join() === 'global,historial,desempeno');
t('"Usar este período..." dice Telegram y el aviso es solo tooltip', /Usar este período para registros de Telegram/.test(panel) && !/wspPeriodoHint/.test(html) && /lbl\.title = /.test(html) && !/registros de WhatsApp de '/.test(html));
t('los dos botones quedan abajo (sb-actions con margin-top:auto) tras el progreso', /\.sb-actions\{[^}]*margin-top:auto/.test(html));
console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
