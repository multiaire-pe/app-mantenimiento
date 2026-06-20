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
    borrador: { sede: '', equipo: '', eqId: '', tipo: '', area: '', cliente: '', observacion: '', estado: 'PENDIENTE' },
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

// ── Última observación guardada por número (para "agregar foto a la última") ──────
// 1 doc por número en wa_ultima_obs. Vida corta (TTL): solo sirve para adjuntar una foto
// olvidada justo después de registrar. Transitoria/operativa (no se respalda).
const COL_ULT = 'wa_ultima_obs';
const TTL_ULT_MS = TTL_MIN * 60 * 1000;   // misma ventana que la sesión (30 min)

export async function guardarUltimaObs(from, obsId, etiqueta) {
  if (!from || !obsId) return;
  await getDb().collection(COL_ULT).doc(String(from)).set({
    obsId, etiqueta: etiqueta || '', expiraEn: new Date(Date.now() + TTL_ULT_MS).toISOString(),
  });
}

export async function getUltimaObs(from) {
  if (!from) return null;
  const snap = await getDb().collection(COL_ULT).doc(String(from)).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d?.expiraEn && new Date(d.expiraEn).getTime() < Date.now()) return null; // expirada
  return d?.obsId ? { obsId: d.obsId, etiqueta: d.etiqueta || '' } : null;
}

export async function limpiarUltimaObs(from) {
  await getDb().collection(COL_ULT).doc(String(from)).delete().catch(() => {});
}
