// Estructura el mensaje del técnico (texto y/o foto) en una observación.
// Patrón REST de Gemini (igual que comprobantes.html): responseSchema fuerza JSON válido.
// La key viene de GEMINI_API_KEY (env var), nunca del front.
//
// Además de extraer {tienda, equipo, observacion, estado}, decide —usando la GUÍA editable
// (manta_guia)— si falta UN dato importante; en ese caso propone una sola pregunta amable.
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const MODELO = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'; // razona mejor que flash-lite

const SCHEMA = {
  type: 'object',
  properties: {
    tienda: { type: 'string' },
    equipo: { type: 'string' },
    observacion: { type: 'string' },
    estado: { type: 'string', enum: ['PENDIENTE', 'EN_PROCESO', 'OK'] },
    faltaDetalle: { type: 'boolean' },
    pregunta: { type: 'string' },
  },
  required: ['tienda', 'equipo', 'observacion', 'estado', 'faltaDetalle', 'pregunta'],
};

const PROMPT = `Eres el asistente de la "Manta de Observaciones" de mantenimiento de MultiAire (equipos de aire acondicionado tipo "Roof Top" en tiendas Ripley de Perú).
Un técnico te describe, por WhatsApp, un hallazgo de un equipo. Pueden venir varios mensajes acumulados. Extrae los datos en JSON.

Campos:
- "tienda": la tienda Ripley mencionada (ej: "santa anita", "RIPLEY JOCKEY PLAZA"). Si no la menciona, deja "".
- "equipo": el equipo mencionado (ej: "roof top 3", "RT 12", "AA Roof Top 03"). Si no lo menciona, deja "".
- "observacion": el hallazgo redactado de forma CLARA, PROFESIONAL y concisa (corrige ortografía; integra todo lo que el técnico haya dicho; NO inventes datos que no dijo).
- "estado": "PENDIENTE" por defecto (hallazgo nuevo sin resolver). "EN_PROCESO" si dice que ya están trabajando en ello. "OK" si dice que ya se resolvió/reparó.

Luego, usando la GUÍA de abajo (qué debe cubrir una buena observación según el tipo de hallazgo), decide si falta UN dato importante:
- "faltaDetalle": true SOLO si falta un dato que un supervisor de mantenimiento realmente necesitaría y que el técnico podría dar fácilmente. Si la observación ya es suficiente, false. No insistas en detalles menores.
- "pregunta": si "faltaDetalle" es true, UNA sola pregunta corta y amable en español para conseguir ese dato. Si es false, "".
Máximo una pregunta. Si el técnico no menciona tienda o equipo, NO preguntes por eso aquí (eso se gestiona aparte): pon faltaDetalle según el contenido técnico del hallazgo.

GUÍA (la edita el admin):
{GUIA}

Responde SOLO el JSON, sin texto adicional.`;

export async function estructurarObservacion(texto, imagenB64, mime, guiaTexto) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta GEMINI_API_KEY');
  const parts = [];
  if (imagenB64) parts.push({ inline_data: { mime_type: mime || 'image/jpeg', data: imagenB64 } });
  const prompt = PROMPT.replace('{GUIA}', guiaTexto || '(sin guía configurada)');
  parts.push({ text: prompt + '\n\nMensaje del técnico:\n' + (texto || '(sin texto; analiza la imagen)') });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  };
  const res = await fetch(ENDPOINT(MODELO()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + (await res.text().catch(() => '')));
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}
