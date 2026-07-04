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
  if (!RE_MTTO.test(t)) return false;
  if (/(registr|hice|realic|complet|termin|marcar|actividades)/.test(t)) return true;
  return /^\s*(mantenimiento|mtto|preventiv)/.test(t);
}

// saludo/menú "en frío" (sin sesión): despliega las 3 opciones
export function esSaludo(texto) {
  return /^(hola|buenas(\s+(dias|tardes|noches))?|buenos\s+dias|menu|inicio|ayuda|hey)[\s!.,?]*$/.test(norm(texto).trim());
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

// ── Lista efectiva de actividades del equipo (Firestore, caché 5 min) ────────
const _cacheActs = new Map();  // eqId → {ts, actividades}
export async function actividadesDeEquipo(eqId, tipo) {
  const hit = _cacheActs.get(eqId);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit.actividades;
  const db = getDb();
  const [plSnap, ovSnap] = await Promise.all([
    db.collection('tareas_config').doc(String(tipo || '')).get(),
    db.collection('mtto_actividades_equipo').doc(String(eqId)).get(),
  ]);
  const plantilla = plSnap.exists ? (plSnap.data().tareas || []) : [];
  const ov = ovSnap.exists ? ovSnap.data() : null;
  const quitadas = new Set(ov?.quitadas || []);
  const actividades = plantilla.filter((t) => !quitadas.has(t))
    .concat((ov?.agregadas || []).map((a) => a.nombre));
  _cacheActs.set(eqId, { ts: Date.now(), actividades });
  return actividades;
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
  return `📋 *Confirma el registro*\n${ses.nombreEq} (${ses.eqId}) · ${ses.sede}\nPeríodo: ${periodo} ${anio}\n\n${hechas}\n\n¿Guardo? Responde *SÍ* para guardar o *NO* para cancelar.`;
}
function pedirFotos(ses) {
  const idx = ses.marcadas[ses.fotoPos];
  return `📷 Fotos de *${ses.actividades[idx]}* (${ses.fotoPos + 1}/${ses.marcadas.length}): envía una o varias.\n· *SIGUIENTE* para pasar a la otra actividad\n· *FIN* para terminar`;
}

// ── Escritura ─────────────────────────────────────────────────────────────────
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
  return clave;
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
    ses.textoOriginal = texto || '';
    ses.fase = 'EQUIPO';
    if (texto && RE_MTTO.test(texto)) {
      const r = await intentarResolver(ses, texto);
      if (r) return r;
    }
    await guardarSesion(from, ses);
    return '🔧 *Registro de actividades de mantenimiento*\nDime el *equipo* y la *sede* (ej: "chiller 1 de atocongo").';
  }

  if (ses.fase === 'EQUIPO') {
    if (!texto) return 'Dime el *equipo* y la *sede* (ej: "chiller 1 de atocongo").';
    const r = await intentarResolver(ses, `${ses.textoOriginal} ${texto}`);
    if (r) return r;
    return null;
  }

  if (ses.fase === 'ACTIVIDADES') {
    const idxs = parseSeleccion(texto || '', ses.actividades.length);
    if (!idxs.length) return `No te entendí. Responde con los números de las actividades realizadas (ej: *1, 3*) o *todas*.\n\n${listaNumerada(ses.actividades)}`;
    ses.marcadas = idxs;
    ses.fase = 'CONFIRMA';
    await guardarSesion(from, ses);
    return resumenConfirma(ses);
  }

  if (ses.fase === 'CONFIRMA') {
    if (/^(si|sí|s|ok|dale|confirmo|confirmar)[\s!.]*$/.test(t)) {
      if (onWriteStart) onWriteStart();   // idempotencia: de aquí en adelante no reprocesar
      await guardarRegistro(ses, tecnico);
      ses.fase = 'FOTOS';
      ses.fotoPos = 0;
      await guardarSesion(from, ses);
      return `✅ *Registro guardado.*\n\n${pedirFotos(ses)}`;
    }
    if (/^(no|n)[\s!.]*$/.test(t)) {
      await limpiarSesion(from);
      return '❌ Registro cancelado. Nada se guardó.';
    }
    return 'Responde *SÍ* para guardar o *NO* para cancelar.';
  }

  if (ses.fase === 'FOTOS') {
    if (imagenB64) {
      if (imagenB64.length > 900 * 1024) {   // margen bajo el límite de 1MB por doc (convención del bot)
        return '📷 Esa foto es muy pesada para guardarla. Reenvíala como *foto normal* (no como documento/HD).';
      }
      if (onWriteStart) onWriteStart();   // idempotencia: la foto se escribe una sola vez
      await guardarFoto(ses, tecnico, imagenB64, mime);
      ses.fotos += 1;
      await guardarSesion(from, ses);
      return `📷 Foto ${ses.fotos} guardada para *${ses.actividades[ses.marcadas[ses.fotoPos]]}*. Envía otra, *SIGUIENTE* o *FIN*.`;
    }
    if (/(^|\s)(siguiente|listo|next)(\s|$)/.test(t)) {
      ses.fotoPos += 1;
      if (ses.fotoPos >= ses.marcadas.length) {
        const n = ses.fotos;
        await limpiarSesion(from);
        return `🏁 *Registro completo* — ${ses.marcadas.length} actividad(es), ${n} foto(s). ¡Gracias!`;
      }
      await guardarSesion(from, ses);
      return pedirFotos(ses);
    }
    if (/(^|\s)(fin|terminar|termine|ya)(\s|$)/.test(t)) {
      const resumen = `🏁 *Registro completo* — ${ses.marcadas.length} actividad(es), ${ses.fotos} foto(s). ¡Gracias!`;
      await limpiarSesion(from);
      return resumen;
    }
    return `Envía una foto, *SIGUIENTE* para pasar de actividad o *FIN* para terminar.`;
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
  ses.nombreEq = r.equipo.nombre;
  ses.actividades = acts;
  ses.fase = 'ACTIVIDADES';
  await guardarSesion(ses.from, ses);
  return pedirActividades(ses);
}
