// Varias fotos juntas (álbum de Telegram) = UNA sola respuesta. Uso: node tests/mtto_album.test.mjs
import { respuestaAlbum, ESPERA_ALBUM_MS } from '../api/_lib/mtto.js';
import { normalizarUpdate, procesarUpdate } from '../api/telegram.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
const BOT = [{ id: 'siguiente', title: 'S' }];

// ── respuestaAlbum: las 3 fotos del álbum llegan "en paralelo"; solo la líder contesta ──
{
  const reclamado = new Set(); const eventos = []; let guardadas = 0;
  const invocacion = (nombre) => respuestaAlbum({
    lider: async () => { if (reclamado.has('G1')) return false; reclamado.add('G1'); eventos.push(nombre + ':lider'); return true; },
    esperar: async () => { eventos.push(nombre + ':espera'); await new Promise((r) => setTimeout(r, 20)); },
    contar: async () => { eventos.push(nombre + ':cuenta'); return guardadas; },
    tarea: 'Mantenimiento integral', siguiente: ', *SIGUIENTE*', botones: BOT,
  });
  // cada invocación primero guarda su foto (aquí: suma 1) y luego pregunta por el líder
  const lanzar = async (nombre) => { guardadas++; return invocacion(nombre); };
  const [a, b, c] = await Promise.all([lanzar('f1'), lanzar('f2'), lanzar('f3')]);
  const respuestas = [a, b, c].filter(Boolean);
  t('álbum de 3: contesta UNA sola vez', respuestas.length === 1, JSON.stringify([a, b, c]));
  t('el mensaje dice 3 fotos', /3 fotos cargadas/.test(respuestas[0]?.texto || ''), respuestas[0]?.texto);
  t('menciona la actividad', /Mantenimiento integral/.test(respuestas[0]?.texto));
  t('incluye SIGUIENTE y FIN', /SIGUIENTE/.test(respuestas[0].texto) && /FIN/.test(respuestas[0].texto));
  t('mantiene los botones', respuestas[0].botones === BOT);
  const lider = eventos.find((e) => e.endsWith(':lider')).split(':')[0];
  const iEspera = eventos.indexOf(lider + ':espera'), iCuenta = eventos.indexOf(lider + ':cuenta');
  t('la líder espera ANTES de contar (y sí espera)', iEspera >= 0 && iCuenta >= 0 && iEspera < iCuenta, JSON.stringify(eventos));
  t('las que no son líder no esperan ni cuentan', eventos.filter((e) => !e.startsWith(lider)).every((e) => !/espera|cuenta/.test(e)));
}
{
  const r = await respuestaAlbum({ lider: async () => true, esperar: async () => {}, contar: async () => 1, tarea: 'X', siguiente: '', botones: BOT });
  t('1 sola foto: singular', /1 foto cargada/.test(r.texto) && !/fotos/.test(r.texto), r.texto);
  const r0 = await respuestaAlbum({ lider: async () => true, esperar: async () => {}, contar: async () => 0, tarea: 'X', siguiente: '', botones: BOT });
  t('conteo 0 (lectura atrasada) nunca dice 0 fotos', /1 foto cargada/.test(r0.texto), r0.texto);
  t('no líder → null', (await respuestaAlbum({ lider: async () => false, esperar: async () => { throw new Error('no debe esperar'); }, contar: async () => 9, tarea: 'X', siguiente: '', botones: BOT })) === null);
  t('sin SIGUIENTE cuando no hay más actividades', !/SIGUIENTE/.test(r.texto));
}
t('la espera es razonable (1-8 s)', ESPERA_ALBUM_MS >= 1000 && ESPERA_ALBUM_MS <= 8000, String(ESPERA_ALBUM_MS));

// ── Telegram: el media_group_id llega hasta el flujo de mtto ──
const priv = { id: 7, type: 'private' };
const foto = (extra = {}) => ({ message: { chat: priv, from: { id: 7 }, photo: [{ file_id: 'f' }], ...extra } });
t('foto de álbum: trae el grupo', normalizarUpdate(foto({ media_group_id: 'ABC' })).grupo === 'ABC');
t('foto suelta: sin grupo', normalizarUpdate(foto()).grupo === null);

function deps(resp) {
  const log = { mtto: [], env: [] };
  return { log, yaProcesado: async () => false, liberarMensaje: async () => {},
    identificarPorTelegram: async () => ({ id: 'P1', nombre: 'ANA' }), vincularTelegram: async () => null,
    tg: { responderCallback: async () => ({}), quitarBotones: async () => ({}), enviarTexto: async () => true,
      enviarRespuestaTg: async (c, r) => { log.env.push(r); }, descargarArchivo: async () => ({ base64: 'QQ==', mime: 'image/jpeg' }),
      TECLADO_CONTACTO: {}, TECLADO_UBICACION: {} },
    manejarMensaje: async () => 'x', guardarObservacion: async () => ({}), notificarSupervisores: async () => 0,
    decidirFlujo: async () => 'mtto', manejarAsistencia: async () => 'x',
    manejarMtto: async (a) => { log.mtto.push(a); return resp; }, getSesionMtto: async () => null,
    MENU_TEXTO: 'M', MENU_BOTONES: [] };
}
{
  const d = deps({ texto: 'ok' });
  await procesarUpdate({ update_id: 1, ...foto({ media_group_id: 'ABC' }) }, d);
  t('mtto recibe el grupoFoto', d.log.mtto[0]?.grupoFoto === 'ABC');
  const d2 = deps({ texto: 'ok' });
  await procesarUpdate({ update_id: 2, ...foto() }, d2);
  t('foto suelta: grupoFoto null', d2.log.mtto[0]?.grupoFoto === null);
}
{
  // una foto de álbum que NO es líder devuelve null: el adaptador no debe romper ni mandar nada
  const d = deps(null);
  await procesarUpdate({ update_id: 3, ...foto({ media_group_id: 'ABC' }) }, d);
  t('respuesta null: no manda mensaje', d.log.env.every((r) => !r || r === null) && !d.log.env.some((r) => r && r.texto));
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
