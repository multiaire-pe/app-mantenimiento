// Toma de parámetros (Mini App de Telegram): firma de initData, formatos (Split · Fan coil y UMA ·
// Ventilación mecánica · Cortinas), validación del registro y el endpoint con dependencias falsas.
// Uso: node tests/parametros.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { verificarInitData, validarRegistro, procesar, fechaHoraLima, porNombre, FORMATOS, TIPOS, formatoDe, LINEAS_3PH } from '../api/_lib/parametros.js';

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

// ── formatos: deben ser los de las hojas impresas de TOTTUS (mismo orden de columnas) ──
{
  const cols = (f) => FORMATOS[f].campos.map((c) => c.k).join();
  t('Split: presión baja, presión alta, temp. salida de aire', cols('SPLIT') === 'presionBaja,presionAlta,tempSalidaAire', cols('SPLIT'));
  t('Fan coil y UMA: potencia, modelo/serie motor, faja, temp. agua entrada y salida', cols('FANCOIL_UMA') === 'potenciaMotor,modeloSerieMotor,modeloCantFaja,tempEntradaAgua,tempSalidaAgua', cols('FANCOIL_UMA'));
  t('Ventilación: potencia, modelo/serie motor, faja, tipo de extractor', cols('VENTILACION') === 'potenciaMotor,modeloSerieMotor,modeloCantFaja,tipoExtractor', cols('VENTILACION'));
  t('Cortinas: medida, potencia, modelo/serie motor', cols('CORTINA') === 'medidaCortina,potenciaMotor,modeloSerieMotor', cols('CORTINA'));
  t('tipo de extractor: Axial, Centrífuga, Humo, Hongo, Cajón (+ N/A)', FORMATOS.VENTILACION.campos[3].opciones.map((o) => o[0]).join() === 'AXIAL,CENTRIFUGA,HUMO,HONGO,CAJON,NA');
  t('el voltaje y el amperaje son 3 líneas cada uno', LINEAS_3PH.join() === 'v1,v2,v3,a1,a2,a3');
  t('tipos del inventario → formato', formatoDe('SPLIT DECORATIVO') === 'SPLIT' && formatoDe('UNIDAD EVAPORADORA') === 'SPLIT' && formatoDe('UMA') === 'FANCOIL_UMA' && formatoDe('FAN COIL') === 'FANCOIL_UMA' && formatoDe('EXTRACTOR') === 'VENTILACION' && formatoDe('INYECTOR') === 'VENTILACION' && formatoDe('CORTINA DE AIRE') === 'CORTINA');
  t('tipos sin formato (chiller, paquete, escalera...) → ninguno', ['CHILLER', 'PAQUETE', 'ESCALERA', 'BOMBA DE AGUA', 'VRV'].every((x) => formatoDe(x) === null));
  t('un tipo no está en dos formatos', TIPOS.length === Object.values(FORMATOS).flatMap((f) => f.tipos).length);
}

// ── validación ──
const EQS = {
  SPLIT: { eqId: 'MA-LOL-SDC-002', nombre: 'SPLIT 01', tipo: 'SPLIT DECORATIVO', cliente: 'TOTTUS', sede: 'LOS OLIVOS', area: 'SISTEMAS 1' },
  FANCOIL_UMA: { eqId: 'MA-LOL-UMA-001', nombre: 'Uma 01', tipo: 'UMA', cliente: 'TOTTUS', sede: 'LOS OLIVOS', area: 'AZOTEA' },
  VENTILACION: { eqId: 'MA-DTV-EXT-001', nombre: 'Extractor 01', tipo: 'EXTRACTOR', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE', area: 'SSHH CLIENTES PISO 2' },
  CORTINA: { eqId: 'MA-LOL-CAI-017', nombre: 'Cortina de aire 01', tipo: 'CORTINA DE AIRE', cliente: 'TOTTUS', sede: 'LOS OLIVOS', area: 'AREA DE RESIDUOS' },
};
const EQ = EQS.VENTILACION;
const TEC = { id: 'PER003', nombre: 'ENRIQUE YARANGA' };
const DATOS = {
  SPLIT: { presionBaja: 118, presionAlta: '350,5', tempSalidaAire: 12.5 },
  FANCOIL_UMA: { potenciaMotor: ' 20  HP ', modeloSerieMotor: 'WEG 123', modeloCantFaja: 'B60 x 3', tempEntradaAgua: 7, tempSalidaAgua: 'NA' },
  VENTILACION: { potenciaMotor: '1.5 HP', modeloSerieMotor: 'SA-15', modeloCantFaja: 'A55 x1', tipoExtractor: 'CENTRIFUGA' },
  CORTINA: { medidaCortina: '1.5 m', potenciaMotor: '870 W', modeloSerieMotor: 'CAF-60' },
};
const base3 = (f = 'VENTILACION') => ({
  id: 'PAR-1730000000000-ab12cd',
  eqId: EQS[f].eqId,
  capturadoEn: new Date(AHORA - 30e3).toISOString(),
  os: '  OS-123 ',
  equipo: { marca: 'WEG', modelo: '3~112M-04', serie: 'N/V' },
  electrico: { fases: '3PH', v1: '220', v2: '221,5', v3: 220, a1: 9.8, a2: 10.1, a3: 'NA' },
  datos: { ...DATOS[f] },
  estado: 'OO',
  observaciones: 'Correa  desgastada',
});
const val = (mut, f = 'VENTILACION', eq = EQS[f], ahora = AHORA) => { const b = base3(f); mut && mut(b); return validarRegistro(b, eq, TEC, ahora); };

{
  const r = val();
  t('trifásico completo: válido', r.ok, JSON.stringify(r));
  const d = r.doc;
  t('formato y versión', d.formato === 'VENTILACION' && d.version === 2);
  t('números: acepta texto con coma y "NA"', d.electrico.v2 === 221.5 && d.electrico.a3 === 'NA' && d.electrico.v1 === 220);
  t('cliente/sede/área/tipo salen del inventario', d.cliente === 'TOTTUS' && d.sede === EQ.sede && d.area === EQ.area && d.tipo === 'EXTRACTOR' && d.eqId === EQ.eqId);
  t('marca/modelo/serie confirmadas por el técnico se guardan', d.equipo.marca === 'WEG' && d.equipo.serie === 'N/V' && d.equipo.modelo === '3~112M-04');
  t('texto normalizado (espacios)', d.os === 'OS-123' && d.observaciones === 'Correa desgastada');
  t('estado OP/OO/FS', d.estado === 'OO');
  t('técnico del registro = el autenticado (no el del cuerpo)', d.tecnicoId === 'PER003' && d.tecnicoNombre === 'ENRIQUE YARANGA');
  t('fecha y hora en Lima (UTC-5)', d.fecha === '2026-10-27' && d.hora === '11:59', d.fecha + ' ' + d.hora);
  t('no diferido y con hora del teléfono', d.diferido === false && d.horaCliente === true && d.origen === 'MINIAPP');
}
// cada formato valida SUS campos
for (const f of Object.keys(FORMATOS)) {
  const r = val(null, f);
  t(`${f}: registro completo válido`, r.ok && r.doc.formato === f, JSON.stringify(r));
  t(`${f}: guarda exactamente los campos del formato`, r.ok && Object.keys(r.doc.datos).join() === FORMATOS[f].campos.map((c) => c.k).join(), r.ok && Object.keys(r.doc.datos).join());
  for (const c of FORMATOS[f].campos.filter((c) => c.t !== 'texto')) {
    t(`${f}: falta "${c.k}" → rechazado`, !val((b) => { delete b.datos[c.k]; }, f).ok);
  }
  t(`${f}: campos de texto vacíos se aceptan (opcionales)`, FORMATOS[f].campos.filter((c) => c.t === 'texto').every((c) => val((b) => { b.datos[c.k] = ''; }, f).ok));
  t(`${f}: sin estado → rechazado`, !val((b) => { delete b.estado; }, f).ok && !val((b) => { b.estado = 'BUENO'; }, f).ok);
  t(`${f}: un dato de otro formato se ignora`, val((b) => { b.datos.otroCampo = 5; }, f).ok && !('otroCampo' in val((b) => { b.datos.otroCampo = 5; }, f).doc.datos));
}
{
  t('Split: presión "NA" aceptada', val((b) => { b.datos.presionBaja = 'NA'; }, 'SPLIT').ok);
  t('Split: presión negativa → rechazada', !val((b) => { b.datos.presionAlta = -3; }, 'SPLIT').ok);
  t('Ventilación: tipo de extractor inventado → rechazado', !val((b) => { b.datos.tipoExtractor = 'TURBINA'; }).ok);
  t('Ventilación: inyector con tipo "N/A" válido', val((b) => { b.datos.tipoExtractor = 'NA'; }, 'VENTILACION', { ...EQ, tipo: 'INYECTOR' }).ok);
  t('el texto del campo se recorta a su máximo', val((b) => { b.datos.medidaCortina = 'x'.repeat(200); }, 'CORTINA').doc.datos.medidaCortina.length === 30);
  t('potencia: espacios normalizados', val(null, 'FANCOIL_UMA').doc.datos.potenciaMotor === '20 HP');
  t('un tipo sin formato → rechazado', !val(null, 'VENTILACION', { ...EQ, tipo: 'CHILLER' }).ok);
}
{
  const r = val((b) => { b.electrico.fases = '1PH'; delete b.electrico.v2; delete b.electrico.v3; delete b.electrico.a2; delete b.electrico.a3; });
  t('monofásico: solo L1, el resto queda en null', r.ok && r.doc.electrico.v2 === null && r.doc.electrico.a2 === null && r.doc.electrico.a1 === 9.8, JSON.stringify(r));
  const sobrante = val((b) => { b.electrico.fases = '1PH'; });   // el cuerpo conserva v2, v3, a2, a3
  t('monofásico con L2/L3 sobrantes en el cuerpo: se descartan', sobrante.ok && ['v2', 'v3', 'a2', 'a3'].every((k) => sobrante.doc.electrico[k] === null), JSON.stringify(sobrante.doc && sobrante.doc.electrico));
  t('trifásico sin L2 → rechazado', !val((b) => { delete b.electrico.a2; }).ok);
  t('campo sin valor ni N/A → rechazado', !val((b) => { b.electrico.a1 = ''; }).ok);
  t('campo undefined → rechazado', !val((b) => { delete b.electrico.v1; }).ok);
  t('negativo → rechazado', !val((b) => { b.electrico.a1 = -1; }).ok);
  t('texto no numérico → rechazado', !val((b) => { b.electrico.a1 = 'abc'; }).ok);
  t('NaN/Infinity → rechazado', !val((b) => { b.electrico.a1 = Infinity; }).ok && !val((b) => { b.electrico.a1 = NaN; }).ok);
  t('valor absurdo (>100000) → rechazado', !val((b) => { b.electrico.a1 = 1e6; }).ok);
  t('cero es una medición válida', val((b) => { b.electrico.a1 = 0; }).ok);
  // NO se juzga la medición: un amperaje muy alto se guarda igual (sin sesgo)
  t('amperaje muy alto se guarda sin objeción', val((b) => { b.electrico.a1 = 55; }).doc.electrico.a1 === 55);
}
{
  t('sin fases → rechazado', !val((b) => { delete b.electrico.fases; }).ok);
  t('id inválido → rechazado', !val((b) => { b.id = 'x'; }).ok && !val((b) => { b.id = '../../otro'; }).ok);
  t('equipo inexistente → rechazado', !val(null, 'VENTILACION', null).ok);
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
  { ...EQS.VENTILACION, marca: 'WEG', modelo: 'M1', serie: 'S1', capacidad: '1.5 HP' },
  { eqId: 'I1', nombre: 'Inyector 01', tipo: 'INYECTOR', cliente: 'RIPLEY', sede: 'ATOCONGO', area: 'C' },
  { ...EQS.SPLIT }, { ...EQS.FANCOIL_UMA }, { ...EQS.CORTINA },
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
  t('inicio: técnico, sedes con su cantidad y los 4 formatos', r.status === 200 && r.json.tecnico.id === 'PER003' && r.json.sedes.length === 3 && r.json.sedes.find((s) => s.sede === 'DOMINICOS / T. VALLE').n === 3 && Object.keys(r.json.formatos).join() === 'SPLIT,FANCOIL_UMA,VENTILACION,CORTINA', JSON.stringify(r.json.sedes));
  const e = await procesar({ accion: 'equipos', cliente: 'TOTTUS', sede: 'DOMINICOS / T. VALLE' }, INIT, d);
  t('equipos: solo los de esa sede, en orden natural', e.status === 200 && e.json.equipos.map((x) => x.nombre).join() === 'Extractor 01,Extractor 2,Extractor 10', JSON.stringify(e.json));
  t('cada equipo trae su formato y los datos del sistema (marca/modelo/serie)', e.json.equipos.every((x) => x.formato === 'VENTILACION') && e.json.equipos[0].marca === 'WEG' && e.json.equipos[0].modelo === 'M1' && e.json.equipos[0].serie === 'S1');
  const lo = await procesar({ accion: 'equipos', cliente: 'TOTTUS', sede: 'LOS OLIVOS' }, INIT, d);
  t('una sede mezcla formatos: cada equipo con el suyo', lo.json.equipos.map((x) => x.formato).sort().join() === 'CORTINA,FANCOIL_UMA,SPLIT', JSON.stringify(lo.json.equipos.map((x) => x.formato)));
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
  const mala = base3(); mala.id = 'PAR-1730000000000-zz99zz'; mala.electrico.a1 = '';
  const rm = await procesar({ accion: 'guardar', registro: mala }, INIT, d);
  t('registro incompleto → 400 y no se crea', rm.status === 400 && /N\/A/.test(rm.json.error) && d.log.creados.length === 1, JSON.stringify(rm));
  const inex = base3(); inex.id = 'PAR-1730000000000-qq11qq'; inex.eqId = 'NO-EXISTE';
  t('equipo inexistente → 400', (await procesar({ accion: 'guardar', registro: inex }, INIT, d)).status === 400);
  // un registro de cada formato, contra su equipo
  let n = 20;
  for (const f of ['SPLIT', 'FANCOIL_UMA', 'CORTINA', 'VENTILACION']) {
    const b = base3(f); b.id = `PAR-17300000000${n++}-fm${n}xx`;
    t(`guardar formato ${f}`, (await procesar({ accion: 'guardar', registro: b }, INIT, d)).status === 200);
  }
  t('un registro de Split no se acepta con los datos de otro formato', (await procesar({ accion: 'guardar', registro: { ...base3('CORTINA'), id: 'PAR-1730000000099-xx00xx', eqId: EQS.SPLIT.eqId } }, INIT, d)).status === 400);
}
t('orden natural', ['Extractor 10', 'Extractor 2', 'Extractor 01'].sort((a, b) => porNombre({ nombre: a }, { nombre: b })).join() === 'Extractor 01,Extractor 2,Extractor 10');

// ── la pantalla: se arma con los formatos del servidor y trae los datos del sistema ya completos ──
{
  const html = fs.readFileSync(new URL('../parametros.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });
  t('el formulario sale de formatos[eq.formato].campos', /const fm = formatos\[eq\.formato\]/.test(html) && /fm\.campos\.map/.test(html));
  t('marca/modelo/serie se precargan del inventario y quedan de solo lectura', /dato\('marca', 'Marca', eq\.marca\)/.test(html) && /dato\('modelo', 'Modelo', eq\.modelo\)/.test(html) && /dato\('serie', 'Número de serie', eq\.serie\)/.test(html) && /valor \? ' readonly' : ''/.test(html));
  t('se pueden corregir con el lápiz', /data-corregir/.test(html) && /i\.readOnly = false/.test(html));
  t('la potencia del motor se precarga con la capacidad (si no es BTU ni N/V)', /const potenciaDe = /.test(html) && /btu/i.test(html) && /c\.potencia \? esc\(potenciaDe\(eq\)\)/.test(html));
  t('las 3 líneas de voltaje y amperaje; en monofásico solo L1', /\['v1', 'Voltaje L1 \(V\)'\]/.test(html) && /\['a3', 'Amperaje L3 \(A\)'\]/.test(html) && /\['v1', 'a1'\]\.includes\(k\)/.test(html));
  t('estado OP / OO / FS', /OP · Operativo/.test(html) && /OO · Operativo con obs/.test(html) && /FS · Fuera de func/.test(html));
  t('el registro manda "datos" y "estado" (no los campos viejos)', /electrico: el, datos, estado/.test(html) && !/voltajeNominal|estadoTablero|sistema: \{/.test(html));
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
