// Pruebas del adaptador de Telegram. No tocan Firestore ni la red: el handler recibe `deps`
// inyectables (mismo patrón que el resto de las suites del bot).  Uso: node tests/telegram.test.mjs
import { htmlDeWa } from '../api/_lib/telegram.js';
import { normalizarUpdate, procesarUpdate, secretValido } from '../api/telegram.js';

let ok = 0, mal = 0;
const t = (nombre, cond, extra = '') => { if (cond) ok++; else { mal++; console.log('✗', nombre, extra); } };

// ── htmlDeWa ─────────────────────────────────────────────────────────────────────────────
t('negrita', htmlDeWa('hola *mundo*') === 'hola <b>mundo</b>');
t('cursiva', htmlDeWa('_(o dime la ubicación)_') === '<i>(o dime la ubicación)</i>');
t('escapa html', htmlDeWa('a < b & c > d') === 'a &lt; b &amp; c &gt; d');
t('no toca guion bajo dentro de palabra', htmlDeWa('corr_ENTRADA_TIE005') === 'corr_ENTRADA_TIE005');
t('negrita+emoji', htmlDeWa('🔧 *Extractor 04 · 📍 comedor*') === '🔧 <b>Extractor 04 · 📍 comedor</b>');
t('inyección neutralizada', !htmlDeWa('*<script>x</script>*').includes('<script>'));

// ── secret ───────────────────────────────────────────────────────────────────────────────
t('secret ok', secretValido('abc123', 'abc123'));
t('secret distinto', !secretValido('abc124', 'abc123'));
t('sin secret configurado → rechaza', !secretValido('abc', ''));
t('sin header → rechaza', !secretValido('', 'abc'));

// ── normalizarUpdate ─────────────────────────────────────────────────────────────────────
const priv = { id: 7, type: 'private' };
t('texto', normalizarUpdate({ message: { chat: priv, from: { id: 7 }, text: 'hola' } }).texto === 'hola');
t('grupo ignorado', normalizarUpdate({ message: { chat: { id: 1, type: 'group' }, text: 'x' } }) === null);
const loc = normalizarUpdate({ message: { chat: priv, from: { id: 7 }, location: { latitude: -12.1, longitude: -77.0 } } });
t('ubicación', loc.tipo === 'location' && loc.ubicacion.lat === -12.1 && loc.ubicacion.lng === -77.0);
const foto = normalizarUpdate({ message: { chat: priv, from: { id: 7 }, caption: 'fuga', photo: [{ file_id: 'chica' }, { file_id: 'grande' }] } });
t('foto toma la mayor + caption', foto.tipo === 'image' && foto.fileId === 'grande' && foto.texto === 'fuga');
const cbq = normalizarUpdate({ callback_query: { id: 'c1', from: { id: 7 }, data: 'si', message: { message_id: 9, chat: priv } } });
t('callback: data como texto', cbq.texto === 'si' && cbq.callbackId === 'c1' && cbq.messageId === 9);
t('sticker → otro', normalizarUpdate({ message: { chat: priv, from: { id: 7 }, sticker: {} } }).tipo === 'otro');

// ── procesarUpdate con deps falsas ───────────────────────────────────────────────────────
function mkDeps(over = {}) {
  const log = { env: [], liberados: [], vinculos: [], manejarMensaje: [], visto: new Set() };
  const tec = { id: 'PER1', nombre: 'ANA' };
  return {
    log,
    yaProcesado: async (id) => { if (log.visto.has(id)) return true; log.visto.add(id); return false; },
    liberarMensaje: async (id) => { log.liberados.push(id); log.visto.delete(id); },
    identificarPorTelegram: async (chat) => (chat === 7 ? tec : null),
    vincularTelegram: async (chat, tel) => { log.vinculos.push([chat, tel]); return tel === '51999' ? tec : null; },
    tg: {
      responderCallback: async () => ({}), quitarBotones: async () => ({}),
      enviarTexto: async (c, x, e) => { log.env.push({ c, x, e }); return true; },
      enviarRespuestaTg: async (c, r) => { log.env.push({ c, r }); },
      descargarArchivo: async () => ({ base64: 'QQ==', mime: 'image/jpeg' }),
      TECLADO_CONTACTO: { k: 'contacto' }, TECLADO_UBICACION: { k: 'ubic' },
    },
    manejarMensaje: async (a) => { log.manejarMensaje.push(a); return 'resp-obs'; },
    guardarObservacion: async () => ({ id: 'O1' }), notificarSupervisores: async () => 0,
    decidirFlujo: async () => 'observaciones', manejarAsistencia: async () => 'resp-asis', manejarMtto: async () => 'resp-mtto',
    getSesionMtto: async () => null, MENU_TEXTO: 'MENU', MENU_BOTONES: [{ id: '1', title: 'M' }],
    ...over,
  };
}
const msg = (extra, chat = 7, uid = 7) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chat, type: 'private' }, from: { id: uid }, ...extra } });

{ // técnico sin vincular → pide el contacto, no corre ningún flujo
  const d = mkDeps(); await procesarUpdate(msg({ text: 'hola' }, 99, 99), d);
  t('sin vincular: pide contacto', d.log.env.length === 1 && d.log.env[0].e?.reply_markup?.k === 'contacto');
  t('sin vincular: no corre el bot', d.log.manejarMensaje.length === 0);
}
{ // contacto AJENO (reenviado) → rechazado, no vincula
  const d = mkDeps(); await procesarUpdate(msg({ contact: { phone_number: '51999', user_id: 12345 } }, 99, 99), d);
  t('contacto ajeno: no vincula', d.log.vinculos.length === 0);
  t('contacto ajeno: avisa', /no es tuyo/.test(d.log.env[0].x));
}
{ // contacto sin user_id → rechazado
  const d = mkDeps(); await procesarUpdate(msg({ contact: { phone_number: '51999' } }, 99, 99), d);
  t('contacto sin user_id: no vincula', d.log.vinculos.length === 0);
}
{ // contacto propio con número conocido → vincula y manda menú
  const d = mkDeps(); await procesarUpdate(msg({ contact: { phone_number: '51999', user_id: 99 } }, 99, 99), d);
  t('contacto propio: vincula', d.log.vinculos.length === 1 && d.log.vinculos[0][0] === 99);
  t('contacto propio: teclado de ubicación + menú', d.log.env.some((e) => e.e?.reply_markup?.k === 'ubic') && d.log.env.some((e) => e.r?.texto === 'MENU'));
}
{ // contacto propio con número desconocido
  const d = mkDeps(); await procesarUpdate(msg({ contact: { phone_number: '51000', user_id: 99 } }, 99, 99), d);
  t('número desconocido: avisa', /No encuentro ese número/.test(d.log.env[0].x));
}
{ // técnico vinculado escribe texto → motor de observaciones con from=tg<chat>
  const d = mkDeps(); await procesarUpdate(msg({ text: 'fuga en rooftop' }), d);
  t('texto: llega al motor con from tg7', d.log.manejarMensaje[0]?.from === 'tg7' && d.log.manejarMensaje[0].texto === 'fuga en rooftop');
  t('texto: responde', d.log.env.at(-1).r === 'resp-obs');
}
{ // /start → menú sin pasar por el router
  const d = mkDeps(); await procesarUpdate(msg({ text: '/start' }), d);
  t('/start: menú', d.log.env[0].r.texto === 'MENU' && d.log.manejarMensaje.length === 0);
}
{ // foto
  const d = mkDeps(); await procesarUpdate(msg({ caption: 'x', photo: [{ file_id: 'f' }] }), d);
  t('foto: se descarga y llega al motor', d.log.manejarMensaje[0]?.imagenB64 === 'QQ==');
}
{ // foto que no se puede descargar
  const d = mkDeps(); d.tg.descargarArchivo = async () => null;
  await procesarUpdate(msg({ photo: [{ file_id: 'f' }] }), d);
  t('foto sin descarga: pide reenviar', /reenvías/.test(d.log.env[0].x) && d.log.manejarMensaje.length === 0);
}
{ // ubicación → flujo asistencia recibe coordenadas
  let recibido; const d = mkDeps({ decidirFlujo: async () => 'asistencia', manejarAsistencia: async (a) => { recibido = a; return 'ok'; } });
  await procesarUpdate(msg({ location: { latitude: -12, longitude: -77 } }), d);
  t('ubicación → asistencia', recibido?.ubicacion?.lat === -12 && recibido.from === 'tg7');
}
{ // botón (callback_query) → su data entra como texto
  const d = mkDeps(); await procesarUpdate({ update_id: 5, callback_query: { id: 'c', from: { id: 7 }, data: 'si', message: { message_id: 3, chat: { id: 7, type: 'private' } } } }, d);
  t('callback: data como texto', d.log.manejarMensaje[0]?.texto === 'si');
}
{ // duplicado
  const d = mkDeps(); const u = msg({ text: 'a' }); await procesarUpdate(u, d); await procesarUpdate(u, d);
  t('duplicado: se procesa una sola vez', d.log.manejarMensaje.length === 1);
}
{ // fallo ANTES de escribir → libera la marca y es recuperable
  const d = mkDeps({ manejarMensaje: async () => { throw new Error('boom'); } });
  let err; try { await procesarUpdate(msg({ text: 'a' }), d); } catch (e) { err = e; }
  t('fallo pre-escritura: recuperable + libera', err?.recuperable === true && d.log.liberados.length === 1);
}
{ // fallo DESPUÉS de empezar a escribir → NO libera (duplicaría)
  const d = mkDeps({ manejarMensaje: async (a) => { await a.guardar({}, {}, null); throw new Error('boom'); } });
  let err; try { await procesarUpdate(msg({ text: 'a' }), d); } catch (e) { err = e; }
  t('fallo post-escritura: no libera', !err?.recuperable && d.log.liberados.length === 0);
}
{ // mensaje de grupo → ignorado en silencio
  const d = mkDeps(); await procesarUpdate({ update_id: 1, message: { chat: { id: 1, type: 'group' }, text: 'x' } }, d);
  t('grupo: no responde', d.log.env.length === 0);
}

// ── Cliente de la Bot API (fetch simulado) ───────────────────────────────────────────────
{
  const tg = await import('../api/_lib/telegram.js');
  process.env.TELEGRAM_BOT_TOKEN = 'TOK';
  const llamadas = [];
  const conRespuestas = (respuestas) => {
    let i = 0;
    globalThis.fetch = async (url, init) => {
      llamadas.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      const r = respuestas[Math.min(i++, respuestas.length - 1)];
      return { ok: r.status < 400, status: r.status, text: async () => r.text || '', json: async () => ({ result: r.result || {} }) };
    };
  };

  conRespuestas([{ status: 200 }]);
  t('envío ok', (await tg.enviarTextoDetalle(7, 'hola *x*')).ok && llamadas.at(-1).body.parse_mode === 'HTML' && llamadas.at(-1).body.text === 'hola <b>x</b>');

  llamadas.length = 0;
  conRespuestas([{ status: 400, text: "Bad Request: can't parse entities" }, { status: 200 }]);
  const rp = await tg.enviarTextoDetalle(7, 'hola *x*');
  t('formato inválido → reintenta en texto plano', rp.ok && llamadas.length === 2 && !('parse_mode' in llamadas[1].body) && llamadas[1].body.text === 'hola *x*');

  conRespuestas([{ status: 400, text: 'Forbidden: bot was blocked by the user' }]);
  const rb = await tg.enviarTextoDetalle(7, 'x');
  t('bloqueado por el usuario → rechazado definitivo', !rb.ok && rb.estado === 'rechazado');

  conRespuestas([{ status: 502 }]);
  t('5xx → ambiguo', (await tg.enviarTextoDetalle(7, 'x')).estado === 'ambiguo');

  globalThis.fetch = async () => { throw new Error('timeout'); };
  t('excepción → ambiguo', (await tg.enviarTextoDetalle(7, 'x')).estado === 'ambiguo');

  llamadas.length = 0;
  conRespuestas([{ status: 200 }]);
  await tg.enviarBotonesDetalle(7, 'elige', [{ id: 'si', title: '✅ Sí' }, { id: 'x'.repeat(100), title: 'largo' }]);
  const kb = llamadas.at(-1).body.reply_markup.inline_keyboard;
  t('botones: uno por fila', kb.length === 2 && kb[0][0].callback_data === 'si');
  t('callback_data ≤ 64 bytes', Buffer.byteLength(kb[1][0].callback_data) <= 64);

  llamadas.length = 0;
  await tg.enviarListaDetalle(7, 'tipo?', [{ id: 'SPLIT', title: 'SPLIT', description: '3 equipo(s)' }]);
  t('lista: título · descripción', llamadas.at(-1).body.reply_markup.inline_keyboard[0][0].text === 'SPLIT · 3 equipo(s)');

  llamadas.length = 0;
  await tg.enviarTextoDetalle(7, 'a'.repeat(9000));
  t('recorta a 4000 antes de traducir', llamadas.at(-1).body.text.length === 4000);

  delete process.env.TELEGRAM_BOT_TOKEN;
  t('sin token → sin_credenciales', (await tg.enviarTextoDetalle(7, 'x')).estado === 'sin_credenciales');
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
