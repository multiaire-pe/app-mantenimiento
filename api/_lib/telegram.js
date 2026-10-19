// Helpers para hablar con la Bot API de Telegram.
// Requiere TELEGRAM_BOT_TOKEN. Los flujos del bot (conversacion/mtto/asistencia) devuelven
// respuestas en el formato de siempre —texto, {texto, botones}, {texto, lista}, {mensajes}— y
// escriben con la sintaxis de WhatsApp (*negrita*, _cursiva_): este módulo las traduce.
const API = 'https://api.telegram.org';

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';

// Mismo criterio que whatsapp.js: un `false` a secas no distingue "no se envió" de "no se sabe".
// Estados: 'ok' | 'rechazado' (4xx: definitivo) | 'ambiguo' (excepción/timeout/5xx) | 'sin_credenciales'.
async function llamar(metodo, cuerpo) {
  if (!token()) {
    console.warn(`[telegram] falta TELEGRAM_BOT_TOKEN — no se ejecutó ${metodo}`);
    return { ok: false, estado: 'sin_credenciales' };
  }
  try {
    const res = await fetch(`${API}/bot${token()}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!res.ok) {
      const detalle = String(await res.text().catch(() => '')).slice(0, 400);
      console.error(`[telegram] ${metodo}:`, res.status, detalle);
      return { ok: false, estado: res.status >= 500 ? 'ambiguo' : 'rechazado', status: res.status, detalle };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, estado: 'ok', result: json.result };
  } catch (e) {
    console.error(`[telegram] excepción en ${metodo}:`, e.message);
    return { ok: false, estado: 'ambiguo', detalle: String(e.message).slice(0, 400) };
  }
}

// WhatsApp → HTML de Telegram. Se escapa PRIMERO (el texto trae datos de Firestore y del
// técnico: un "<" sin escapar haría que Telegram rechace el mensaje entero) y después se
// traducen las marcas. La cursiva exige bordes de palabra para no tocar `corr_ENTRADA_TIE005`.
export function htmlDeWa(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(¿¡])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<i>$2</i>');
}

const LIMITE = 4000;   // Telegram corta en 4096 caracteres por mensaje

export async function enviarTextoDetalle(chatId, texto, extra = {}) {
  // Se recorta ANTES de traducir: cortar después podría dejar una etiqueta HTML a medias.
  const crudo = String(texto == null ? '' : texto).slice(0, LIMITE);
  const r = await llamar('sendMessage', { chat_id: chatId, text: htmlDeWa(crudo), parse_mode: 'HTML', ...extra });
  // Si Telegram no pudo interpretar el formato (400 "can't parse entities"), el mensaje se
  // manda igual como texto plano: perder el formato es mejor que perder la respuesta.
  if (!r.ok && r.status === 400 && /parse|entit/i.test(r.detalle || '')) {
    return llamar('sendMessage', { chat_id: chatId, text: crudo, ...extra });
  }
  return r;
}

export async function enviarTexto(chatId, texto, extra) {
  return (await enviarTextoDetalle(chatId, texto, extra)).ok;
}

// callback_data admite hasta 64 BYTES (no caracteres). Los ids de los flujos son cortos
// ('si', 'corr_ENTRADA_TIE005', el nombre de un tipo), pero se recorta por bytes por si acaso.
function cb(id) {
  let s = String(id);
  while (Buffer.byteLength(s, 'utf8') > 64) s = s.slice(0, -1);
  return s;
}

// Un botón por fila: en el celular se tocan mejor que varios apretados en una fila.
const tecladoInline = (filas) => ({ inline_keyboard: filas.map((f) => [{ text: String(f.text).slice(0, 60), callback_data: cb(f.id) }]) });

export const enviarBotonesDetalle = (chatId, texto, botones) =>
  enviarTextoDetalle(chatId, texto, {
    reply_markup: tecladoInline((botones || []).map((b) => ({ id: b.id, text: b.title }))),
  });

// Las listas de WhatsApp tenían tope de 10 filas; acá no hace falta recortar (Telegram admite
// muchas más), así que el índice que ve el técnico es siempre el real.
export const enviarListaDetalle = (chatId, texto, filas) =>
  enviarTextoDetalle(chatId, texto, {
    reply_markup: tecladoInline((filas || []).map((f) => ({ id: f.id, text: f.description ? `${f.title} · ${f.description}` : f.title }))),
  });

// Teclado persistente con "Compartir ubicación": el marcaje de asistencia exige ubicación, y
// con este botón el técnico la manda de un toque en vez de buscarla en el clip 📎.
export const TECLADO_UBICACION = {
  keyboard: [[{ text: '📍 Compartir ubicación', request_location: true }]],
  resize_keyboard: true,
  is_persistent: true,
};

// Pide el contacto del técnico para vincular su cuenta. one_time: desaparece tras usarlo.
export const TECLADO_CONTACTO = {
  keyboard: [[{ text: '📱 Compartir mi número', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const responderCallback = (callbackId) => llamar('answerCallbackQuery', { callback_query_id: callbackId });

// Quita los botones de un mensaje ya respondido (evita el doble toque sobre una confirmación).
export const quitarBotones = (chatId, messageId) =>
  llamar('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });

// Mismo contrato que `enviarRespuesta` de whatsapp.js. Si el teclado falla, el técnico igual
// recibe la pregunta como texto: repetir una PREGUNTA es inofensivo.
export async function enviarRespuestaTg(chatId, resp) {
  if (!resp) return;
  if (typeof resp === 'string') { await enviarTexto(chatId, resp); return; }
  if (Array.isArray(resp.mensajes)) { for (const m of resp.mensajes) await enviarRespuestaTg(chatId, m); return; }
  if (resp.botones) {
    const r = await enviarBotonesDetalle(chatId, resp.texto, resp.botones);
    if (!r.ok) await enviarTexto(chatId, resp.texto);
    return;
  }
  if (resp.lista) {
    const r = await enviarListaDetalle(chatId, resp.texto, resp.lista);
    if (!r.ok) await enviarTexto(chatId, resp.texto);
    return;
  }
  await enviarTexto(chatId, resp.texto || '');
}

const MIME_POR_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Descarga un archivo (foto) por su file_id. Devuelve { base64, mime, bytes } o null.
export async function descargarArchivo(fileId) {
  if (!fileId || !token()) return null;
  try {
    const meta = await llamar('getFile', { file_id: fileId });
    const ruta = meta.ok && meta.result && meta.result.file_path;
    if (!ruta) return null;
    const res = await fetch(`${API}/file/bot${token()}/${ruta}`);
    if (!res.ok) { console.error('[telegram] descarga', res.status); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = String(ruta).split('.').pop().toLowerCase();
    return { base64: buf.toString('base64'), mime: MIME_POR_EXT[ext] || 'image/jpeg', bytes: buf.length };
  } catch (e) {
    console.error('[telegram] excepción al descargar:', e.message);
    return null;
  }
}
