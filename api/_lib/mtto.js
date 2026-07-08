// Flujo de REGISTRO DE ACTIVIDADES de mantenimiento preventivo por WhatsApp (Etapa 3).
// Escribe en el MISMO modelo que la app: doc `mantenimiento/{SEDE|PERIODO|AÑO}` con
// seleccionados/tareaStatus por índice, y fotos como docs de `mantenimiento_fotos`
// (1 doc por foto). La lista de actividades es la EFECTIVA del equipo:
// (plantilla tareas_config del tipo − quitadas) + agregadas de mtto_actividades_equipo.
import { getDb } from './firestore.js';
import { resolverEquipo } from './equipos.js';
import { hoyLima } from './fecha.js';
import { nuevaSesion, getSesion, guardarSesion, limpiarSesion } from './mtto_sesiones.js';

// ── Helpers puros (testeables) ────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// mantenimiento/mtto/preventivo — lookahead en vez de \b por las tildes del español
export const RE_MTTO = /(mantenimientos?|mtto\.?|preventiv[oa]s?)(?![a-z])/i;

// Intención de REGISTRO (no solo mencionar la palabra): exige verbo de registro o que el
// mensaje EMPIECE con la intención — "después del mantenimiento preventivo quedó con fuga"
// debe seguir yendo a observaciones (hallazgo del Council).
export function esIntencionMtto(texto) {
  const t = norm(texto);
  if (/registr\w*/.test(t) && /actividad/.test(t)) return true;   // "quiero registrar ... actividad(es)"
  if (!RE_MTTO.test(t)) return false;
  if (/(registr|hice|realic|complet|termin|marcar|actividades)/.test(t)) return true;
  return /^\s*(mantenimiento|mtto|preventiv)/.test(t);
}

// saludo/menú "en frío" (sin sesión): despliega las 3 opciones
export function esSaludo(texto) {
  return /^(hola|buenas(\s+(dias|tardes|noches))?|buenos\s+dias|menu|inicio|ayuda|hey)[\s!.,?]*$/.test(norm(texto).trim());
}

// Palabra de control SUELTA (sin conversación viva): "fin", "sí", "siguiente"… no deben
// caer a observaciones y abrir un borrador absurdo (pasó en la prueba en vivo) → menú.
export function esControlSuelto(texto) {
  return /^(si|no|ok|dale|fin|siguiente|listo|cancelar|salir|ya|gracias|confirmo)[\s!.,]*$/.test(norm(texto).trim());
}

export const MENU_TEXTO =
  '👋 ¡Hola! Soy el bot de MultiAire. ¿Qué necesitas?\n\n' +
  '1️⃣ *Registrar actividades* de mantenimiento\n' +
  '2️⃣ *Reportar una observación* de un equipo\n' +
  '3️⃣ *Marcar asistencia* (entrada/salida)\n\n' +
  'Responde con el número, o escríbeme directo (ej: "mantenimiento preventivo del chiller 1 de atocongo").';

// Período bimestral vigente en Lima (mismo esquema de la app de mantenimiento).
const PERIODOS = ['ENE-FEB', 'MAR-ABR', 'MAY-JUN', 'JUL-AGO', 'SEP-OCT', 'NOV-DIC'];
export function periodoLima(base = Date.now()) {
  const [anio, mes] = hoyLima(base).split('-').map(Number);
  return { periodo: PERIODOS[Math.floor((mes - 1) / 2)], anio };
}

// "1,3 y 5" / "todas" / "ninguna" → índices 0-based válidos (únicos, ordenados)
export function parseSeleccion(texto, n) {
  const t = norm(texto);
  if (/(^|\s)(todas?|todo)(\s|$)/.test(t)) return Array.from({ length: n }, (_, i) => i);
  if (/(^|\s)ningun[ao]?(\s|$)/.test(t)) return [];
  const nums = (t.match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= n);
  return [...new Set(nums)].sort((a, b) => a - b).map((x) => x - 1);
}

// Fusiona índices marcados sobre el tareaStatus previo del equipo (tolerante a formatos viejos).
export function mergeTareaStatus(prev, idxs) {
  const st = (prev && typeof prev === 'object') ? { ...prev } : {};
  idxs.forEach((i) => { st[i] = true; });
  return st;
}

function safeObj(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(val) || {}; } catch { return {}; }
}

// ¿El texto menciona una ACTIVIDAD ya definida? (plantillas por tipo + agregadas por
// equipo). Un técnico que escribe "lavado de serpentín de condensador del rooftop 5"
// está registrando una actividad, no reportando una observación — pedido del usuario.
// Solo nombres específicos (≥2 palabras y ≥10 chars): "Realizado" daría falsos positivos.
const _cacheNombres = { ts: 0, nombres: [] };
export async function esActividadConocida(texto) {
  const t = norm(texto);
  if (!t || t.length < 10) return false;
  if (Date.now() - _cacheNombres.ts > 5 * 60 * 1000) {
    const db = getDb();
    const [plSnap, ovSnap] = await Promise.all([
      db.collection('tareas_config').get(),
      db.collection('mtto_actividades_equipo').get(),
    ]);
    const set = new Set();
    plSnap.docs.forEach((d) => (d.data().tareas || []).forEach((x) => set.add(x)));
    ovSnap.docs.forEach((d) => ((d.data() || {}).agregadas || []).forEach((a) => set.add(a.nombre)));
    _cacheNombres.nombres = [...set].map(norm).filter((n) => n.length >= 10 && n.trim().split(/\s+/).length >= 2);
    _cacheNombres.ts = Date.now();
  }
  return _cacheNombres.nombres.some((n) => t.includes(n));
}

// Señales de INCIDENTE: si el texto huele a problema, es una observación — aunque
// mencione una actividad — salvo que traiga verbo explícito de registro (Council).
// (norm() convierte ñ→n y quita tildes: por eso "danad", "averi", "enfria".)
export const RE_PROBLEMA = /(fuga|falla|fallo|averi|no (funciona|enciende|prende|enfria|arranca)|ruido|gotea|goteo|alarma|problema|danad|malograd|roto|rota|quemad|humo|chispa|\bmal\b)/;

// Decisión final de intención de REGISTRO (la usa el router).
export async function esRegistroActividad(texto) {
  const t = norm(texto);
  const intencion = esIntencionMtto(texto) || await esActividadConocida(texto);
  if (!intencion) return false;
  if (!RE_PROBLEMA.test(t)) return true;
  return /(registr|hice|realic|complet|termin|marcar)/.test(t);   // problema + verbo explícito → registro igual
}

// ── Lista efectiva de actividades del equipo (Firestore, caché 5 min) ────────
// Resuelve actividades Y minutos en paralelo (mismo criterio que actividadesDe de la app:
// base − quitadas + agregadas; minutos por índice vigente, default 5) → los minutos alimentan
// los KPIs de carga (Etapa 3) cuando la actividad no venía planificada.
const _cacheActs = new Map();  // eqId → {ts, actividades, minutos}
async function _resolverActs(eqId, tipo) {
  const hit = _cacheActs.get(eqId);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit;
  const db = getDb();
  const [plSnap, ovSnap] = await Promise.all([
    db.collection('tareas_config').doc(String(tipo || '')).get(),
    db.collection('mtto_actividades_equipo').doc(String(eqId)).get(),
  ]);
  const pd = plSnap.exists ? plSnap.data() : {};
  const plantilla = pd.tareas || [], plMin = pd.minutos || [];
  const ov = ovSnap.exists ? ovSnap.data() : null;
  const quitadas = new Set(ov?.quitadas || []);
  const actividades = [], minutos = [];
  plantilla.forEach((t, i) => { if (!quitadas.has(t)) { actividades.push(t); minutos.push(Number(plMin[i]) || 5); } });
  (ov?.agregadas || []).forEach((a) => { actividades.push(a.nombre); minutos.push(Number(a.minutos) || 5); });
  const val = { ts: Date.now(), actividades, minutos };
  _cacheActs.set(eqId, val);
  return val;
}
export async function actividadesDeEquipo(eqId, tipo) {
  return (await _resolverActs(eqId, tipo)).actividades;
}
export async function minutosDeEquipo(eqId, tipo) {
  return (await _resolverActs(eqId, tipo)).minutos;
}

// ── Textos ────────────────────────────────────────────────────────────────────
function listaNumerada(acts) {
  return acts.map((t, i) => `${i + 1}. ${t}`).join('\n');
}
function pedirActividades(ses) {
  return `🔧 *${ses.nombreEq}* (${ses.eqId}) · ${ses.sede}\n\nActividades del equipo:\n${listaNumerada(ses.actividades)}\n\n¿Cuáles realizaste? Responde con los números (ej: *1, 3, 5*) o *todas*.`;
}
function resumenConfirma(ses) {
  const { periodo, anio } = periodoLima();
  const hechas = ses.marcadas.map((i) => `✅ ${ses.actividades[i]}`).join('\n');
  return `📋 *Confirma el registro*\n${ses.nombreEq} (${ses.eqId}) · ${ses.sede}\nPeríodo: ${periodo} ${anio}\n\n${hechas}\n\n¿Guardo? Responde *SÍ* para guardar, *NO* para corregir o *CANCELAR* para salir.`;
}
function pedirFotos(ses) {
  const idx = ses.marcadas[ses.fotoPos];
  return `📷 Fotos de *${ses.actividades[idx]}* (${ses.fotoPos + 1}/${ses.marcadas.length}): envía una o varias.\n· *SIGUIENTE* para pasar a la otra actividad\n· *FIN* para terminar`;
}

// ── Escritura ─────────────────────────────────────────────────────────────────
// Crédito de la ejecución: del PLAN si estaba planificada (retrocompat escalar↔array,
// cuadrilla incluida); si no había plan, al técnico que REPORTA (individual). Sin nombre → [].
export function ejecTecnicos(plan, tecnico) {
  if (plan) {
    // Con plan, la atribución sale SOLO del plan (aunque sea a nivel de bloque sin técnico → []),
    // coherente con la app; el reportante solo aplica cuando NO había plan.
    if (Array.isArray(plan.tecnicos) && plan.tecnicos.length) {
      const arr = plan.tecnicos.map((t) => ({ id: (t && t.id) || '', nombre: (t && t.nombre) || '' })).filter((t) => t.nombre);
      if (arr.length) return arr;
    }
    if (plan.tecnicoNombre) return [{ id: plan.tecnicoId || '', nombre: plan.tecnicoNombre }];
    return [];
  }
  if (tecnico && tecnico.nombre) return [{ id: tecnico.id || '', nombre: tecnico.nombre }];
  return [];
}
// Doc de mtto_ejecuciones (forma canónica; puro/testeable). minutos: del plan si estaba
// planificada, si no del array de la plantilla (default 5).
export function docEjecucion(ses, i, plan, tecnico, minutos, periodo, anio, fechaEjec) {
  const tecs = ejecTecnicos(plan, tecnico);
  return {
    eq_id: ses.eqId, nombreEq: ses.nombreEq, tipo: ses.tipo || '', area: ses.area || '',
    sede: ses.sede, periodo, anio,
    tareaIdx: i, tarea: ses.actividades[i] || `Actividad ${i + 1}`,
    minutos: (plan && plan.minutos != null) ? plan.minutos : (Number((minutos || [])[i]) || 5),
    tecnicoIds: tecs.map((t) => t.id), tecnicos: tecs, modo: tecs.length >= 2 ? 'grupo' : 'individual',
    planificada: !!plan,
    fechaEjec, registradoPor: tecnico?.nombre || ses.nombre || ses.from, origen: 'BOT', ts: new Date().toISOString(),
  };
}
async function guardarRegistro(ses, tecnico) {
  const { periodo, anio } = periodoLima();
  const clave = `${ses.sede}|${periodo}|${anio}`;
  const db = getDb();
  const ref = db.collection('mantenimiento').doc(clave);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const sel = safeObj(d.seleccionados);
    const ts = safeObj(d.tareaStatus);
    sel[ses.eqId] = true;
    ts[ses.eqId] = mergeTareaStatus(ts[ses.eqId], ses.marcadas);
    tx.set(ref, {
      clave, seleccionados: sel, tareaStatus: ts,
      updatedAt: new Date().toISOString(),
      updatedBy: `BOT · ${tecnico?.nombre || ses.nombre || ses.from}`,
    }, { merge: true });
  });
  // Registro persistente de lo EJECUTADO (mtto_ejecuciones) → base de los KPIs (Etapa 2) +
  // sincronización con el itinerario (lo ejecutado sale del plan). Por índice: LEER el plan
  // (atribución) → ESCRIBIR la ejecución → BORRAR el plan SOLO si la ejecución quedó registrada.
  // Si la escritura falla, se conserva el plan (atribución recuperable; el barrido del itinerario
  // es la red de seguridad). Ids determinísticos, idempotente. Nunca frustra el registro.
  try {
    const minutos = await minutosDeEquipo(ses.eqId, ses.tipo);
    const fechaEjec = hoyLima();
    await Promise.all(ses.marcadas.map(async (i) => {
      const ejecRef = db.collection('mtto_ejecuciones').doc(`${ses.eqId}|${periodo}|${anio}|${i}`);
      const planRef = db.collection('mtto_plan').doc(`${ses.eqId}|${periodo}|${anio}|${i}`);
      try {
        await db.runTransaction(async (tx) => {
          const [esEjec, esPlan] = await Promise.all([tx.get(ejecRef), tx.get(planRef)]);
          const plan = esPlan.exists ? esPlan.data() : null;
          // CREATE-IF-ABSENT: no sobrescribir una ejecución ya registrada (p.ej. por la app con la
          // atribución del plan) con una espontánea del reportante.
          if (!esEjec.exists) tx.set(ejecRef, docEjecucion(ses, i, plan, tecnico, minutos, periodo, anio, fechaEjec));
          if (plan) tx.delete(planRef);   // lo ejecutado sale del itinerario (atómico con el registro)
        });
      } catch (err) { console.error('[mtto_ejecuciones]', ses.eqId, periodo, anio, i, err.message); }
    }));
  } catch (e) { console.error('[mtto_ejecuciones]', e.message); }
  // Bitácora (tab Historial de la app): quién registró qué y cuándo
  await db.collection('mtto_log').add({
    ts: new Date().toISOString(),
    fecha: hoyLima(),
    autor: tecnico?.nombre || ses.nombre || ses.from,
    colabId: tecnico?.id || null,
    origen: 'BOT',
    sede: ses.sede, periodo, anio,
    eq_id: ses.eqId, nombreEq: ses.nombreEq,
    actividades: ses.marcadas.map((i) => ses.actividades[i]),
    done: true,
  }).catch(() => {});   // el log nunca debe frustrar el registro
  // Aviso a los designados (Personal → 🔔 Alertas del bot); nunca frustra el registro
  try {
    const { notificarPorTipo } = await import('./avisos.js');
    const autor = tecnico?.nombre || ses.nombre || ses.from;
    const acts = ses.marcadas.map((i) => ses.actividades[i]);
    await notificarPorTipo('mtto',
      `🔧 *Registro de mantenimiento* — ${autor}\n` +
      `❄️ ${ses.nombreEq} · 🏪 ${ses.sede} · 📅 ${periodo} ${anio}\n` +
      acts.map((a) => `✅ ${a}`).join('\n'),
      tecnico?.id || '',
      { params: [autor, ses.nombreEq, ses.sede, `${periodo} ${anio}`, acts.join(' · ')] });
  } catch (e) { console.error('[avisos mtto]', e.message); }
  return clave;
}

// nº de fotos de ESTA SESIÓN (docs con createdAt >= inicio de la sesión), inmune a la
// carrera de mensajes concurrentes. Sin el corte por sesión, el resumen final sumaba las
// fotos históricas del equipo en el período (12 en vez de 3 — reporte del usuario).
async function contarFotos(ses, tareaIdx) {
  const { periodo, anio } = periodoLima();
  let q = getDb().collection('mantenimiento_fotos')
    .where('clave', '==', `${ses.sede}|${periodo}|${anio}`)
    .where('eq_id', '==', ses.eqId);
  if (tareaIdx != null) q = q.where('tareaIdx', '==', tareaIdx);
  const snap = await q.select('createdAt').get();   // solo headers, no baja los base64
  const desde = ses.inicio || '';                    // sesiones viejas sin inicio: cuenta todo
  // normaliza por si un doc trajera Timestamp en vez de ISO string (defensa del Council;
  // hoy app y bot escriben toISOString())
  const iso = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : String(v || '');
  return snap.docs.filter((d) => iso(d.data().createdAt) >= desde).length;
}

async function guardarFoto(ses, tecnico, imagenB64, mime) {
  const { periodo, anio } = periodoLima();
  const idx = ses.marcadas[ses.fotoPos];
  await getDb().collection('mantenimiento_fotos').add({
    clave: `${ses.sede}|${periodo}|${anio}`,
    eq_id: ses.eqId,
    tareaIdx: idx,
    tarea: ses.actividades[idx] || '',
    foto: `data:${mime || 'image/jpeg'};base64,${imagenB64}`,
    createdAt: new Date().toISOString(),
    createdBy: `BOT · ${tecnico?.nombre || ses.nombre || ses.from}`,
  });
}

// ── Motor del flujo ───────────────────────────────────────────────────────────
// Devuelve el texto de respuesta (o null). El webhook lo envía.
export async function manejarMtto({ tecnico, from, texto, imagenB64, mime, onWriteStart }) {
  const t = norm(texto).trim();
  let ses = await getSesion(from);

  // CANCELAR en cualquier punto
  if (ses && /(^|\s)(cancelar|cancela|salir)(\s|$)/.test(t)) {
    await limpiarSesion(from);
    return '❌ Registro cancelado. Escríbeme cuando quieras retomarlo.';
  }

  // Sin sesión: arrancar — con el texto completo intentamos resolver el equipo de una
  if (!ses) {
    ses = nuevaSesion(from, tecnico);
    // No arrastrar el dígito del menú ("1") ni un saludo como texto del pedido: contaminan el
    // matching (el "1" mete un número falso → falso empate de equipo, p.ej. Roof Top 01 vs 03)
    // y no aportan datos. El primer mensaje REAL pasa a ser el textoOriginal en la fase EQUIPO.
    ses.textoOriginal = (t === '1' || esSaludo(texto)) ? '' : (texto || '');
    ses.fase = 'EQUIPO';
    if (texto && t !== '1' && !esSaludo(texto)) {
      const r = await intentarResolver(ses, texto);
      if (r) return r;
    }
    await guardarSesion(from, ses);
    return '🔧 *Registro de actividades de mantenimiento*\nDime el *equipo* y la *sede* (ej: "chiller 1 de atocongo").';
  }

  if (ses.fase === 'EQUIPO') {
    if (!texto) return 'Dime el *equipo* y la *sede* (ej: "chiller 1 de atocongo").';
    // Un saludo, una palabra de control ("fin"/"listo"/"ya"…) o un dígito de menú a mitad del
    // flujo NO son datos del equipo: reinician al menú en vez de acumularse como ruido (o meter
    // un número falso) y dejar al técnico atrapado repreguntando. "cancelar"/"salir" ya salieron arriba.
    if (esSaludo(texto) || esControlSuelto(texto) || t === '1' || t === '2' || t === '3') {
      await limpiarSesion(from);
      return MENU_TEXTO;
    }
    // Acumula lo que el técnico va diciendo: la 1ª frase suele traer la sede y la respuesta a
    // la repregunta el equipo (o al revés). Sin acumular, responder de a poco perdía lo ya
    // dicho (la sede desaparecía al contestar el equipo) → el bot repreguntaba en bucle.
    ses.textoOriginal = `${ses.textoOriginal || ''} ${texto}`.trim();
    const r = await intentarResolver(ses, ses.textoOriginal);
    if (r) return r;
    return null;
  }

  if (ses.fase === 'ACTIVIDADES') {
    if (imagenB64) return '📷 Esa foto guárdala un momento: primero dime *qué actividades realizaste* (números o *todas*) — las fotos te las pido al confirmar.';
    const idxs = parseSeleccion(texto || '', ses.actividades.length);
    if (!idxs.length) return `No te entendí. Responde con los números de las actividades realizadas (ej: *1, 3*) o *todas*.\n\n${listaNumerada(ses.actividades)}`;
    ses.marcadas = idxs;
    ses.fase = 'CONFIRMA';
    await guardarSesion(from, ses);
    return resumenConfirma(ses);
  }

  if (ses.fase === 'CONFIRMA') {
    if (imagenB64) return '📷 Esa foto te la pido después de confirmar. Responde *SÍ* para guardar el registro — las fotos vienen al toque.';
    if (/^(si|sí|s|ok|dale|confirmo|confirmar)[\s!.]*$/.test(t)) {
      if (onWriteStart) onWriteStart();   // idempotencia: de aquí en adelante no reprocesar
      await guardarRegistro(ses, tecnico);
      ses.fase = 'FOTOS';
      ses.fotoPos = 0;
      await guardarSesion(from, ses);
      return `✅ *Registro guardado.*\n\n${pedirFotos(ses)}`;
    }
    if (/^(no|n)[\s!.]*$/.test(t)) {
      ses.fase = 'ACTIVIDADES';
      ses.marcadas = [];
      await guardarSesion(from, ses);
      return `Ok, corrijamos.\n\n${pedirActividades(ses)}`;
    }
    return 'Responde *SÍ* para guardar, *NO* para corregir la selección o *CANCELAR* para salir.';
  }

  if (ses.fase === 'FOTOS') {
    if (imagenB64) {
      if (imagenB64.length > 900 * 1024) {   // margen bajo el límite de 1MB por doc (convención del bot)
        return '📷 Esa foto es muy pesada para guardarla. Reenvíala como *foto normal* (no como documento/HD).';
      }
      if (onWriteStart) onWriteStart();   // idempotencia: la foto se escribe una sola vez
      await guardarFoto(ses, tecnico, imagenB64, mime);
      const n = await contarFotos(ses, ses.marcadas[ses.fotoPos]);
      return `📷 Foto ${n} guardada para *${ses.actividades[ses.marcadas[ses.fotoPos]]}*. Envía otra, *SIGUIENTE* o *FIN*.`;
    }
    if (/(^|\s)(siguiente|listo|next)(\s|$)/.test(t)) {
      ses.fotoPos += 1;
      if (ses.fotoPos >= ses.marcadas.length) {
        const n = await contarFotos(ses, null);
        await limpiarSesion(from);
        return `🏁 *Registro completo* — ${ses.marcadas.length} actividad(es), ${n} foto(s). ¡Gracias!`;
      }
      await guardarSesion(from, ses);
      return pedirFotos(ses);
    }
    if (/(^|\s)(fin|terminar|termine|ya)(\s|$)/.test(t)) {
      const n = await contarFotos(ses, null);
      await limpiarSesion(from);
      return `🏁 *Registro completo* — ${ses.marcadas.length} actividad(es), ${n} foto(s). ¡Gracias!`;
    }
    // El registro anterior YA está guardado: un saludo o una NUEVA intención de registro
    // no deben quedar atrapados pidiendo fotos (pasó en la prueba en vivo).
    if (texto && esSaludo(texto)) {
      const n = await contarFotos(ses, null);
      await limpiarSesion(from);
      return `🏁 Cerré el registro de *${ses.nombreEq}* (${n} foto(s)).\n\n${MENU_TEXTO}`;
    }
    if (texto && await esRegistroActividad(texto)) {
      const n = await contarFotos(ses, null);
      const cierre = `🏁 Cerré el registro de *${ses.nombreEq}* (${n} foto(s)).`;
      await limpiarSesion(from);
      const resp = await manejarMtto({ tecnico, from, texto, imagenB64: null, mime: null, onWriteStart });
      return `${cierre}\n\n${resp || ''}`;
    }
    return `Envía una foto, *SIGUIENTE* para pasar de actividad o *FIN* para terminar. (Registro en curso: *${ses.nombreEq}*)`;
  }

  await limpiarSesion(from);   // fase desconocida: reset defensivo
  return MENU_TEXTO;
}

// Intenta resolver el equipo con el texto; si queda resuelto, avanza a ACTIVIDADES.
// Devuelve el texto de respuesta al técnico.
async function intentarResolver(ses, texto) {
  const r = await resolverEquipo(texto, texto, texto);
  if (!r.ok) {
    await guardarSesion(ses.from, ses);
    if (r.motivo === 'sede') return `¿De qué *sede* es el equipo? ${r.candidatosSede?.length ? 'Ej: ' + r.candidatosSede.slice(0, 5).join(', ') : ''}`;
    if (r.motivo === 'cliente') return `Esa sede existe para varios clientes (${(r.candidatosCliente || []).join(', ')}). ¿De cuál es?`;
    return `¿Qué *equipo* es? ${r.candidatosEquipo?.length ? 'Opciones: ' + r.candidatosEquipo.slice(0, 6).map((e) => e.nombre).join(' · ') : 'Dime el nombre como figura en el inventario.'}`;
  }
  const acts = await actividadesDeEquipo(r.equipo.eqId, r.equipo.tipo);
  if (!acts.length) {
    await limpiarSesion(ses.from);
    return `⚠️ El equipo *${r.equipo.nombre}* (${r.equipo.eqId}) no tiene actividades configuradas. Pídele al administrador que las configure en la app de Mantenimiento.`;
  }
  ses.sede = r.sede;
  ses.eqId = r.equipo.eqId;
  ses.tipo = r.equipo.tipo;
  ses.area = r.equipo.area || '';
  ses.nombreEq = r.equipo.nombre;
  ses.actividades = acts;
  // ¿El mensaje ya menciona actividades de la lista? → pre-marcarlas y saltar a confirmar
  const tOrig = norm(ses.textoOriginal || '');
  const pre = [];
  acts.forEach((a, i) => {
    const n = norm(a);
    if (n.length >= 10 && n.trim().split(/\s+/).length >= 2 && tOrig.includes(n)) pre.push(i);
  });
  if (pre.length) {
    ses.marcadas = pre;
    ses.fase = 'CONFIRMA';
    await guardarSesion(ses.from, ses);
    return `🔎 Detecté ${pre.length} actividad(es) en tu mensaje.\n\n${resumenConfirma(ses)}`;
  }
  ses.fase = 'ACTIVIDADES';
  await guardarSesion(ses.from, ses);
  return pedirActividades(ses);
}
