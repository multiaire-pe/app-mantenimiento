// Insumos · Transferencia masiva de sede: ejecuta el código REAL (saveTransfSede + helpers) con un Firestore falso.
// Uso: node tests/insumos_transf_sede.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../insumos.html', import.meta.url), 'utf8');
let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

const bloque = (re) => html.match(re)?.[0];
const defs = [
  bloque(/const instanciasTransferibles = [^\n]+/),
  bloque(/const idsATransferir = [^\n]+/),
  bloque(/async function saveTransfSede\(\) \{[\s\S]*?\n\}\n/),
];
t('existen helpers y saveTransfSede', defs.every(Boolean));

function escenario({ instancias, paquetes = [], form, permiso = 1, exc = [], confirma = true }) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { value: '', textContent: '', disabled: false });
  Object.entries(form).forEach(([k, v]) => { el(k).value = v; });
  const ops = [], toasts = [];
  const batch = { update: (ref, d) => ops.push(['update', ref.path, d]), set: (ref, d) => ops.push(['set', ref.path, d]), commit: async () => { ops.push(['commit']); } };
  const db = { batch: () => batch, collection: (c) => ({ doc: (id) => ({ path: c + '/' + (id || 'NEW') }) }) };
  const env = {
    document: { getElementById: el },
    db, can: () => permiso, toast: (m, k) => toasts.push([k, m]), confirm: () => confirma,
    maUser: { email: 'x@y.z' }, instanciasData: structuredClone(instancias), paquetesData: structuredClone(paquetes), movimientosData: [],
    tsExc: new Set(exc), closeModal: () => {}, renderAll: () => {}, Date,
  };
  const fn = new Function(...Object.keys(env), `${defs[0]}\n${defs[1]}\n${defs[2]}\nreturn { saveTransfSede, setExc: (s) => { tsExc = s; } };`)(...Object.values(env));
  return { fn, ops, toasts };
}
const I = (id, sede, extra = {}) => ({ id, nombre: 'ITEM ' + id, sede, estado: 'DISPONIBLE', itemId: 'IT', ...extra });
const base = [I('A1', 'OFICINA'), I('A2', 'OFICINA'), I('A3', 'OFICINA', { estado: 'BAJA' }), I('B1', 'ATOCONGO'), I('A4', 'OFICINA', { paqueteId: 'P1' })];
const paq = [{ id: 'P1', instancias: ['A4', 'Z9'] }];
const form = { 'fts-origen': 'OFICINA', 'fts-destino': 'ATOCONGO', 'fts-obs': 'obra', 'fts-exc-motivo': '', 'fts-guia-num': '', 'fts-tecnico': 'Juan', 'btn-save-transf-sede': undefined };
const upd = (ops) => ops.filter(o => o[0] === 'update' && o[1].startsWith('insumos_instancias/')).map(o => o[1].split('/')[1]);
const mov = (ops) => ops.find(o => o[0] === 'set')?.[2];

// 1) sin excepciones: pasa todo lo de la sede origen (menos BAJA), nada de otras sedes
let r = escenario({ instancias: base, paquetes: paq, form });
await r.fn.saveTransfSede();
t('mueve las 3 vigentes de OFICINA (A1,A2,A4); ni la BAJA ni las de otra sede', upd(r.ops).sort().join() === 'A1,A2,A4', upd(r.ops).join());
t('un solo movimiento TRANSFERENCIA masivo, con sede previa para revertir', mov(r.ops)?.tipo === 'TRANSFERENCIA' && mov(r.ops).masiva === true && mov(r.ops).instanciasSnapshot.every(s => s.sede === 'OFICINA') && mov(r.ops).camposTransferidos.join() === 'sede');
t('todo en un batch atómico (termina en commit)', r.ops.at(-1)[0] === 'commit' && r.ops.filter(o => o[0] === 'commit').length === 1);
t('la que estaba en un paquete sale de él (instancia y paquete)', r.ops.some(o => o[1] === 'insumos_instancias/A4' && o[2].paqueteId === null) && r.ops.some(o => o[1] === 'insumos_paquetes/P1' && o[2].instancias.join() === 'Z9'));
t('sin excepciones: no se guarda lista de excepciones con datos', mov(r.ops).excepciones.length === 0);

// 2) con excepciones: las desmarcadas NO se mueven y quedan registradas
r = escenario({ instancias: base, paquetes: paq, form: { ...form, 'fts-exc-motivo': 'se quedan en obra' }, exc: ['A2'] });
await r.fn.saveTransfSede();
t('EXCEPCIÓN A2 no se transfiere', !upd(r.ops).includes('A2') && upd(r.ops).sort().join() === 'A1,A4', upd(r.ops).join()+' '+JSON.stringify(r.toasts));
t('el movimiento deja constancia de las excepciones y su motivo', mov(r.ops).excepciones[0].id === 'A2' && mov(r.ops).excepcionesMotivo === 'se quedan en obra' && /1 sin transferir/.test(mov(r.ops).cambios));
t('cantidad = lo realmente movido', mov(r.ops).cantidad === 2 && mov(r.ops).instancias.join() === 'A1,A4');

// 3) validaciones: no escribe nada
for (const [nom, f, ex] of [
  ['sin origen', { ...form, 'fts-origen': '' }, []],
  ['sin destino', { ...form, 'fts-destino': '' }, []],
  ['origen = destino', { ...form, 'fts-destino': 'OFICINA' }, []],
  ['todo en excepciones', form, ['A1', 'A2', 'A4']],
]) { r = escenario({ instancias: base, paquetes: paq, form: f, exc: ex }); await r.fn.saveTransfSede(); t('rechaza: ' + nom, r.ops.length === 0 && r.toasts.some(x => x[0] === 'err'), JSON.stringify(r.toasts)); }
r = escenario({ instancias: base, paquetes: paq, form, permiso: 0 }); await r.fn.saveTransfSede(); t('sin permiso no escribe', r.ops.length === 0);
r = escenario({ instancias: base, paquetes: paq, form, confirma: false }); await r.fn.saveTransfSede(); t('si cancelas la confirmación no escribe', r.ops.length === 0);
const muchas = Array.from({ length: 450 }, (_, i) => I('M' + i, 'OFICINA'));
r = escenario({ instancias: muchas, form }); await r.fn.saveTransfSede(); t('más de 449 → no escribe (pide dividir)', r.ops.length === 0 && r.toasts.some(x => /449/.test(x[1])));

// 4) el código de la pantalla usa todo esto
t('botón "Transferencia masiva" en el tab Por Sede con permiso', /id="btn-transf-sede"/.test(html) && /btn-transf-sede'\);\s*\n\s*if\(btnTs\) btnTs\.style\.display = can\('transferencia'\)===1/.test(html));
t('cada tarjeta de sede tiene su botón Mover (sin interpolar la sede en JS)', /data-sede-origen="\$\{escB\(sede\)\}" onclick="openModalTransfSede\(this\.dataset\.sedeOrigen\)"/.test(html));
t('la lista marca excepciones con checkboxes (data-ts-id)', /data-ts-id="\$\{escB\(i\.id\)\}"/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
