// Borra tomas de parámetros desde la web (Mantenimiento → Parámetros). Las reglas de Firestore no dejan escribir
// `mtto_parametros` desde el navegador (solo el backend), así que el borrado pasa por acá: se verifica el ID token de
// Firebase del usuario y que sea ADMIN o SUPER_ADMIN (misma regla de `isAdmin` de firestore.rules).
//
// POST /api/parametros_borrar   Authorization: Bearer <idToken>   { ids: ['EQ|SEP-OCT|2026', ...] }
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js';
import { puedeBorrarParametros } from './_lib/parametros.js';

const MAX_IDS = 400;   // un lote de Firestore admite 500 operaciones

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const db = getDb();   // inicializa firebase-admin
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Sesión no válida (falta token).' });
    let email = '';
    try { email = String((await admin.auth().verifyIdToken(idToken)).email || '').toLowerCase(); }
    catch { return res.status(401).json({ error: 'Sesión no válida o expirada. Vuelve a iniciar sesión.' }); }

    const usuario = email ? (await db.collection('usuarios').doc(email).get()).data() : null;
    if (!puedeBorrarParametros(email, usuario)) return res.status(403).json({ error: 'Solo un administrador puede eliminar tomas de parámetros.' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const ids = Array.isArray(body && body.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string' && x && !x.includes('/')))] : [];
    if (!ids.length) return res.status(400).json({ error: 'No se indicó qué eliminar.' });
    if (ids.length > MAX_IDS) return res.status(400).json({ error: `Máximo ${MAX_IDS} registros por vez.` });

    const batch = db.batch();
    ids.forEach((id) => batch.delete(db.collection('mtto_parametros').doc(id)));
    await batch.commit();
    console.log('[parametros_borrar]', email, ids.length, 'registro(s)');
    return res.status(200).json({ ok: true, borrados: ids.length });
  } catch (e) {
    console.error('[parametros_borrar] error:', e?.message);
    return res.status(500).json({ error: 'No se pudo eliminar. Inténtalo de nuevo.' });
  }
}
