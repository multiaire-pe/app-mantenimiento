// Cron de recordatorios de asistencia — a la hora fija configurada en Personal → 🔔 Alertas
// del bot (colección config_recordatorios/default), manda un WhatsApp de recordatorio de
// ENTRADA/SALIDA a quien tenga avisos.recordatorio=true en maestros_personal.
//
// Incondicional a propósito: NO lee asistencia_registros ni regimenAsistencia (decisión
// explícita del usuario) — el bot de marcaje sigue intacto, sin ninguna dependencia nueva.
//
// Disparado por un workflow de GitHub Actions (schedule) contra este endpoint, protegido
// por CRON_SECRET (header x-cron-secret). No usamos Vercel Cron Jobs: el plan Hobby no
// permite un horario editable sin redeploy y solo corre sobre deployments de Producción —
// acá la hora la fija el usuario desde la app, sin tocar código.
import crypto from 'node:crypto';
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js';
import { hoyLima, horaHHMMLima, decimalAHHMM } from './_lib/fecha.js';
import { notificarPorTipo, destinatariosAviso } from './_lib/avisos.js';

function secretoValido(header) {
  const esperado = process.env.CRON_SECRET || '';
  if (!esperado || !header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// TURNO DEL DÍA (lock atómico) — la marca `ultimoEnvio` del config NO alcanza para decidir
// si mandar: se escribe DESPUÉS de enviar, así que dos ejecuciones solapadas (el schedule
// de 30 min con un workflow_dispatch manual, un reintento, o una función que se corta tras
// enviar y antes del set) leen las dos "todavía no se mandó" y el técnico recibe el
// recordatorio dos veces. Acá el turno se toma ANTES de enviar con `create()`, que falla si
// el doc ya existe (ALREADY_EXISTS): solo una ejecución puede ganarlo por (fecha, tipo).
// Colección `recordatorio_envios` — operativa/transitoria, como `wa_mensajes` del bot
// (idempotencia): no se respalda.
const YA_EXISTE = (e) => e?.code === 6 || /ALREADY_EXISTS/i.test(e?.message || '');

// Exportada (además de usarse acá) para poder testearla con un Firestore inyectado:
// es la pieza que decide si se manda o no, y su modo de fallo son los duplicados.
export async function tomarTurno(db, hoy, tipo) {
  const ref = db.collection('recordatorio_envios').doc(`${hoy}_${tipo}`);
  try {
    await ref.create({ fecha: hoy, tipo, inicioTs: new Date().toISOString() });
    return ref;
  } catch (e) {
    if (YA_EXISTE(e)) return null;   // otra ejecución ya lo tomó → esta no envía
    throw e;
  }
}

// Hora EXACTA (sin redondear) del momento en Lima, en decimal — a propósito distinta de
// `ahoraDecimalLima()` de fecha.js, que redondea a la media hora (convención de asistencia,
// no sirve acá: "¿ya pasó la hora del recordatorio?" necesita precisión de minuto).
function ahoraExactaLima() {
  const [h, m] = horaHHMMLima().split(':').map(Number);
  return h + m / 60;
}

const TEXTO = {
  entrada: '⏰ *Recordatorio* — no olvides marcar tu *entrada* de hoy.',
  salida: '⏰ *Recordatorio* — no olvides marcar tu *salida* de hoy.',
};

// QUÉ HACER DESPUÉS DE ENVIAR. `notificarPorTipo` NO lanza si WhatsApp falla: atrapa el
// error de cada destinatario por dentro y devuelve cuántos salieron. Con el token vencido
// o Meta caído devuelve 0 — y sin esta política el cron marcaba el día como enviado,
// respondía 200 y el workflow quedaba verde: el recordatorio se perdía en silencio, que es
// justo el modo de fallo que este endpoint vino a eliminar.
//   · 0 enviados → NADIE recibió nada, así que reintentar no puede duplicar: se libera el
//     turno (el próximo tick de 30 min reintenta) y se responde no-2xx para que el job falle.
//   · envío parcial → algunos SÍ recibieron: reintentar duplicaría, así que el día se marca
//     igual; los fallidos se anotan y se avisan, pero no ponen el job en rojo (un técnico con
//     el número muerto dejaría el cron rojo todos los días y la alerta se volvería ruido).
export function politicaEnvio(enviados, intentados) {
  if (enviados === 0) {
    return { liberarTurno: true, marcarDia: false, fallidos: intentados, error: `ningún envío salió (0/${intentados})` };
  }
  return { liberarTurno: false, marcarDia: true, fallidos: intentados - enviados, error: null };
}

export default async function handler(req, res) {
  if (!secretoValido(req.headers['x-cron-secret'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getDb();
  const ref = db.collection('config_recordatorios').doc('default');

  // ?reset=entrada|salida|all — borra la marca de "ya enviado hoy" (turno + ultimoEnvio) para
  // volver a probar el mismo tipo sin esperar al día siguiente. Es una herramienta de PRUEBA:
  // rearma un envío masivo real, así que en producción queda APAGADA. Requiere las dos cosas —
  // env ALLOW_RECORDATORIOS_RESET=true (solo se setea en Preview/develop) y método POST (un
  // GET no debe tener efectos) — además del CRON_SECRET que ya protege todo el endpoint.
  const reset = req.query?.reset;
  if (reset) {
    // Doble llave: el env explícito Y que el deployment no sea Production — así, si algún día
    // ALLOW_RECORDATORIOS_RESET se copia por error al entorno equivocado, sigue sin reactivarse.
    if (process.env.ALLOW_RECORDATORIOS_RESET !== 'true' || process.env.VERCEL_ENV === 'production') {
      return res.status(403).json({ error: 'reset deshabilitado en este entorno' });
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'reset requiere POST' });
    }
    const tipos = reset === 'all' ? ['entrada', 'salida'] : [String(reset)];
    if (tipos.some((t) => t !== 'entrada' && t !== 'salida')) {
      return res.status(400).json({ error: `reset inválido: ${reset} (usar entrada, salida o all)` });
    }
    // El turno manda sobre `ultimoEnvio`: si no se borra, resetear la marca no reactiva nada.
    const hoyReset = hoyLima();
    await Promise.all(tipos.map((t) => db.collection('recordatorio_envios').doc(`${hoyReset}_${t}`).delete()));
    const snapReset = await ref.get();
    if (snapReset.exists) {
      const updates = {};
      for (const t of tipos) updates[`ultimoEnvio.${t}`] = admin.firestore.FieldValue.delete();
      await ref.update(updates);
    }
    return res.status(200).json({ ok: true, reset: tipos });
  }

  const snap = await ref.get();
  const cfg = snap.exists ? snap.data() : {};
  const hoy = hoyLima();
  const ahora = ahoraExactaLima();
  const ultimoEnvio = { ...(cfg.ultimoEnvio || {}) };
  const resultados = {};
  let enviadoAhora = false;   // solo se reescribe el config si esta ejecución mandó algo
  let huboError = false;      // → responde 502 para que el workflow NO quede verde en falso

  for (const tipo of ['entrada', 'salida']) {
    const hora = cfg[tipo === 'entrada' ? 'horaEntrada' : 'horaSalida'];
    if (hora == null || !Number.isFinite(Number(hora))) continue; // sin hora configurada
    if (ultimoEnvio[tipo] === hoy) continue;                      // ya se mandó hoy (atajo barato)
    if (ahora < Number(hora)) continue;                           // aún no llega la hora

    // Los destinatarios se resuelven ANTES de tomar el turno, a propósito: si esa lectura
    // falla (o todavía no hay nadie marcado en 🔔 Alertas del bot), el turno queda libre y
    // el próximo tick reintenta. Después de tomarlo ya no se libera: `notificarPorTipo`
    // atrapa los errores de cada envío por dentro, así que una excepción posterior puede
    // haber mandado parte de los mensajes — reintentar duplicaría.
    const destinos = await destinatariosAviso('recordatorio');
    if (!destinos.length) { console.log(`[cron_recordatorios] ${tipo} · 0 destinatarios con avisos.recordatorio`); continue; }

    const turno = await tomarTurno(db, hoy, tipo);
    if (!turno) { console.log(`[cron_recordatorios] ${tipo} · turno ya tomado hoy, no se envía`); continue; }

    let n = 0;
    try {
      n = await notificarPorTipo('recordatorio', TEXTO[tipo], '', {
        destinos,
        params: [tipo === 'entrada' ? 'Entrada' : 'Salida'],
      });
    } catch (e) {
      // Excepción a mitad del envío: pudo haber mandado parte, así que el turno NO se libera
      // (reintentar duplicaría). Se anota el error y el job va a fallar por el 502 de abajo.
      await turno.update({ error: String(e?.message || e), finTs: new Date().toISOString() }).catch(() => {});
      console.error(`[cron_recordatorios] ${tipo} · falló el envío:`, e?.message || e);
      resultados[tipo] = { error: String(e?.message || e), enviados: n, intentados: destinos.length };
      huboError = true;
      continue;
    }

    const pol = politicaEnvio(n, destinos.length);
    if (pol.liberarTurno) await turno.delete().catch(() => {});
    else await turno.update({ enviados: n, fallidos: pol.fallidos, finTs: new Date().toISOString() }).catch(() => {});

    if (pol.error) {
      console.error(`[cron_recordatorios] ${tipo} · ${pol.error} — turno liberado, se reintenta en el próximo tick`);
      resultados[tipo] = { error: pol.error, enviados: 0, intentados: destinos.length };
      huboError = true;
      continue;
    }
    if (pol.fallidos > 0) console.warn(`[cron_recordatorios] ${tipo} · ${pol.fallidos} destinatario(s) no recibieron (no se reintenta: duplicaría)`);

    ultimoEnvio[tipo] = hoy;
    enviadoAhora = true;
    resultados[tipo] = { enviados: n, fallidos: pol.fallidos, intentados: destinos.length };
    console.log(`[cron_recordatorios] ${tipo} · ${n}/${destinos.length} enviado(s) · hora config ${decimalAHHMM(hora)} · ahora ${decimalAHHMM(ahora)}`);
  }

  if (enviadoAhora) {
    await ref.set({ ultimoEnvio }, { merge: true });
  }
  // no-2xx ante fallo real: es lo único que pone el job de GitHub Actions en rojo.
  const status = huboError ? 502 : 200;
  return res.status(status).json({ ok: !huboError, hoy, ahora: decimalAHHMM(ahora), resultados });
}
