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

// ── La líder sigue esperando mientras lleguen más fotos (caso real: contó 1 de 3 a los 3 s) ──
{
  let llegadas = [1, 2, 3, 3], i = 0, esperas = 0;
  const r = await respuestaAlbum({ lider: async () => true, esperar: async () => { esperas++; }, contar: async () => llegadas[Math.min(i++, llegadas.length - 1)], tarea: 'X', siguiente: '', botones: BOT });
  t('espera a que el total deje de crecer: dice 3 fotos', /3 fotos cargadas/.test(r.texto), r.texto);
  t('no espera de más cuando ya es estable', esperas <= 4, String(esperas));
  const r2 = await respuestaAlbum({ lider: async () => true, esperar: async () => {}, contar: async () => 2, tarea: 'X', siguiente: '', botones: BOT });
  t('total estable: 2 fotos', /2 fotos cargadas/.test(r2.texto), r2.texto);
}

// ── Fotos de álbum SIN sesión de mantenimiento (después de FIN): no abren una observación por foto ──
{
  const huerfana = (reclamar) => {
    const d = deps(null); d.decidirFlujo = async () => 'observaciones'; d.reclamarAlbum = reclamar;
    d.llamadasObs = 0; d.manejarMensaje = async () => { d.llamadasObs++; return 'x'; };
    return d;
  };
  const d1 = huerfana(async () => true);
  await procesarUpdate({ update_id: 10, ...foto({ media_group_id: 'ZZ' }) }, d1);
  t('álbum sin sesión: la primera foto sí sigue su camino', d1.llamadasObs === 1);
  // álbum ya atendido: la 1ª foto tardía AVISA (una vez) que no se guardó; las siguientes callan
  const marcas = new Set(); const reclamar = async (from, g) => { const k = from + g; if (k.includes('ZZ') && !k.includes('aviso')) return false; if (marcas.has(k)) return false; marcas.add(k); return true; };
  const enviados = [];
  const tardia = () => { const d = huerfana(reclamar); d.tg.enviarTexto = async (c, x) => { enviados.push(x); return true; }; return d; };
  const d2 = tardia(), d2b = tardia(), d2c = tardia();
  await procesarUpdate({ update_id: 11, ...foto({ media_group_id: 'ZZ' }) }, d2);
  await procesarUpdate({ update_id: 13, ...foto({ media_group_id: 'ZZ' }) }, d2b);
  await procesarUpdate({ update_id: 14, ...foto({ media_group_id: 'ZZ' }) }, d2c);
  t('álbum ya atendido: no abre observación', d2.llamadasObs === 0 && d2b.llamadasObs === 0 && d2c.llamadasObs === 0);
  t('álbum ya atendido: avisa UNA sola vez que no se guardaron', enviados.length === 1 && /NO se guardaron/.test(enviados[0]), JSON.stringify(enviados));
  const d3 = huerfana(async () => false);
  await procesarUpdate({ update_id: 12, ...foto() }, d3);
  t('foto suelta sin sesión: sigue como observación', d3.llamadasObs === 1);
}

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
