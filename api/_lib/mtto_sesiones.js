// Estado de la conversación de REGISTRO DE ACTIVIDADES de mantenimiento, por número
// de WhatsApp. Colección propia (wa_mtto_sesiones) para no colisionar con observaciones
// (wa_sesiones) ni asistencia (wa_asistencia_sesiones). TTL 30 min: un registro con
// fotos toma más que un marcaje, pero si se abandona se descarta.
import { getDb } from './firestore.js';

const COL = 'wa_mtto_sesiones';
const TTL_MS = 30 * 60 * 1000;

// Sesión nueva (aún sin persistir).
export function nuevaSesion(from, tecnico) {
  return {
    from: String(from),
    inicio: new Date().toISOString(),   // las fotos de ESTA sesión se cuentan desde aquí
    colabId: tecnico?.id || null,
    nombre: tecnico?.nombre || '',
    fase: 'EQUIPO',        // EQUIPO → ACTIVIDADES → CONFIRMA → FOTOS
    sede: null,
    eqId: null,
    tipo: null,
    nombreEq: null,
    actividades: [],       // nombres (lista efectiva del equipo, congelada al iniciar)
    marcadas: [],          // índices (0-based) de actividades realizadas
    fotoPos: 0,            // posición en `marcadas` de la actividad que recibe fotos
    fotos: 0,              // total de fotos guardadas en este registro
    textoOriginal: '',     // primer mensaje (para re-resolver cliente/sede en repreguntas)
  };
}

export async function getSesion(from) {
  if (!from) return null;
  const snap = await getDb().collection(COL).doc(String(from)).get();
  if (!snap.exists) return null;
  const ses = snap.data();
  if (Date.now() - (ses._ts || 0) > TTL_MS) {
    await snap.ref.delete().catch(() => {});   // expirada: limpiar para no heredar estado
    return null;
  }
  return ses;
}

export async function guardarSesion(from, ses) {
  await getDb().collection(COL).doc(String(from)).set({ ...ses, _ts: Date.now() });
}

export async function limpiarSesion(from) {
  await getDb().collection(COL).doc(String(from)).delete().catch(() => {});
}
