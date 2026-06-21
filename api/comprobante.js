// Función serverless: extrae los datos de un comprobante (factura/boleta/ticket) con Gemini,
// usando la GEMINI_API_KEY del SERVIDOR (la misma del bot de observaciones, tier pagado).
// La key nunca llega al navegador. Protegido: requiere un ID token de Firebase válido
// (solo usuarios logueados de MultiAire pueden consumir el endpoint).
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js'; // inicializa firebase-admin (singleton) para auth

const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];

const PROMPT = `Eres un extractor de datos de comprobantes de pago peruanos (facturas, boletas, tickets).
Analiza la imagen y extrae los datos. Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.

Claves requeridas:
- "fecha": string DD/MM/YYYY (ejemplo: "27/05/2026"). Si no se lee usa "".
- "tipo": "FT"=Factura, "BO"=Boleta, "TK"=Ticket, "NC"=Nota de Crédito, "OT"=Otro.
- "numero": número completo con serie (ejemplo: "F001-00001234"). Si no se lee usa "".
- "ruc": RUC o DNI del emisor, solo dígitos (ejemplo: "20512345678"). Si no se lee usa "".
- "proveedor": la RAZÓN SOCIAL LEGAL del emisor (el nombre registrado en SUNAT, el mismo que figura junto al RUC), NO la marca ni el nombre comercial ni el logo. La razón social casi siempre termina en la forma jurídica: S.A.C., S.A., E.I.R.L., S.R.L., S.C.R.L. Ejemplo: si el logo grande dice "Promart" pero el RUC corresponde a "MAESTRO PERU S.A.", usa "MAESTRO PERU S.A." (no "Promart"). En MAYÚSCULAS. Si no se lee usa "".
- "monto": número decimal con el total a pagar (ejemplo: 150.00). Si no se lee usa 0.

Responde SOLO el JSON.`;

const SCHEMA = {
  type: 'object',
  properties: {
    fecha:     { type: 'string' },
    tipo:      { type: 'string', enum: ['FT', 'BO', 'TK', 'NC', 'OT'] },
    numero:    { type: 'string' },
    ruc:       { type: 'string' },
    proveedor: { type: 'string' },
    monto:     { type: 'number' },
  },
  required: ['fecha', 'tipo', 'numero', 'ruc', 'proveedor', 'monto'],
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    getDb(); // asegura firebase-admin inicializado (para verificar el token)

    // 1) Autenticación: ID token de Firebase del usuario logueado.
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Sesión no válida (falta token).' });
    try { await admin.auth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Sesión no válida o expirada. Vuelve a iniciar sesión.' }); }

    // 2) Imagen + modelo.
    const { image, mime, model } = req.body || {};
    if (!image || !mime) return res.status(400).json({ error: 'Falta la imagen.' });
    const modelo = MODELOS.includes(model) ? model : 'gemini-2.5-flash';

    // 3) Gemini con la key del servidor (NUNCA expuesta al front).
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY no está configurada en este entorno.' });
    const genCfg = { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json', responseSchema: SCHEMA };
    if (!modelo.includes('pro')) genCfg.thinkingConfig = { thinkingBudget: 0 }; // flash: sin thinking = JSON fiable y rápido

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
        generationConfig: genCfg,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Gemini ' + r.status, detail: t.slice(0, 200) });
    }
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) return res.status(502).json({ error: 'Gemini no devolvió texto.' });
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } } }
    if (!parsed || !Object.keys(parsed).length) return res.status(502).json({ error: 'Respuesta de Gemini no es JSON válido.' });
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('[comprobante] error', e?.message);
    return res.status(500).json({ error: e?.message || 'Error interno' });
  }
}
