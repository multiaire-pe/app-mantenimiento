// Estructura el mensaje del técnico (texto y/o foto) en una observación.
// Patrón REST de Gemini (igual que comprobantes.html): responseSchema fuerza JSON válido.
// La key viene de GEMINI_API_KEY (env var), nunca del front.
//
// Extrae {sede, equipo, observacion, estado} contra el inventario REAL (varias sedes y tipos
// de equipo). Además, con la GUÍA editable (manta_guia), decide si falta UN dato importante.
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const MODELO = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'; // razona mejor que flash-lite

const SCHEMA = {
  type: 'object',
  properties: {
    sede: { type: 'string' },
    equipo: { type: 'string' },
    observacion: { type: 'string' },
    estado: { type: 'string', enum: ['PENDIENTE', 'EN_PROCESO', 'OK'] },
    faltaDetalle: { type: 'boolean' },
    pregunta: { type: 'string' },
  },
  required: ['sede', 'equipo', 'observacion', 'estado', 'faltaDetalle', 'pregunta'],
};

const PROMPT = `Eres el asistente de observaciones de mantenimiento de MultiAire (equipos de climatización y ventilación: cortinas de aire, extractores, splits, UMA, chillers, fan coils, inyectores, paquetes/roof tops, etc.) instalados en varias sedes/tiendas.
Un técnico te describe, por WhatsApp, un hallazgo de un equipo. Pueden venir varios mensajes acumulados. Extrae los datos en JSON.

Campos:
- "sede": la sede/tienda donde está el equipo (ej: "atocongo", "santa anita", "jockey plaza"). Si no la menciona, deja "".
- "equipo": cómo el técnico identifica el equipo, copiado tal cual: su código (ej: "MA-ATO-CAI-001"), su tipo y número (ej: "cortina de aire 1", "extractor 3", "chiller 2"), o su ubicación (ej: "el chiller de la azotea"). NO inventes. Si no lo menciona, deja "".
- "observacion": el hallazgo redactado de forma CLARA, PROFESIONAL y concisa (corrige ortografía; integra todo lo que dijo; NO inventes datos que no dijo).
- "estado": "PENDIENTE" por defecto (hallazgo nuevo sin resolver). "EN_PROCESO" si dice que ya están trabajando en ello. "OK" si dice que ya se resolvió/reparó.

Luego, usando la GUÍA de abajo (qué debe cubrir una buena observación según el tipo de hallazgo), decide si falta UN dato importante:
- "faltaDetalle": true SOLO si falta un dato que un supervisor de mantenimiento realmente necesitaría y que el técnico podría dar fácilmente. Si la observación ya es suficiente, false. No insistas en detalles menores.
- "pregunta": si "faltaDetalle" es true, UNA sola pregunta corta y amable en español para conseguir ese dato. Si es false, "".
Máximo una pregunta. Si el técnico no menciona sede o equipo, NO preguntes por eso aquí (eso se gestiona aparte).
La pregunta DEBE ser pertinente al TIPO de equipo de la observación. Nunca preguntes por un componente que ese tipo de equipo NO tiene:
- Cortinas de aire, extractores, inyectores y UMA son equipos de VENTILACIÓN: NO tienen compresor ni gas refrigerante. Para ellos pregunta por el motor/ventilador, el flujo de aire, vibración o ruido — nunca por compresor/refrigerante.
- Splits, chillers, fan coils y paquetes/roof tops sí pueden tener compresor y gas refrigerante.
Si la guía no encaja con ese tipo de equipo, haz una pregunta genérica útil o pon "faltaDetalle": false (mejor no preguntar que preguntar algo que no aplica).

SEDES Y TIPOS de equipo disponibles (úsalos para reconocer la sede y el tipo):
{CONTEXTO}

GUÍA (la edita el admin):
{GUIA}

Responde SOLO el JSON, sin texto adicional.`;

// Llamada REST compartida: arma el body con el schema/tope de tokens dado, reintenta ante
// 429/5xx transitorios (backoff 1.5s/3s) y parsea el JSON de la respuesta (defensivo: extrae
// el primer {...} si viene con texto alrededor). La usan estructurarObservacion (Fase 3) y
// corregirSedeEquipo (registro de mtto) — mismo patrón REST, distinto prompt/schema.
async function _llamarGeminiJSON(contents, schema, maxOutputTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta GEMINI_API_KEY');
  const body = {
    contents,
    generationConfig: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinkingConfig: { thinkingBudget: 0 },   // sin "thinking": JSON estructurado fiable y más rápido
    },
  };
  // El free tier de Gemini da 429 (rate limit) con llamadas seguidas, y a veces 5xx transitorios.
  // Reintentamos con backoff para que el bot se recupere solo en vez de pedirle al técnico que repita.
  const MAX_INTENTOS = 3;
  let res;
  for (let intento = 1; ; intento++) {
    res = await fetch(ENDPOINT(MODELO()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    const transitorio = res.status === 429 || res.status >= 500;
    if (!transitorio || intento >= MAX_INTENTOS) {
      throw new Error('Gemini ' + res.status + ': ' + (await res.text().catch(() => '')));
    }
    await new Promise((r) => setTimeout(r, intento * 1500));   // backoff: 1.5s, 3s
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Parseo defensivo: extrae el primer objeto {...} por si viene con texto alrededor.
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Gemini: respuesta no es JSON válido: ' + clean.slice(0, 120));
  }
}

export async function estructurarObservacion(texto, imagenB64, mime, guiaTexto, contextoEquipos) {
  const parts = [];
  if (imagenB64) parts.push({ inline_data: { mime_type: mime || 'image/jpeg', data: imagenB64 } });
  const prompt = PROMPT
    .replace('{CONTEXTO}', contextoEquipos || '(sin contexto)')
    .replace('{GUIA}', guiaTexto || '(sin guía configurada)');
  parts.push({ text: prompt + '\n\nMensaje del técnico:\n' + (texto || '(sin texto; analiza la imagen)') });
  return _llamarGeminiJSON([{ parts }], SCHEMA, 2048);
}

// ── Corrección de sede/equipo para el REGISTRO de mantenimiento ─────────────────────────
// El registro de mtto (mtto.js → resolverEquipo) usa un matcher determinístico que NO tolera
// typos de sede ("atokongo", "plasa norte"...) — a diferencia de Observaciones, que ya pasa
// por Gemini antes de resolver. Este paso corrige la ortografía de sede/equipo ANTES del
// matcher, mismo criterio que Observaciones (pedido de Adrián/José, 2026-07-11).
const SCHEMA_SEDE_EQUIPO = {
  type: 'object',
  properties: {
    sede: { type: 'string' },
    equipo: { type: 'string' },
  },
  required: ['sede', 'equipo'],
};

const PROMPT_SEDE_EQUIPO = `Eres el asistente de mantenimiento preventivo de MultiAire (equipos de climatización y ventilación: cortinas de aire, extractores, splits, UMA, chillers, fan coils, inyectores, paquetes/roof tops, etc.) instalados en varias sedes/tiendas.
Un técnico te dice, por WhatsApp, en qué equipo va a registrar actividades de mantenimiento. Puede tener errores de ortografía o de tipeo. Extrae en JSON:
- "sede": la sede/tienda del equipo, CORRIGIENDO errores de tipeo para que coincida con una sede REAL de la lista de abajo (ej: "atokongo"→"Atocongo", "plasa norte"→"Plaza Norte", "megaplasa"→"Megaplaza"). Si no puedes identificarla con confianza contra la lista, o no la menciona, deja "".
- "equipo": cómo el técnico identifica el equipo — su código (ej: "MA-ATO-CAI-001"), su tipo y número (ej: "cortina de aire 1", "rooftop 3"), o su ubicación. Corrige errores de tipeo evidentes (ej: "rutop"→"rooftop"). Copia el resto tal cual lo dijo el técnico — NO inventes datos que no dijo. Si no lo menciona, deja "".

SEDES Y TIPOS de equipo disponibles (úsalos para reconocer y corregir):
{CONTEXTO}

Responde SOLO el JSON, sin texto adicional.`;

export async function corregirSedeEquipo(texto, contextoEquipos) {
  const prompt = PROMPT_SEDE_EQUIPO.replace('{CONTEXTO}', contextoEquipos || '(sin contexto)');
  const parts = [{ text: prompt + '\n\nMensaje del técnico:\n' + (texto || '') }];
  return _llamarGeminiJSON([{ parts }], SCHEMA_SEDE_EQUIPO, 512);
}
