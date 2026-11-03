// Marcaje desde la Mini App: gestos al azar, reto firmado de un solo uso, foto y ubicación válidas.
import crypto from 'node:crypto';
import { GESTOS, emitirReto, verificarReto, fotoValida, ubicacionValida, procesar, RETO_VIDA_MS } from '../api/_lib/asistencia_app.js';
let ok = 0, mal = 0;
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n); } };

const BOT = '123:TEST';
const AHORA = 1_800_000_000_000;
function initDataDe(userId, ahora = AHORA, token = BOT) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(ahora / 1000)), user: JSON.stringify({ id: userId, first_name: 'Ana' }) });
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const sec = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', sec).update(dcs).digest('hex'));
  return p.toString();
}
const JPEG = '/9j/' + 'A'.repeat(200);

// ── gestos ──
t('hay 10 gestos', GESTOS.length === 10);
t('ids únicos y con texto', new Set(GESTOS.map((g) => g.id)).size === 10 && GESTOS.every((g) => g.texto && g.emoji));
const vistos = new Set();
for (let i = 0; i < 10; i++) vistos.add(emitirReto({ colabId: 'C1', secreto: BOT, ahora: AHORA, azar: () => (i + 0.5) / 10 }).gesto.id);
t('el sorteo alcanza los 10 gestos', vistos.size === 10);
t('azar = 0.999… no se sale de la lista', !!emitirReto({ colabId: 'C1', secreto: BOT, azar: () => 0.9999999 }).gesto);
const dos = [emitirReto({ colabId: 'C1', secreto: BOT }), emitirReto({ colabId: 'C1', secreto: BOT })];
t('dos retos distintos no repiten token', dos[0].token !== dos[1].token);
t('código de 2 dígitos', /^\d{2}$/.test(dos[0].codigo));

// ── reto ──
const r = emitirReto({ colabId: 'C1', secreto: BOT, ahora: AHORA });
t('reto válido tras 5 s', verificarReto(r.token, { colabId: 'C1', secreto: BOT, ahora: AHORA + 5000 }).ok);
t('devuelve los segundos transcurridos', verificarReto(r.token, { colabId: 'C1', secreto: BOT, ahora: AHORA + 5000 }).reto.segundos === 5);
t('vencido a los 3 min', verificarReto(r.token, { colabId: 'C1', secreto: BOT, ahora: AHORA + RETO_VIDA_MS + 1 }).motivo === 'vencido');
t('demasiado rápido (<2 s)', verificarReto(r.token, { colabId: 'C1', secreto: BOT, ahora: AHORA + 500 }).motivo === 'muy_rapido');
t('de otro técnico', verificarReto(r.token, { colabId: 'C2', secreto: BOT, ahora: AHORA + 5000 }).motivo === 'otro_tecnico');
t('firma con otro secreto', verificarReto(r.token, { colabId: 'C1', secreto: 'otro', ahora: AHORA + 5000 }).motivo === 'firma');
const [pl, sg] = r.token.split('.');
const alterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl, 'base64url').toString()), g: 'puno' })).toString('base64url');
t('payload alterado se rechaza', verificarReto(`${alterado}.${sg}`, { colabId: 'C1', secreto: BOT, ahora: AHORA + 5000 }).ok === false);
t('sin token', verificarReto(undefined, { colabId: 'C1', secreto: BOT }).motivo === 'sin_reto');
t('token basura', verificarReto('abc', { colabId: 'C1', secreto: BOT }).ok === false);

// ── foto y ubicación ──
t('JPEG válido', fotoValida(JPEG).ok);
t('PNG no vale', fotoValida('iVBORw0KGgo' + 'A'.repeat(50)).motivo === 'foto_formato');
t('con prefijo data: no vale', fotoValida('data:image/jpeg;base64,' + JPEG).ok === false);
t('foto enorme', fotoValida('/9j/' + 'A'.repeat(1_000_000)).motivo === 'foto_grande');
t('sin foto', fotoValida('').motivo === 'sin_foto');
t('ubicación válida', ubicacionValida({ lat: -12.1, lng: -77.0, precision: 8.4 }).precision === 8);
t('ubicación fuera de rango', ubicacionValida({ lat: 91, lng: 0 }) === null);
t('ubicación vacía', ubicacionValida(null) === null && ubicacionValida({ lat: '', lng: '' }) === null);

// ── procesar ──
const tecnico = { id: 'C1', nombre: 'Ana', regimenAsistencia: 'MARCA' };
function deps(extra = {}) {
  const usados = new Set(), llamadas = [], avisos = [];
  return { llamadas, avisos, d: {
    token: BOT, ahora: () => AHORA + 6000,
    identificar: async () => tecnico, estadoHoy: async () => ({ entrada: null, salida: null }),
    usarReto: async (n) => { if (usados.has(n)) return false; usados.add(n); return true; },
    marcar: async (a) => { llamadas.push(a); return 'Entrada registrada ✅'; },
    avisarChat: async (c, resp) => { avisos.push([c, resp]); },
    ...extra,
  } };
}
const ini = deps();
const retoVivo = emitirReto({ colabId: 'C1', secreto: BOT, ahora: AHORA });   // emitido 6 s antes de "ahora"
const cuerpo = { accion: 'enviar', token: retoVivo.token, foto: JPEG, ubicacion: { lat: -12.1, lng: -77.0, precision: 7 } };

t('firma de Telegram inválida → 401', (await procesar(cuerpo, initDataDe(5, AHORA + 6000, 'otro:TOKEN'), ini.d)).status === 401);
t('sin vincular → 403', (await procesar(cuerpo, initDataDe(5, AHORA + 6000), deps({ identificar: async () => null }).d)).status === 403);
t('régimen FIJO no marca por aquí → 403', (await procesar(cuerpo, initDataDe(5, AHORA + 6000), deps({ identificar: async () => ({ ...tecnico, regimenAsistencia: 'FIJO' }) }).d)).status === 403);

const a = await procesar({ accion: 'inicio' }, initDataDe(5, AHORA + 6000), ini.d);
t('inicio devuelve reto con gesto y código', a.status === 200 && a.json.reto.gesto.texto && /^\d{2}$/.test(a.json.reto.codigo) && a.json.nombre === 'Ana');

const e1 = await procesar(cuerpo, initDataDe(5, AHORA + 6000), ini.d);
t('envío correcto marca con la evidencia del reto', e1.status === 200 && ini.llamadas.length === 1
  && ini.llamadas[0].evidencia.canal === 'MINIAPP' && ini.llamadas[0].evidencia.gesto === retoVivo.gesto.id
  && ini.llamadas[0].evidencia.codigo === retoVivo.codigo && ini.llamadas[0].evidencia.precision === 7);
t('el motor recibe from tg<id>, ubicación y selfie JPEG', ini.llamadas[0].from === 'tg5' && ini.llamadas[0].mime === 'image/jpeg' && ini.llamadas[0].ubicacion.lat === -12.1);
t('devuelve el texto del motor y avisa al chat', e1.json.mensajes[0] === 'Entrada registrada ✅' && ini.avisos.length === 1 && ini.avisos[0][0] === 5);
const e2 = await procesar(cuerpo, initDataDe(5, AHORA + 6000), ini.d);
t('el mismo reto no sirve dos veces', e2.status === 400 && e2.json.reiniciar === true && ini.llamadas.length === 1);

const lejos = deps({ ahora: () => AHORA + RETO_VIDA_MS + 5000 });
t('reto vencido → 400 y pide reiniciar', (await procesar(cuerpo, initDataDe(5, AHORA + RETO_VIDA_MS + 5000), lejos.d)).json.reiniciar === true && lejos.llamadas.length === 0);
const sinFoto = deps();
t('sin foto no marca', (await procesar({ ...cuerpo, foto: '' }, initDataDe(5, AHORA + 6000), sinFoto.d)).status === 400 && sinFoto.llamadas.length === 0);
const sinUbic = deps();
t('sin ubicación no marca', (await procesar({ ...cuerpo, ubicacion: null }, initDataDe(5, AHORA + 6000), sinUbic.d)).status === 400 && sinUbic.llamadas.length === 0);
t('un envío rechazado por foto NO quema el reto', (await procesar(cuerpo, initDataDe(5, AHORA + 6000), sinFoto.d)).status === 200 && sinFoto.llamadas.length === 1);
t('acción desconocida', (await procesar({ accion: 'x' }, initDataDe(5, AHORA + 6000), deps().d)).status === 400);

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
