// ── Webhook de WhatsApp Cloud API — Manta de Observaciones (MultiAire) ──────────
// Backend serverless en Vercel. Los secretos viven en variables de entorno (NUNCA en el front).
//
// FASE 1 (esta): verificación del webhook (GET de Meta) + validación de la firma
//   X-Hub-Signature-256 + parseo del payload. El procesamiento real (identificar técnico,
//   estructurar con Gemini, conversación con confirmación, escritura en manta_observaciones)
//   se agrega en las fases siguientes.
//
// Endpoint final: https://<dominio>/api/whatsapp   (GET = verificación · POST = mensajes)

import crypto from 'node:crypto';
import { yaProcesado } from './_lib/idempotencia.js';
import { identificarTecnico } from './_lib/identidad.js';
import { enviarTexto } from './_lib/whatsapp.js';

// Necesitamos el body CRUDO (bytes exactos) para validar la firma HMAC → desactivamos
// el parser automático de Vercel.
export const config = { api: { bodyParser: false } };

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const APP_SECRET   = process.env.WHATSAPP_APP_SECRET   || '';

// Lee el cuerpo del request como Buffer sin parsearlo.
function leerBodyCrudo(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Valida la firma que Meta envía en cada POST (HMAC-SHA256 del body con el App Secret).
function firmaValida(rawBody, header) {
  if (!APP_SECRET || !header) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  // 1) VERIFICACIÓN DEL WEBHOOK — Meta hace un GET al configurarlo.
  if (req.method === 'GET') {
    const mode      = req.query?.['hub.mode'];
    const token     = req.query?.['hub.verify_token'];
    const challenge = req.query?.['hub.challenge'];
    if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2) EVENTOS ENTRANTES (mensajes) — POST firmado por Meta.
  if (req.method === 'POST') {
    let raw;
    try { raw = await leerBodyCrudo(req); } catch { return res.status(400).send('Bad Request'); }

    if (!firmaValida(raw, req.headers['x-hub-signature-256'])) {
      return res.status(401).send('Firma inválida');
    }

    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(200).send('EVENT_RECEIVED'); }

    const mensajes = payload?.entry?.[0]?.changes?.[0]?.value?.messages || [];
    for (const msg of mensajes) {
      try {
        await procesarMensaje(msg);
      } catch (e) {
        console.error('[whatsapp] error procesando mensaje', msg?.id, e?.message);
      }
    }

    // Acusar recibo (procesamos antes de responder; Meta reintenta si tardamos → idempotencia cubre dups).
    return res.status(200).send('EVENT_RECEIVED');
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).send('Method Not Allowed');
}

// Procesa un mensaje entrante. FASE 2: idempotencia + identidad del técnico.
// (El procesamiento real —Gemini, conversación, escritura en manta_observaciones— llega en fases 3+.)
async function procesarMensaje(msg) {
  // Idempotencia: si Meta reenvía el mismo mensaje, lo ignoramos.
  if (await yaProcesado(msg.id, { from: msg.from, type: msg.type })) {
    console.log('[whatsapp] duplicado ignorado:', msg.id);
    return;
  }

  // Identidad: ¿de quién es este número?
  const tecnico = await identificarTecnico(msg.from);
  if (!tecnico) {
    console.log('[whatsapp] número no reconocido:', msg.from);
    await enviarTexto(msg.from,
      '👋 Hola. No reconozco este número en el sistema de MultiAire. ' +
      'Pídele al administrador que registre tu número (en el personal) para poder usar el bot de observaciones.');
    return;
  }

  // FASE 2: técnico identificado. Aún no procesamos la observación.
  console.log('[whatsapp] mensaje de', tecnico.nombre, `(${tecnico.id})`, '·', msg.type, '·', msg.text?.body || '(sin texto)');
  // TODO Fase 3+: estructurar con Gemini, conversar con confirmación y guardar en manta_observaciones.
}
