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

// ── Telegram ────────────────────────────────────────────────────────────────────────────────
// Telegram identifica por `chat_id`, no por teléfono. El vínculo se hace una sola vez: el técnico
// comparte su contacto con el bot y se guarda `telegramChatId` en su doc de maestros_personal.

// Devuelve { id, ...data } del técnico vinculado a ese chat, o null (también si está inactivo).
export async function identificarPorTelegram(chatId) {
  const id = Number(chatId);
  if (!Number.isFinite(id)) return null;
  const snap = await getDb().collection('maestros_personal').where('telegramChatId', '==', id).get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() })).filter((d) => activo(d.data));
  if (docs.length !== 1) {
    if (docs.length > 1) console.error('[identidad] chat de Telegram vinculado a más de un colaborador:', id);
    return null;   // ambiguo = no se adivina quién es
  }
  return { id: docs[0].id, ...docs[0].data };
}

// Lógica PURA de la vinculación. A diferencia de matchTecnico, NO hay fallback por últimos 9
// dígitos: en WhatsApp el número lo garantiza Meta, pero aquí lo comparte el usuario, y un
// `+34 912345678` propio no debe vincularse al titular de `+51 912345678`. Cada teléfono guardado
// se lleva a internacional igual que personal.html (`e164De`): el `e164` si está, si no
// `prefijo + numero`; y solo un número SIN información de país (9 dígitos, el formato histórico)
// se toma como peruano. Exige coincidencia ÚNICA: dos colaboradores con el mismo número = ambiguo.
function internacional(numero, prefijo = '') {
  let d = soloDigitos(numero).replace(/^00/, '');
  const p = soloDigitos(prefijo);
  if (p) d = p + d;                       // igual que e164De: prefijo + número, sin adivinar
  else if (d.length === 9) d = `51${d}`;
  return d;
}

function internacionalesDe(data) {
  const out = new Set();
  if (data && data.telefono) out.add(internacional(data.telefono));
  if (data && Array.isArray(data.telefonos)) {
    for (const t of data.telefonos) {
      if (!t) continue;
      out.add(t.e164 ? internacional(t.e164) : internacional(t.numero, t.prefijo));
    }
  }
  out.delete('');
  return out;
}

export function matchTelegram(docs, telefono) {
  // El número compartido NO se asume peruano: Telegram lo manda siempre con su código de país.
  const tel = soloDigitos(telefono).replace(/^00/, '');
  if (tel.length < 10) return null;
  const hits = docs.filter(({ data }) => activo(data) && internacionalesDe(data).has(tel));
  return hits.length === 1 ? { id: hits[0].id, ...hits[0].data } : null;
}

// Vincula un chat de Telegram con el colaborador cuyo teléfono coincide (ver matchTelegram).
// Devuelve el técnico vinculado o null si el número no está en el sistema. Quita el vínculo de
// cualquier otro colaborador con ese mismo chat (un chat = una persona) antes de asignarlo.
export async function vincularTelegram(chatId, telefono) {
  const id = Number(chatId);
  if (!Number.isFinite(id) || !soloDigitos(telefono)) return null;
  const db = getDb();
  const snap = await db.collection('maestros_personal').get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const t = matchTelegram(docs, telefono);
  if (!t) return null;
  const batch = db.batch();
  for (const d of docs) {
    if (d.id !== t.id && Number(d.data.telegramChatId) === id) {
      batch.update(db.collection('maestros_personal').doc(d.id), { telegramChatId: null });
    }
  }
  batch.update(db.collection('maestros_personal').doc(t.id), { telegramChatId: id });
  await batch.commit();
  return { ...t, telegramChatId: id };
}
