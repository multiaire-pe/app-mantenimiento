// Foto pendiente de una conversación: el técnico manda la foto en un mensaje y se confirma
// la observación en otro, así que la foto se guarda aparte (doc por número) hasta el "SÍ".
// Se guarda en wa_sesiones_fotos para NO inflar el doc de wa_sesiones. Transitoria.
import { getDb } from './firestore.js';

const COL = 'wa_sesiones_fotos';
const MAX_B64 = 900 * 1024; // ~900KB: deja margen bajo el límite de 1MB por doc de Firestore

// Guarda la foto pendiente. Devuelve true si se guardó (false si no hay o es muy grande).
export async function guardarFotoPendiente(from, base64, mime) {
  if (!base64) return false;
  if (base64.length > MAX_B64) {
    console.warn('[fotos] imagen muy grande, no se adjunta:', base64.length, 'bytes b64');
    return false;
  }
  await getDb().collection(COL).doc(String(from)).set({
    base64, mime: mime || 'image/jpeg', updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function getFotoPendiente(from) {
  const snap = await getDb().collection(COL).doc(String(from)).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return d?.base64 ? { base64: d.base64, mime: d.mime || 'image/jpeg' } : null;
}

export async function tieneFotoPendiente(from) {
  return !!(await getFotoPendiente(from));
}

export async function limpiarFotoPendiente(from) {
  await getDb().collection(COL).doc(String(from)).delete().catch(() => {});
}
