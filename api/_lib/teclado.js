// Qué teclado fijo tiene puesto cada chat de Telegram: 'inicio' (las tres acciones) o 'flujo'
// (solo «Cancelar»). Telegram no dice qué teclado tiene el técnico en el teléfono, así que el bot lo
// recuerda para mandar el mensaje del cambio SOLO cuando cambia de modo (y no en cada respuesta).
// 1 doc en tg_teclado por chat (doc id = `tg<chat_id>`). Es un dato operativo y chico: no se respalda
// y no necesita regla (solo lo toca el Admin SDK del bot).
import { getDb } from './firestore.js';

const COL = 'tg_teclado';
export const MODOS = ['inicio', 'flujo'];

export async function getModoTeclado(from) {
  if (!from) return null;
  const snap = await getDb().collection(COL).doc(String(from)).get();
  const m = snap.exists ? snap.data()?.modo : null;
  return MODOS.includes(m) ? m : null;
}

export async function setModoTeclado(from, modo) {
  if (!from || !MODOS.includes(modo)) return;
  await getDb().collection(COL).doc(String(from)).set({ modo, ts: new Date().toISOString() });
}
