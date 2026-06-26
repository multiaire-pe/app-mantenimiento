// Identifica al técnico a partir de su número de WhatsApp (wa_id), cruzándolo con
// maestros_personal. WhatsApp envía el número como "51988511111" (E.164 sin '+').
//
// Estrategia (compatible y multi-país):
//   1) match EXACTO por E.164 contra el `telefono` legacy y cada `telefonos[].e164`
//      (preciso; distingue números de distinto país aunque compartan los últimos 9 dígitos);
//   2) si no hay match exacto, FALLBACK por los últimos 9 dígitos (móvil local) — preserva el
//      comportamiento histórico para datos guardados sin prefijo o con prefijo distinto.
import { getDb } from './firestore.js';

export function soloDigitos(t) {
  return String(t == null ? '' : t).replace(/\D/g, '');
}

// Conjuntos de claves de una persona: e164 exactos y últimos-9-dígitos, del legacy `telefono`
// y de cada entrada de `telefonos[]` (e164 o numero).
export function clavesDe(data) {
  const e164s = new Set(), locales = new Set();
  const add = (t) => {
    const d = soloDigitos(t);
    if (!d) return;
    e164s.add(d);
    if (d.length >= 9) locales.add(d.slice(-9));
  };
  add(data && data.telefono);
  if (data && Array.isArray(data.telefonos)) {
    for (const t of data.telefonos) add(t && (t.e164 || t.numero));
  }
  return { e164s, locales };
}

function activo(data) {
  return String((data && data.activo) || 'SI').toUpperCase() !== 'NO';
}

// Lógica PURA (testeable sin Firestore): `docs` = [{ id, data }]. Devuelve { id, ...data } o null.
// Hace dos pasadas (exacta por E.164, luego fallback por últimos 9) para que un match exacto de
// otra persona tenga prioridad sobre un fallback ambiguo.
export function matchTecnico(docs, waId) {
  const wa = soloDigitos(waId);
  if (!wa) return null;
  const waLocal = wa.length >= 9 ? wa.slice(-9) : '';
  // 1) match exacto por E.164
  for (const { id, data } of docs) {
    if (!activo(data)) continue;
    if (clavesDe(data).e164s.has(wa)) return { id, ...data };
  }
  // 2) fallback por últimos 9 dígitos (compat con el comportamiento histórico)
  if (waLocal) {
    for (const { id, data } of docs) {
      if (!activo(data)) continue;
      if (clavesDe(data).locales.has(waLocal)) return { id, ...data };
    }
  }
  return null;
}

// Devuelve { id, nombre, telefono, ... } del técnico, o null si no está registrado/activo.
export async function identificarTecnico(waId) {
  if (!soloDigitos(waId)) return null;
  const db = getDb();
  const snap = await db.collection('maestros_personal').get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return matchTecnico(docs, waId);
}
