// Envía el itinerario POR TÉCNICO por WhatsApp: a cada técnico con tareas ese día le
// llega SOLO lo suyo (individuales 🔧 + cuadrilla 👥). Usa el WHATSAPP_TOKEN del servidor.
// Texto libre (dentro de la ventana de 24h, el caso normal porque los técnicos usan el
// bot de asistencia a diario); si falla y hay plantilla aprobada, cae a plantilla.
// Requisito: la versión debe estar CONFIRMADA. Solo ADMIN/SUPER_ADMIN. Registra cada
// envío en `itinerario_envios` (auditoría + detección de "actualización" + resumen).
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js';
import { enviarTexto, enviarPlantilla } from './_lib/whatsapp.js';
import { mensajesPorTecnico } from './_lib/itinerario_envio.js';

const SUPER_ADMIN_EMAILS = ['marchenaangulojoseluis@gmail.com', 'plataforma@multiaire.com.pe'];

// Gate: ADMIN o SUPER_ADMIN (super por email o por rol; ADMIN por doc usuarios/{email}).
async function requireAdmin(idToken, db) {
  const decoded = await admin.auth().verifyIdToken(idToken);
  const email = String(decoded.email || '').toLowerCase();
  if (decoded.email_verified !== true) throw { code: 403, msg: 'Email no verificado.' };
  if (SUPER_ADMIN_EMAILS.includes(email)) return { email, rol: 'SUPER_ADMIN' };
  const snap = await db.collection('usuarios').doc(email).get();
  const rol = snap.exists ? (snap.data().rol || '') : '';
  if (rol === 'SUPER_ADMIN' || rol === 'ADMIN') return { email, rol };
  throw { code: 403, msg: 'Solo un ADMIN puede enviar itinerarios.' };
}

// Fecha del itinerario (Timestamp | {seconds} | 'YYYY-MM-DD' | ISO) → texto legible es-PE.
function fmtFecha(f, dia) {
  try {
    let d;
    if (f && typeof f.toDate === 'function') d = f.toDate();
    else if (f && f.seconds) d = new Date(f.seconds * 1000);
    else { const s = String(f); d = new Date(s.length === 10 && s.includes('-') ? s + 'T12:00:00' : s); }
    if (isNaN(d)) return dia || String(f || '');
    return d.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Lima' });
  } catch { return dia || ''; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const db = getDb();
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Sesión no válida (falta token).' });
    let user;
    try { user = await requireAdmin(idToken, db); }
    catch (e) { return res.status(e.code || 401).json({ error: e.msg || 'Sesión no válida.' }); }

    const { idIti, version, prueba, telefonoPrueba } = req.body || {};
    if (!idIti || version == null) return res.status(400).json({ error: 'Falta idIti o version.' });
    const to_prueba = String(telefonoPrueba || '').replace(/\D/g, '');
    if (prueba && to_prueba.length < 9) return res.status(400).json({ error: 'Número de prueba inválido.' });
    // El modo prueba envía todo a un número arbitrario → solo SUPER_ADMIN (evita exfiltración/spam).
    if (prueba && user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'El modo prueba es solo para super admin.' });

    // 1) La versión debe existir y estar CONFIRMADA (gate del backend, no solo del front).
    const itiSnap = await db.collection('bd_itinerarios').doc(`${idIti}_v${version}`).get();
    if (!itiSnap.exists) return res.status(404).json({ error: 'Versión de itinerario no encontrada.' });
    const iti = itiSnap.data();
    if (!iti.confirmado) return res.status(409).json({ error: 'La versión no está confirmada. Confírmala antes de enviar.' });

    // 2) Bloques de esa versión + actividades (mtto_plan) del itinerario/versión.
    const [bSnap, pSnap] = await Promise.all([
      db.collection('bd_bloques').get(),
      db.collection('mtto_plan').get(),
    ]);
    const bloques = bSnap.docs.map((d) => d.data()).filter((b) => b.idIti === idIti && Number(b.version) === Number(version));
    const planes = pSnap.docs.map((d) => d.data()).filter((p) => p.itiId === idIti && Number(p.itiVersion) === Number(version));

    // 3) ¿Ya hubo un envío REAL previo de este itinerario? → es una ACTUALIZACIÓN (las pruebas no cuentan).
    const prevSnap = await db.collection('itinerario_envios').where('idIti', '==', idIti).get();
    const actualizacion = prevSnap.docs.some((d) => !(d.data() || {}).prueba);

    // 4) Armar el mensaje de cada técnico.
    const fechaStr = fmtFecha(iti.fecha, iti.dia);
    const pie = `_MultiAire · Itinerario ${actualizacion ? '(actualizado)' : 'confirmado'} · ${iti.id} v${version}_`;
    const msgs = mensajesPorTecnico(bloques, planes, { fechaStr, actualizacion, pie });
    if (!msgs.length) return res.status(200).json({ enviados: 0, total: 0, detalle: [], aviso: 'No hay técnicos con tareas en esta versión.' });

    // 5) Mapear técnico → teléfono (maestros_personal, e164 marcado WhatsApp).
    const perSnap = await db.collection('maestros_personal').get();
    const telById = {};
    perSnap.docs.forEach((d) => {
      const t = String((d.data() || {}).telefono || '').replace(/\D/g, '');
      if (t.length >= 9) telById[d.id] = t;
    });

    // 6) Auditoría PRE-envío: se crea el registro ANTES del loop (incluye pruebas, con target
    // enmascarado). Si el proceso muere a mitad, queda traza → no se puede "reintentar limpio"
    // sin dejar rastro (mitiga duplicados ciegos por reintento).
    const envRef = db.collection('itinerario_envios').doc();
    const masked = prueba ? (to_prueba.slice(0, 3) + '****' + to_prueba.slice(-2)) : '';
    try {
      await envRef.set({
        idIti, version: Number(version), fecha: iti.fecha || '', fechaStr,
        actualizacion, prueba: !!prueba, ...(prueba ? { pruebaTarget: masked } : {}),
        enviadoPor: user.email, ts: new Date().toISOString(), estado: 'en_progreso', totalTecnicos: msgs.length,
      });
    } catch (e) {
      // Sin traza previa NO enviamos: la auditoría es requisito para no arriesgar duplicados ciegos.
      console.error('[enviar_itinerario] pre-registro', e.message);
      return res.status(503).json({ error: 'No se pudo registrar la auditoría del envío; no se envió nada. Reintenta.' });
    }

    // 7) Enviar: texto libre (24h) con fallback a plantilla (fuera de 24h) si está configurada.
    const plantilla = process.env.WHATSAPP_TEMPLATE_ITINERARIO || '';
    const idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || 'es';
    const detalle = [];
    for (const m of msgs) {
      const to = prueba ? to_prueba : telById[m.tecnicoId];
      if (!to) { detalle.push({ tecnicoId: m.tecnicoId, nombre: m.nombre, estado: 'sin_telefono', nTareas: m.nTareas }); continue; }
      let ok = false, canal = 'texto';
      try { ok = await enviarTexto(to, m.texto); } catch { /* intenta plantilla abajo */ }
      if (!ok && plantilla) {
        const params = [m.nombre, fechaStr, String(m.nTareas), (m.sedes || []).join(', ') || '—']
          .map((x) => ({ type: 'text', text: (String(x || '').replace(/\s+/g, ' ').trim() || '—').slice(0, 600) }));
        try { ok = await enviarPlantilla(to, plantilla, idioma, [{ type: 'body', parameters: params }]); canal = 'plantilla'; } catch { /* queda error */ }
      }
      detalle.push({ tecnicoId: m.tecnicoId, nombre: m.nombre, estado: ok ? 'enviado' : 'error', nTareas: m.nTareas, ...(ok ? { canal } : {}) });
    }
    const enviados = detalle.filter((d) => d.estado === 'enviado').length;
    const sinTelefono = detalle.filter((d) => d.estado === 'sin_telefono').length;
    const errores = detalle.filter((d) => d.estado === 'error').length;

    // 8) Cerrar la auditoría con el resultado real (si esto falla, el doc 'en_progreso' queda como traza).
    try {
      await envRef.update({ estado: 'completado', enviados, sinTelefono, errores, detalle, finTs: new Date().toISOString() });
    } catch (e) { console.error('[enviar_itinerario] cierre', e.message); }

    return res.status(200).json({ enviados, total: msgs.length, actualizacion, prueba: !!prueba, sinTelefono, errores, detalle });
  } catch (e) {
    console.error('[enviar_itinerario]', e);
    return res.status(500).json({ error: e.message });
  }
}
