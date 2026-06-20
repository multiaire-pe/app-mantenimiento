// Estado de la conversación del bot, por número de WhatsApp.
// 1 doc en wa_sesiones por wa_id (doc id = wa_id). Vida corta (TTL): si el técnico
// no responde en TTL_MIN minutos, la sesión se considera expirada y se empieza de cero.
// La expiración se chequea en LECTURA (campo expiraEn). Opcionalmente se puede activar
// una política TTL nativa de Firestore sobre `expiraEn` para que se autoborren.
import { getDb } from './firestore.js';

const COL = 'wa_sesiones';
const TTL_MIN = 30;
const TTL_MS = TTL_MIN * 60 * 1000;

// Sesión vacía recién creada (aún sin escribir en Firestore).
export function nuevaSesion(from, tecnico) {
  return {
    from,
    tecnicoId: tecnico?.id || null,
    fase: 'RECOLECTANDO',                                 // RECOLECTANDO | CONFIRMANDO
    borrador: { sede: '', equipo: '', eqId: '', tipo: '', cliente: '', observacion: '', estado: 'PENDIENTE' },
    faltante: null,                                       // 'tienda' | 'equipo' | 'detalle' | null
    intentos: 0,                                          // nº de repreguntas hechas (tope MAX)
    preguntoDetalle: false,                               // ya se hizo la repregunta de detalle (máx 1)
    historial: [],                                        // textos sustantivos del técnico (se reextrae el acumulado)
  };
}

// Devuelve la sesión activa o null (si no existe o ya expiró).
export async function getSesion(from) {
  if (!from) return null;
  const snap = await getDb().collection(COL).doc(String(from)).get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (s?.expiraEn && new Date(s.expiraEn).getTime() < Date.now()) return null; // expirada
  return s;
}

// Persiste la sesión (sobrescribe) y renueva su TTL.
export async function guardarSesion(from, ses) {
  const now = Date.now();
  ses.from = String(from);
  ses.updatedAt = new Date(now).toISOString();
  ses.expiraEn = new Date(now + TTL_MS).toISOString();
  await getDb().collection(COL).doc(String(from)).set(ses);
  return ses;
}

// Borra la sesión (conversación terminada o cancelada).
export async function limpiarSesion(from) {
  await getDb().collection(COL).doc(String(from)).delete().catch(() => {});
}
