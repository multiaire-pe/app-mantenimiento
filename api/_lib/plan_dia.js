// Lee el PLAN DEL DÍA de un técnico desde el itinerario (bd_itinerarios + bd_bloques):
// qué sedes tiene asignadas hoy. Replica la lógica de versiones de itinerario.html
// (para una fecha se usa el itinerario de MAYOR versión que la cubre, y sus bloques).
import { getDb } from './firestore.js';

const ESTADO_EXCLUIDO = 'CANCELADO';

// Normaliza el campo `fecha` de un itinerario (Timestamp | {seconds} | 'YYYY-MM-DD' | ISO) a 'YYYY-MM-DD'.
function fechaAYMD(f) {
  try {
    if (f && typeof f.toDate === 'function') return f.toDate().toISOString().slice(0, 10);
    if (f && f.seconds) return new Date(f.seconds * 1000).toISOString().slice(0, 10);
    const s = String(f);
    const d = new Date(s.length === 10 && s.includes('-') ? s + 'T12:00:00' : s);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  } catch { return ''; }
}

// ¿El bloque tiene asignado a este colaborador? El array `personal[]` guarda OBJETOS
// {id,nombre} (ver itinerario.html:955), aunque toleramos también ids sueltos por robustez;
// además revisamos los campos legacy personal1..4 ({id,nombre}).
export function bloqueIncluye(bloque, colabId) {
  if (!colabId) return false;
  if (Array.isArray(bloque.personal) && bloque.personal.some((p) => p === colabId || (p && p.id === colabId))) return true;
  for (const k of ['personal1', 'personal2', 'personal3', 'personal4']) {
    if (bloque[k] && bloque[k].id === colabId) return true;
  }
  return false;
}

// Lógica PURA (testeable sin Firestore). Dado el volcado de itinerarios y bloques, devuelve las
// sedes asignadas al colaborador ese día: [{ idTienda, tienda, cliente, bloques:[{horaInicio,horaFin,detalle}] }].
export function sedesDesde(itinerarios, bloques, colabId, fecha) {
  const fd = String(fecha).slice(0, 10);
  const matching = (itinerarios || [])
    .filter((it) => fechaAYMD(it.fecha) === fd)
    .sort((a, b) => Number(b.version) - Number(a.version));
  const iti = matching[0];
  if (!iti) return { hayPlan: false, sedes: [] };

  const propios = (bloques || []).filter(
    (b) =>
      b.idIti === iti.id &&
      Number(b.version) === Number(iti.version) &&
      String(b.estado || '').toUpperCase() !== ESTADO_EXCLUIDO &&
      bloqueIncluye(b, colabId)
  );

  const porSede = new Map();
  for (const b of propios) {
    const key = b.idTienda || b.tienda || '';
    if (!key) continue;
    if (!porSede.has(key)) {
      porSede.set(key, { idTienda: b.idTienda || '', tienda: b.tienda || '', cliente: b.cliente || '', bloques: [] });
    }
    porSede.get(key).bloques.push({ horaInicio: b.horaInicio || '', horaFin: b.horaFin || '', detalle: b.detalle || '' });
  }
  return { hayPlan: true, sedes: Array.from(porSede.values()) };
}

// Acceso real a Firestore: sedes asignadas al colaborador en `fecha`.
export async function sedesDelDia(colabId, fecha) {
  const db = getDb();
  const [iSnap, bSnap] = await Promise.all([
    db.collection('bd_itinerarios').get(),
    db.collection('bd_bloques').get(),
  ]);
  const itinerarios = iSnap.docs.map((d) => d.data());
  const bloques = bSnap.docs.map((d) => d.data());
  return sedesDesde(itinerarios, bloques, colabId, fecha);
}
