// Marcaje de asistencia desde la Mini App de Telegram: cámara EN VIVO (sin galería), ubicación y un gesto
// al azar. Este módulo es PURO (sin Firestore ni red): la firma de Telegram, el reto y la validación se
// prueban sin servicios. El handler está en api/asistencia_app.js.
//
// Idea: el bot ya sabe resolver la sede, geovalidar, decidir entrada/salida y escribir el registro
// (`manejarAsistencia`). La Mini App NO repite nada de eso: arma el mismo mensaje que el técnico mandaría
// por el chat (ubicación + selfie) y lo pasa por ese motor. Lo que añade es la EVIDENCIA de que la foto se
// tomó ahora y en la sede: un reto de un solo uso (gesto + código) emitido por el servidor.
import crypto from 'node:crypto';
import { verificarInitData } from './parametros.js';

// 10 gestos. `id` es estable (se guarda en el registro); `texto` es lo que ve el técnico.
export const GESTOS = [
  { id: 'mano-abierta', emoji: '✋', texto: 'Mano abierta, con la palma al frente' },
  { id: 'pulgar-arriba', emoji: '👍', texto: 'Pulgar arriba' },
  { id: 'paz', emoji: '✌️', texto: 'Signo de paz: dos dedos arriba' },
  { id: 'un-dedo', emoji: '☝️', texto: 'Un solo dedo apuntando hacia arriba' },
  { id: 'tres-dedos', emoji: '🤟', texto: 'Tres dedos arriba' },
  { id: 'puno', emoji: '✊', texto: 'Puño cerrado al frente' },
  { id: 'dos-manos', emoji: '🙌', texto: 'Las dos manos abiertas arriba' },
  { id: 'ok', emoji: '👌', texto: 'Signo OK con los dedos' },
  { id: 'saludo', emoji: '🤙', texto: 'Pulgar y meñique extendidos (saludo)' },
  { id: 'nariz', emoji: '👃', texto: 'Tócate la nariz con un dedo' },
];

export const RETO_VIDA_MS = 3 * 60 * 1000;   // el reto vence a los 3 min de emitido
export const RETO_MIN_MS = 2000;             // una foto "instantánea" (< 2 s) no es una persona haciendo el gesto
const MAX_B64 = 900 * 1024;                  // mismo tope que la selfie del bot (límite de 1 MB por doc de Firestore)

const b64u = (b) => Buffer.from(b).toString('base64url');
const firma = (secreto, parte) => crypto.createHmac('sha256', `reto:${secreto}`).update(parte).digest('base64url');

// Emite un reto: { token, gesto, codigo, venceMs }. El token va firmado con un secreto del servidor (el del bot):
// no hay que guardar nada para emitirlo, y el técnico no puede fabricar ni alterar uno.
export function emitirReto({ colabId, secreto, ahora = Date.now(), azar = Math.random }) {
  const gesto = GESTOS[Math.min(GESTOS.length - 1, Math.floor(azar() * GESTOS.length))];
  const codigo = String(Math.floor(azar() * 90) + 10);   // 2 dígitos: el técnico lo escribe en un papel o lo dice
  const nonce = crypto.randomBytes(9).toString('base64url');
  const payload = b64u(JSON.stringify({ c: String(colabId), g: gesto.id, k: codigo, i: ahora, n: nonce }));
  return { token: `${payload}.${firma(secreto, payload)}`, gesto, codigo, emitidoMs: ahora, venceMs: ahora + RETO_VIDA_MS };
}

// Verifica el reto. Devuelve { ok:true, reto:{ colabId, gesto, codigo, emitidoMs, nonce, segundos } } o { ok:false, motivo }.
export function verificarReto(token, { colabId, secreto, ahora = Date.now() }) {
  if (typeof token !== 'string') return { ok: false, motivo: 'sin_reto' };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false, motivo: 'formato' };
  const esperado = firma(secreto, payload);
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, motivo: 'firma' };
  let p;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, motivo: 'formato' }; }
  if (!p || p.c !== String(colabId)) return { ok: false, motivo: 'otro_tecnico' };
  const edad = ahora - Number(p.i);
  if (!Number.isFinite(edad) || edad < 0) return { ok: false, motivo: 'formato' };
  if (edad > RETO_VIDA_MS) return { ok: false, motivo: 'vencido' };
  if (edad < RETO_MIN_MS) return { ok: false, motivo: 'muy_rapido' };
  if (!GESTOS.some((g) => g.id === p.g)) return { ok: false, motivo: 'formato' };
  return { ok: true, reto: { colabId: p.c, gesto: p.g, codigo: String(p.k), emitidoMs: p.i, nonce: String(p.n), segundos: Math.round(edad / 1000) } };
}

// Solo JPEG en base64 (lo que produce el canvas de la Mini App), sin prefijo data:.
export function fotoValida(b64) {
  if (typeof b64 !== 'string' || !b64) return { ok: false, motivo: 'sin_foto' };
  if (b64.length > MAX_B64) return { ok: false, motivo: 'foto_grande' };
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return { ok: false, motivo: 'foto_formato' };
  if (!b64.startsWith('/9j/')) return { ok: false, motivo: 'foto_formato' };   // cabecera JPEG
  return { ok: true };
}

const numero = (v) => (v == null || v === '' ? NaN : Number(v));
export function ubicacionValida(u) {
  const lat = numero(u && u.lat), lng = numero(u && u.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const pr = numero(u.precision);
  return { lat, lng, precision: Number.isFinite(pr) && pr >= 0 ? Math.round(pr) : null };
}

const ERRORES_RETO = {
  sin_reto: 'Vuelve a abrir la Mini App para pedir un gesto nuevo.',
  formato: 'El reto no es válido. Vuelve a abrir la Mini App.',
  firma: 'El reto no es válido. Vuelve a abrir la Mini App.',
  otro_tecnico: 'Ese reto no es tuyo. Vuelve a abrir la Mini App.',
  vencido: 'Pasó mucho tiempo desde que se pidió el gesto. Toca «Pedir otro gesto» y vuelve a tomarte la foto.',
  muy_rapido: 'La foto salió demasiado rápido. Haz el gesto con calma y vuelve a intentarlo.',
  reutilizado: 'Ese gesto ya se usó. Toca «Pedir otro gesto».',
};
const ERRORES_FOTO = {
  sin_foto: 'Falta la foto. Toma la selfie con la cámara.',
  foto_grande: 'La foto pesa demasiado. Inténtalo de nuevo.',
  foto_formato: 'La foto no es válida. Tómala con la cámara de la Mini App.',
};

// Texto plano de lo que contesta el motor del bot (string | {texto} | {mensajes:[…]}).
export function textosDeRespuesta(resp) {
  const items = resp && resp.mensajes ? resp.mensajes : [resp];
  return items.map((r) => (typeof r === 'string' ? r : (r && r.texto) || '')).filter(Boolean);
}

// ── Procesamiento ───────────────────────────────────────────────────────────────────────────
// body: { accion: 'inicio' } | { accion: 'enviar', token, foto, ubicacion:{lat,lng,precision} }
// deps: { token (bot), ahora(), identificar(chatId), estadoHoy(colabId), usarReto(nonce), marcar(args) , avisarChat(chatId, resp) }
export async function procesar(body, initData, deps) {
  const v = verificarInitData(initData, deps.token, { ahora: deps.ahora() });
  if (!v.ok) return { status: 401, json: { error: 'No pude confirmar que vienes de Telegram. Cierra y vuelve a abrir la Mini App desde el bot.' } };
  const tecnico = await deps.identificar(v.user.id);
  if (!tecnico) return { status: 403, json: { error: 'Tu Telegram no está vinculado a ningún colaborador. Compártele tu contacto al bot.' } };
  const regimen = String(tecnico.regimenAsistencia || 'MARCA').toUpperCase();
  if (regimen !== 'MARCA') return { status: 403, json: { error: 'Tu asistencia no se controla por este medio. Si crees que es un error, avísale al administrador.' } };
  const secreto = deps.token;

  if (body.accion === 'inicio') {
    const reto = emitirReto({ colabId: tecnico.id, secreto, ahora: deps.ahora(), azar: deps.azar });
    const estado = await deps.estadoHoy(tecnico.id);
    return { status: 200, json: {
      nombre: tecnico.nombre || '', estado,
      reto: { token: reto.token, gesto: reto.gesto, codigo: reto.codigo, venceMs: reto.venceMs },
      ahoraMs: deps.ahora(),
    } };
  }

  if (body.accion === 'enviar') {
    const rv = verificarReto(body.token, { colabId: tecnico.id, secreto, ahora: deps.ahora() });
    if (!rv.ok) return { status: 400, json: { error: ERRORES_RETO[rv.motivo] || ERRORES_RETO.formato, reiniciar: true } };
    const fv = fotoValida(body.foto);
    if (!fv.ok) return { status: 400, json: { error: ERRORES_FOTO[fv.motivo] } };
    const ub = ubicacionValida(body.ubicacion);
    if (!ub) return { status: 400, json: { error: 'No pude leer tu ubicación. Activa el GPS, da el permiso y vuelve a intentarlo.' } };
    // Un reto sirve UNA vez: si no, una misma foto buena podría reenviarse para otro marcaje.
    if (!(await deps.usarReto(rv.reto.nonce, rv.reto.emitidoMs))) return { status: 400, json: { error: ERRORES_RETO.reutilizado, reiniciar: true } };
    const resp = await deps.marcar({
      tecnico, from: `tg${v.user.id}`, ubicacion: { lat: ub.lat, lng: ub.lng },
      imagenB64: body.foto, mime: 'image/jpeg',
      evidencia: { canal: 'MINIAPP', gesto: rv.reto.gesto, codigo: rv.reto.codigo, retoSeg: rv.reto.segundos, precision: ub.precision },
    });
    const textos = textosDeRespuesta(resp);
    // Si el motor sigue esperando algo (p. ej. «¿en cuál sede estás?») o ofrece botones, la conversación
    // continúa en el chat: se le manda ahí, además de mostrarla en la Mini App.
    if (deps.avisarChat) await deps.avisarChat(v.user.id, resp).catch(() => {});
    return { status: 200, json: { ok: true, mensajes: textos } };
  }

  return { status: 400, json: { error: 'Solicitud inválida.' } };
}
