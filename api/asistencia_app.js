// Endpoint de la Mini App «Marcar asistencia» (cámara en vivo + ubicación + gesto al azar).
// Igual que api/parametros.js: la Mini App manda `Authorization: tma <Telegram.WebApp.initData>`, se valida la
// firma con el token del bot y de ahí sale QUIÉN es el técnico. La lógica está en _lib/asistencia_app.js y el
// marcaje en sí lo hace el motor de siempre (`manejarAsistencia`): sede, radio, entrada/salida, turno nocturno.
//
// POST /api/asistencia_app   { accion: 'inicio' } | { accion: 'enviar', token, foto, ubicacion }
import { getDb } from './_lib/firestore.js';
import { identificarPorTelegram } from './_lib/identidad.js';
import { procesar } from './_lib/asistencia_app.js';
import { manejarAsistencia } from './_lib/asistencia.js';
import { registrarMarcaje, registroDelDia } from './_lib/asistencia_registros.js';
import { enviarRespuestaTg } from './_lib/telegram.js';
import { hoyLima, decimalAHHMM } from './_lib/fecha.js';

// create() falla si el id ya existe → el reto no se puede usar dos veces (código 6 = ALREADY_EXISTS).
async function usarReto(nonce, emitidoMs) {
  try {
    await getDb().collection('asistencia_retos').doc(nonce).create({ usadoAt: new Date().toISOString(), emitidoMs });
    return true;
  } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) return false;
    throw e;
  }
}

async function estadoHoy(colabId) {
  const reg = await registroDelDia(colabId, hoyLima());
  return {
    entrada: reg && reg.horaEntrada != null ? decimalAHHMM(reg.horaEntrada) : null,
    salida: reg && reg.horaSalida != null ? decimalAHHMM(reg.horaSalida) : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const h = req.headers.authorization || '';
  const initData = h.startsWith('tma ') ? h.slice(4) : '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Solicitud inválida.' });
  try {
    const r = await procesar(body, initData, {
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      ahora: () => Date.now(),
      identificar: identificarPorTelegram,
      estadoHoy,
      usarReto,
      // El motor escribe el registro con `registrarMarcaje`; se le inyecta una versión que añade la evidencia
      // del canal (Mini App, gesto, código, precisión) a lo que guarda.
      marcar: ({ evidencia, ...msg }) => manejarAsistencia(msg, {
        registrarMarcaje: (m) => registrarMarcaje({ ...m, ...evidencia }),
      }),
      avisarChat: (chatId, resp) => enviarRespuestaTg(chatId, resp),
    });
    return res.status(r.status).json(r.json);
  } catch (e) {
    console.error('[asistencia_app] error:', e?.message);
    return res.status(500).json({ error: 'No se pudo procesar. Inténtalo de nuevo.' });
  }
}
