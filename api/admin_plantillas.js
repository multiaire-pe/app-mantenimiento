// Herramienta de administración: crea/consulta las plantillas de avisos del bot en Meta
// usando el WHATSAPP_TOKEN del SERVIDOR (variable sensitive: no se puede descargar de
// Vercel, así que la operación corre aquí, donde el token sí vive). Solo SUPER_ADMIN.
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js'; // inicializa firebase-admin (singleton)

const SUPER_ADMIN_EMAILS = ['marchenaangulojoseluis@gmail.com', 'plataforma@multiaire.com.pe'];
const WABA = process.env.WHATSAPP_WABA_ID || '4327823754136219';
const GRAPH = 'https://graph.facebook.com/v20.0';

const PLANTILLAS = [
  {
    name: 'marcaje_asistencia', language: 'es', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: '🕐 *Marcaje de asistencia — MultiAire*\nTipo: {{1}}\nColaborador: {{2}}\nSede: {{3}}\nHora: {{4}}\nUbicación: {{5}}\nAviso automático del bot de asistencia.',
      example: { body_text: [['Entrada', 'RAFAEL SANTOS', 'PLAZA NORTE', '08:30', 'en la sede (a 120 m)']] },
    }],
  },
  {
    name: 'registro_mtto', language: 'es', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: '🔧 *Registro de mantenimiento — MultiAire*\nTécnico: {{1}}\nEquipo: {{2}}\nSede: {{3}}\nPeríodo: {{4}}\nActividades realizadas: {{5}}\nAviso automático del bot de mantenimiento.',
      example: { body_text: [['RAFAEL SANTOS', 'AA Roof Top 05', 'PLAZA NORTE', 'JUL-AGO 2026', 'Lavado de filtros · Limpieza de siroco']] },
    }],
  },
  {
    // Fallback FUERA de la ventana de 24h para el envío de itinerario por técnico (aviso corto:
    // variables de una línea; el detalle completo va por texto libre dentro de la ventana).
    // Orden de las variables = params del endpoint enviar_itinerario.js: nombre, fecha, nº, sedes.
    name: 'itinerario_tecnico', language: 'es', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: '📋 *Tu itinerario — MultiAire*\nHola {{1}}, tu itinerario del {{2}} ya está listo: {{3}} actividad(es) en {{4}}. Abre este chat para ver el detalle de tus tareas.',
      example: { body_text: [['Rafael Santos', 'martes 08 de julio', '3', 'PLAZA NORTE, MEGAPLAZA']] },
    }],
  },
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    getDb();
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta token.' });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Sesión no válida.' }); }
    if (decoded.email_verified !== true || !SUPER_ADMIN_EMAILS.includes(String(decoded.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Solo super admin.' });
    }

    const token = process.env.WHATSAPP_TOKEN;
    if (!token) return res.status(500).json({ error: 'WHATSAPP_TOKEN no configurado en este entorno.' });

    const accion = (req.body || {}).accion;
    if (!['crear', 'estado'].includes(accion)) return res.status(400).json({ error: "accion debe ser 'crear' o 'estado'" });
    if (accion === 'estado') {
      const r = await fetch(`${GRAPH}/${WABA}/message_templates?fields=name,status,language&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      return res.status(r.ok ? 200 : 502).json(j);
    }

    const resultados = [];
    for (const tpl of PLANTILLAS) {
      const r = await fetch(`${GRAPH}/${WABA}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tpl),
      });
      const j = await r.json();
      const err = j.error || {};
      resultados.push({ plantilla: tpl.name, ok: r.ok, respuesta: r.ok ? { id: j.id, status: j.status } : { code: err.code, message: err.error_user_msg || err.message || 'error' } });
    }
    return res.status(200).json({ resultados });
  } catch (e) {
    console.error('[admin_plantillas]', e);
    return res.status(500).json({ error: e.message });
  }
}
