// Motor conversacional del MARCAJE de asistencia geolocalizada.
// Lleva al técnico de "quiero marcar" a un registro escrito, pidiendo ubicación + selfie y
// geovalidando contra la sede de su itinerario del día. Diseño testeable: TODOS los accesos a
// datos (plan del día, tiendas, escritura y el almacén de sesiones) se inyectan por `deps`.
//
// Estados de la sesión (wa_asistencia_sesiones):
//   RECOLECTA   → espera ubicación y/o selfie (en cualquier orden).
//   ELIGE_SEDE  → su ubicación no cae dentro de ninguna sede: se pregunta en cuál está (tenga plan o no).
import { evaluarSede, sedeQueContiene, fmtDistancia } from './geo.js';
import { hoyLima, ahoraDecimalLima, horaHHMMLima, decimalAHHMM } from './fecha.js';
import { sedesDelDia as _sedesDelDia } from './plan_dia.js';
import { cargarTiendas as _cargarTiendas, tiendaPorId as _tiendaPorId, tiendasConGeo as _tiendasConGeo } from './tiendas.js';
import { registrarMarcaje as _registrarMarcaje, registroDelDia as _registroDelDia } from './asistencia_registros.js';
import * as _ses from './asistencia_sesiones.js';

const RE_CANCELA = /^\s*(cancel\w*|anul\w*|olv[ií]d\w*|d[eé]jal\w*|no\s+import\w*|ya\s+no)/i;
const RE_ENTRADA = /\b(entrada|entr[eé]|ingres\w*|llegu[eé]|ya\s+llegu|inici\w*\s+jornada)\b/i;
const RE_SALIDA  = /\b(salida|sal[ií]\b|me\s+voy|me\s+retir\w*|retir\w*|fin\s+de\s+jornada|termin[eé])\b/i;

// Intención de asistencia para el ROUTER. Estricta a propósito para NO capturar un "salida"/"entrada"
// dicho en medio de una observación ("salida de aire", "entrada principal") ni la marca comercial
// ("marca Carrier"). Enruta a asistencia solo si:
//   - empieza con un verbo de marcaje (marcar/marco/fichar/asistencia), o
//   - el mensaje ES exactamente "entrada"/"salida"/"ingreso", o
//   - empieza con "(ya) llegué/llego" o "(ya) me voy/retiro", o
//   - contiene "marcar/registrar/fichar (mi) entrada/salida/asistencia" en cualquier parte.
// Nota: se usa el lookahead (?![a-z]) en vez de \b como delimitador, porque \b NO reconoce
// las vocales acentuadas ("é" no es \w en ASCII) y rompería "llegué"/"fiché".
export const RE_ASISTENCIA = new RegExp(
  '^\\s*(marcar|marco|marcando|fichar|fich[oeé]|asistencia)(?![a-z])' +
  '|^\\s*(entrada|salida|ingreso)\\s*[.!¡]*\\s*$' +
  '|^\\s*(ya\\s+)?(llegu[eé]|lleg[oó])(?![a-z])' +
  '|^\\s*(ya\\s+|me\\s+)?sal[ií](?![a-z])' +
  '|^\\s*(ya\\s+)?me\\s+(voy|retir\\w*|fui)(?![a-z])' +
  '|\\b(marcar|registrar|fichar|marco)\\s+(mi\\s+)?(entrada|salida|asistenc\\w*|ingres\\w*)\\b',
  'i'
);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function parseTipo(texto) {
  const t = texto || '';
  if (RE_SALIDA.test(t)) return 'SALIDA';
  if (RE_ENTRADA.test(t)) return 'ENTRADA';
  return null;
}

// Decide entrada vs salida a partir de lo que pidió (explícito) y el registro del día.
function decidirTipo(explicito, reg) {
  const hasEnt = !!(reg && reg.horaEntrada != null);
  const hasSal = !!(reg && reg.horaSalida != null);
  if (explicito === 'ENTRADA') {
    if (hasEnt && hasSal) return { error: 'ya_completo' };
    if (hasEnt) return { error: 'ya_entrada' };
    return { tipo: 'ENTRADA' };
  }
  if (explicito === 'SALIDA') {
    if (!hasEnt) return { error: 'sin_entrada' };
    if (hasSal) return { error: 'ya_salida' };
    return { tipo: 'SALIDA' };
  }
  if (!hasEnt) return { tipo: 'ENTRADA' };
  if (!hasSal) return { tipo: 'SALIDA' };
  return { error: 'ya_completo' };
}

// Enriquecer una sede del plan (idTienda/tienda/cliente) con sus coords desde maestros_tiendas.
async function enriquecer(sedePlan, tiendaPorId) {
  const t = sedePlan.idTienda ? await tiendaPorId(sedePlan.idTienda) : null;
  if (t) return t;
  return { id: sedePlan.idTienda || '', idTienda: sedePlan.idTienda || '', tienda: sedePlan.tienda || '', sede: sedePlan.sede || sedePlan.tienda || '', cliente: sedePlan.cliente || '', latitud: null, longitud: null, radio: null };
}

function labelSede(s) {
  return (s.sede || s.tienda || '').replace(/^RIPLEY\s+/i, '') || s.tienda || 'la sede';
}

// ── Entrada principal ─────────────────────────────────────────────────────────
// Devuelve el texto a responder (o null si no hay nada que responder).
export async function manejarAsistencia({ tecnico, from, texto = '', ubicacion = null, imagenB64 = null, mime = null }, deps = {}) {
  const d = {
    sedesDelDia: deps.sedesDelDia || _sedesDelDia,
    tiendaPorId: deps.tiendaPorId || _tiendaPorId,
    tiendasConGeo: deps.tiendasConGeo || _tiendasConGeo,
    cargarTiendas: deps.cargarTiendas || _cargarTiendas,
    registrarMarcaje: deps.registrarMarcaje || _registrarMarcaje,
    registroDelDia: deps.registroDelDia || _registroDelDia,
    store: deps.store || _ses,
    hoy: deps.hoy || hoyLima(),
    ahora: deps.ahora || Date.now(),
  };
  const t = (texto || '').trim();
  let ses = await d.store.getSesion(from);

  if (ses && RE_CANCELA.test(t)) {
    await d.store.limpiarSesion(from);
    return '👍 Listo, cancelé el marcaje. Cuando quieras marcar, escríbeme *entrada* o *salida* (o comparte tu ubicación).';
  }

  // Régimen: solo MARCA marca por aquí (default MARCA si no está definido).
  const regimen = String(tecnico?.regimenAsistencia || 'MARCA').toUpperCase();
  if (!ses) {
    if (regimen === 'NO_MARCA') {
      return `Hola ${primerNombre(tecnico)}. Tu asistencia no se controla por este medio. Si crees que es un error, avísale al administrador.`;
    }
    if (regimen === 'FIJO') {
      const hf = tecnico.horarioFijo || {};
      const horario = (hf.entrada != null && hf.salida != null) ? ` (${decimalAHHMM(hf.entrada)}–${decimalAHHMM(hf.salida)})` : '';
      return `Hola ${primerNombre(tecnico)}. Tu horario es *fijo*${horario}, así que no necesitas marcar por aquí: tu asistencia se registra automáticamente. ✅`;
    }
    const explicito = parseTipo(t);
    const reg = await d.registroDelDia(tecnico.id, d.hoy);
    const dt = decidirTipo(explicito, reg);
    if (dt.error) return errorTipo(dt.error, reg);
    ses = _ses.nuevaSesion(from, tecnico, dt.tipo);
    try {
      const plan = await d.sedesDelDia(tecnico.id, d.hoy);
      ses.planSedes = plan.sedes || [];
    } catch (e) {
      console.error('[asistencia] error leyendo el plan del día:', e?.message);
      ses.planSedes = [];
    }
    await d.store.guardarSesion(from, ses);
  }

  return avanzar(ses, { t, ubicacion, imagenB64, mime }, d);
}

// Procesa un turno: acumula ubicación/selfie, resuelve la sede y, si ya está todo, escribe.
async function avanzar(ses, msg, d) {
  const from = ses.from;

  if (msg.imagenB64) {
    if (await d.store.guardarSelfie(from, msg.imagenB64, msg.mime)) ses.tieneSelfie = true;
    else { await d.store.guardarSesion(from, ses); return '⚠️ Esa foto pesa demasiado. Compríme y reenvíala como *selfie*.'; }
  }
  if (msg.ubicacion && Number.isFinite(msg.ubicacion.lat) && Number.isFinite(msg.ubicacion.lng)) {
    ses.punto = { lat: Number(msg.ubicacion.lat), lng: Number(msg.ubicacion.lng) };
  }

  // Elegir sede por nombre (cuando se le preguntó).
  if (ses.fase === 'ELIGE_SEDE' && msg.t && !msg.ubicacion) {
    const sede = await resolverSedePorNombre(msg.t, d);
    if (!sede) { await d.store.guardarSesion(from, ses); return `No reconocí esa sede. ${await listaSedesTxt(d)}`; }
    ses.sede = compactSede(sede);
    ses.fueraDePlan = true;
    ses.fase = 'RECOLECTA';
  }

  // Resolver sede automáticamente a partir de la ubicación, si aún no hay sede.
  if (!ses.sede && ses.punto) {
    const r = await resolverSedePorUbicacion(ses, d);
    if (r.preguntar) { ses.fase = 'ELIGE_SEDE'; await d.store.guardarSesion(from, ses); return r.mensaje; }
    ses.sede = compactSede(r.sede);
    ses.fueraDePlan = r.fueraDePlan;
  }

  // Evaluar la ubicación contra la sede elegida.
  if (ses.sede && ses.punto) {
    const ev = evaluarSede(ses.punto, ses.sede);
    ses.ubicacion = { ...ev, lat: ses.punto.lat, lng: ses.punto.lng };
  }

  const tieneUbic = !!(ses.sede && ses.ubicacion);
  const tieneSelfie = ses.tieneSelfie || !!(await d.store.getSelfie(from));

  if (!tieneUbic) { await d.store.guardarSesion(from, ses); return pedirUbicacion(ses); }
  if (!tieneSelfie) { await d.store.guardarSesion(from, ses); return pedirSelfie(ses); }

  // Todo listo → escribir el marcaje.
  const selfie = await d.store.getSelfie(from);
  const res = await d.registrarMarcaje({
    tipo: ses.tipo,
    tecnico: { id: ses.colabId, nombre: ses.nombre, cargo: ses.cargo },
    fecha: d.hoy,
    horaDecimal: ahoraDecimalLima(d.ahora),
    horaExacta: horaHHMMLima(d.ahora),
    ts: new Date(d.ahora).toISOString(),
    sede: ses.sede,
    ubic: ses.ubicacion,
    fueraDePlan: ses.fueraDePlan,
    selfie,
  });
  await d.store.limpiarSesion(from);
  if (!res.ok) return errorMarcaje(res.error, res.existing, ses.tipo);
  // Aviso a los designados (Personal → 🔔 Alertas del bot); nunca frustra el marcaje
  try {
    const u = ses.ubicacion || {};
    const hora = (ses.tipo === 'SALIDA' ? res.registro?.marcajeSalida?.hora : res.registro?.marcajeEntrada?.hora) || '';
    const geo = u.valida === false ? 'sin validación de distancia'
      : u.dentro ? `en la sede (${fmtDistancia(u.distancia)})`
      : `⚠️ fuera de radio (${fmtDistancia(u.distancia)})`;
    const { notificarPorTipo } = await import('./avisos.js');
    const tipoTxt = ses.tipo === 'SALIDA' ? 'Salida' : 'Entrada';
    const sedeTxt = labelSede(ses.sede) + (ses.fueraDePlan ? ' · ⚠️ fuera de plan' : '');
    await notificarPorTipo('asistencia',
      `🕐 *${tipoTxt}* — ${ses.nombre}\n🏪 ${sedeTxt}\n🕐 ${hora} · 📍 ${geo}`,
      ses.colabId || '',
      { params: [tipoTxt, ses.nombre, sedeTxt, hora, geo] });
  } catch (e) { console.error('[avisos asistencia]', e.message); }
  return confirmacion(ses, res);
}

function compactSede(s) {
  return {
    idTienda: s.idTienda || s.id || '', sede: s.sede || '', tienda: s.tienda || '', cliente: s.cliente || '',
    latitud: s.latitud ?? null, longitud: s.longitud ?? null, radio: s.radio ?? null,
  };
}

// ¿Esta sede es una de las del plan del día? Por id, o por nombre si el bloque no trae `idTienda`
// (una "zona de trabajo" escrita a mano en el itinerario no lo tiene).
function esDelPlan(sede, plan) {
  const id = sede.idTienda || sede.id || '';
  const nom = norm(sede.sede || sede.tienda || '');
  return (plan || []).some((p) => {
    const pid = p.idTienda || p.id || '';
    if (id && pid && id === pid) return true;
    return !!nom && nom === norm(p.sede || p.tienda || '');
  });
}

// Elige la sede a partir de la ubicación compartida. LA UBICACIÓN REAL MANDA SOBRE EL PLAN:
//   1) ¿Está dentro del radio de una sede de su plan? → esa (el caso normal).
//   2) ¿No, pero está parado dentro de OTRA sede real? → esa, con bandera FUERA DE PLAN. Fue a una
//      tienda que no estaba en su itinerario, y la evidencia tiene que decir dónde estuvo de verdad.
//   3) ¿No está dentro de NINGUNA sede? → no se asume ninguna: se le pregunta (fase ELIGE_SEDE).
//
// El plan NO puede ganarle a la geo: antes se registraba "la sede del plan más cercana" sin mirar el
// radio, así que con un plan de una sola sede cualquier coordenada del planeta caía en ella (un
// técnico parado en Jockey Plaza quedó registrado en Comas, a 19,7 km — 2026-07-14).
async function resolverSedePorUbicacion(ses, d) {
  const plan = [];
  for (const sp of ses.planSedes || []) plan.push(await enriquecer(sp, d.tiendaPorId));
  const planConGeo = plan.filter((s) => s.latitud != null && s.longitud != null);

  // 1) Dentro de una sede de su plan.
  const enPlan = sedeQueContiene(ses.punto, planConGeo);
  if (enPlan) return { sede: enPlan.sede, fueraDePlan: false };

  // 2) Dentro de otra sede real (la realidad gana). `esDelPlan` evita marcar una bandera falsa
  //    cuando la sede sí era de su plan pero el bloque no traía coordenadas.
  const enOtra = sedeQueContiene(ses.punto, await d.tiendasConGeo());
  if (enOtra) return { sede: enOtra.sede, fueraDePlan: !esDelPlan(enOtra.sede, plan) };

  // 3) Su plan tiene UNA sola sede y no tiene coordenadas cargadas: no hay geo que contradiga al
  //    itinerario (esto es ausencia de dato, no una discrepancia) → se acepta la sede del plan.
  if (plan.length === 1 && !planConGeo.length) return { sede: plan[0], fueraDePlan: false };

  // 4) Ninguna sede lo contiene: NO se asume ninguna.
  const preambulo = plan.length
    ? 'Tu ubicación no cae dentro de ninguna sede'
    : 'No tienes sede asignada hoy en el itinerario y tu ubicación no cae dentro de ninguna sede';
  return { preguntar: true, mensaje: `${preambulo}. ¿En qué sede estás?\n${await listaSedesTxt(d)}` };
}

// Empareja un texto contra el maestro de sedes (por sede/tienda/cliente).
async function resolverSedePorNombre(texto, d) {
  const q = norm(texto);
  if (!q) return null;
  const tiendas = (await d.cargarTiendas()).filter((t) => t.activo);
  let mejor = null, mejorScore = 0;
  for (const t of tiendas) {
    const campos = [norm(t.sede), norm(t.tienda), norm(t.sede).replace(/^ripley\s+/, '')];
    let score = 0;
    for (const c of campos) {
      if (!c) continue;
      if (c === q) score = Math.max(score, 3);
      else if (c.includes(q) || q.includes(c)) score = Math.max(score, 2);
    }
    if (score > mejorScore) { mejorScore = score; mejor = t; }
  }
  return mejorScore >= 2 ? mejor : null;
}

async function listaSedesTxt(d, lista = null) {
  const sedes = lista || (await d.cargarTiendas()).filter((t) => t.activo);
  return sedes.slice(0, 15).map((s) => `• ${labelSede(s)}`).join('\n');
}

// ── Mensajes ──────────────────────────────────────────────────────────────────
const primerNombre = (tec) => (tec?.nombre || '').split(' ')[0] || '';
const tipoLabel = (tipo) => (tipo === 'SALIDA' ? 'salida' : 'entrada');

function pedirUbicacion(ses) {
  return `📍 Para registrar tu *${tipoLabel(ses.tipo)}*, compárteme tu *ubicación actual*:\n\n` +
    'Toca 📎 (o el +) → *Ubicación* → *Enviar mi ubicación actual*.\n\n_Escribe *cancelar* si te equivocaste._';
}

function pedirSelfie(ses) {
  const s = ses.sede ? ` en *${labelSede(ses.sede)}*` : '';
  return `📸 Ya tengo tu ubicación${s}. Ahora mándame una *selfie* (una foto tuya) para dejar constancia de tu *${tipoLabel(ses.tipo)}*.`;
}

function confirmacion(ses, res) {
  const u = ses.ubicacion || {};
  let geo;
  if (u.valida === false) geo = '📍 Sede sin coordenadas (no se pudo validar la distancia)';
  else if (u.dentro) geo = `📍 En la sede (${fmtDistancia(u.distancia)})`;
  else geo = `📍 A ${fmtDistancia(u.distancia)} de la sede · ⚠️ *fuera de radio*`;
  const hora = (ses.tipo === 'SALIDA' ? res.registro?.marcajeSalida?.hora : res.registro?.marcajeEntrada?.hora) || '';
  return `✅ *${ses.tipo === 'SALIDA' ? 'Salida' : 'Entrada'} registrada* — ${ses.nombre}\n` +
    `🏪 ${labelSede(ses.sede)}${ses.fueraDePlan ? ' · ⚠️ *fuera de plan*' : ''}\n` +
    `🕐 ${hora}\n${geo}\n📷 Selfie recibida\n\n` +
    (ses.tipo === 'ENTRADA' ? '¡Buen turno! Cuando termines, escríbeme *salida*.' : '¡Gracias! Que descanses. 👋');
}

function errorTipo(error, reg) {
  const ent = reg?.horaEntrada != null ? decimalAHHMM(reg.horaEntrada) : '';
  const sal = reg?.horaSalida != null ? decimalAHHMM(reg.horaSalida) : '';
  if (error === 'ya_completo') return `Hoy ya registraste *entrada* (${ent}) y *salida* (${sal}). No hay nada más que marcar. ✅`;
  if (error === 'ya_entrada') return `Ya tienes *entrada* registrada hoy (${ent}). Si terminaste, escríbeme *salida*.`;
  if (error === 'ya_salida') return `Ya registraste tu *salida* hoy (${sal}).`;
  if (error === 'sin_entrada') return 'Aún no tienes *entrada* registrada hoy, así que no puedo marcar salida. Marca tu *entrada* primero.';
  return 'No pude determinar si es entrada o salida. Escríbeme *entrada* o *salida*.';
}

function errorMarcaje(error, existing, tipo) {
  const ent = existing?.horaEntrada != null ? decimalAHHMM(existing.horaEntrada) : '';
  const sal = existing?.horaSalida != null ? decimalAHHMM(existing.horaSalida) : '';
  if (error === 'ya_entrada') return `Ya tienes *entrada* registrada hoy (${ent}).`;
  if (error === 'ya_salida') return `Ya registraste tu *salida* hoy (${sal}).`;
  if (error === 'sin_entrada') return 'No puedo marcar salida: aún no tienes *entrada* hoy.';
  if (error === 'salida_antes') return `La hora de salida no puede ser anterior a tu entrada (${ent}). Inténtalo de nuevo más tarde.`;
  return '⚠️ No pude registrar el marcaje ahora mismo. Inténtalo de nuevo en un momento.';
}
