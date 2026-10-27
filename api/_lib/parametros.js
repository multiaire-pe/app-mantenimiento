// Toma de parámetros de ventilación mecánica (extractores / inyectores) desde la Mini App de Telegram.
// Reemplaza el formato impreso "FORMATO DE TOMA DE PARÁMETROS": el técnico lo llena en el celular y el
// registro queda guardado en `mtto_parametros` (1 doc por registro). Este módulo es PURO (sin Firestore
// ni red): la firma de Telegram y la validación se prueban sin servicios. El handler está en
// api/parametros.js.
import crypto from 'node:crypto';

export const TIPOS = ['EXTRACTOR', 'INYECTOR'];

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
// es lo que se guarda. Solo se exige que cada campo aplicable tenga un número o se marque "N/A", para
// que un registro no salga con campos sin medir por descuido.
const NUM_MAX = 100000;
export const FASES = ['1PH', '3PH'];
export const ESTADO = ['BUENO', 'REGULAR', 'MALO', 'NA'];
export const ESTADO_FILTROS = ['BUENO', 'REGULAR', 'MALO', 'SIN_FILTRO', 'NA'];
export const TRANSMISION = ['DIRECTA', 'FAJAS', 'ACOPLADA', 'NA'];

const CAMPOS_NUM_BASE = ['voltajeNominal', 'amperajeNominal', 'frecuencia', 'vL1L2', 'aL1'];
const CAMPOS_NUM_3PH = ['vL2L3', 'vL1L3', 'aL2', 'aL3'];

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

// body: lo que manda la Mini App · equipo: ficha del inventario · tecnico: {id,nombre}
// Devuelve { ok:true, doc } o { ok:false, error }.
export function validarRegistro(body, equipo, tecnico, ahora = Date.now()) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Registro vacío.' };
  if (!ID_REGISTRO.test(String(body.id || ''))) return { ok: false, error: 'Identificador del registro inválido.' };
  if (!equipo) return { ok: false, error: 'El equipo no existe en el inventario.' };
  if (!TIPOS.includes(equipo.tipo)) return { ok: false, error: 'Este formato es solo para extractores e inyectores.' };
  if (!tecnico || !tecnico.id) return { ok: false, error: 'Técnico no identificado.' };

  const el = body.electrico || {}, si = body.sistema || {}, eq = body.equipo || {};
  if (!FASES.includes(el.fases)) return { ok: false, error: 'Indica si el equipo es monofásico o trifásico.' };
  const tres = el.fases === '3PH';

  const electrico = { fases: el.fases };
  for (const k of [...CAMPOS_NUM_BASE, ...(tres ? CAMPOS_NUM_3PH : [])]) {
    const m = medida(el[k]);
    if (!m.ok) return { ok: false, error: `Falta un valor (o marcar N/A) en: ${k}.` };
    electrico[k] = m.valor;
  }
  if (!tres) for (const k of CAMPOS_NUM_3PH) electrico[k] = null;   // no aplica en monofásico

  for (const k of ['estadoTablero', 'estadoContactores']) {
    if (!ESTADO.includes(el[k])) return { ok: false, error: `Falta indicar: ${k}.` };
    electrico[k] = el[k];
  }

  const sistema = {};
  if (!TRANSMISION.includes(si.transmision)) return { ok: false, error: 'Falta el tipo de transmisión.' };
  sistema.transmision = si.transmision;
  if (!ESTADO_FILTROS.includes(si.filtros)) return { ok: false, error: 'Falta el estado de filtros.' };
  sistema.filtros = si.filtros;
  for (const k of ['fajas', 'poleas']) {
    if (!ESTADO.includes(si[k])) return { ok: false, error: `Falta indicar: ${k}.` };
    sistema[k] = si[k];
  }
  sistema.fajasMedida = texto(si.fajasMedida, 40);

  // Hora de captura: la del teléfono si es razonable (el registro puede enviarse horas después por falta
  // de señal); si viene absurda se usa la del servidor y se marca.
  const recibido = ahora;
  let capturado = Date.parse(body.capturadoEn);
  let horaCliente = true;
  if (!Number.isFinite(capturado) || capturado > recibido + 3600e3 || capturado < recibido - 14 * 86400e3) {
    capturado = recibido; horaCliente = false;
  }
  const { fecha, hora } = fechaHoraLima(capturado);

  return {
    ok: true,
    doc: {
      id: body.id,
      formato: 'VENTILACION_MECANICA',
      version: 1,
      eqId: equipo.eqId,
      tag: equipo.eqId,
      cliente: equipo.cliente,
      sede: equipo.sede,
      area: equipo.area,
      tipo: equipo.tipo,
      nombreEq: equipo.nombre,
      // Identificación tal como la confirma el técnico (puede corregir lo que dice el inventario).
      equipo: { marca: texto(eq.marca, 60), modelo: texto(eq.modelo, 60), serie: texto(eq.serie, 60), potencia: texto(eq.potencia, 40) },
      electrico,
      sistema,
      observaciones: texto(body.observaciones, 1000),
      supervisor: texto(body.supervisor, 80),
      tecnicoId: tecnico.id,
      tecnicoNombre: tecnico.nombre || '',
      fecha, hora,
      capturadoEn: new Date(capturado).toISOString(),
      recibidoEn: new Date(recibido).toISOString(),
      horaCliente,
      diferido: recibido - capturado > 2 * 60 * 1000,   // se envió más de 2 min después de capturarlo
      origen: 'MINIAPP',
    },
  };
}

// Orden natural por nombre ("Extractor 2" antes que "Extractor 10").
export const porNombre = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true });

// Lógica del endpoint con dependencias inyectadas (testeable sin Vercel ni Firestore):
//  d.token · d.ahora() · d.identificar(chatId) → {id,nombre}|null · d.equipos() → [{eqId,...}]
//  d.crear(id, doc) → 'creado' | 'duplicado'
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
    return { status: 200, json: { tecnico: t, sedes } };
  }
  if (accion === 'equipos') {
    const eqs = (await d.equipos()).filter((e) => e.cliente === body.cliente && e.sede === body.sede).sort(porNombre);
    return { status: 200, json: { equipos: eqs } };
  }
  if (accion === 'guardar') {
    const eqs = await d.equipos();
    const equipo = eqs.find((e) => e.eqId === (body.registro && body.registro.eqId));
    const r = validarRegistro(body.registro, equipo, t, d.ahora());
    if (!r.ok) return { status: 400, json: { error: r.error } };
    const estado = await d.crear(r.doc.id, r.doc);
    return { status: 200, json: { ok: true, duplicado: estado === 'duplicado' } };
  }
  return { status: 400, json: { error: 'Acción desconocida.' } };
}
