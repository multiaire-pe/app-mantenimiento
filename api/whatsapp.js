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

    const value    = payload?.entry?.[0]?.changes?.[0]?.value;
    const mensajes = value?.messages || [];
    for (const msg of mensajes) {
      // FASE 1: solo registramos en logs. El procesamiento real se implementa en las fases 2+.
      console.log('[whatsapp] mensaje recibido', JSON.stringify({
        from: msg.from, id: msg.id, type: msg.type,
        texto: msg.text?.body, tieneImagen: !!msg.image
      }));
      // TODO Fase 2+: await procesarMensaje(value, msg)
    }

    // Acusar recibo (procesamos antes de responder; con idempotencia por messageId en Fase 2).
    return res.status(200).send('EVENT_RECEIVED');
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).send('Method Not Allowed');
}
