// Idempotencia por messageId: Meta reenvía el mismo mensaje varias veces (reintentos).
// Usamos doc.create() sobre wa_mensajes/{messageId}, que es atómico: falla si ya existe.
// Así garantizamos que cada mensaje se procese UNA sola vez.
import { getDb } from './firestore.js';

// Devuelve true si el mensaje YA estaba registrado (→ ignorar).
// Si no estaba, lo marca y devuelve false (→ procesar).
export async function yaProcesado(messageId, meta = {}) {
  if (!messageId) return false;
  const ref = getDb().collection('wa_mensajes').doc(messageId);
  try {
    await ref.create({ procesadoEn: new Date().toISOString(), ...meta });
    return false; // no existía → recién lo marcamos
  } catch (e) {
    // ALREADY_EXISTS (gRPC code 6) → duplicado, ya procesado.
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) return true;
    throw e; // otro error real → propagar para que Meta reintente (no perder el mensaje)
  }
}
