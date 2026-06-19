// Identifica al técnico a partir de su número de WhatsApp (wa_id), cruzándolo con
// maestros_personal.telefono. WhatsApp envía el número como "51988511111" (E.164 sin '+'),
// que coincide con cómo está guardado el teléfono. Se comparan los últimos 9 dígitos
// (número local de Perú) para tolerar diferencias de prefijo de país.
import { getDb } from './firestore.js';

export function soloDigitos(t) {
  return String(t == null ? '' : t).replace(/\D/g, '');
}

// Clave de comparación: últimos 9 dígitos (móvil peruano). '' si no hay suficientes dígitos.
function clave(t) {
  const d = soloDigitos(t);
  return d.length >= 9 ? d.slice(-9) : '';
}

// Devuelve { id, nombre, telefono, ... } del técnico, o null si no está registrado/activo.
export async function identificarTecnico(waId) {
  const k = clave(waId);
  if (!k) return null;
  const db = getDb();
  const snap = await db.collection('maestros_personal').get();
  for (const d of snap.docs) {
    const data = d.data();
    if (clave(data.telefono) === k && String(data.activo || 'SI').toUpperCase() !== 'NO') {
      return { id: d.id, ...data };
    }
  }
  return null;
}
