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
  const ref = getDb().collection(COL).doc(String(from));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (s?.expiraEn && new Date(s.expiraEn).getTime() < Date.now()) {
    // Expirada: la borramos para que una conversación nueva NO herede su historial al fusionar.
    await ref.delete().catch(() => {});
    return null;
  }
  return s;
}

// Persiste la sesión y renueva su TTL. Usa una transacción que FUSIONA el historial con el del
// doc actual (union por valor): si dos mensajes del mismo número se procesan casi a la vez, ninguno
// pierde su texto. El resto del estado (fase/borrador) es last-write-wins, pero se re-deriva del
// historial en el siguiente turno (procesarBorrador reextrae el acumulado), así que se autocorrige.
export async function guardarSesion(from, ses) {
  const now = Date.now();
  ses.from = String(from);
  ses.updatedAt = new Date(now).toISOString();
  ses.expiraEn = new Date(now + TTL_MS).toISOString();
  const ref = getDb().collection(COL).doc(String(from));
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = (snap.exists && Array.isArray(snap.data().historial)) ? snap.data().historial : [];
    const merged = prev.slice();
    for (const h of (ses.historial || [])) if (!merged.includes(h)) merged.push(h);
    ses.historial = merged;
    tx.set(ref, ses);
  });
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
