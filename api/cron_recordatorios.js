// Cron de recordatorios de asistencia — a la hora fija configurada en Personal → 🔔 Alertas
// del bot (colección config_recordatorios/default), manda un WhatsApp de recordatorio de
// ENTRADA/SALIDA a quien tenga avisos.recordatorio=true en maestros_personal.
//
// Incondicional a propósito: NO lee asistencia_registros ni regimenAsistencia (decisión
// explícita del usuario) — el bot de marcaje sigue intacto, sin ninguna dependencia nueva.
//
// Días laborables únicamente: domingo y feriados (`maestros_feriados`) no reciben NADA. El
// sábado sí es laborable, pero con jornada corta — la SALIDA usa `horaEfectiva` (default 1pm,
// configurable en `config_recordatorios.horaSalidaSabado`) en vez de `horaSalida`. Mismo
// criterio que ya usa el resto de asistencia (`calcHorasExtra`/`esDiaNoLaboral`).
//
// Disparado por un workflow de GitHub Actions (schedule) contra este endpoint, protegido
// por CRON_SECRET (header x-cron-secret). No usamos Vercel Cron Jobs: el plan Hobby no
// permite un horario editable sin redeploy y solo corre sobre deployments de Producción —
// acá la hora la fija el usuario desde la app, sin tocar código.
import crypto from 'node:crypto';
import admin from 'firebase-admin';
import { getDb } from './_lib/firestore.js';
import { hoyLima, horaHHMMLima, decimalAHHMM, diaSemanaLima } from './_lib/fecha.js';
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

// VENTANA DE GRACIA — un recordatorio que llega muy tarde es peor que no llegar. El endpoint
// solo sabe "¿ya pasó la hora y no se mandó hoy?", así que si el disparador se demora horas
// (le pasó a GitHub Actions: su `schedule` perdía ticks y corría cada ~1.5 h en vez de cada 30
// min) el técnico recibía "no olvides marcar tu entrada" a media mañana — inútil, y le resta
// credibilidad al bot para cuando el aviso sí sea oportuno.
//
// Pasada la ventana el envío del día se SALTA y se reporta como fallo: el problema es del
// disparador, y taparlo mandando el mensaje tarde solo lo esconde. Configurable desde
// Personal → 🔔 Alertas del bot (`config_recordatorios.ventanaGraciaMin`).
export const GRACIA_DEFAULT_MIN = 45;
// Rango admitido. No es cosmético: `ventanaGraciaMin` ES la política de envío, y un valor
// corrupto la cambia entera sin que nadie se entere — `0.1` saltaría prácticamente todos los
// días, `1e9` volvería a permitir el recordatorio a cualquier hora (el bug que esto vino a
// cerrar). El `min`/`max` del input de personal.html no alcanza: el doc de Firestore se puede
// escribir desde otro lado, así que el backend valida por su cuenta.
export const GRACIA_MIN_MIN = 1;
export const GRACIA_MAX_MIN = 240;

// Exportada para testear la normalización sola: su modo de fallo es aceptar basura en
// silencio, no lanzar.
export function normalizarGracia(valor) {
  // `Number(valor)` a secas NO alcanza: `Number(true) === 1`, así que un booleano corrupto en
  // Firestore pasaría como una tolerancia de 1 minuto —el caso peligroso que esto vino a
  // evitar— y encima sin caer en el aviso, porque el valor "normalizado" coincidiría con el
  // guardado. Lo mismo con `[]` (→ 0) y `['30']` (→ 30). Se aceptan solo un número de verdad
  // o un string de dígitos (que es como puede quedar si se cargó a mano).
  let n;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) n = Number(valor.trim());
  else return GRACIA_DEFAULT_MIN;
  if (!Number.isInteger(n) || n < GRACIA_MIN_MIN || n > GRACIA_MAX_MIN) return GRACIA_DEFAULT_MIN;
  return n;
}

// Exportada para testear la aritmética sin montar el handler entero: las horas viajan en
// DECIMAL (8.5 = 08:30) y la ventana en MINUTOS, así que un error de unidades acá apagaría
// la protección (×60 de menos) o la dispararía siempre (×60 de más), en los dos casos sin
// hacer ruido.
export function evaluarAtraso(ahora, hora, graciaMin) {
  const atrasoMin = (Number(ahora) - Number(hora)) * 60;
  return { atrasoMin, vencido: atrasoMin > graciaMin };
}

// Docs del formato ANTERIOR (sin `estado`), que ya existen en producción. UNA sola definición
// compartida por `tomarTurno` y `marcarVencido`: tener la regla duplicada es exactamente cómo
// un camino se arregla y el otro se queda leyendo un fallo viejo como éxito.
//
// El orden de las señales importa: la versión vieja escribía `finTs` TAMBIÉN al fallar, así
// que `finTs` no prueba envío; solo vale como éxito cuando no hay ninguna señal de fallo.
export function clasificarLegacy(d) {
  if ((d.enviados || 0) > 0) return 'enviado';
  if ((d.ambiguos || 0) > 0 || d.error) return 'incierto';
  if (d.finTs) return 'enviado';
  return 'agotado';
}

// Exportada para testearla con un Firestore inyectado, igual que `tomarTurno`: decide si el día
// se da por perdido, así que su modo de fallo es callarse (nadie se entera de que no salió) o
// gritar en cada tick hasta medianoche (el ruido que enseña a ignorar las alertas).
//
// Solo ESCRIBE sobre un turno inexistente o 'reintentable' (falló dentro de la ventana y ahora
// ya venció: no tiene sentido seguir reintentando) y sobre un 'en_curso' abandonado. El resto
// de los estados ya dijeron lo suyo y no se pisan — pero el motivo NO es intercambiable:
// clasificarlos a todos como fallo reportaba un falso "sin entrega confirmada" sobre un día que
// SÍ se envió, y eso enseña a ignorar las alertas igual que el ruido.
export async function marcarVencido(db, hoy, tipo, atrasoMin, graciaMin) {
  const ref = db.collection('recordatorio_envios').doc(`${hoy}_${tipo}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() || {}) : null;
    const estado = d ? (d.estado || clasificarLegacy(d)) : null;

    if (d && estado === 'enviado') return { reclamado: false, motivo: 'enviado', sinFallo: true, doc: d };

    if (d && estado === 'en_curso') {
      // Misma regla de lease que `tomarTurno`: uno recién tomado es una ejecución viva (no es
      // un fallo); uno abandonado no puede quedar bloqueado y callado el resto del día.
      const venció = d.inicioTs && (Date.now() - Date.parse(d.inicioTs)) > LEASE_MS;
      if (!venció) return { reclamado: false, motivo: 'en_curso', sinFallo: true, doc: d };
      const error = 'la ejecución que tomó el turno no lo cerró (quedó a mitad) y ya venció la tolerancia';
      tx.update(ref, { estado: 'incierto', error, reportado: true });
      return { reclamado: !d.reportado, motivo: 'incierto', error, doc: d };
    }

    // Fallos que ya son finales ('incierto' / 'agotado' / 'vencido', propios o derivados de un
    // doc legacy): no se pisan, pero uno que NUNCA se reportó tiene que salir a la luz — y uno
    // que ya se reportó no puede volver a poner el job en rojo por lo mismo.
    if (d && estado !== 'reintentable') {
      const reclamado = !d.reportado;
      if (reclamado) tx.update(ref, { reportado: true });
      return { reclamado, motivo: estado, doc: d };
    }

    const error = `el disparador llegó ${Math.round(atrasoMin)} min tarde (ventana ${graciaMin} min) — no se envía, un recordatorio a destiempo confunde más de lo que ayuda`;
    const payload = {
      fecha: hoy, tipo, estado: 'vencido', error, atrasoMin: Math.round(atrasoMin),
      graciaMin, finTs: new Date().toISOString(), reportado: true,
    };
    if (d) tx.update(ref, payload); else tx.set(ref, { ...payload, intentos: 0 });
    // Un 'reintentable' que YA se había reportado (falló dentro de la ventana) no vuelve a
    // poner el job en rojo al vencer: es el mismo problema del mismo día.
    return { reclamado: !d?.reportado, error };
  });
}

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
    // La clasificación vive en `clasificarLegacy`, compartida con `marcarVencido`.
    if (!d.estado) return { ok: false, ref, motivo: clasificarLegacy(d), doc: d };

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

// DÍA NO LABORABLE — domingo (dow===0) y feriados no reciben NINGÚN recordatorio (ni entrada
// ni salida). Mismo criterio que ya usa el resto del sistema para asistencia
// (`asistencia_multiaire.html`: `calcHorasExtra`/`esDiaNoLaboral` → `dow===0 || isFeriado(f)`).
// El SÁBADO (dow===6) SÍ es laborable — no confundir con que tenga jornada corta, que se
// resuelve aparte en `horaEfectiva`.
export function esDiaLaborable(dow, feriado) {
  return dow !== 0 && !feriado;
}

// Consulta por IGUALDAD de `fecha` (mismo campo YYYY-MM-DD de `maestros_feriados` que usa
// `asistencia_multiaire.html`) — sin índice compuesto, trae como mucho 1 doc.
export async function esFeriadoHoy(db, hoy) {
  const snap = await db.collection('maestros_feriados').where('fecha', '==', hoy).limit(1).get();
  return !snap.empty;
}

// SÁBADO tiene jornada corta (8:30–13:00, la misma convención que ya usa el resto de
// asistencia — ver `calcHorasExtra`: base 4.5h los sábados vs 9.5h L-V). La hora de ENTRADA
// no cambia (sigue siendo `horaEntrada` los 6 días); solo la de SALIDA. Configurable aparte
// en `config_recordatorios.horaSalidaSabado`; sin configurar, cae a la 1pm.
export const SALIDA_SABADO_DEFAULT = 13;
export function horaEfectiva(tipo, dow, cfg) {
  if (tipo === 'salida' && dow === 6) {
    const h = cfg.horaSalidaSabado;
    return (h != null && Number.isFinite(Number(h))) ? Number(h) : SALIDA_SABADO_DEFAULT;
  }
  return cfg[tipo === 'entrada' ? 'horaEntrada' : 'horaSalida'];
}

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
  const dow = diaSemanaLima();

  // Domingo o feriado → ningún recordatorio hoy (ni entrada ni salida). Se corta ANTES de
  // leer destinatarios/tomar turno: no hay nada que enviar, así que no vale la pena el resto
  // del trabajo. No es un fallo — se responde 200 explicando por qué no se mandó nada.
  const feriadoHoy = dow !== 0 ? await esFeriadoHoy(db, hoy) : false;
  if (!esDiaLaborable(dow, feriadoHoy)) {
    const motivo = dow === 0 ? 'domingo' : 'feriado';
    console.log(`[cron_recordatorios] ${hoy} · ${motivo} — no se manda ningún recordatorio`);
    return res.status(200).json({ ok: true, hoy, ahora: decimalAHHMM(ahora), diaNoLaborable: motivo, resultados: {} });
  }

  const ultimoEnvio = { ...(cfg.ultimoEnvio || {}) };
  // Un valor basura en el config no puede desactivar la ventana en silencio: se cae al default.
  const graciaMin = normalizarGracia(cfg.ventanaGraciaMin);
  if (cfg.ventanaGraciaMin != null && graciaMin !== Number(cfg.ventanaGraciaMin)) {
    console.warn(`[cron_recordatorios] ventanaGraciaMin inválida (${cfg.ventanaGraciaMin}) — se usa el default ${GRACIA_DEFAULT_MIN} min`);
  }
  const resultados = {};
  const configInvalida = {};  // advertencias de configuración, no cortan el envío
  let enviadoAhora = false;   // solo se reescribe el config si esta ejecución mandó algo
  let huboError = false;      // → responde 502 para que el workflow NO quede verde en falso

  for (const tipo of ['entrada', 'salida']) {
    const hora = horaEfectiva(tipo, dow, cfg);
    if (hora == null || !Number.isFinite(Number(hora))) continue; // sin hora configurada
    if (ahora < Number(hora)) continue;                           // aún no llega la hora

    // CONFIGURACIÓN QUE CRUZA MEDIANOCHE — la comparación es siempre contra la hora de HOY, así
    // que el tramo de la ventana que cae después de las 00:00 ya no se alcanza (`ahora < hora`
    // corta) y ahí el envío no saldría NI se marcaría vencido: silencio. `personal.html` rechaza
    // la combinación al guardar, pero el doc de Firestore se puede escribir desde otro lado.
    //
    // Es una ADVERTENCIA, no un corte: entre la hora configurada y medianoche el envío es
    // perfectamente válido y cortarlo acá dejaría sin recordatorio a un día que sí podía salir.
    // El ORDEN de las tres líneas de acá es deliberado: después de `ahora < hora` (antes,
    // avisaría en cada tick desde la madrugada) y ANTES del atajo de `ultimoEnvio` (después,
    // la advertencia se apagaría justo cuando el recordatorio sale bien, que es cuando más
    // falta hace enterarse de que la config tiene un tramo muerto).
    // `> 24` y no `>=`: una ventana que termina JUSTO a las 24:00 no cruza nada.
    if (Number(hora) + graciaMin / 60 > 24) {
      console.warn(`[cron_recordatorios] ${tipo} · la tolerancia de ${graciaMin} min sobre ${decimalAHHMM(hora)} cruza la medianoche`);
      configInvalida[tipo] = `la hora de ${tipo} (${decimalAHHMM(hora)}) más la tolerancia de ${graciaMin} min cruza la medianoche — corregilo en Personal → 🔔 Alertas del bot`;
    }

    if (ultimoEnvio[tipo] === hoy) continue;                      // ya se mandó hoy (atajo barato)

    // VENTANA DE GRACIA — se evalúa antes de resolver destinatarios y antes de tomar el turno:
    // si el día ya se perdió, no tiene sentido leer `maestros_personal` ni reservar nada.
    const { atrasoMin, vencido } = evaluarAtraso(ahora, hora, graciaMin);
    if (vencido) {
      const v = await marcarVencido(db, hoy, tipo, atrasoMin, graciaMin);
      // `sinFallo`: el día ya se envió, o hay una ejecución viva mandándolo ahora mismo. No es
      // un fallo y no puede reportarse como tal — un falso "sin entrega confirmada" sobre un
      // recordatorio que SÍ salió enseña a ignorar las alertas igual que el ruido.
      if (v.sinFallo) continue;
      const err = v.error || v.doc?.error || `vencido (${v.motivo})`;
      resultados[tipo] = {
        error: err, motivo: v.motivo || 'vencido', atrasoMin: Math.round(atrasoMin), graciaMin,
        enviados: 0, intentados: 0, reportadoAntes: !v.reclamado,
      };
      // El 502 sale UNA vez (quien reclama el turno); después el error sigue viajando en
      // `resultados` y el workflow lo emite como ::warning:: en cada corrida — el rojo puede
      // perderse, el aviso no.
      if (v.reclamado) {
        huboError = true;
        console.error(`[cron_recordatorios] ${tipo} · VENCIDO — ${err}`);
      }
      continue;
    }

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
        //
        // El 502 único es best-effort y no puede ser otra cosa: se marca `reportado` antes de
        // saber si GitHub llegó a ver la respuesta, y si la función muriera en el medio, ese
        // rojo se perdería. Por eso la alerta NO depende solo del rojo — el error se sigue
        // devolviendo en `resultados` de todos los ticks siguientes y el workflow lo emite
        // como `::warning::` en cada corrida. El rojo puede perderse; el aviso no.
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
  // Las advertencias de configuración viajan APARTE de `resultados`: no son un fallo de envío
  // (el recordatorio del día pudo salir perfectamente) y meterlas ahí pondría el job en rojo
  // por algo que se arregla en la app, no en el cron.
  for (const [tipo, msg] of Object.entries(configInvalida)) {
    resultados[tipo] = { ...(resultados[tipo] || {}), configInvalida: msg };
  }
  // no-2xx ante fallo real: es lo único que pone el job de GitHub Actions en rojo.
  const status = huboError ? 502 : 200;
  return res.status(status).json({ ok: !huboError, hoy, ahora: decimalAHHMM(ahora), resultados });
}
