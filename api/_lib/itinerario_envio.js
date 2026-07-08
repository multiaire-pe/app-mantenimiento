// Arma el mensaje de WhatsApp de itinerario POR TÉCNICO: sus sedes/horarios del día
// y sus actividades de mtto separadas en individuales (🔧) y en cuadrilla (👥, con
// co-responsables). Lógica PURA (testeable sin Firestore); el endpoint carga los
// datos (bd_bloques + mtto_plan) y despacha el envío (whatsapp.js / avisos.js).
import { decimalAHHMM } from './fecha.js';
import { bloqueIncluye } from './plan_dia.js';

const CANCELADO = 'CANCELADO';
const sinRipley = (t) => String(t || '').replace(/^RIPLEY\s+/i, '');
const hhmm = (h) => (h === '' || h == null ? '' : (typeof h === 'number' ? decimalAHHMM(h) : String(h)));
const numOr = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; }; // nBloque robusto (descarta NaN)

// ¿el técnico participa en esta actividad de mtto? (array nuevo `tecnicos[]` o escalar legacy)
export function planTieneTecnico(plan, tecId) {
  if (!tecId) return false;
  if (Array.isArray(plan.tecnicos) && plan.tecnicos.length) return plan.tecnicos.some((t) => t && t.id === tecId);
  return plan.tecnicoId === tecId;
}

// ¿es actividad de cuadrilla? (modo explícito o ≥2 técnicos)
function esGrupo(plan) {
  if (plan.modo) return plan.modo === 'grupo';
  return Array.isArray(plan.tecnicos) && plan.tecnicos.length >= 2;
}

// nombres de los OTROS técnicos de una actividad de cuadrilla
function coResponsables(plan, tecId) {
  const arr = Array.isArray(plan.tecnicos) ? plan.tecnicos : [];
  return arr.filter((t) => t && t.id && t.id !== tecId).map((t) => t.nombre || '').filter(Boolean);
}

// Técnicos del día = unión de los asignados a bloques (personal[]/personal1..4) y a
// actividades (tecnicos[]/escalar legacy). Excluye bloques CANCELADO. Devuelve Map id→nombre.
export function tecnicosDelDia(bloques, planes) {
  const m = new Map();
  for (const b of bloques || []) {
    if (String(b.estado || '').toUpperCase() === CANCELADO) continue;
    const arr = Array.isArray(b.personal) ? b.personal : [];
    for (const p of arr) if (p && p.id && p.nombre && !m.has(p.id)) m.set(p.id, p.nombre);
    for (const k of ['personal1', 'personal2', 'personal3', 'personal4']) {
      const p = b[k];
      if (p && p.id && p.nombre && !m.has(p.id)) m.set(p.id, p.nombre);
    }
  }
  for (const p of planes || []) {
    const arr = Array.isArray(p.tecnicos) ? p.tecnicos : [];
    for (const t of arr) if (t && t.id && t.nombre && !m.has(t.id)) m.set(t.id, t.nombre);
    if (!arr.length && p.tecnicoId && p.tecnicoNombre && !m.has(p.tecnicoId)) m.set(p.tecnicoId, p.tecnicoNombre);
  }
  return m;
}

// Agrupa actividades por equipo (❄️) y las lista con su área (📍). Uso interno para el texto.
function bloqueActs(acts) {
  const porEq = new Map();
  for (const p of acts) {
    const k = p.nombreEq || p.eq_id || 'Equipo';
    if (!porEq.has(k)) porEq.set(k, { area: p.area || '', tareas: [] });
    porEq.get(k).tareas.push(p.tarea || ('Actividad ' + ((Number(p.tareaIdx) || 0) + 1)));
  }
  let s = '';
  for (const [eq, v] of porEq) {
    s += `\n   ❄️ ${eq}${v.area ? ` · 📍 ${v.area}` : ''}`;
    for (const tk of v.tareas) s += `\n      • ${tk}`;
  }
  return s;
}

// PURA. Arma el mensaje de cada técnico.
//   bloques = bd_bloques del itinerario/versión (personal[], tienda, horaInicio/Fin, detalle, estado, nBloque)
//   planes  = mtto_plan del día (tecnicos[]/modo/tarea/eq_id/nombreEq/area/nBloque/tareaIdx)
//   opts    = { fechaStr, actualizacion:bool, pie:string }
// Devuelve [{ tecnicoId, nombre, texto, nTareas, sedes:[...] }] ordenado por nombre.
export function mensajesPorTecnico(bloques, planes, opts = {}) {
  const fechaStr = opts.fechaStr || '';
  const cab = opts.actualizacion ? '🔄 *ACTUALIZACIÓN DE TU ITINERARIO*' : '📋 *TU ITINERARIO*';
  const vivos = (bloques || []).filter((b) => String(b.estado || '').toUpperCase() !== CANCELADO);
  const tecs = tecnicosDelDia(bloques, planes);
  const out = [];
  for (const [tecId, nombre] of tecs) {
    // Bloques donde el técnico está asignado + bloques con actividades suyas (por si no figura en personal[])
    const misBloques = vivos.filter((b) => bloqueIncluye(b, tecId));
    const nBConActs = new Set(
      (planes || []).filter((p) => planTieneTecnico(p, tecId)).map((p) => numOr(p.nBloque)).filter((n) => n !== null)
    );
    const extra = vivos.filter((b) => { const k = numOr(b.nBloque); return k !== null && !misBloques.includes(b) && nBConActs.has(k); });
    const todos = misBloques.concat(extra).sort((a, b) => (numOr(a.nBloque) ?? 0) - (numOr(b.nBloque) ?? 0));
    if (!todos.length) continue; // sin dónde ubicarlo (p.ej. solo en bloque cancelado)

    let texto = `${cab}\n📅 ${fechaStr}`;
    let nTareas = 0;
    const sedes = [];
    for (const b of todos) {
      const bk = numOr(b.nBloque);
      const acts = bk === null ? [] : (planes || []).filter((p) => numOr(p.nBloque) === bk && planTieneTecnico(p, tecId));
      const indiv = acts.filter((p) => !esGrupo(p));
      const grupo = acts.filter((p) => esGrupo(p));
      texto += `\n\n━━━━━━━━━━━━\n🏪 *${sinRipley(b.tienda)}*`;
      const hi = hhmm(b.horaInicio), hf = hhmm(b.horaFin);
      if (hi || hf) texto += `\n⏰ ${hi}${hf ? ` – ${hf}` : ''}`;
      if (!acts.length && b.detalle) texto += `\n📝 ${b.detalle}`;
      if (indiv.length) { texto += `\n🔧 *Tus actividades:*${bloqueActs(indiv)}`; nTareas += indiv.length; }
      if (grupo.length) {
        const cores = new Set();
        for (const p of grupo) for (const n of coResponsables(p, tecId)) cores.add(n);
        const con = cores.size ? ` (con ${Array.from(cores).join(' · ')})` : '';
        texto += `\n👥 *En cuadrilla${con}:*${bloqueActs(grupo)}`;
        nTareas += grupo.length;
      }
      sedes.push(sinRipley(b.tienda));
    }
    texto += `\n\n${opts.pie || '_MultiAire · Itinerario del día_'}`;
    out.push({ tecnicoId: tecId, nombre, texto, nTareas, sedes });
  }
  out.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  return out;
}
