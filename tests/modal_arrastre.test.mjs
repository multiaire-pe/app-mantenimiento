// Una ventana (modal) NO debe cerrarse si el usuario selecciona texto adentro y suelta el mouse afuera: el navegador
// dispara el `click` sobre el fondo y los `onclick="if(event.target===this)cerrar()"` de todas las páginas la cerraban.
// auth-guard.js (cargado por todas las páginas) lo descarta en captura. Uso: node tests/modal_arrastre.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

// DOM mínimo: lo justo para que auth-guard.js registre sus listeners y poder dispararle eventos.
const oyentes = { mousedown: [], click: [] };
const body = { nodeType: 1 };
const doc = {
  body, documentElement: { nodeType: 1 },
  addEventListener(tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
  getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
};
const nodo = (props) => ({ nodeType: 1, offsetWidth: 100, offsetHeight: 100, pos: 'static', hijos: [], contains(x) { return x === this || this.hijos.some((h) => h === x || (h.contains && h.contains(x))); }, ...props });
const win = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, location: { host: 'x', pathname: '/', search: '' }, history: {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
const ctx = vm.createContext({
  window: win, document: doc, location: win.location, history: win.history, sessionStorage: win.sessionStorage,
  getComputedStyle: (el) => ({ position: el.pos }), console, setTimeout, clearTimeout,
});
ctx.window.document = doc;
try { vm.runInContext(fs.readFileSync(new URL('../auth-guard.js', import.meta.url), 'utf8'), ctx); }
catch (e) { t('auth-guard.js carga sin errores en un entorno de navegador mínimo', false, e.message); }

t('registra los listeners en captura', oyentes.mousedown.length >= 1 && oyentes.click.length >= 1);

// Escenario: fondo (fixed, pantalla completa) > ventana > campo de texto
const campo = nodo({}), boton = nodo({}), icono = nodo({});
boton.hijos = [icono];
const ventana = nodo({ hijos: [campo], offsetWidth: 600, offsetHeight: 400 });
const fondo = nodo({ pos: 'fixed', offsetWidth: 1000, offsetHeight: 800, hijos: [ventana] });
const fab = nodo({ pos: 'fixed', offsetWidth: 56, offsetHeight: 56, hijos: [icono] });   // botón flotante con un ícono adentro

function clic(presionadoEn, clicEn) {
  oyentes.mousedown.forEach((f) => f({ target: presionadoEn }));
  const e = { target: clicEn, parou: false, stopImmediatePropagation() { this.parou = true; }, preventDefault() {} };
  oyentes.click.forEach((f) => { if (!e.parou) f(e); });
  return e.parou;
}

t('presionar en el campo y soltar afuera (el click cae en el fondo) → se descarta', clic(campo, fondo) === true);
t('presionar y soltar en el fondo → se deja pasar (cierra, como siempre)', clic(fondo, fondo) === false);
t('clic normal dentro de la ventana → se deja pasar', clic(campo, campo) === false);
t('clic en un botón con ícono adentro (presiona el ícono, suelta en el botón) → se deja pasar', clic(icono, boton) === false);
t('botón flotante fixed con ícono adentro no es un fondo → se deja pasar', clic(icono, fab) === false);
t('un click sin mousedown previo (teclado o .click()) → se deja pasar', (() => { const e = { target: fondo, stopImmediatePropagation() { this.parou = true; }, preventDefault() {} }; oyentes.click.forEach((f) => f(e)); return !e.parou; })());
t('tras un arrastre descartado, el siguiente clic en el fondo sí cierra', (clic(campo, fondo), clic(fondo, fondo) === false));

// Todas las páginas con modales cargan el guard (sin él seguirían cerrándose)
const paginas = fs.readdirSync(new URL('../', import.meta.url)).filter((f) => f.endsWith('.html'));
const conModal = paginas.filter((f) => /event\.target===this/.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')));
t('hay páginas con modales que cierran al clic en el fondo', conModal.length >= 6, conModal.join());
for (const f of conModal) t(`${f} carga auth-guard.js`, /<script src="auth-guard\.js"><\/script>/.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
