// Varias fotos seguidas = UN solo mensaje de confirmación que se corrige con el total. Uso: node tests/mtto_album.test.mjs
import { decidirLote, confirmarFotos } from '../api/_lib/lote_fotos.js';
import { normalizarUpdate, procesarUpdate } from '../api/telegram.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

// ── lógica pura de la ráfaga ──
{
  const a = decidirLote(null, { clave: 'S|X', n: 1, ahora: 1000 });
  t('primera foto: envía mensaje nuevo', a.accion === 'enviar' && a.total === 1);
  const b = decidirLote({ clave: 'S|X', ts: 1000, n: 1, msgId: 55 }, { clave: 'S|X', n: 3, ahora: 2000 });
  t('foto siguiente: edita el mismo mensaje con el total', b.accion === 'editar' && b.msgId === 55 && b.total === 3);
  const c = decidirLote({ clave: 'S|X', ts: 1000, n: 5, msgId: 55 }, { clave: 'S|X', n: 3, ahora: 2000 });
  t('el total nunca baja (conteo atrasado de otra invocación)', c.total === 5);
  t('pasó la ventana: mensaje nuevo', decidirLote({ clave: 'S|X', ts: 1000, n: 5, msgId: 55 }, { clave: 'S|X', n: 6, ahora: 1000 + 31000 }).accion === 'enviar');
  t('otra actividad u otro registro: mensaje nuevo', decidirLote({ clave: 'S|X', ts: 1000, n: 5, msgId: 55 }, { clave: 'S|Y', n: 1, ahora: 1500 }).accion === 'enviar');
}

// ── confirmarFotos con un almacén en memoria (con transacción simulada) ──
function mundo() {
  let doc = null; const enviados = [], editados = [];
  const almacen = {
    reclamar: async (_f, d) => { const r = decidirLote(doc, d); doc = { ...r.nuevo }; return r; },
    leer: async () => doc, fijarMsg: async (_f, id) => { doc = { ...doc, msgId: id }; },
  };
  let idSig = 100;
  const base = (clave, n, ahora) => ({
    from: 'tg1', clave, n, texto: (k) => `${k} fotos`, almacen, ahora, esperar: async () => {},
    enviar: async (x) => { enviados.push(x); return idSig++; }, editar: async (id, x) => { editados.push([id, x]); },
  });
  return { enviados, editados, base };
}
{
  // 11 fotos una por una (Telegram parte en 10 + 1): UN mensaje enviado y el resto ediciones; termina en 11
  const w = mundo();
  for (let i = 1; i <= 11; i++) await confirmarFotos(w.base('S|X', i, 1000 + i * 500));
  t('11 fotos seguidas: UN solo mensaje enviado', w.enviados.length === 1, JSON.stringify(w.enviados));
  t('el mensaje termina diciendo 11', w.editados.at(-1)[1] === '11 fotos', JSON.stringify(w.editados.at(-1)));
  t('todas las ediciones apuntan al mismo mensaje', w.editados.every(([id]) => id === 100));
}
{
  // en paralelo: la 2ª llega cuando la 1ª aún no registró el id de su mensaje → espera y luego edita
  const w = mundo(); let intentos = 0;
  const b1 = w.base('S|X', 1, 1000), b2 = w.base('S|X', 2, 1001);
  const enviar1 = b1.enviar; b1.enviar = async (x) => { await new Promise((r) => setTimeout(r, 30)); return enviar1(x); };
  b2.esperar = async () => { intentos++; await new Promise((r) => setTimeout(r, 20)); };
  await Promise.all([confirmarFotos(b1), confirmarFotos(b2)]);
  t('en paralelo: sigue siendo UN mensaje', w.enviados.length === 1, JSON.stringify(w.enviados));
  t('en paralelo: la segunda esperó el id y editó con el total', w.editados.length >= 1 && w.editados.at(-1)[1] === '2 fotos' && intentos >= 1, JSON.stringify(w.editados));
}
{
  // dos ráfagas separadas (más de 30 s): dos mensajes
  const w = mundo();
  await confirmarFotos(w.base('S|X', 1, 1000));
  await confirmarFotos(w.base('S|X', 2, 1000 + 40000));
  t('ráfagas separadas: un mensaje por ráfaga', w.enviados.length === 2);
}

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

// ── Telegram: la respuesta con total de fotos pasa por confirmarFotos (un mensaje editable), no por un envío por foto ──
{
  const resp = { texto: '✅ 1 foto cargada', botones: [{ id: 'fin', title: 'Fin' }], fotoCount: 1, textoLote: (k) => `${k} fotos`, loteClave: 'S|X' };
  const d = deps(resp); const llamadas = [];
  d.confirmarFotos = async (a) => { llamadas.push(a); };
  await procesarUpdate({ update_id: 30, ...foto({ media_group_id: 'AA' }) }, d);
  t('mtto con total de fotos usa confirmarFotos', llamadas.length === 1 && llamadas[0].n === 1 && llamadas[0].clave === 'S|X');
  t('no manda además el mensaje por foto', d.log.env.length === 0);
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
