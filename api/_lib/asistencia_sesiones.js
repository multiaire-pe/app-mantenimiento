// Estado de la conversación de MARCAJE de asistencia, por número de WhatsApp.
// Colección PROPIA (wa_asistencia_sesiones) para NO colisionar con el bot de observaciones
// (wa_sesiones). Vida corta (TTL 20 min): marcar es rápido; si se abandona, se descarta.
// La selfie pendiente va aparte (wa_asistencia_fotos), por tamaño (base64), igual que en observaciones.
import { getDb } from './firestore.js';

const COL = 'wa_asistencia_sesiones';
const COL_FOTO = 'wa_asistencia_fotos';
const TTL_MS = 20 * 60 * 1000;
const MAX_B64 = 900 * 1024; // ~900KB: margen bajo el límite de 1MB por doc de Firestore

// Sesión nueva (aún sin persistir).
export function nuevaSesion(from, tecnico, tipo) {
  return {
    from: String(from),
    colabId: tecnico?.id || null,
    nombre: tecnico?.nombre || '',
    cargo: tecnico?.cargo || '',
    tipo,                       // 'ENTRADA' | 'SALIDA'
    fase: 'RECOLECTA',          // RECOLECTA (espera ubicación/selfie) | ELIGE_SEDE
    sede: null,                 // { idTienda, tienda, cliente, latitud, longitud, radio } una vez resuelta
    fueraDePlan: false,         // no tenía la sede en su itinerario del día
    planSedes: [],              // sedes candidatas de su itinerario (para elegir la más cercana)
    ubicacion: null,            // { lat, lng, distancia, dentro, radio } una vez compartida
    tieneSelfie: false,         // la selfie vive en wa_asistencia_fotos
  };
}

export async function getSesion(from) {
  if (!from) return null;
  const ref = getDb().collection(COL).doc(String(from));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (s?.expiraEn && new Date(s.expiraEn).getTime() < Date.now()) {
    await ref.delete().catch(() => {});
    await getDb().collection(COL_FOTO).doc(String(from)).delete().catch(() => {});
    return null;
  }
  return s;
}

export async function guardarSesion(from, ses) {
  const now = Date.now();
  ses.from = String(from);
  ses.updatedAt = new Date(now).toISOString();
  ses.expiraEn = new Date(now + TTL_MS).toISOString();
  await getDb().collection(COL).doc(String(from)).set(ses);
  return ses;
}

export async function limpiarSesion(from) {
  await getDb().collection(COL).doc(String(from)).delete().catch(() => {});
  await getDb().collection(COL_FOTO).doc(String(from)).delete().catch(() => {});
}

// ── Selfie pendiente ──────────────────────────────────────────────────────────
// Guarda la selfie (base64) hasta que se escribe el registro. Devuelve true si se guardó.
export async function guardarSelfie(from, base64, mime) {
  if (!base64) return false;
  if (base64.length > MAX_B64) {
    console.warn('[asistencia] selfie muy grande, no se adjunta:', base64.length);
    return false;
  }
  const now = Date.now();
  await getDb().collection(COL_FOTO).doc(String(from)).set({
    base64, mime: mime || 'image/jpeg',
    updatedAt: new Date(now).toISOString(),
    expiraEn: new Date(now + TTL_MS).toISOString(),
  });
  return true;
}

export async function getSelfie(from) {
  const snap = await getDb().collection(COL_FOTO).doc(String(from)).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d?.expiraEn && new Date(d.expiraEn).getTime() < Date.now()) return null;
  return d?.base64 ? { base64: d.base64, mime: d.mime || 'image/jpeg' } : null;
}
