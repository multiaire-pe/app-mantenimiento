// Pruebas del adaptador de Telegram. No tocan Firestore ni la red: el handler recibe `deps`
// inyectables (mismo patrón que el resto de las suites del bot).  Uso: node tests/telegram.test.mjs
import { htmlDeWa, enviarTextoDetalle, ACCION_DE_BOTON, TECLADO_INICIO, TECLADO_FLUJO, BOTON_CANCELAR, ACCIONES_INICIO } from '../api/_lib/telegram.js';
import { matchTelegram } from '../api/_lib/identidad.js';
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
  const log = { env: [], liberados: [], vinculos: [], manejarMensaje: [], visto: new Set(), limpiadas: [], modos: [] };
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
      TECLADO_CONTACTO: { k: 'contacto' }, TECLADO_INICIO: { k: 'inicio' }, TECLADO_FLUJO: { k: 'flujo' }, ACCION_DE_BOTON, BOTON_CANCELAR,
    },
    manejarMensaje: async (a) => { log.manejarMensaje.push(a); return 'resp-obs'; },
    guardarObservacion: async () => ({ id: 'O1' }), notificarSupervisores: async () => 0,
    decidirFlujo: async () => 'observaciones', manejarAsistencia: async () => 'resp-asis', manejarMtto: async () => 'resp-mtto',
    getSesionMtto: async () => null, MENU_TEXTO: 'MENU', MENU_BOTONES: [{ id: '1', title: 'M' }],
    limpiarSesiones: async (from) => { log.limpiadas.push(from); },
    // teclado fijo variable: por defecto el chat ya tiene el de inicio y no está en ningún flujo
    hayFlujo: async () => !!log.enFlujo,
    getModoTeclado: async () => (log.modo === undefined ? 'inicio' : log.modo),
    setModoTeclado: async (_f, m) => { log.modo = m; log.modos.push(m); },
    ...over,
  };
}
const esMenuTg = (e) => typeof e?.x === 'string' && /Elige una opción aquí abajo/.test(e.x) && !/1️⃣|Responde con el número/.test(e.x) && !e.r && e.e?.reply_markup?.k === 'inicio';
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
  t('contacto propio: teclado de inicio + menú corto sin botones en línea', d.log.env.some((e) => e.e?.reply_markup?.k === 'inicio') && d.log.env.some((e) => /Elige una opción aquí abajo/.test(e.x || '')) && !d.log.env.some((e) => e.r?.botones));
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
  t('/start: UN mensaje, el menú corto con el teclado de inicio', d.log.env.length === 1 && esMenuTg(d.log.env[0]) && d.log.manejarMensaje.length === 0, JSON.stringify(d.log.env));
}
{ // /menu: corta lo que esté en curso y muestra el menú
  const d = mkDeps(); await procesarUpdate(msg({ text: '/menu' }), d);
  t('/menu: corta las sesiones', d.log.limpiadas.join() === 'tg7');
  t('/menu: UN mensaje, sin botones en línea ni lista numerada', d.log.env.length === 1 && esMenuTg(d.log.env[0]), JSON.stringify(d.log.env));
  t('/menu: no llega al motor', d.log.manejarMensaje.length === 0);
}
{ // /cancelar: corta, avisa que lo no guardado se pierde y vuelve al menú
  const d = mkDeps(); await procesarUpdate(msg({ text: '/cancelar' }), d);
  t('/cancelar: corta las sesiones', d.log.limpiadas.join() === 'tg7');
  t('/cancelar: avisa y deja el menú corto con el teclado de inicio, en un solo mensaje', d.log.env.length === 1 && /Cancelado/.test(d.log.env[0].x) && /Elige una opción aquí abajo/.test(d.log.env[0].x) && d.log.env[0].e?.reply_markup?.k === 'inicio' && !d.log.env[0].r, JSON.stringify(d.log.env));
  t('/cancelar: no llega al motor', d.log.manejarMensaje.length === 0);
}
{ // variantes: mayúsculas, @bot, espacios, /start con parámetro
  for (const txt of ['/MENU', '/menu@multiaire_pe_bot', '  /menu  ', '/start abc123']) {
    const d = mkDeps(); await procesarUpdate(msg({ text: txt }), d);
    t(`variante ${JSON.stringify(txt)} → menú`, esMenuTg(d.log.env[0]) && d.log.limpiadas.length === 1);
  }
  const d = mkDeps(); await procesarUpdate(msg({ text: '/CANCELAR@multiaire_pe_bot' }), d);
  t('variante /CANCELAR@bot', /Cancelado/.test(d.log.env[0]?.x || ''));
}
{ // TECLADO FIJO VARIABLE: las dos definiciones
  const ini = TECLADO_INICIO.keyboard, flu = TECLADO_FLUJO.keyboard;
  t('teclado de inicio: las tres acciones en una fila', ini.length === 1 && ini[0].map((k) => k.text).join() === ACCIONES_INICIO.join() && ACCIONES_INICIO.length === 3, JSON.stringify(ini));
  t('teclado de inicio: cada tecla se traduce a 1/2/3', ini.flat().every((k) => ACCION_DE_BOTON[k.text]) && ['1', '2', '3'].every((x) => Object.values(ACCION_DE_BOTON).includes(x)));
  t('teclado de flujo: UN solo botón, "Cancelar"', flu.flat().length === 1 && flu.flat()[0].text === BOTON_CANCELAR && /Cancelar/.test(BOTON_CANCELAR), JSON.stringify(flu));
  t('ninguno pide ubicación', ![...ini.flat(), ...flu.flat()].some((k) => k.request_location));
  t('ambos persistentes y ajustados', [TECLADO_INICIO, TECLADO_FLUJO].every((k) => k.is_persistent === true && k.resize_keyboard === true));
}
{ // tocar "❌ Cancelar": hace lo mismo que /cancelar
  const d = mkDeps(); await procesarUpdate(msg({ text: BOTON_CANCELAR }), d);
  t('botón Cancelar: corta las sesiones', d.log.limpiadas.join() === 'tg7');
  t('botón Cancelar: avisa y muestra el menú corto', /Cancelado/.test(d.log.env[0]?.x || '') && /Elige una opción aquí abajo/.test(d.log.env[0]?.x || '') && !d.log.env[0]?.r);
  t('botón Cancelar: deja el teclado de inicio en ese mismo mensaje', d.log.env.length === 1 && d.log.env[0]?.e?.reply_markup?.k === 'inicio');
  t('botón Cancelar: no llega al motor', d.log.manejarMensaje.length === 0);
  const d2 = mkDeps(); await procesarUpdate(msg({ text: '  ' + BOTON_CANCELAR + '  ' }), d2);
  t('botón Cancelar: tolera espacios', d2.log.limpiadas.length === 1);
  // escribir "cancelar" a mano NO es el botón: lo resuelve el flujo en curso, como siempre
  const d3 = mkDeps(); await procesarUpdate(msg({ text: 'cancelar' }), d3);
  t('"cancelar" escrito a mano va al flujo (no corta por su cuenta)', d3.log.limpiadas.length === 0 && d3.log.manejarMensaje[0]?.texto === 'cancelar');
}
{ // COMPATIBILIDAD: el teclado anterior de 4 teclas sigue funcionando hasta que llegue el nuevo
  // (tocar una tecla: corta lo anterior y llega al router como 1/2/3)
  for (const [tecla, op] of [['🔧 Mantenimiento', '1'], ['📝 Observación', '2'], ['🕐 Asistencia', '3']]) {
    const d = mkDeps(); await procesarUpdate(msg({ text: tecla }), d);
    t(`tecla ${tecla}: corta las sesiones`, d.log.limpiadas.join() === 'tg7');
    t(`tecla ${tecla}: llega como "${op}"`, d.log.manejarMensaje[0]?.texto === op, JSON.stringify(d.log.manejarMensaje));
  }
  // el rótulo debe coincidir EXACTO: texto a mano no se toca ni corta nada
  const d = mkDeps(); await procesarUpdate(msg({ text: 'mantenimiento' }), d);
  t('"mantenimiento" a mano no corta ni se traduce', d.log.limpiadas.length === 0 && d.log.manejarMensaje[0]?.texto === 'mantenimiento');
  // con espacios alrededor sí (Telegram puede recortar o no)
  const d2 = mkDeps(); await procesarUpdate(msg({ text: '  🕐 Asistencia  ' }), d2);
  t('tolera espacios alrededor de la tecla', d2.log.manejarMensaje[0]?.texto === '3');
}
{ // la ayuda de asistencia no debe PISAR el teclado fijo con uno distinto
  const d = mkDeps({ decidirFlujo: async () => 'hint-asistencia' }); await procesarUpdate(msg({ text: '3' }), d);
  t('hint de asistencia: ya entró, muestra Cancelar', d.log.env[0]?.e?.reply_markup?.k === 'flujo' && d.log.modo === 'flujo', JSON.stringify(d.log.env));
}
{ // TECLADO VARIABLE: inicio ⇄ flujo
  // 1) tocar Mantenimiento/Observación/Asistencia y quedar dentro de un flujo → pasa a Cancelar
  //    (texto simple: el teclado viaja EN la respuesta, sin mensaje extra)
  const d = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => 'Dime la sede', hayFlujo: async () => true });
  await procesarUpdate(msg({ text: '🔧 Mantenimiento' }), d);
  t('entrar a un flujo: la respuesta lleva Cancelar', d.log.env.length === 1 && d.log.env[0].x === 'Dime la sede' && d.log.env[0].e?.reply_markup?.k === 'flujo', JSON.stringify(d.log.env));
  t('entrar a un flujo: recuerda el modo', d.log.modo === 'flujo' && d.log.modos.join() === 'flujo');
  // 2) seguir dentro del flujo: no vuelve a mandar teclado
  const d2 = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => 'Siguiente pregunta', hayFlujo: async () => true });
  d2.log.modo = 'flujo';
  await procesarUpdate(msg({ text: 'atocongo' }), d2);
  t('dentro del flujo: sin teclado repetido', d2.log.env.length === 1 && d2.log.env[0].r === 'Siguiente pregunta' && d2.log.modos.length === 0, JSON.stringify(d2.log.env));
  // 3) terminar el registro (ya no hay sesión) → vuelven las tres acciones
  const d3 = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => '✅ Listo, registrado', hayFlujo: async () => false });
  d3.log.modo = 'flujo';
  await procesarUpdate(msg({ text: 'fin' }), d3);
  t('terminar el registro: la respuesta lleva las tres acciones', d3.log.env.length === 1 && d3.log.env[0].x === '✅ Listo, registrado' && d3.log.env[0].e?.reply_markup?.k === 'inicio' && d3.log.modo === 'inicio', JSON.stringify(d3.log.env));
  // 4) respuesta con botones en línea: el teclado va en un mensaje corto aparte
  const d4 = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => ({ texto: 'Elige', botones: [{ id: 'a', title: 'A' }] }), hayFlujo: async () => true });
  await procesarUpdate(msg({ text: '1' }), d4);
  t('botones en línea: respuesta intacta + mensaje aparte con Cancelar', d4.log.env.length === 2 && d4.log.env[0].r?.botones?.length === 1 && !d4.log.env[0].e && d4.log.env[1].e?.reply_markup?.k === 'flujo', JSON.stringify(d4.log.env));
  // 5) observación: la sesión viva (también en la fase de operatividad) cuenta como flujo
  const d5 = mkDeps({ hayFlujo: async () => true });
  await procesarUpdate(msg({ text: 'fuga en el rooftop 6' }), d5);
  t('observación en curso: Cancelar', d5.log.env[0]?.e?.reply_markup?.k === 'flujo' && d5.log.modo === 'flujo');
  // 6) tocar Observación sin sesión todavía (hint): ya "entró" → Cancelar
  const d6 = mkDeps({ decidirFlujo: async () => 'hint-obs' });
  await procesarUpdate(msg({ text: '📝 Observación' }), d6);
  t('hint de observación: muestra Cancelar', d6.log.env[0]?.e?.reply_markup?.k === 'flujo' && d6.log.modo === 'flujo', JSON.stringify(d6.log.env));
  // 7) saludo en frío: menú + teclado de inicio
  const d7 = mkDeps({ decidirFlujo: async () => 'menu' });
  d7.log.modo = 'flujo';
  await procesarUpdate(msg({ text: 'hola' }), d7);
  t('saludo: menú corto y vuelven las tres acciones, en un solo mensaje', d7.log.env.length === 1 && esMenuTg(d7.log.env[0]) && d7.log.modo === 'inicio', JSON.stringify(d7.log.env));
  // 8) /cancelar y /menu siempre dejan el teclado de inicio (aunque el chat tuviera Cancelar)
  const d8 = mkDeps(); d8.log.modo = 'flujo';
  await procesarUpdate(msg({ text: BOTON_CANCELAR }), d8);
  t('Cancelar: vuelven las tres acciones', d8.log.env[0]?.e?.reply_markup?.k === 'inicio' && d8.log.modo === 'inicio');
  // 9) una falla del teclado NO pierde la respuesta
  const d9 = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => 'Respuesta importante', hayFlujo: async () => { throw new Error('firestore caído'); } });
  await procesarUpdate(msg({ text: 'hola' }), d9);
  t('si falla el teclado, la respuesta sale igual', d9.log.env.length === 1 && d9.log.env[0].r === 'Respuesta importante');
  // 10) respuesta vacía (foto de álbum que no es la líder): no manda nada ni toca el teclado
  const d10 = mkDeps({ decidirFlujo: async () => 'mtto', manejarMtto: async () => null, hayFlujo: async () => true });
  await procesarUpdate(msg({ text: 'x' }), d10);
  t('respuesta null: silencio', d10.log.env.length === 0 && d10.log.modos.length === 0);
}
{ // un flujo que termina devolviendo al menú (p. ej. mtto al cerrar las fotos): sin botones del menú ni lista numerada
  const MENU_B = [{ id: '1', title: 'M' }];
  const d = mkDeps({ decidirFlujo: async () => 'mtto', MENU_TEXTO: 'MENU-NUMERADO', MENU_BOTONES: MENU_B,
    manejarMtto: async () => ({ texto: '🏁 Cerré el registro (3 foto(s)).\n\nMENU-NUMERADO', botones: MENU_B }), hayFlujo: async () => false });
  d.log.modo = 'flujo';
  await procesarUpdate(msg({ text: 'fin' }), d);
  const m = d.log.env[0];
  t('flujo que vuelve al menú: texto corto, sin botones en línea ni lista numerada', d.log.env.length === 1 && /Cerré el registro/.test(m.x) && /Elige una opción aquí abajo/.test(m.x) && !/NUMERADO/.test(m.x) && !m.r && m.e?.reply_markup?.k === 'inicio', JSON.stringify(d.log.env));
  // otros botones en línea (confirmaciones) NO se tocan
  const OTROS = [{ id: 'si', title: 'Sí' }];
  const d2 = mkDeps({ decidirFlujo: async () => 'mtto', MENU_BOTONES: MENU_B, manejarMtto: async () => ({ texto: '¿Confirmas?', botones: OTROS }), hayFlujo: async () => true });
  d2.log.modo = 'flujo';
  await procesarUpdate(msg({ text: 'x' }), d2);
  t('confirmaciones con botones en línea: intactas', d2.log.env[0]?.r?.botones === OTROS, JSON.stringify(d2.log.env));
}
{ // cualquier otro comando: NO existe, NO va al motor de observaciones, NO corta nada
  for (const txt of ['/obs', '/mtto', '/asistencia', '/ayuda', '/loquesea']) {
    const d = mkDeps(); await procesarUpdate(msg({ text: txt }), d);
    t(`${txt}: no existe`, /no existe/.test(d.log.env[0]?.x || '') && d.log.manejarMensaje.length === 0 && d.log.limpiadas.length === 0, JSON.stringify(d.log.env));
  }
}
{ // un texto normal que no empieza con "/" sigue yendo al motor; una "/" en medio no es comando
  const d = mkDeps(); await procesarUpdate(msg({ text: 'fuga en el rooftop 3/4 de megaplaza' }), d);
  t('"/" en medio del texto no es comando', d.log.manejarMensaje.length === 1 && d.log.limpiadas.length === 0);
}
{ // un comando de un técnico NO vinculado no corta ni responde el menú: primero hay que vincularse
  const d = mkDeps(); await procesarUpdate(msg({ text: '/cancelar' }, 99, 99), d);
  t('sin vincular: pide el contacto', d.log.env.length === 1 && d.log.env[0].e?.reply_markup?.k === 'contacto' && d.log.limpiadas.length === 0);
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
{ // la propia marca de idempotencia falla (Firestore caído) → recuperable, Telegram reintenta
  const d = mkDeps({ yaProcesado: async () => { throw new Error('firestore caído'); } });
  let err; try { await procesarUpdate(msg({ text: 'a' }), d); } catch (e) { err = e; }
  t('fallo de idempotencia: recuperable', err?.recuperable === true && d.log.manejarMensaje.length === 0);
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

// ── Avisos salientes: Telegram para quien esté vinculado, WhatsApp para el resto ──────────
{
  const { notificarPorTipo, notificarSupervisores } = await import('../api/_lib/avisos.js');
  const wa = [], tgs = [];
  const base = {
    enviarTexto: async (to, x) => { wa.push(['texto', to, x]); return { ok: true, estado: 'ok' }; },
    enviarPlantilla: async (to) => { wa.push(['plantilla', to]); return { ok: true, estado: 'ok' }; },
    enviarTelegram: async (chat, x) => { tgs.push([chat, x]); return { ok: true, estado: 'ok' }; },
  };
  const destinos = [
    { id: 'A', telefono: '51911111111' },                          // solo WhatsApp
    { id: 'B', telefono: '51922222222', telegramChatId: 555 },     // vinculado: Telegram manda
    { id: 'C', telegramChatId: 777 },                              // solo Telegram, sin teléfono
  ];
  const r = await notificarPorTipo('asistencia', 'hola', '', { ...base, destinos, plantilla: '', detalle: true });
  t('avisos: 3 enviados', r.enviados === 3 && r.intentados === 3);
  t('avisos: el vinculado NO recibe por WhatsApp', wa.length === 1 && wa[0][1] === '51911111111');
  t('avisos: Telegram a quien corresponde', tgs.length === 2 && tgs.some((x) => x[0] === 555) && tgs.some((x) => x[0] === 777));

  wa.length = 0; tgs.length = 0;
  const rp = await notificarPorTipo('recordatorio', 'hola', '', { ...base, destinos, plantilla: 'plantilla_x', params: ['Entrada'], detalle: true });
  t('avisos con plantilla: Telegram nunca usa plantilla', wa.filter((x) => x[0] === 'plantilla').length === 1 && tgs.length === 2 && rp.enviados === 3);

  const ramb = await notificarPorTipo('mtto', 'x', '', { ...base, destinos: [{ id: 'C', telegramChatId: 777 }],
    enviarTelegram: async () => ({ ok: false, estado: 'ambiguo' }), detalle: true });
  t('avisos: fallo ambiguo en Telegram se cuenta aparte', ramb.enviados === 0 && ramb.ambiguos === 1);

  const rrech = await notificarPorTipo('mtto', 'x', '', { ...base, destinos: [{ id: 'C', telegramChatId: 777 }],
    enviarTelegram: async () => ({ ok: false, estado: 'rechazado' }), detalle: true });
  t('avisos: bloqueado por el usuario no es ambiguo', rrech.enviados === 0 && rrech.ambiguos === 0);

  const rx = await notificarPorTipo('mtto', 'x', 'B', { ...base, destinos, plantilla: '' });
  t('avisos: no avisa a quien hizo la acción', rx === 2);

  tgs.length = 0;
  const ns = await notificarSupervisores({ obs: { tienda: 'RIPLEY X', equipo: 'E', estado: 'OK', observacion: 'o' }, tecnico: { id: 'Z' } },
    { destinos, enviarTexto: base.enviarTexto, enviarTelegram: base.enviarTelegram });
  t('supervisores: también por Telegram', ns === 3 && tgs.length === 2);
}

// ── matchTelegram: vinculación sin fallback por últimos 9 dígitos ───────────────────────
{
  const docs = [
    { id: 'A', data: { nombre: 'Ana', telefono: '51912345678' } },
    { id: 'B', data: { nombre: 'Beto', telefono: '987654321' } },                       // legacy sin prefijo
    { id: 'C', data: { nombre: 'Caro', telefonos: [{ e164: '56911112222' }] } },        // Chile
    { id: 'D', data: { nombre: 'Dani', telefono: '51955556666', activo: 'NO' } },
    { id: 'E', data: { nombre: 'Eva', telefono: '51933334444' } }, { id: 'F', data: { nombre: 'Fer', telefono: '933334444' } },
  ];
  t('tg: E.164 exacto', matchTelegram(docs, '+51912345678')?.id === 'A');
  t('tg: otro país con mismos 9 dígitos → no', matchTelegram(docs, '+34912345678') === null);
  t('tg: legacy de 9 dígitos se toma como +51', matchTelegram(docs, '51987654321')?.id === 'B');
  t('tg: legacy no se cruza con otro país', matchTelegram(docs, '56987654321') === null);
  t('tg: número extranjero exacto', matchTelegram(docs, '+56 9 1111 2222')?.id === 'C');
  t('tg: inactivo → no', matchTelegram(docs, '51955556666') === null);
  t('tg: dos colaboradores con el mismo número → ambiguo', matchTelegram(docs, '51933334444') === null);
  t('tg: número corto → no', matchTelegram(docs, '912345678') === null);
  const cl = [{ id: 'CL', data: { nombre: 'Chileno', telefonos: [{ pais: 'CL', prefijo: '+56', numero: '912345678' }] } }];
  t('tg: prefijo explícito sin e164 se respeta', matchTelegram(cl, '56912345678')?.id === 'CL');
  t('tg: peruano no se vincula al chileno sin e164', matchTelegram(cl, '51912345678') === null);
  const br = [{ id: 'BR', data: { telefonos: [{ pais: 'BR', prefijo: '+55', numero: '55912345678' }] } }];   // área 55
  t('tg: número nacional que empieza como el código de país', matchTelegram(br, '5555912345678')?.id === 'BR' && matchTelegram(br, '55912345678') === null);
  t('tg: 00 internacional', matchTelegram([{ id: 'Y', data: { telefono: '0051912345678' } }], '+51912345678')?.id === 'Y');
}

// ── el token nunca llega a los logs ─────────────────────────────────────────────────────
{
  const tok = '123456:ABC-def_GHI';
  const prevTok = process.env.TELEGRAM_BOT_TOKEN, prevFetch = globalThis.fetch, prevErr = console.error;
  process.env.TELEGRAM_BOT_TOKEN = tok;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  globalThis.fetch = async (url) => { throw new Error(`request to ${url} failed`); };
  const r = await enviarTextoDetalle(7, 'hola');
  console.error = prevErr; globalThis.fetch = prevFetch;
  if (prevTok === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevTok;
  t('token: no aparece en logs ni en el detalle', logs.length > 0 && !logs.some((l) => l.includes(tok)) && !String(r.detalle).includes(tok));
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
