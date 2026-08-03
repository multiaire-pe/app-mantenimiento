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

// TURNO DEL DÍA — la marca `ultimoEnvio` del config NO alcanza para decidir si mandar: se
// escribe DESPUÉS de enviar, así que dos ejecuciones solapadas (el schedule de 30 min con un
// workflow_dispatch manual, un reintento, o una función que se corta tras enviar y antes del
// set) leen las dos "todavía no se mandó" y el técnico recibe el recordatorio dos veces. El
// turno se toma ANTES de enviar, en una TRANSACCIÓN: solo una ejecución puede ganarlo por
// (fecha, tipo). Colección `recordatorio_envios` — operativa/transitoria, como `wa_mensajes`
// del bot (idempotencia): no se respalda.
//
// El turno además ACOTA LOS REINTENTOS. Un fallo definitivo (Meta rechaza porque el
// destinatario está fuera de la ventana de 24h y no hay plantilla aprobada, por ejemplo) se
// repite idéntico en cada tick: sin tope, el cron reintentaría cada 30 min hasta medianoche
// —unos 14 intentos y 14 jobs en rojo— sin ninguna chance de éxito. Con tope, se intenta lo
// justo para cubrir una caída pasajera de Meta y después se rinde con el error a la vista.
//
// Estados: 'en_curso' (alguien lo tiene) · 'enviado' (listo, no se repite) · 'reintentable'
// (falló y consta que NADIE recibió) · 'incierto' (falló con algún envío ambiguo: pudo haber
// llegado, así que NO se reintenta nunca — reintentar es como se duplica).
export const MAX_INTENTOS_DIA = 3;
// Vencimiento del turno 'en_curso'. La función tiene maxDuration 30s, así que 10 min solo se
// alcanzan si la ejecución murió sin cerrarlo.
export const LEASE_MS = 10 * 60 * 1000;

// Exportada (además de usarse acá) para poder testearla con un Firestore inyectado: es la
// pieza que decide si se manda o no, y sus modos de fallo son el duplicado y el spam.
export async function tomarTurno(db, hoy, tipo, maxIntentos = MAX_INTENTOS_DIA) {
  const ref = db.collection('recordatorio_envios').doc(`${hoy}_${tipo}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ahora = new Date().toISOString();
    if (!snap.exists) {
      tx.set(ref, { fecha: hoy, tipo, estado: 'en_curso', intentos: 1, inicioTs: ahora });
      return { ok: true, ref, intento: 1 };
    }
    const d = snap.data() || {};

    // Doc del formato ANTERIOR (sin `estado`), creado por la versión que corría antes de este
    // cambio. Nunca se reenvía —eso sería duplicar—, pero tampoco puede quedar en silencio.
    // El orden de las señales importa: la versión vieja escribía `finTs` TAMBIÉN al fallar,
    // así que `finTs` no prueba envío; solo vale como éxito cuando no hay ninguna señal de
    // fallo. Se mira: envíos reales → fallo (ambiguo o con error) → finTs limpio → nada.
    if (!d.estado) {
      if ((d.enviados || 0) > 0) return { ok: false, ref, motivo: 'enviado', doc: d };
      if ((d.ambiguos || 0) > 0 || d.error) return { ok: false, ref, motivo: 'incierto', doc: d };
      if (d.finTs) return { ok: false, ref, motivo: 'enviado', doc: d };
      return { ok: false, ref, motivo: 'agotado', doc: d };
    }

    // 'en_curso' VENCIDO: la ejecución que lo tomó murió sin cerrarlo (la función tiene
    // maxDuration 30s, así que 10 min es de sobra). Pudo haber alcanzado a enviar parte, así
    // que NO se reenvía; pero se marca `incierto` para que el fallo se reporte en vez de que
    // el turno quede bloqueado y callado el resto del día.
    if (d.estado === 'en_curso') {
      const venció = d.inicioTs && (Date.now() - Date.parse(d.inicioTs)) > LEASE_MS;
      if (!venció) return { ok: false, ref, motivo: 'en_curso', doc: d };
      const error = 'la ejecución que tomó el turno no lo cerró (quedó a mitad)';
      tx.update(ref, { estado: 'incierto', error });
      return { ok: false, ref, motivo: 'incierto', doc: { ...d, estado: 'incierto', error } };
    }

    if (d.estado !== 'reintentable') {
      // 'enviado' / 'incierto' → esta ejecución NO envía.
      return { ok: false, ref, motivo: d.estado, doc: d };
    }
    const intento = (d.intentos || 0) + 1;
    if (intento > maxIntentos) return { ok: false, ref, motivo: 'agotado', doc: d };
    tx.update(ref, { estado: 'en_curso', intentos: intento, inicioTs: ahora });
    return { ok: true, ref, intento };
  });
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
//   · 0 enviados y ningún fallo AMBIGUO → se sabe que nadie recibió nada, así que reintentar
//     no puede duplicar: se libera el turno (el próximo tick de 30 min reintenta) y se
//     responde no-2xx para que el job falle.
//   · 0 enviados pero con algún fallo AMBIGUO (timeout, 5xx de Meta) → la petición pudo haber
//     llegado y el mensaje pudo haberse entregado: el turno NO se libera, porque reintentar
//     sobre un ambiguo es exactamente cómo se duplica. Igual responde no-2xx.
//   · envío parcial → algunos SÍ recibieron: reintentar duplicaría, así que el día se marca
//     igual; los fallidos se anotan y se avisan, pero no ponen el job en rojo (un técnico con
//     el número muerto dejaría el cron rojo todos los días y la alerta se volvería ruido).
export function politicaEnvio(enviados, intentados, ambiguos = 0) {
  if (enviados === 0) {
    return {
      liberarTurno: ambiguos === 0,
      marcarDia: false,
      fallidos: intentados,
      error: ambiguos === 0
        ? `ningún envío salió (0/${intentados})`
        : `ningún envío confirmado (0/${intentados}) y ${ambiguos} con resultado incierto — no se reintenta para no duplicar`,
    };
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
    if (!destinos.length) {
      // Ya pasó la hora y no hay nadie marcado en 🔔 Alertas del bot: no es un error del
      // cron, pero tampoco puede quedar en silencio — el workflow lo avisa como warning.
      console.log(`[cron_recordatorios] ${tipo} · 0 destinatarios con avisos.recordatorio`);
      resultados[tipo] = { sinDestinatarios: true, enviados: 0, intentados: 0 };
      continue;
    }

    const turno = await tomarTurno(db, hoy, tipo);
    if (!turno.ok) {
      // Si el día terminó SIN entrega confirmada, no puede quedar en silencio: los ticks
      // siguientes veían el turno tomado y respondían 200 con `resultados` vacío, así que el
      // monitoreo dejaba de avisar aunque nadie hubiera recibido nada. Se reporta con 502 UNA
      // vez (el primero que lo detecta marca `reportado`) y después se sigue devolviendo el
      // error en la respuesta, pero sin repetir el rojo cada 30 min.
      const fallado = turno.motivo === 'agotado' || turno.motivo === 'incierto';
      if (fallado) {
        const yaReportado = turno.doc?.reportado === true;
        resultados[tipo] = {
          error: turno.doc?.error || turno.motivo,
          motivo: turno.motivo,
          intentos: turno.doc?.intentos ?? null,
          reportadoAntes: yaReportado,
        };
        // El reporte se RECLAMA en transacción: dos ejecuciones solapadas que vean el mismo
        // fallo sin reportar pondrían dos jobs en rojo por el mismo problema.
        // Sigue siendo best-effort respecto de GitHub: se marca antes de saber si llegó a ver
        // el 502 (si la función muriera justo después, quedaría como "ya reportado" sin haber
        // puesto ningún job en rojo). Se acepta a cambio de no repetir el rojo cada 30 min; el
        // error igual queda visible en `resultados` de todos los ticks siguientes.
        if (!yaReportado) {
          const reclamado = await db.runTransaction(async (tx) => {
            const s = await tx.get(turno.ref);
            if (s.data()?.reportado === true) return false;
            tx.update(turno.ref, { reportado: true });
            return true;
          }).catch(() => true);   // si la transacción falla, se reporta igual (mejor de más)
          if (reclamado) {
            huboError = true;
            console.error(`[cron_recordatorios] ${tipo} · ${turno.motivo} — ${turno.doc?.error || 'sin entrega confirmada'}`);
          }
        }
      } else {
        console.log(`[cron_recordatorios] ${tipo} · turno ${turno.motivo}, no se envía`);
      }
      continue;
    }

    let n = 0, ambiguos = 0;
    try {
      const r = await notificarPorTipo('recordatorio', TEXTO[tipo], '', {
        destinos,
        detalle: true,
        params: [tipo === 'entrada' ? 'Entrada' : 'Salida'],
      });
      n = r.enviados; ambiguos = r.ambiguos;
    } catch (e) {
      // Excepción a mitad del envío: pudo haber mandado parte, así que el turno queda
      // INCIERTO (no se reintenta: reintentar duplicaría) y el job falla por el 502 de abajo.
      await turno.ref.update({
        estado: 'incierto', error: String(e?.message || e), enviados: n,
        finTs: new Date().toISOString(), reportado: true,
      }).catch(() => {});
      console.error(`[cron_recordatorios] ${tipo} · falló el envío:`, e?.message || e);
      resultados[tipo] = { error: String(e?.message || e), enviados: n, intentados: destinos.length };
      huboError = true;
      continue;
    }

    // El turno ya no se BORRA para reintentar: cambia de estado. Borrarlo perdía la cuenta de
    // intentos y por eso un fallo definitivo se repetía cada 30 min hasta medianoche.
    const pol = politicaEnvio(n, destinos.length, ambiguos);
    const estado = pol.error ? (pol.liberarTurno ? 'reintentable' : 'incierto') : 'enviado';
    const quedanIntentos = turno.intento < MAX_INTENTOS_DIA;
    await turno.ref.update({
      estado, enviados: n, fallidos: pol.fallidos, ambiguos,
      error: pol.error || null, finTs: new Date().toISOString(),
    }).catch(() => {});

    if (pol.error) {
      const cola = estado === 'incierto' ? ' — no se reintenta (pudo haber llegado)'
        : quedanIntentos ? ` — se reintenta en el próximo tick (intento ${turno.intento}/${MAX_INTENTOS_DIA})`
        : ` — sin más reintentos hoy (${turno.intento}/${MAX_INTENTOS_DIA})`;
      console.error(`[cron_recordatorios] ${tipo} · ${pol.error}${cola}`);
      resultados[tipo] = {
        error: pol.error, enviados: 0, intentados: destinos.length, ambiguos,
        intento: turno.intento, reintentara: estado === 'reintentable' && quedanIntentos,
      };
      huboError = true;
      await turno.ref.update({ reportado: true }).catch(() => {});
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
