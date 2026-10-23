// ── Webhook de Telegram — mismo bot de MultiAire (observaciones · mantenimiento · asistencia) ──
// Backend serverless en Vercel. Secretos solo en variables de entorno:
//   TELEGRAM_BOT_TOKEN       token que entrega @BotFather
//   TELEGRAM_WEBHOOK_SECRET  valor que se fija en setWebhook (secret_token); Telegram lo reenvía en
//                            el header X-Telegram-Bot-Api-Secret-Token de cada POST.
//
// Este endpoint es solo el ADAPTADOR de canal: traduce un update de Telegram al mismo formato que
// ya consumen los flujos (conversacion.js / mtto.js / asistencia.js) y manda sus respuestas de vuelta.
// La lógica del bot NO se toca. `from` (la llave de las sesiones wa_*) es `tg<chat_id>`: así nunca
// choca con un número de WhatsApp y los dos canales pueden convivir durante la transición.
//
// Endpoint: https://<dominio>/api/telegram   (POST)

import crypto from 'node:crypto';

// Cada dependencia se importa dinámicamente la primera vez: el módulo se puede importar en un
// test sin arrastrar firebase-admin, y `procesarUpdate` recibe `deps` inyectables.
async function depsReales() {
  const [idem, ident, tg, conv, esc, av, rout, asis, mt, mtSes, obsSes, asisSes, fotos] = await Promise.all([
    import('./_lib/idempotencia.js'), import('./_lib/identidad.js'), import('./_lib/telegram.js'),
    import('./_lib/conversacion.js'), import('./_lib/escritura.js'), import('./_lib/avisos.js'),
    import('./_lib/router.js'), import('./_lib/asistencia.js'), import('./_lib/mtto.js'),
    import('./_lib/mtto_sesiones.js'), import('./_lib/sesiones.js'), import('./_lib/asistencia_sesiones.js'),
    import('./_lib/fotos.js'),
  ]);
  return {
    yaProcesado: idem.yaProcesado, liberarMensaje: idem.liberarMensaje,
    identificarPorTelegram: ident.identificarPorTelegram, vincularTelegram: ident.vincularTelegram,
    tg, manejarMensaje: conv.manejarMensaje, guardarObservacion: esc.guardarObservacion,
    notificarSupervisores: av.notificarSupervisores, decidirFlujo: rout.decidirFlujo,
    manejarAsistencia: asis.manejarAsistencia, manejarMtto: mt.manejarMtto,
    MENU_TEXTO: mt.MENU_TEXTO, MENU_BOTONES: mt.MENU_BOTONES, getSesionMtto: mtSes.getSesion,
    // Corta CUALQUIER conversación a medias (observación + su foto pendiente, asistencia + su selfie,
    // mantenimiento). Lo usan /menu y /cancelar: sin esto, lo que el técnico toque después se
    // mezclaría con la conversación vieja.
    limpiarSesiones: (from) => Promise.all([
      obsSes.limpiarSesion(from), fotos.limpiarFotoPendiente(from),
      asisSes.limpiarSesion(from), mtSes.limpiarSesion(from),
    ]),
  };
}

const SECRET = () => process.env.TELEGRAM_WEBHOOK_SECRET || '';

// Compara el secret del header en tiempo constante. Sin secret configurado se rechaza TODO
// (fail-closed): un webhook abierto dejaría a cualquiera fabricar mensajes de un técnico.
export function secretValido(header, esperado = SECRET()) {
  if (!esperado || !header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }
  if (!secretValido(req.headers['x-telegram-bot-api-secret-token'])) {
    return res.status(401).send('Secret inválido');
  }
  // Vercel ya parseó el JSON; si llegara como string se parsea acá.
  let update = req.body;
  if (typeof update === 'string') { try { update = JSON.parse(update); } catch { return res.status(200).send('OK'); } }
  if (!update || typeof update !== 'object') return res.status(200).send('OK');

  try {
    await procesarUpdate(update, await depsReales());
  } catch (e) {
    console.error('[telegram] error procesando update', update.update_id, e?.message);
    // Fallo ANTES de escribir → 500 para que Telegram reintente (la marca de idempotencia ya se
    // liberó). Si ya se había empezado a escribir NO se reintenta: duplicaría el registro.
    if (e?.recuperable) return res.status(500).send('RETRY');
  }
  return res.status(200).send('OK');
}

// Lo que el técnico tocó/escribió, normalizado. Devuelve null si el update no es para nosotros
// (grupos, canales, ediciones, tipos que no soportamos).
export function normalizarUpdate(update) {
  const cbq = update.callback_query;
  if (cbq) {
    const m = cbq.message;
    if (!m || m.chat?.type !== 'private') return null;
    return { chatId: m.chat.id, userId: cbq.from?.id, texto: String(cbq.data || ''), tipo: 'text',
      callbackId: cbq.id, messageId: m.message_id };
  }
  const m = update.message;
  if (!m || m.chat?.type !== 'private') return null;
  const base = { chatId: m.chat.id, userId: m.from?.id, texto: '', tipo: 'text' };
  if (m.contact) return { ...base, tipo: 'contact', contacto: m.contact };
  if (m.location) {
    return { ...base, tipo: 'location',
      ubicacion: { lat: Number(m.location.latitude), lng: Number(m.location.longitude) } };
  }
  if (Array.isArray(m.photo) && m.photo.length) {
    // Telegram manda varias resoluciones de la misma foto, de menor a mayor: la última es la mejor.
    return { ...base, tipo: 'image', texto: m.caption || '', fileId: m.photo[m.photo.length - 1].file_id,
      grupo: m.media_group_id || null };   // varias fotos juntas = un álbum: se responde UNA vez
  }
  if (typeof m.text === 'string') return { ...base, texto: m.text };
  return { ...base, tipo: 'otro' };   // audio, sticker, documento, etc.
}

const TXT_VINCULAR =
  '👋 Hola, soy el bot de MultiAire.\n\nPara usarlo necesito saber quién eres. ' +
  'Toca el botón de abajo para compartir tu número (el mismo que tiene registrado la oficina).';

export async function procesarUpdate(update, d) {
  const n = normalizarUpdate(update);
  if (!n) return;
  const { chatId } = n;
  const from = `tg${chatId}`;

  // Idempotencia por update_id (Telegram reintenta si no recibe 200). Si la propia marca falla
  // (Firestore caído) todavía no se escribió nada: es recuperable, así Telegram reintenta.
  let duplicado;
  try {
    duplicado = update.update_id != null && await d.yaProcesado(`tg_${update.update_id}`, { from, type: n.tipo });
  } catch (e) { e.recuperable = true; throw e; }
  if (duplicado) {
    console.log('[telegram] duplicado ignorado:', update.update_id);
    return;
  }
  if (n.callbackId) d.tg.responderCallback(n.callbackId).catch(() => {});   // quita el "cargando" del botón

  let escrituraIniciada = false;
  try {
    // ── Vinculación: el técnico comparte su contacto ────────────────────────────────────────
    if (n.tipo === 'contact') {
      // SOLO se acepta el contacto PROPIO: Telegram también deja reenviar la tarjeta de otra
      // persona, y sin esta comprobación cualquiera podría vincularse al número de un compañero.
      if (!n.contacto.user_id || n.contacto.user_id !== n.userId) {
        await d.tg.enviarTexto(chatId, '⚠️ Ese contacto no es tuyo. Usa el botón *Compartir mi número* para enviar el tuyo.',
          { reply_markup: d.tg.TECLADO_CONTACTO });
        return;
      }
      const t = await d.vincularTelegram(chatId, n.contacto.phone_number);
      if (!t) {
        await d.tg.enviarTexto(chatId, '🤔 No encuentro ese número en el sistema de MultiAire. Pídele al administrador que lo registre en *Personal* y vuelve a intentarlo.');
        return;
      }
      await d.tg.enviarTexto(chatId, `✅ Listo, *${t.nombre}*. Ya estás vinculado.\n\nTe dejé abajo los botones para moverte rápido: *Mantenimiento*, *Observación*, *Asistencia* y *Compartir ubicación*.`,
        { reply_markup: d.tg.TECLADO_PRINCIPAL });
      await d.tg.enviarRespuestaTg(chatId, { texto: d.MENU_TEXTO, botones: d.MENU_BOTONES });
      return;
    }

    // ── Identidad ───────────────────────────────────────────────────────────────────────────
    const tecnico = await d.identificarPorTelegram(chatId);
    if (!tecnico) {
      await d.tg.enviarTexto(chatId, TXT_VINCULAR, { reply_markup: d.tg.TECLADO_CONTACTO });
      return;
    }

    if (n.messageId) d.tg.quitarBotones(chatId, n.messageId).catch(() => {});   // evita el doble toque

    // TECLAS DEL TECLADO FIJO (🔧 Mantenimiento / 📝 Observación / 🕐 Asistencia): empezar una acción
    // es abandonar la anterior, así que primero se corta lo que estuviera en curso (igual que los
    // comandos) y el texto se traduce a la opción 1/2/3 que ya entiende el router. Solo coincide el
    // rótulo EXACTO del botón: un técnico que escribe "mantenimiento" a mano no se toca.
    if (n.tipo === 'text' && d.tg.ACCION_DE_BOTON && d.tg.ACCION_DE_BOTON[n.texto.trim()]) {
      await d.limpiarSesiones(from);
      n.texto = d.tg.ACCION_DE_BOTON[n.texto.trim()];
    }

    // COMANDOS. Solo hay dos que el técnico usa: /menu y /cancelar (más /start, que es lo que manda
    // el botón "Iniciar" de Telegram y se comporta como /menu). Ambos cortan primero lo que esté en
    // curso. Cualquier otro "/algo" NO se manda al motor de observaciones (abriría un borrador
    // absurdo con el texto "/algo"): se le dice que no existe.
    if (n.tipo === 'text' && n.texto.trim().startsWith('/')) {
      const cmd = n.texto.trim().split(/\s+/)[0].replace(/@[A-Za-z0-9_]+$/, '').toLowerCase();
      // El menú sale con el TECLADO FIJO (no con botones en el mensaje): un mensaje no puede llevar
      // los dos, y así quien ya estaba vinculado antes de existir el teclado lo recibe al tocar Menú.
      if (cmd === '/menu' || cmd === '/start') {
        await d.limpiarSesiones(from);
        await d.tg.enviarTexto(chatId, d.MENU_TEXTO, { reply_markup: d.tg.TECLADO_PRINCIPAL });
      } else if (cmd === '/cancelar') {
        await d.limpiarSesiones(from);
        await d.tg.enviarTexto(chatId,
          '❌ Cancelado. Lo que estabas haciendo no se guardó (lo que ya estaba guardado se mantiene).\n\n' + d.MENU_TEXTO,
          { reply_markup: d.tg.TECLADO_PRINCIPAL });
      } else {
        await d.tg.enviarTexto(chatId, 'Ese comando no existe. Usa /menu para ver las opciones o /cancelar para salir de lo que estás haciendo.');
      }
      return;
    }

    let imagenB64 = null, mime = null;
    if (n.tipo === 'image') {
      const media = await d.tg.descargarArchivo(n.fileId);
      if (!media) {
        await d.tg.enviarTexto(chatId, '📷 No pude descargar esa foto (fallo temporal). ¿Me la reenvías?');
        return;
      }
      imagenB64 = media.base64; mime = media.mime;
    }

    // Tipo que no sabemos leer (audio, sticker…): la guía del flujo vivo, igual que en WhatsApp.
    if (n.tipo === 'otro') {
      const flujoRaro = await d.decidirFlujo({ from, tipo: 'otro', texto: '' });
      if (flujoRaro === 'mtto') {
        const sesM = await d.getSesionMtto(from);
        if (sesM?.fase === 'FOTOS') return;   // silencio entre fotos de un álbum
        if (sesM) {
          const resp = await d.manejarMtto({ tecnico, from, texto: '', imagenB64: null, mime: null });
          await d.tg.enviarRespuestaTg(chatId, resp);
        }
      } else if (flujoRaro === 'asistencia') {
        await d.tg.enviarTexto(chatId, '🤔 Eso no lo pude leer. Comparte tu *ubicación* 📍 (o tu selfie) para el marcaje, o escribe *cancelar*.');
      } else {
        await d.tg.enviarTexto(chatId, '📝 Mándame una *observación* (texto o foto), o para marcar tu asistencia escribe *entrada*/*salida* y comparte tu *ubicación* 📍.');
      }
      return;
    }

    const texto = n.texto;
    const ubicacion = n.ubicacion || null;
    console.log('[telegram] mensaje de', tecnico.nombre, `(${tecnico.id})`, '·', n.tipo, '·', texto || '(sin texto)', imagenB64 ? '· 📷' : '', ubicacion ? '· 📍' : '');

    const flujo = await d.decidirFlujo({ from, tipo: n.tipo === 'image' ? 'image' : n.tipo, texto });
    if (flujo === 'menu') {
      await d.tg.enviarRespuestaTg(chatId, { texto: d.MENU_TEXTO, botones: d.MENU_BOTONES });
      return;
    }
    if (flujo === 'hint-obs') {
      await d.tg.enviarTexto(chatId, '📝 Descríbeme la observación: *sede*, *equipo* y el problema (puedes adjuntar una foto). Ej: "fuga de gas en el rooftop 6 de megaplaza".');
      return;
    }
    if (flujo === 'hint-asistencia') {
      await d.tg.enviarTexto(chatId, '🕐 Para marcar, escribe *entrada* o *salida* y comparte tu *ubicación* 📍 (y tu selfie si te la pido).',
        { reply_markup: d.tg.TECLADO_PRINCIPAL });
      return;
    }
    if (flujo === 'mtto') {
      const resp = await d.manejarMtto({ tecnico, from, texto, imagenB64, mime, grupoFoto: n.grupo || null, onWriteStart: () => { escrituraIniciada = true; } });
      await d.tg.enviarRespuestaTg(chatId, resp);
      return;
    }
    if (flujo === 'asistencia') {
      const resp = await d.manejarAsistencia({ tecnico, from, texto, ubicacion, imagenB64, mime });
      await d.tg.enviarRespuestaTg(chatId, resp);
      return;
    }

    const respuesta = await d.manejarMensaje({
      tecnico, from, texto, imagenB64, mime,
      guardar: async (borrador, tec, foto) => {
        escrituraIniciada = true;   // de acá en adelante YA se escribe → no liberar la marca
        const obs = await d.guardarObservacion(borrador, tec, foto);
        // El aviso no debe romper el flujo si falla. (Fase 2: hoy sale por el canal de WhatsApp.)
        d.notificarSupervisores({ obs, tecnico: tec }).catch((e) => console.error('[telegram] aviso falló:', e?.message));
        return obs;
      },
    });
    await d.tg.enviarRespuestaTg(chatId, respuesta);
  } catch (e) {
    if (!escrituraIniciada && update.update_id != null) {
      await d.liberarMensaje(`tg_${update.update_id}`);
      e.recuperable = true;
    }
    throw e;
  }
}
