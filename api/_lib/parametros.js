// Toma de parámetros desde la Mini App de Telegram, con los 4 formatos de las hojas impresas de TOTTUS
// (Split · Fan coil y UMA · Ventilación mecánica · Cortinas de aire). El técnico los llena en el celular y el
// registro queda en `mtto_parametros` (1 doc por registro) con la MISMA estructura de columnas de esas hojas
// de Excel, para exportarlo después sin transformar nada. Este módulo es PURO (sin Firestore ni red): la
// firma de Telegram y la validación se prueban sin servicios. El handler está en api/parametros.js.
import crypto from 'node:crypto';

// ── Formatos ────────────────────────────────────────────────────────────────────────────────
// Una sola definición que usan el servidor (validar) y la Mini App (pintar el formulario): `inicio` se la manda.
//   t: 'num'    → número o N/A (obligatorio: que no salga un registro sin medir por descuido)
//   t: 'texto'  → texto libre, opcional (placa del motor, faja, medida...)
//   t: 'opcion' → una de `opciones` (obligatorio)
// `potencia: true` → se precarga la "Potencia del motor" con la capacidad del inventario (en extractores,
// UMA y cortinas la capacidad ES la potencia del motor: 1.5 HP, 870 W...).
export const OPCIONES_EXTRACTOR = [['AXIAL', 'Axial'], ['CENTRIFUGA', 'Centrífuga'], ['HUMO', 'Humo'], ['HONGO', 'Hongo'], ['CAJON', 'Cajón'], ['NA', 'N/A']];
const POTENCIA = { k: 'potenciaMotor', t: 'texto', rotulo: 'Potencia del motor (hp o W)', max: 40, potencia: true };
const MOTOR = { k: 'modeloSerieMotor', t: 'texto', rotulo: 'Modelo / serie del motor', max: 60 };
const FAJA = { k: 'modeloCantFaja', t: 'texto', rotulo: 'Modelo / cantidad de faja', max: 40 };
export const FORMATOS = {
  SPLIT: {
    titulo: 'Split',
    tipos: ['SPLIT DECORATIVO', 'SPLIT CONSOLA', 'SPLIT DUCTO', 'SPLIT PORTATIL', 'UNIDAD EVAPORADORA', 'UNIDAD CONDENSADOR'],
    campos: [
      { k: 'presionBaja', t: 'num', rotulo: 'Presión de baja (psi)' },
      { k: 'presionAlta', t: 'num', rotulo: 'Presión de alta (psi)' },
      { k: 'tempSalidaAire', t: 'num', rotulo: 'Temperatura salida de aire (°C)' },
    ],
  },
  FANCOIL_UMA: {
    titulo: 'Fan coil y UMA',
    tipos: ['FAN COIL', 'UMA'],
    campos: [
      POTENCIA, MOTOR, FAJA,
      { k: 'tempEntradaAgua', t: 'num', rotulo: 'Temp. entrada de agua helada (°C)' },
      { k: 'tempSalidaAgua', t: 'num', rotulo: 'Temp. salida de agua helada (°C)' },
    ],
  },
  VENTILACION: {
    titulo: 'Ventilación mecánica',
    tipos: ['EXTRACTOR', 'INYECTOR'],
    campos: [POTENCIA, MOTOR, FAJA, { k: 'tipoExtractor', t: 'opcion', rotulo: 'Tipo de extractor', opciones: OPCIONES_EXTRACTOR }],
  },
  CORTINA: {
    titulo: 'Cortinas de aire',
    tipos: ['CORTINA DE AIRE'],
    campos: [{ k: 'medidaCortina', t: 'texto', rotulo: 'Medida de cortina', max: 30 }, POTENCIA, MOTOR],
  },
};
export const TIPOS = [...new Set(Object.values(FORMATOS).flatMap((f) => f.tipos))];
export const formatoDe = (tipo) => Object.keys(FORMATOS).find((k) => FORMATOS[k].tipos.includes(tipo)) || null;
export const ESTADOS_EQ = ['OP', 'OO', 'FS'];   // Operativo · Operativo con observación · Fuera de funcionamiento

// ── Telegram initData ───────────────────────────────────────────────────────────────────────
// La Mini App manda `Telegram.WebApp.initData` (querystring firmado). Se valida igual que dice la
// documentación de Telegram: secreto = HMAC_SHA256("WebAppData", botToken); hash = HMAC_SHA256(secreto,
// "k=v" ordenados alfabéticamente y unidos por \n, sin `hash`). Sin esto cualquiera podría fabricar
// registros a nombre de un técnico.
export function verificarInitData(initData, botToken, { ahora = Date.now(), maxEdadSeg = 24 * 3600 } = {}) {
  if (!botToken) return { ok: false, motivo: 'sin_token' };
  if (typeof initData !== 'string' || !initData) return { ok: false, motivo: 'vacio' };
  let params;
  try { params = new URLSearchParams(initData); } catch { return { ok: false, motivo: 'formato' }; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, motivo: 'sin_hash' };
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secreto = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const esperado = crypto.createHmac('sha256', secreto).update(dcs).digest();
  const dado = Buffer.from(hash, 'hex');
  if (dado.length !== esperado.length || !crypto.timingSafeEqual(dado, esperado)) return { ok: false, motivo: 'firma' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, motivo: 'sin_fecha' };
  const edad = Math.floor(ahora / 1000) - authDate;
  if (edad > maxEdadSeg || edad < -300) return { ok: false, motivo: 'vencido' };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { /* user inválido */ }
  if (!user || !Number.isFinite(Number(user.id))) return { ok: false, motivo: 'sin_usuario' };
  return { ok: true, user: { id: Number(user.id), nombre: user.first_name || '' } };
}

// ── Validación del registro ─────────────────────────────────────────────────────────────────
// Los valores de las mediciones NO se juzgan (ni rangos ni "sobre el nominal"): lo que mide el técnico
// es lo que se guarda. Solo se exige que cada medida aplicable tenga un número o se marque "N/A".
const NUM_MAX = 100000;
export const FASES = ['1PH', '3PH'];
// Las 6 líneas de la hoja: Voltaje L1-L2-L3 y Amperaje L1-L2-L3. En monofásico solo va L1.
export const LINEAS_1PH = ['v1', 'a1'];
export const LINEAS_3PH = ['v1', 'v2', 'v3', 'a1', 'a2', 'a3'];

const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// número | 'NA'  → { ok, valor }  (acepta "12,5" con coma decimal)
function medida(v) {
  if (v === 'NA') return { ok: true, valor: 'NA' };
  if (typeof v === 'string' && v.trim() !== '') v = Number(v.trim().replace(',', '.'));
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > NUM_MAX) return { ok: false };
  return { ok: true, valor: v };
}

// Fecha y hora en Lima (UTC-5, sin horario de verano).
export function fechaHoraLima(ms) {
  const d = new Date(ms - 5 * 3600 * 1000);
  const iso = d.toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

export const ID_REGISTRO = /^PAR-[A-Za-z0-9-]{8,64}$/;

// ── Una sola toma por equipo y período ──
// El id del documento es DETERMINÍSTICO (equipo + período + año): guardar de nuevo el mismo equipo en el mismo período
// cae sobre el mismo documento y lo ACTUALIZA, así nunca hay dos tomas del mismo equipo. El período lo decide el servidor
// (el del botón "Usar este período…" de Mantenimiento), no el teléfono.
export const PERIODOS = ['ENE-FEB', 'MAR-ABR', 'MAY-JUN', 'JUL-AGO', 'SEP-OCT', 'NOV-DIC'];
export const idRegistro = (eqId, periodo, anio) => `${String(eqId).replace(/\//g, '∕')}|${periodo}|${anio}`;
export function periodoDeFecha(fecha) {   // 'YYYY-MM-DD' → { periodo, anio }
  const [a, m] = String(fecha).split('-').map(Number);
  return { periodo: PERIODOS[Math.floor((m - 1) / 2)], anio: a };
}
export function rangoPeriodo(periodo, anio) {   // → { desde, hasta } 'YYYY-MM-DD' (para los registros viejos, que no traen `periodo`)
  const i = PERIODOS.indexOf(periodo), y = Number(anio);
  if (i < 0 || !Number.isFinite(y)) return null;
  const m1 = i * 2 + 1, m2 = m1 + 1, dos = (n) => String(n).padStart(2, '0');
  return { desde: `${y}-${dos(m1)}-01`, hasta: `${y}-${dos(m2)}-${dos(new Date(Date.UTC(y, m2, 0)).getUTCDate())}` };
}
// Marca / modelo / serie que el técnico escribió y NO coinciden con el inventario → { campo: { antes, despues } }
export function cambiosEquipo(inventario, enviado) {
  const c = {};
  for (const k of ['marca', 'modelo', 'serie']) {
    const a = texto(inventario && inventario[k], 60), b = texto(enviado && enviado[k], 60);
    if (a !== b) c[k] = { antes: a, despues: b };
  }
  return c;
}

// body: lo que manda la Mini App · equipo: ficha del inventario · tecnico: {id,nombre}
// Devuelve { ok:true, doc } o { ok:false, error }.
// ctx (opcional): { periodo: {periodo, anio}, previo: documento ya guardado de este equipo en este período }
export function validarRegistro(body, equipo, tecnico, ahora = Date.now(), ctx = {}) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Registro vacío.' };
  if (!ID_REGISTRO.test(String(body.id || ''))) return { ok: false, error: 'Identificador del registro inválido.' };
  if (!equipo) return { ok: false, error: 'El equipo no existe en el inventario.' };
  const formato = formatoDe(equipo.tipo);
  if (!formato) return { ok: false, error: 'Este tipo de equipo no tiene formato de parámetros.' };
  if (!tecnico || !tecnico.id) return { ok: false, error: 'Técnico no identificado.' };
  const def = FORMATOS[formato];

  const el = body.electrico || {}, dt = body.datos || {}, eq = body.equipo || {};
  if (!FASES.includes(el.fases)) return { ok: false, error: 'Indica si el equipo es monofásico o trifásico.' };
  const tres = el.fases === '3PH';

  const electrico = { fases: el.fases };
  for (const k of LINEAS_3PH) {
    if (!tres && !LINEAS_1PH.includes(k)) { electrico[k] = null; continue; }   // no aplica en monofásico
    const m = medida(el[k]);
    if (!m.ok) return { ok: false, error: `Falta un valor (o marcar N/A) en: ${k}.` };
    electrico[k] = m.valor;
  }

  const datos = {};
  for (const c of def.campos) {
    if (c.t === 'num') {
      const m = medida(dt[c.k]);
      if (!m.ok) return { ok: false, error: `Falta un valor (o marcar N/A) en: ${c.rotulo}.` };
      datos[c.k] = m.valor;
    } else if (c.t === 'opcion') {
      if (!c.opciones.some(([v]) => v === dt[c.k])) return { ok: false, error: `Falta elegir: ${c.rotulo}.` };
      datos[c.k] = dt[c.k];
    } else {
      datos[c.k] = texto(dt[c.k], c.max || 60);
    }
  }
  if (!ESTADOS_EQ.includes(body.estado)) return { ok: false, error: 'Falta el estado del equipo (OP / OO / FS).' };

  // Hora de captura: la del teléfono si es razonable (el registro puede enviarse horas después por falta
  // de señal); si viene absurda se usa la del servidor y se marca.
  const recibido = ahora;
  let capturado = Date.parse(body.capturadoEn);
  let horaCliente = true;
  if (!Number.isFinite(capturado) || capturado > recibido + 3600e3 || capturado < recibido - 14 * 86400e3) {
    capturado = recibido; horaCliente = false;
  }
  const { fecha, hora } = fechaHoraLima(capturado);
  const per = ctx.periodo || periodoDeFecha(fecha);
  const previo = ctx.previo || null;
  const equipoEnviado = { marca: texto(eq.marca, 60), modelo: texto(eq.modelo, 60), serie: texto(eq.serie, 60) };
  const nombre = tecnico.nombre || '';

  return {
    ok: true,
    doc: {
      id: idRegistro(equipo.eqId, per.periodo, per.anio),
      periodo: per.periodo,
      anio: Number(per.anio),
      formato,
      version: 3,
      eqId: equipo.eqId,
      cliente: equipo.cliente,
      sede: equipo.sede,
      area: equipo.area,
      tipo: equipo.tipo,
      nombreEq: equipo.nombre,
      // Marca / modelo / serie vienen del inventario; el técnico puede corregirlas y se guarda lo que confirma.
      equipo: equipoEnviado,
      // Lo que decía el inventario al guardar y qué campos se corrigieron/completaron: Mantenimiento los marca con un punto
      // rojo para que quien revisa decida si corrige el inventario. No se toca el inventario desde acá.
      equipoInventario: { marca: texto(equipo.marca, 60), modelo: texto(equipo.modelo, 60), serie: texto(equipo.serie, 60) },
      cambiosEquipo: cambiosEquipo(equipo, equipoEnviado),
      electrico,
      datos,
      estado: body.estado,
      os: texto(body.os, 30),
      observaciones: texto(body.observaciones, 1000),
      tecnicoId: tecnico.id,
      tecnicoNombre: tecnico.nombre || '',
      fecha, hora,
      capturadoEn: new Date(capturado).toISOString(),
      recibidoEn: new Date(recibido).toISOString(),
      horaCliente,
      diferido: recibido - capturado > 2 * 60 * 1000,   // se envió más de 2 min después de capturarlo
      origen: 'MINIAPP',
      // Primera toma y ediciones: volver a enviar el mismo equipo en el mismo período lo ACTUALIZA, no crea otro.
      creadoEn: previo ? (previo.creadoEn || previo.recibidoEn || new Date(recibido).toISOString()) : new Date(recibido).toISOString(),
      creadoPor: previo ? (previo.creadoPor || previo.tecnicoNombre || nombre) : nombre,
      ediciones: previo ? (Number(previo.ediciones) || 0) + 1 : 0,
      ...(previo ? { editadoEn: new Date(recibido).toISOString(), editadoPor: nombre } : {}),
    },
  };
}

// Registro más reciente por equipo (si hubiera duplicados viejos, gana el último capturado).
export function ultimoPorEquipo(registros) {
  const m = new Map();
  for (const r of registros || []) {
    const a = m.get(r.eqId);
    if (!a || String(r.capturadoEn || '') > String(a.capturadoEn || '')) m.set(r.eqId, r);
  }
  return m;
}
// Lo que la Mini App necesita para reabrir una toma ya hecha y editarla.
const paraEditar = (r) => ({
  fecha: r.fecha, hora: r.hora, tecnicoNombre: r.tecnicoNombre || '', ediciones: Number(r.ediciones) || 0,
  equipo: r.equipo || {}, electrico: r.electrico || {}, datos: r.datos || {}, estado: r.estado || '', os: r.os || '', observaciones: r.observaciones || '',
});

// ¿Puede borrar tomas desde la web? ADMIN y SUPER_ADMIN (ver firestore.rules: isAdmin).
export const SUPER_EMAILS = ['marchenaangulojoseluis@gmail.com', 'plataforma@multiaire.com.pe'];
export function puedeBorrarParametros(email, usuario) {
  if (SUPER_EMAILS.includes(String(email || '').toLowerCase())) return true;
  return !!usuario && ['ADMIN', 'SUPER_ADMIN'].includes(usuario.rol);
}

// Orden natural por nombre ("Extractor 2" antes que "Extractor 10").
export const porNombre = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true });

// Lógica del endpoint con dependencias inyectadas (testeable sin Vercel ni Firestore):
//  d.token · d.ahora() · d.identificar(chatId) → {id,nombre}|null · d.equipos() → [{eqId,...}]
//  d.periodo(sede, cliente) → { periodo, anio }   (el efectivo: respeta "Usar este período para registros de Telegram")
//  d.registros({ cliente, sede, periodo, anio }) → [doc]   (las tomas de ese período, nuevas y viejas)
//  d.previos(eqId, periodo, anio) → [doc]   (las de ese equipo en ese período)
//  d.guardar(doc, borrarIds) → escribe el doc (set) y borra los duplicados viejos
export async function procesar(body, initData, d) {
  const v = verificarInitData(initData, d.token, { ahora: d.ahora() });
  if (!v.ok) return { status: 401, json: { error: 'Sesión de Telegram no válida. Ciérralo y ábrelo de nuevo desde el bot.', motivo: v.motivo } };
  const tecnico = await d.identificar(v.user.id);
  if (!tecnico) return { status: 403, json: { error: 'Tu cuenta de Telegram no está vinculada a un colaborador activo.' } };
  const t = { id: tecnico.id, nombre: tecnico.nombre || v.user.nombre };
  const accion = body && body.accion;

  if (accion === 'inicio') {
    const eqs = await d.equipos();
    const por = new Map();
    for (const e of eqs) {
      const k = JSON.stringify([e.cliente, e.sede]);
      por.set(k, (por.get(k) || 0) + 1);
    }
    const sedes = [...por.entries()].map(([k, n]) => { const [cliente, sede] = JSON.parse(k); return { cliente, sede, n }; })
      .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es') || a.sede.localeCompare(b.sede, 'es'));
    return { status: 200, json: { tecnico: t, sedes, formatos: FORMATOS } };
  }
  if (accion === 'equipos') {
    const lista = (await d.equipos()).filter((e) => e.cliente === body.cliente && e.sede === body.sede);
    const per = await d.periodo(body.sede, body.cliente);
    const hechos = ultimoPorEquipo(await d.registros({ cliente: body.cliente, sede: body.sede, periodo: per.periodo, anio: per.anio }));
    const eqs = lista.map((e) => ({ ...e, formato: formatoDe(e.tipo), hecho: hechos.has(e.eqId), registro: hechos.has(e.eqId) ? paraEditar(hechos.get(e.eqId)) : null })).sort(porNombre);
    return { status: 200, json: { equipos: eqs, periodo: per } };
  }
  if (accion === 'guardar') {
    const eqs = await d.equipos();
    const equipo = eqs.find((e) => e.eqId === (body.registro && body.registro.eqId));
    // Solo se necesita el período para armar el id; con un equipo inexistente validarRegistro responde el error.
    const per = equipo ? await d.periodo(equipo.sede, equipo.cliente) : null;
    const existentes = equipo ? await d.previos(equipo.eqId, per.periodo, per.anio) : [];
    const idNuevo = equipo ? idRegistro(equipo.eqId, per.periodo, per.anio) : '';
    const previo = existentes.find((x) => x.id === idNuevo) || ultimoPorEquipo(existentes).get(equipo && equipo.eqId) || null;
    const r = validarRegistro(body.registro, equipo, t, d.ahora(), per ? { periodo: per, previo } : {});
    if (!r.ok) return { status: 400, json: { error: r.error } };
    // Un envío viejo que llega tarde (cola del teléfono) no pisa una toma más nueva.
    if (previo && String(previo.capturadoEn || '') > r.doc.capturadoEn) return { status: 200, json: { ok: true, obsoleto: true, periodo: per } };
    await d.guardar(r.doc, existentes.filter((x) => x.id !== r.doc.id).map((x) => x.id));
    return { status: 200, json: { ok: true, actualizado: !!previo, periodo: per } };
  }
  return { status: 400, json: { error: 'Acción desconocida.' } };
}
