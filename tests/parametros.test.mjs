// Toma de parámetros (Mini App de Telegram): firma de initData, validación del registro y el endpoint con
// dependencias falsas. Uso: node tests/parametros.test.mjs
import crypto from 'node:crypto';
import { verificarInitData, validarRegistro, procesar, fechaHoraLima, porNombre } from '../api/_lib/parametros.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

// ── initData firmado como lo hace Telegram ──
const TOKEN = '123456:TEST-token';
const AHORA = Date.UTC(2026, 9, 27, 17, 0, 0);
function firmar(campos, token = TOKEN) {
  const dcs = Object.entries(campos).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secreto = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secreto).update(dcs).digest('hex');
  return new URLSearchParams({ ...campos, hash }).toString();
}
const user = (id = 7) => JSON.stringify({ id, first_name: 'Ana' });
const auth = (extra = {}) => ({ user: user(), auth_date: String(Math.floor(AHORA / 1000) - 60), query_id: 'AAH', ...extra });

{
  const v = verificarInitData(firmar(auth()), TOKEN, { ahora: AHORA });
  t('initData válido', v.ok && v.user.id === 7 && v.user.nombre === 'Ana', JSON.stringify(v));
  t('token distinto → firma inválida', verificarInitData(firmar(auth()), 'otro:token', { ahora: AHORA }).motivo === 'firma');
  // adulterar el usuario después de firmar (suplantar a otro técnico)
  const p = new URLSearchParams(firmar(auth())); p.set('user', user(99));
  t('usuario adulterado → firma inválida', verificarInitData(p.toString(), TOKEN, { ahora: AHORA }).motivo === 'firma');
  t('sin hash', verificarInitData(new URLSearchParams(auth()).toString(), TOKEN, { ahora: AHORA }).motivo === 'sin_hash');
  t('vacío', verificarInitData('', TOKEN, { ahora: AHORA }).motivo === 'vacio');
  t('sin token configurado', verificarInitData(firmar(auth()), '', { ahora: AHORA }).motivo === 'sin_token');
  const viejo = firmar(auth({ auth_date: String(Math.floor(AHORA / 1000) - 3 * 86400) }));
  t('vencido (3 días)', verificarInitData(viejo, TOKEN, { ahora: AHORA }).motivo === 'vencido');
  const futuro = firmar(auth({ auth_date: String(Math.floor(AHORA / 1000) + 3600) }));
  t('fecha en el futuro', verificarInitData(futuro, TOKEN, { ahora: AHORA }).motivo === 'vencido');
  t('hash con largo incorrecto no rompe', verificarInitData('user=%7B%7D&auth_date=1&hash=abc', TOKEN, { ahora: AHORA }).ok === false);
}

// ── validación ──
const EQ = { eqId: 'MA-DTV-EXT-001', nombre: 'Extractor 01', tipo: 'EXTRACTOR', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE', area: 'SSHH CLIENTES PISO 2' };
const TEC = { id: 'PER003', nombre: 'ENRIQUE YARANGA' };
const base3 = () => ({
  id: 'PAR-1730000000000-ab12cd',
  eqId: EQ.eqId,
  capturadoEn: new Date(AHORA - 30e3).toISOString(),
  supervisor: '  José   Huamán ',
  equipo: { marca: 'WEG', modelo: '3~112M-04', serie: 'N/V', potencia: '4.0 kW' },
  electrico: { fases: '3PH', voltajeNominal: '220', amperajeNominal: 11.5, frecuencia: 60, estadoTablero: 'BUENO', estadoContactores: 'REGULAR',
    vL1L2: 222, vL2L3: '221,5', vL1L3: 220, aL1: 9.8, aL2: 10.1, aL3: 'NA' },
  sistema: { transmision: 'FAJAS', filtros: 'SIN_FILTRO', fajas: 'MALO', poleas: 'BUENO', fajasMedida: 'A55' },
  observaciones: 'Correa  desgastada',
});
const val = (mut, eq = EQ, ahora = AHORA) => { const b = base3(); mut && mut(b); return validarRegistro(b, eq, TEC, ahora); };

{
  const r = val();
  t('trifásico completo: válido', r.ok, JSON.stringify(r));
  const d = r.doc;
  t('números: acepta texto con coma y "NA"', d.electrico.vL2L3 === 221.5 && d.electrico.aL3 === 'NA' && d.electrico.voltajeNominal === 220);
  t('cliente/sede/área/tipo salen del inventario', d.cliente === 'TOTTUS' && d.sede === EQ.sede && d.area === EQ.area && d.tipo === 'EXTRACTOR' && d.tag === EQ.eqId);
  t('lo que confirma el técnico del equipo se guarda tal cual', d.equipo.marca === 'WEG' && d.equipo.serie === 'N/V' && d.equipo.potencia === '4.0 kW');
  t('texto normalizado (espacios)', d.supervisor === 'José Huamán' && d.observaciones === 'Correa desgastada');
  t('técnico del registro = el autenticado (no el del cuerpo)', d.tecnicoId === 'PER003' && d.tecnicoNombre === 'ENRIQUE YARANGA');
  t('fecha y hora en Lima (UTC-5)', d.fecha === '2026-10-27' && d.hora === '11:59', d.fecha + ' ' + d.hora);
  t('no diferido y con hora del teléfono', d.diferido === false && d.horaCliente === true && d.origen === 'MINIAPP');
}
{
  const r = val((b) => { b.electrico.fases = '1PH'; delete b.electrico.vL2L3; delete b.electrico.vL1L3; delete b.electrico.aL2; delete b.electrico.aL3; });
  t('monofásico: solo L1, el resto queda en null', r.ok && r.doc.electrico.vL2L3 === null && r.doc.electrico.aL2 === null && r.doc.electrico.aL1 === 9.8, JSON.stringify(r));
  // el técnico escribió valores de L2/L3 y luego cambió a monofásico: esos valores sobrantes NO se guardan
  const sobrante = val((b) => { b.electrico.fases = '1PH'; });   // el cuerpo conserva vL2L3, vL1L3, aL2, aL3
  t('monofásico con L2/L3 sobrantes en el cuerpo: se descartan', sobrante.ok && sobrante.doc.electrico.vL2L3 === null && sobrante.doc.electrico.vL1L3 === null && sobrante.doc.electrico.aL2 === null && sobrante.doc.electrico.aL3 === null, JSON.stringify(sobrante.doc && sobrante.doc.electrico));
  t('trifásico sin L2 → rechazado', !val((b) => { delete b.electrico.aL2; }).ok);
  t('campo sin valor ni N/A → rechazado', !val((b) => { b.electrico.aL1 = ''; }).ok);
  t('campo undefined → rechazado', !val((b) => { delete b.electrico.vL1L2; }).ok);
  t('negativo → rechazado', !val((b) => { b.electrico.aL1 = -1; }).ok);
  t('texto no numérico → rechazado', !val((b) => { b.electrico.aL1 = 'abc'; }).ok);
  t('NaN/Infinity → rechazado', !val((b) => { b.electrico.aL1 = Infinity; }).ok && !val((b) => { b.electrico.aL1 = NaN; }).ok);
  t('valor absurdo (>100000) → rechazado', !val((b) => { b.electrico.aL1 = 1e6; }).ok);
  t('cero es una medición válida', val((b) => { b.electrico.aL1 = 0; }).ok);
  // NO se juzga la medición: un amperaje muy superior al nominal se guarda igual (sin sesgo)
  const sobre = val((b) => { b.electrico.aL1 = 55; b.electrico.amperajeNominal = 5; });
  t('amperaje sobre el nominal se guarda sin objeción', sobre.ok && sobre.doc.electrico.aL1 === 55);
}
{
  t('sin fases → rechazado', !val((b) => { delete b.electrico.fases; }).ok);
  t('estado de tablero inválido → rechazado', !val((b) => { b.electrico.estadoTablero = 'EXCELENTE'; }).ok);
  t('transmisión inválida → rechazado', !val((b) => { b.sistema.transmision = 'x'; }).ok);
  t('filtros: SIN_FILTRO aceptado, valor inválido no', val().ok && !val((b) => { b.sistema.filtros = 'BUENISIMO'; }).ok);
  t('fajas/poleas faltantes → rechazado', !val((b) => { delete b.sistema.fajas; }).ok && !val((b) => { delete b.sistema.poleas; }).ok);
  t('id inválido → rechazado', !val((b) => { b.id = 'x'; }).ok && !val((b) => { b.id = '../../otro'; }).ok);
  t('equipo inexistente → rechazado', !val(null, null).ok);
  t('tipo que no es ventilación → rechazado', !val(null, { ...EQ, tipo: 'SPLIT' }).ok);
  t('sin técnico → rechazado', !validarRegistro(base3(), EQ, null, AHORA).ok);
  t('cuerpo vacío → rechazado', !validarRegistro(null, EQ, TEC, AHORA).ok);
}
{
  const dif = val((b) => { b.capturadoEn = new Date(AHORA - 3 * 3600e3).toISOString(); });
  t('enviado horas después: conserva la hora de captura y queda marcado diferido', dif.ok && dif.doc.diferido === true && dif.doc.horaCliente === true && dif.doc.hora === '09:00', dif.doc && dif.doc.hora);
  const fut = val((b) => { b.capturadoEn = new Date(AHORA + 5 * 86400e3).toISOString(); });
  t('hora del teléfono en el futuro → se usa la del servidor', fut.ok && fut.doc.horaCliente === false && fut.doc.capturadoEn === new Date(AHORA).toISOString());
  const vie = val((b) => { b.capturadoEn = new Date(AHORA - 30 * 86400e3).toISOString(); });
  t('hora del teléfono de hace un mes → se usa la del servidor', vie.ok && vie.doc.horaCliente === false);
  const basura = val((b) => { b.capturadoEn = 'ayer'; });
  t('fecha ilegible → se usa la del servidor', basura.ok && basura.doc.horaCliente === false);
  t('Lima: 02:00 UTC es el día anterior', fechaHoraLima(Date.UTC(2026, 9, 27, 2, 0)).fecha === '2026-10-26');
}

// ── endpoint con dependencias falsas ──
const INV = [
  { eqId: 'E10', nombre: 'Extractor 10', tipo: 'EXTRACTOR', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE', area: 'A' },
  { eqId: 'E2', nombre: 'Extractor 2', tipo: 'EXTRACTOR', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE', area: 'B' },
  { eqId: 'MA-DTV-EXT-001', nombre: 'Extractor 01', tipo: 'EXTRACTOR', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE', area: 'SSHH CLIENTES PISO 2', marca: 'WEG' },
  { eqId: 'I1', nombre: 'Inyector 01', tipo: 'INYECTOR', cliente: 'RIPLEY', sede: 'ATOCONGO', area: 'C' },
];
function deps(over = {}) {
  const log = { creados: [] };
  return { log, token: TOKEN, ahora: () => AHORA,
    identificar: async (id) => (id === 7 ? { id: 'PER003', nombre: 'ENRIQUE YARANGA' } : null),
    equipos: async () => INV,
    crear: async (id, doc) => { if (log.creados.some((c) => c.id === id)) return 'duplicado'; log.creados.push(doc); return 'creado'; },
    ...over };
}
const INIT = firmar(auth());
{
  const d = deps();
  t('sin firma → 401', (await procesar({ accion: 'inicio' }, '', d)).status === 401);
  t('firma ajena → 401', (await procesar({ accion: 'inicio' }, firmar(auth(), 'otro:tok'), d)).status === 401);
  t('cuenta no vinculada → 403', (await procesar({ accion: 'inicio' }, firmar(auth({ user: user(55) })), d)).status === 403);
  const r = await procesar({ accion: 'inicio' }, INIT, d);
  t('inicio: técnico y sedes con su cantidad', r.status === 200 && r.json.tecnico.id === 'PER003' && r.json.sedes.length === 2 && r.json.sedes[0].cliente === 'RIPLEY' && r.json.sedes.find((s) => s.sede === 'DOMINICOS / T. VALLE').n === 3, JSON.stringify(r.json));
  const e = await procesar({ accion: 'equipos', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE' }, INIT, d);
  t('equipos: solo los de esa sede, en orden natural', e.status === 200 && e.json.equipos.map((x) => x.nombre).join() === 'Extractor 01,Extractor 2,Extractor 10', JSON.stringify(e.json));
  t('equipos de otro cliente con la misma sede no se mezclan', (await procesar({ accion: 'equipos', cliente: 'RIPLEY', sede: 'DOMINICOS / T. VALLE' }, INIT, d)).json.equipos.length === 0);
  t('acción desconocida → 400', (await procesar({ accion: 'borrar' }, INIT, d)).status === 400);
}
{
  const d = deps();
  const reg = base3();
  reg.cliente = 'OTRO'; reg.sede = 'OTRA'; reg.tecnicoId = 'PER999'; reg.area = 'X';   // intento de falsear lo que sale del inventario / la sesión
  const r = await procesar({ accion: 'guardar', registro: reg }, INIT, d);
  t('guardar: ok', r.status === 200 && r.json.ok === true && r.json.duplicado === false, JSON.stringify(r));
  const g = d.log.creados[0];
  t('lo que no debe fiarse del cliente sale del servidor', g && g.cliente === 'TOTTUS' && g.sede === 'DOMINICOS / T. VALLE' && g.area === 'SSHH CLIENTES PISO 2' && g.tecnicoId === 'PER003');
  const otra = await procesar({ accion: 'guardar', registro: reg }, INIT, d);
  t('reintento del mismo registro: ok y duplicado, sin crear otro', otra.status === 200 && otra.json.duplicado === true && d.log.creados.length === 1);
  const mala = base3(); mala.id = 'PAR-1730000000000-zz99zz'; mala.electrico.aL1 = '';
  const rm = await procesar({ accion: 'guardar', registro: mala }, INIT, d);
  t('registro incompleto → 400 y no se crea', rm.status === 400 && /N\/A/.test(rm.json.error) && d.log.creados.length === 1, JSON.stringify(rm));
  const inex = base3(); inex.id = 'PAR-1730000000000-qq11qq'; inex.eqId = 'NO-EXISTE';
  t('equipo inexistente → 400', (await procesar({ accion: 'guardar', registro: inex }, INIT, d)).status === 400);
  const split = base3(); split.id = 'PAR-1730000000000-ss22ss'; split.eqId = 'I1';
  t('inyector de otra sede válido', (await procesar({ accion: 'guardar', registro: split }, INIT, d)).status === 200);
}
t('orden natural', ['Extractor 10', 'Extractor 2', 'Extractor 01'].sort((a, b) => porNombre({ nombre: a }, { nombre: b })).join() === 'Extractor 01,Extractor 2,Extractor 10');

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
