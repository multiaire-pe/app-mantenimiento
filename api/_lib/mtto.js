// Flujo de REGISTRO DE ACTIVIDADES de mantenimiento preventivo por WhatsApp (Etapa 3).
// Escribe en el MISMO modelo que la app: doc `mantenimiento/{SEDE|PERIODO|AÑO}` con
// seleccionados/tareaStatus por NOMBRE de actividad, y fotos como docs de `mantenimiento_fotos`
// (1 doc por foto). La lista de actividades es la EFECTIVA del equipo:
// (plantilla tareas_config del tipo − quitadas) + agregadas de mtto_actividades_equipo.
import { getDb } from './firestore.js';
import { resolverEquipo, etiquetaEquipo, opcionesEquipo, elegirRescate } from './equipos.js';
import { corregirSedeEquipo } from './gemini.js';
import { contextoInventario } from './inventario.js';
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
  // "realizado <equipo> de <sede>": hay actividades que se llaman literalmente "Realizado"
  // (esActividadConocida las excluye a propósito por cortas) y el técnico reporta así. Un
  // mensaje que EMPIEZA con "realizado/a" es un registro — misma filosofía "empieza con la
  // intención" de la última regla; la guarda RE_PROBLEMA sigue aplicando después.
  if (/^\s*realizad[oa]s?\b/.test(t)) return true;
  if (!RE_MTTO.test(t)) return false;
  if (/(registr|hice|realic|realizad|complet|termin|marcar|actividades)/.test(t)) return true;
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

// Doc-id de mtto_plan / mtto_ejecuciones: la actividad se identifica por NOMBRE, no por posición
// (quitar una actividad de la lista ya no corre a las siguientes). `/` parte el path de Firestore y
// `|` es el separador de la clave → se escapan de forma INYECTIVA (`%` primero): "Lavado a/c" y
// "Lavado a-c" son actividades distintas y no pueden colapsar en el mismo doc. Misma convención que la app.
export const actKey = (t) => String(t ?? '').replace(/[%|/]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const docTarea = (eqId, periodo, anio, tarea) => `${eqId}|${periodo}|${anio}|${actKey(tarea)}`;

// Fusiona las actividades hechas (por NOMBRE) sobre el tareaStatus previo del equipo.
// `prev === true` ("solo marcar") arranca limpio: ese estado es de un equipo SIN actividades, y si el
// bot le mostró una lista es que sí las tiene — dejarlo en `true` diría "todo hecho" habiendo hecho
// solo algunas. Las claves numéricas de los datos viejos se conservan: no estorban.
export function mergeTareaStatus(prev, nombres) {
  const st = (prev && typeof prev === 'object') ? { ...prev } : {};
  (nombres || []).forEach((n) => { if (n) st[n] = true; });
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
    const [plSnap, ovSnap, perSnap] = await Promise.all([
      db.collection('tareas_config').get(),
      db.collection('mtto_actividades_equipo').get(),
      db.collection('mtto_actividades_periodo').get(),
    ]);
    const set = new Set();
    // Todos los nombres de actividad que existan en cualquier capa (plantillas de todos los
    // clientes + lo agregado por período + lo agregado por equipo). Es un Set de NOMBRES para
    // detectar INTENCIÓN de registro, no un map por tipo → no importa de dónde venga cada nombre.
    plSnap.docs.forEach((d) => (d.data().tareas || []).forEach((x) => set.add(x)));
    ovSnap.docs.forEach((d) => ((d.data() || {}).agregadas || []).forEach((a) => set.add(a.nombre)));
    perSnap.docs.forEach((d) => ((d.data() || {}).agregadas || []).forEach((a) => set.add(a.nombre)));
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

// ── Lista efectiva de actividades del equipo ─────────────────────────────────
// TRES capas, de lo general a lo particular. Cada una puede QUITAR de lo que heredó y AGREGAR lo
// suyo; se aplican en orden, así que la más específica siempre puede corregir a la anterior:
//
//   ① plantilla del CLIENTE      tareas_config/{cliente|tipo}          (su licitación)
//   ② ajuste del PERÍODO         mtto_actividades_periodo/{sede|periodo|anio|tipo}
//                                 ("este bimestre, a las cortinas de Atocongo además X")
//   ③ ajuste del EQUIPO          mtto_actividades_equipo/{eq_id}       (permanente, ese equipo)
//
// ③ opera sobre el resultado de ②, así que un equipo puede quitarse una actividad que agregó el
// período. Devuelve arrays PARALELOS tareas/minutos (el índice solo empareja una tarea con sus
// minutos: el estado del checklist se guarda por NOMBRE, no por posición).
export function componerActividades(base, minBase, ajuste) {
  const quit = new Set((ajuste && ajuste.quitadas) || []);
  const tareas = [], minutos = [];
  (base || []).forEach((t, i) => { if (!quit.has(t)) { tareas.push(t); minutos.push(Number((minBase || [])[i]) || 5); } });
  ((ajuste && ajuste.agregadas) || []).forEach((a) => { tareas.push(a.nombre); minutos.push(Number(a.minutos) || 5); });
  return { tareas, minutos };
}

const _cacheActs = new Map();
// La clave lleva TODO lo que determina el resultado (no solo el eqId): dos llamadas para el mismo
// equipo con distinta sede/tipo/cliente —o una sin sede y otra con sede— resuelven capas distintas,
// y con una clave incompleta la segunda se comería la caché de la primera.
async function _resolverActs(eqId, tipo, cliente, sede, fresco) {
  const { periodo, anio } = periodoLima();
  const ck = `${eqId}|${sede || ''}|${tipo || ''}|${cliente || ''}|${periodo}|${anio}`;
  const hit = _cacheActs.get(ck);
  if (!fresco && hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit;
  const db = getDb();
  // ① La plantilla vive SOLO en el cliente. Sin fallback a una plantilla global — las actividades
  // salen de la licitación de cada cliente. Un equipo sin cliente, o de un cliente al que aún no le
  // configuraron el tipo, se queda SIN actividades y el caller lo dice explícito (mejor que
  // registrar contra una lista que no es la que el cliente contrató).
  const clavePl = cliente ? `${cliente}|${tipo}` : '';
  const clavePer = (sede && tipo) ? `${sede}|${periodo}|${anio}|${tipo}` : '';
  const [plSnap, perSnap, eqSnap] = await Promise.all([
    clavePl ? db.collection('tareas_config').doc(clavePl).get() : Promise.resolve(null),
    clavePer ? db.collection('mtto_actividades_periodo').doc(clavePer).get() : Promise.resolve(null),
    db.collection('mtto_actividades_equipo').doc(String(eqId)).get(),
  ]);
  const c2 = componerCapas(
    (plSnap && plSnap.exists) ? plSnap.data() : null,   // ① plantilla del cliente
    (perSnap && perSnap.exists) ? perSnap.data() : null, // ② vence con el período
    eqSnap.exists ? eqSnap.data() : null,                // ③ permanente
  );

  const val = { ts: Date.now(), actividades: c2.tareas, minutos: c2.minutos };
  _cacheActs.set(ck, val);
  return val;
}

// Las 3 capas, desde los docs crudos. Se usa tanto en el resolver (con caché) como DENTRO de la
// transacción del registro, que necesita resolver la lista sin pasar por ninguna caché.
export function componerCapas(pl, per, eq) {
  const c1 = componerActividades((pl && pl.tareas) || [], (pl && pl.minutos) || [], per);
  return componerActividades(c1.tareas, c1.minutos, eq);
}
export async function actividadesDeEquipo(eqId, tipo, cliente, sede, fresco) {
  return (await _resolverActs(eqId, tipo, cliente, sede, fresco)).actividades;
}

// El técnico eligió actividades por NOMBRE (las leyó en la lista que el bot le mostró); el número es
// solo cómo las señaló. Si entre que el bot mostró la lista y el técnico confirmó un admin la cambió
// desde la app —y el bot la cachea 5 minutos, así que puede mostrarla desactualizada un buen rato—,
// esos números apuntarían a OTRA actividad. Por eso los números se traducen a nombres contra la lista
// que el técnico VIO, y se contrastan con una lectura FRESCA justo antes de escribir.
// Devuelve { nombres:[los que siguen vigentes], perdidas:[los que ya no están en la lista] }.
// `ambiguo:true` = la lista tiene dos actividades con el MISMO nombre. El nombre deja de identificar
// una actividad, así que marcarla por nombre las marcaría a las dos: se registraría una que el técnico
// no hizo. No se adivina — el caller no escribe y avisa. La app bloquea los nombres duplicados al
// guardar un ajuste, pero la plantilla del cliente (que se edita en la app de Clientes, o entra por
// importación) todavía podría traerlos.
export function nombresMarcados(marcadas, actividadesVistas, actividadesVigentes) {
  const dup = (l) => (l || []).some((n, i) => l.indexOf(n) !== i);
  if (dup(actividadesVistas) || dup(actividadesVigentes)) {
    return { nombres: [], perdidas: [], ambiguo: true };
  }
  const nombres = [], perdidas = [];
  (marcadas || []).forEach((i) => {
    const nombre = (actividadesVistas || [])[i];
    if (nombre == null) return;
    if (!(actividadesVigentes || []).includes(nombre)) perdidas.push(nombre);
    else if (!nombres.includes(nombre)) nombres.push(nombre);
  });
  return { nombres, perdidas };
}
export async function minutosDeEquipo(eqId, tipo, cliente, sede) {
  return (await _resolverActs(eqId, tipo, cliente, sede)).minutos;
}

// ── Textos ────────────────────────────────────────────────────────────────────
function listaNumerada(acts) {
  return acts.map((t, i) => `${i + 1}. ${t}`).join('\n');
}
function pedirActividades(ses) {
  return `🔧 *${etiquetaEquipo(ses)}*\n🏪 ${ses.sede} · 🔖 ${ses.eqId}\n\nActividades del equipo:\n${listaNumerada(ses.actividades)}\n\n¿Cuáles realizaste? Responde con los números (ej: *1, 3, 5*) o *todas*.\n_(si ese NO es el equipo, escribe *cancelar*)_`;
}
function resumenConfirma(ses) {
  const { periodo, anio } = periodoLima();
  const hechas = ses.marcadas.map((i) => `✅ ${ses.actividades[i]}`).join('\n');
  return `📋 *Confirma el registro*\n❄️ ${etiquetaEquipo(ses)}\n🏪 ${ses.sede} · 🔖 ${ses.eqId}\nPeríodo: ${periodo} ${anio}\n\n${hechas}\n\n¿Guardo? Responde *SÍ* para guardar, *NO* para corregir o *CANCELAR* para salir.`;
}
// En la fase FOTOS ya se registró: se recorren las actividades REGISTRADAS (`ses.hechas`, por nombre).
function pedirFotos(ses) {
  const tarea = (ses.hechas || [])[ses.fotoPos];
  return `📷 Fotos de *${tarea}* (${ses.fotoPos + 1}/${(ses.hechas || []).length}): envía una o varias.\n· *SIGUIENTE* para pasar a la otra actividad\n· *FIN* para terminar`;
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
// planificada, si no del array de la plantilla (default 5) — `vigentes` da la posición del minuto.
export function docEjecucion(ses, tarea, plan, tecnico, vigentes, minutos, periodo, anio, fechaEjec) {
  const tecs = ejecTecnicos(plan, tecnico);
  const i = (vigentes || []).indexOf(tarea);
  return {
    eq_id: ses.eqId, nombreEq: ses.nombreEq, tipo: ses.tipo || '', area: ses.area || '',
    sede: ses.sede, periodo, anio,
    tarea,
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

  // El técnico eligió por NOMBRE (leyó la lista); los números solo señalan. Si un admin cambió la
  // lista mientras él respondía —y el bot la cachea 5 min, así que puede mostrarla vieja un buen
  // rato—, hay que saber qué nombres siguen vigentes. Por eso la lista se resuelve DENTRO de la
  // transacción (las 3 capas, sin caché): si un admin toca una capa en el medio, Firestore ve el
  // cambio, reintenta, y se vuelve a resolver.
  const clavePl  = ses.cliente ? `${ses.cliente}|${ses.tipo}` : '';
  const clavePer = (ses.sede && ses.tipo) ? `${ses.sede}|${periodo}|${anio}|${ses.tipo}` : '';
  let vigentes = [], minutos = [], hechas = [], perdidas = [], ambiguo = false;

  await db.runTransaction(async (tx) => {
    // TODAS las lecturas antes de las escrituras
    const [snap, plSnap, perSnap, eqSnap] = await Promise.all([
      tx.get(ref),
      clavePl  ? tx.get(db.collection('tareas_config').doc(clavePl)) : Promise.resolve(null),
      clavePer ? tx.get(db.collection('mtto_actividades_periodo').doc(clavePer)) : Promise.resolve(null),
      tx.get(db.collection('mtto_actividades_equipo').doc(String(ses.eqId))),
    ]);
    const c = componerCapas(
      (plSnap && plSnap.exists) ? plSnap.data() : null,
      (perSnap && perSnap.exists) ? perSnap.data() : null,
      eqSnap.exists ? eqSnap.data() : null,
    );
    vigentes = c.tareas; minutos = c.minutos;

    const r = nombresMarcados(ses.marcadas, ses.actividades, vigentes);
    hechas = r.nombres; perdidas = r.perdidas; ambiguo = !!r.ambiguo;
    if (ambiguo) return;          // nombres duplicados: marcar por nombre marcaría las dos
    if (!hechas.length) return;   // nada de lo que marcó sigue vigente: no se inventa un registro

    const d = snap.exists ? snap.data() : {};
    const sel = safeObj(d.seleccionados);
    const ts = safeObj(d.tareaStatus);
    sel[ses.eqId] = true;
    ts[ses.eqId] = mergeTareaStatus(ts[ses.eqId], hechas);
    tx.set(ref, {
      clave, seleccionados: sel, tareaStatus: ts,
      updatedAt: new Date().toISOString(),
      updatedBy: `BOT · ${tecnico?.nombre || ses.nombre || ses.from}`,
    }, { merge: true });
  });

  if (ambiguo) {
    console.error('[mtto] lista con nombres DUPLICADOS, no se registra:', ses.eqId, vigentes.join(' · '));
    return { clave, sinRegistrar: true, ambiguo: true, perdidas: [] };
  }
  if (perdidas.length) {
    console.warn('[mtto] actividades ya no vigentes al confirmar:', ses.eqId, perdidas.join(' · '));
  }
  if (!hechas.length) return { clave, sinRegistrar: true, perdidas };

  // La sesión adopta la lista VIGENTE y las actividades REGISTRADAS (por nombre): así todo lo que
  // sigue (ejecuciones, bitácora, avisos y la fase de fotos) trabaja sobre lo que de verdad se escribió.
  ses.actividades = vigentes;
  ses.hechas = hechas;
  // Registro persistente de lo EJECUTADO (mtto_ejecuciones) → base de los KPIs (Etapa 2) +
  // sincronización con el itinerario (lo ejecutado sale del plan). Por actividad: LEER el plan
  // (atribución) → ESCRIBIR la ejecución → BORRAR el plan SOLO si la ejecución quedó registrada.
  // Si la escritura falla, se conserva el plan (atribución recuperable; el barrido del itinerario
  // es la red de seguridad). Ids determinísticos, idempotente. Nunca frustra el registro.
  try {
    // los minutos salen de la MISMA resolución que fijó la lista (dentro de la transacción):
    // releerlos acá podría traer otra lista y desalinear minutos ↔ actividad.
    const fechaEjec = hoyLima();
    // El plan se busca por sus CAMPOS, no por el doc-id: los docs anteriores a la migración todavía
    // tienen el id terminado en índice (`…|2`) y buscarlos por nombre no los encontraría — se
    // registraría la ejecución SIN la atribución del técnico asignado, y el plan quedaría fantasma.
    // Una sola query por equipo+período (4 igualdades → sin índice compuesto).
    const planPorTarea = new Map();
    let ps = null;
    for (let intento = 0; intento < 2 && !ps; intento++) {
      try {
        ps = await db.collection('mtto_plan')
          .where('eq_id', '==', ses.eqId).where('periodo', '==', periodo).where('anio', '==', anio).get();
      } catch (err) {
        if (intento === 1) {
          // Sin saber si había plan, escribir la ejecución la marcaría como espontánea y sin técnico —y
          // encima el barrido del itinerario, al ver que la ejecución ya existe, borraría el plan sin
          // copiarle la atribución: el crédito del técnico se perdería para siempre. Mejor no escribir
          // nada: el registro en `mantenimiento` ya se guardó, y el plan sigue vivo para que el barrido
          // lo convierta CON su atribución.
          console.error('[mtto_plan lookup] no se registra la ejecución para no perder la atribución:', ses.eqId, err.message);
          throw err;
        }
        await new Promise((r) => setTimeout(r, 800));   // fallo transitorio de red: un reintento
      }
    }
    ps.docs.forEach((d) => { const r = d.data(); if (r.tarea) planPorTarea.set(r.tarea, d.id); });

    await Promise.all(hechas.map(async (tarea) => {
      const ejecRef = db.collection('mtto_ejecuciones').doc(docTarea(ses.eqId, periodo, anio, tarea));
      const planRef = db.collection('mtto_plan').doc(planPorTarea.get(tarea) || docTarea(ses.eqId, periodo, anio, tarea));
      try {
        await db.runTransaction(async (tx) => {
          const [esEjec, esPlan] = await Promise.all([tx.get(ejecRef), tx.get(planRef)]);
          const plan = esPlan.exists ? esPlan.data() : null;
          // CREATE-IF-ABSENT: no sobrescribir una ejecución ya registrada (p.ej. por la app con la
          // atribución del plan) con una espontánea del reportante.
          if (!esEjec.exists) tx.set(ejecRef, docEjecucion(ses, tarea, plan, tecnico, vigentes, minutos, periodo, anio, fechaEjec));
          if (plan) tx.delete(planRef);   // lo ejecutado sale del itinerario (atómico con el registro)
        });
      } catch (err) { console.error('[mtto_ejecuciones]', ses.eqId, periodo, anio, tarea, err.message); }
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
    actividades: hechas,
    done: true,
  }).catch(() => {});   // el log nunca debe frustrar el registro
  // Aviso a los designados (Personal → 🔔 Alertas del bot); nunca frustra el registro
  try {
    const { notificarPorTipo } = await import('./avisos.js');
    const autor = tecnico?.nombre || ses.nombre || ses.from;
    const acts = hechas;
    await notificarPorTipo('mtto',
      `🔧 *Registro de mantenimiento* — ${autor}\n` +
      `❄️ ${etiquetaEquipo(ses)} · 🏪 ${ses.sede} · 📅 ${periodo} ${anio}\n` +
      acts.map((a) => `✅ ${a}`).join('\n'),
      tecnico?.id || '',
      // En los params de la PLANTILLA de Meta el equipo va con su ubicación pero SIN emoji: un
      // carácter inesperado puede hacer que Meta rechace el envío (y caeríamos a texto libre).
      { params: [autor, ses.area ? `${ses.nombreEq} (${ses.area})` : ses.nombreEq, ses.sede, `${periodo} ${anio}`, acts.join(' · ')] });
  } catch (e) { console.error('[avisos mtto]', e.message); }
  return { clave, perdidas };
}

// nº de fotos de ESTA SESIÓN (docs con createdAt >= inicio de la sesión), inmune a la
// carrera de mensajes concurrentes. Sin el corte por sesión, el resumen final sumaba las
// fotos históricas del equipo en el período (12 en vez de 3 — reporte del usuario).
async function contarFotos(ses, tarea) {
  const { periodo, anio } = periodoLima();
  let q = getDb().collection('mantenimiento_fotos')
    .where('clave', '==', `${ses.sede}|${periodo}|${anio}`)
    .where('eq_id', '==', ses.eqId);
  if (tarea != null) q = q.where('tarea', '==', tarea);
  const snap = await q.select('createdAt').get();   // solo headers, no baja los base64
  const desde = ses.inicio || '';                    // sesiones viejas sin inicio: cuenta todo
  // normaliza por si un doc trajera Timestamp en vez de ISO string (defensa del Council;
  // hoy app y bot escriben toISOString())
  const iso = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : String(v || '');
  return snap.docs.filter((d) => iso(d.data().createdAt) >= desde).length;
}

async function guardarFoto(ses, tecnico, imagenB64, mime) {
  const { periodo, anio } = periodoLima();
  await getDb().collection('mantenimiento_fotos').add({
    clave: `${ses.sede}|${periodo}|${anio}`,
    eq_id: ses.eqId,
    tarea: (ses.hechas || [])[ses.fotoPos] || '',
    foto: `data:${mime || 'image/jpeg'};base64,${imagenB64}`,
    createdAt: new Date().toISOString(),
    createdBy: `BOT · ${tecnico?.nombre || ses.nombre || ses.from}`,
  });
}

// ── Motor del flujo ───────────────────────────────────────────────────────────
// Devuelve el texto de respuesta (o null). El webhook lo envía.
// `corregir` (Gemini) se inyecta para poder testear sin llamar a la API real — mismo patrón
// que `analizar` en conversacion.js.
export async function manejarMtto({ tecnico, from, texto, imagenB64, mime, onWriteStart, corregir = corregirSedeEquipo }) {
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
      const r = await intentarResolver(ses, texto, corregir);
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
    // Si le acabamos de preguntar la SEDE (porque lo que dijo era ambiguo entre dos sedes
    // reales), su respuesta ES la sede y va aparte — NO se acumula. Acumularla volvería a meter
    // el texto ambiguo original ("m plaza norte") en el matcher, que volvería a preguntar lo
    // mismo: bucle, y de los que solo se salen con "cancelar".
    if (ses.pidiendoSede) {
      const r = await intentarResolver(ses, ses.textoOriginal || texto, corregir, texto);
      if (r) return r;
      return null;
    }
    // Acumula lo que el técnico va diciendo: la 1ª frase suele traer la sede y la respuesta a
    // la repregunta el equipo (o al revés). Sin acumular, responder de a poco perdía lo ya
    // dicho (la sede desaparecía al contestar el equipo) → el bot repreguntaba en bucle.
    ses.textoOriginal = `${ses.textoOriginal || ''} ${texto}`.trim();
    const r = await intentarResolver(ses, ses.textoOriginal, corregir, null, texto);
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
      const res = await guardarRegistro(ses, tecnico);
      if (res.ambiguo) {
        // La lista tiene dos actividades con el mismo nombre: marcar una marcaría las dos.
        await limpiarSesion(from);
        return '⚠️ Este equipo tiene dos actividades con el MISMO nombre en su lista, así que no puedo saber cuál marcaste. Avisale a un administrador para que las diferencie en la app de Clientes.';
      }
      // La lista pudo cambiar desde la app mientras el técnico respondía (ver guardarRegistro).
      if (res.sinRegistrar) {
        ses.fase = 'ACTIVIDADES';
        ses.marcadas = [];
        ses.actividades = await actividadesDeEquipo(ses.eqId, ses.tipo, ses.cliente, ses.sede, true);
        await guardarSesion(from, ses);
        return `⚠️ Las actividades que marcaste ya no están en la lista de este equipo (la cambiaron desde la app). Esta es la lista al día:\n\n${pedirActividades(ses)}`;
      }
      ses.fase = 'FOTOS';
      ses.fotoPos = 0;
      await guardarSesion(from, ses);
      const aviso = (res.perdidas && res.perdidas.length)
        ? `\n⚠️ No registré ${res.perdidas.map((p) => `"${p}"`).join(', ')}: ya no está(n) en la lista de este equipo.`
        : '';
      return `✅ *Registro guardado.*${aviso}\n\n${pedirFotos(ses)}`;
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
      const tarea = (ses.hechas || [])[ses.fotoPos];
      const n = await contarFotos(ses, tarea);
      return `📷 Foto ${n} guardada para *${tarea}*. Envía otra, *SIGUIENTE* o *FIN*.`;
    }
    if (/(^|\s)(siguiente|listo|next)(\s|$)/.test(t)) {
      ses.fotoPos += 1;
      if (ses.fotoPos >= (ses.hechas || []).length) {
        const n = await contarFotos(ses, null);
        await limpiarSesion(from);
        return `🏁 *Registro completo* — ${(ses.hechas || []).length} actividad(es), ${n} foto(s). ¡Gracias!`;
      }
      await guardarSesion(from, ses);
      return pedirFotos(ses);
    }
    if (/(^|\s)(fin|terminar|termine|ya)(\s|$)/.test(t)) {
      const n = await contarFotos(ses, null);
      await limpiarSesion(from);
      return `🏁 *Registro completo* — ${(ses.hechas || []).length} actividad(es), ${n} foto(s). ¡Gracias!`;
    }
    // El registro anterior YA está guardado: un saludo o una NUEVA intención de registro
    // no deben quedar atrapados pidiendo fotos (pasó en la prueba en vivo).
    if (texto && esSaludo(texto)) {
      const n = await contarFotos(ses, null);
      await limpiarSesion(from);
      return `🏁 Cerré el registro de *${etiquetaEquipo(ses)}* (${n} foto(s)).\n\n${MENU_TEXTO}`;
    }
    if (texto && await esRegistroActividad(texto)) {
      const n = await contarFotos(ses, null);
      const cierre = `🏁 Cerré el registro de *${etiquetaEquipo(ses)}* (${n} foto(s)).`;
      await limpiarSesion(from);
      const resp = await manejarMtto({ tecnico, from, texto, imagenB64: null, mime: null, onWriteStart });
      return `${cierre}\n\n${resp || ''}`;
    }
    return `Envía una foto, *SIGUIENTE* para pasar de actividad o *FIN* para terminar. (Registro en curso: *${etiquetaEquipo(ses)}*)`;
  }

  await limpiarSesion(from);   // fase desconocida: reset defensivo
  return MENU_TEXTO;
}

// Aplica la corrección de Gemini sobre el texto crudo: si identificó sede/equipo, se usan
// (ya corregidos); si no (no los detectó, o Gemini falló y `g` llega null), cae al texto tal
// cual — mismo comportamiento que antes de este fix, cero regresión. Pura/testeable.
export function aplicarCorreccion(texto, g) {
  return {
    sedeTxt: (g && g.sede) ? g.sede : texto,
    equipoTxt: (g && g.equipo) ? g.equipo : texto,
  };
}

// Intenta resolver el equipo con el texto; si queda resuelto, avanza a ACTIVIDADES.
// Devuelve el texto de respuesta al técnico.
// `sedeRespuesta` = el técnico está contestando "¿de qué sede?" tras una ambigüedad. Su
// respuesta ES la sede y va aparte: mezclarla con el texto anterior (que traía la sede ambigua)
// volvería a disparar la misma repregunta, dejándolo en bucle.
// `mensajeNuevo` = solo lo último que dijo el técnico (`texto` es todo lo acumulado del turno).
async function intentarResolver(ses, texto, corregir, sedeRespuesta = null, mensajeNuevo = null) {
  const pideSede = async (r) => {
    ses.pidiendoSede = true;                 // ← el próximo mensaje es LA SEDE, no más contexto
    await guardarSesion(ses.from, ses);
    return `¿De qué *sede* es el equipo? ${r.candidatosSede?.length ? 'Ej: ' + r.candidatosSede.slice(0, 5).join(', ') : ''}`;
  };

  // Con qué texto se busca la SEDE:
  let sedeCruda = sedeRespuesta || texto;
  if (!sedeRespuesta && ses.sedeFijada) {
    // La sede ya está resuelta y fijada. Manda ella y no el texto, porque el texto que se
    // acumula turno a turno sigue arrastrando la frase ambigua original ("m plaza norte") y el
    // bot volvería a preguntar la sede en cada mensaje.
    sedeCruda = ses.sedeFijada;
    // Salvo que el técnico haya CAMBIADO DE IDEA en este último mensaje y nombre otra sede sin
    // ambigüedad ("mejor el chiller 1 de atocongo"): ahí manda la nueva, no la vieja.
    if (mensajeNuevo) {
      const nuevo = await resolverEquipo(mensajeNuevo, mensajeNuevo, mensajeNuevo);
      if (nuevo.sede && !nuevo.sedeAmbigua && nuevo.sede !== ses.sedeFijada) sedeCruda = nuevo.sede;
    }
  }

  // EL MATCHER PRIMERO; GEMINI ES EL RESCATE.
  // El matcher es determinístico y ya tolera typos por su cuenta (fonética + siglas + distancia
  // de edición). Gemini solo entra si el matcher NO pudo resolver. El orden importa y es a
  // sangre: si Gemini corrigiera SIEMPRE, su respuesta —que es una corazonada, no un dato—
  // entraría al matcher como sede canónica y le ganaría por coincidencia exacta a lo que el
  // matcher ya había resuelto bien. Ante "chiller 1 de mac plaza norte", que Gemini conteste
  // "Plaza Norte" mandaría el registro a la sede equivocada (son dos sedes distintas y reales).
  let r = await resolverEquipo(sedeCruda, texto, `${sedeCruda} ${texto}`);

  // Y ante una ambigüedad GENUINA entre dos sedes reales ("m plaza norte" = ¿PLAZA NORTE o MAC
  // PLAZA NORTE?), Gemini tampoco desempata: elegiría una con total aplomo. Se le pregunta al
  // técnico, que es el único que sabe.
  if (!r.ok && r.motivo === 'sede' && r.sedeAmbigua) return pideSede(r);

  if (!r.ok) {
    // Rescate: el texto trae algo que el matcher no reconoce (typo fuerte, jerga). Si Gemini
    // falla (rate limit, key rotada, red), nos quedamos con lo que ya teníamos — no se pierde
    // nada respecto de no haberlo llamado.
    //
    // Qué puede y qué no puede hacer esa corrección lo decide `elegirRescate` (compartida con
    // observaciones — tener la regla duplicada es cómo se arregla un flujo y el otro se queda con
    // el bucle): no puede mudar de sede, no puede desempatar entre equipos reales y no puede
    // ensanchar la lista de candidatos que el matcher ya había acotado.
    const sedeFijada = r.sede || null;
    let g = null;
    try {
      const contexto = await contextoInventario();
      g = await corregir(texto, contexto);
    } catch (e) {
      console.error('[mtto] corrección Gemini falló, sigo con el texto tal cual:', e?.message);
    }
    if (g && (g.sede || g.equipo)) {
      const { sedeTxt, equipoTxt } = aplicarCorreccion(texto, g);
      const rg = await resolverEquipo(sedeFijada || sedeRespuesta || sedeTxt, equipoTxt, texto);
      r = elegirRescate(r, rg);
      if (!r.ok && r.motivo === 'sede' && r.sedeAmbigua) return pideSede(r);
    }
  }

  if (!r.ok) {
    if (r.motivo === 'sede') return pideSede(r);
    // La sede ya está resuelta; lo que falta es el equipo o el cliente. Hay que salir del modo
    // "el próximo mensaje es la sede", o el nombre del equipo que conteste el técnico se leería
    // como si fuera una sede y quedaría trabado.
    ses.pidiendoSede = false;
    if (r.sede) ses.sedeFijada = r.sede;
    await guardarSesion(ses.from, ses);
    if (r.motivo === 'cliente') return `Esa sede existe para varios clientes (${(r.candidatosCliente || []).join(', ')}). ¿De cuál es?`;
    // Los candidatos se ofrecen por UBICACIÓN (mismo helper que observaciones): el técnico dice
    // "el extractor del comedor", no "extractor 04" — sin el área no tiene con qué elegir.
    const o = opcionesEquipo(r.candidatosEquipo);
    if (!o) return '¿Qué *equipo* es? Dime el nombre como figura en el inventario.';
    if (o.modo === 'tipos') return `Hay ${o.total} equipos. ¿De qué *tipo* es?\n${o.texto}\n\n_(o dime la *ubicación* o el *código* MA-...)_`;
    if (o.modo === 'areas') return `Hay ${o.total} ${o.tipo.toLowerCase()}(s). ¿En qué *ubicación* está el tuyo?\n${o.texto}\n\n_(o dame el *código* MA-...)_`;
    const mas = o.truncado ? `\n_(…y ${o.truncado} más — si no está, dame el código MA-...)_` : '';
    return `¿Qué *equipo* es?\n${o.texto}${mas}\n\n_(dime la *ubicación*, el nombre o el código MA-...)_`;
  }
  ses.pidiendoSede = false;
  const acts = await actividadesDeEquipo(r.equipo.eqId, r.equipo.tipo, r.equipo.cliente, r.sede);
  if (!acts.length) {
    await limpiarSesion(ses.from);
    return `⚠️ El equipo *${etiquetaEquipo(r.equipo)}* (${r.equipo.eqId}) no tiene actividades configuradas. Pídele al administrador que configure las actividades de *${r.equipo.tipo}* para el cliente *${r.equipo.cliente || '—'}* en la app de Clientes.`;
  }
  ses.sede = r.sede;
  ses.eqId = r.equipo.eqId;
  ses.tipo = r.equipo.tipo;
  ses.cliente = r.equipo.cliente || '';   // para resolver los MINUTOS por cliente al guardar (Etapa 2)
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
