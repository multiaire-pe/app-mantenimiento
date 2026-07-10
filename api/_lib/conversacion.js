// Motor conversacional del bot (Fase 4). Lleva al técnico de un mensaje suelto a una
// observación confirmada, repreguntando lo mínimo y SIEMPRE confirmando antes de escribir.
//
// Estados de la sesión (wa_sesiones):
//   RECOLECTANDO  → falta tienda / equipo / un detalle → se repregunta (máx 1-2).
//   CONFIRMANDO   → ya hay borrador completo → se muestra resumen y se espera "SÍ".
//
// Diseño desacoplado/testeable: `analizar` (Gemini) y `guardar` (escritura) se inyectan;
// por defecto usan los módulos reales, pero en pruebas se pasan stubs.
import { estructurarObservacion } from './gemini.js';
import { resolverEquipo } from './equipos.js';
import { contextoInventario } from './inventario.js';
import { textoGuia } from './guia.js';
import { getSesion, guardarSesion, limpiarSesion, nuevaSesion, guardarUltimaObs, getUltimaObs, limpiarUltimaObs } from './sesiones.js';
import { guardarFotoPendiente, getFotoPendiente, tieneFotoPendiente, limpiarFotoPendiente } from './fotos.js';
import { agregarFotoAObservacion } from './escritura.js';
import { menuOperatividad, parsearOperatividad, registrarOperatividad, nivelDeOperatividad } from './operatividad.js';

// Termina la conversación: borra la sesión y la foto pendiente.
async function limpiarTodo(from) {
  await limpiarSesion(from);
  await limpiarFotoPendiente(from);
}

const MAX_REPREGUNTAS = 2;

const ESTADO_LABEL = { PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', OK: 'Resuelto (OK)' };

// ── Detección de intención (respuestas cortas del técnico) ──────────────────────
const RE_CONFIRMA  = /^\s*(s[ií]+|sip|ok\b|okey|oka|dale|ya\b|listo|correcto|confirm\w*|guard\w*|de acuerdo|👍|✅)/i;
const RE_CANCELA   = /^\s*(cancel\w*|anul\w*|olv[ií]d\w*|descart\w*|borr\w*)/i;
const RE_NUEVA     = /^\s*(nueva\s+observ\w*|otra\s+observ\w*|empez\w*\s+de\s+nuevo|reinici\w*)/i;
const RE_GUARDA_ASI = /(guard\w*\s+as[ií]|as[ií]\s+est[aá]|d[eé]jal\w*\s+as[ií]|sin\s+m[aá]s|sin\s+detalle|no\s+aplica)/i;
const RE_AYUDA     = /^\s*(ayuda|help|c[oó]mo\s+funciona|men[uú]|hola|buenas|buenos d[ií]as)\s*$/i;
// "agregar foto a la última", "olvidé la foto", "foto de la anterior"…
const RE_AGREGAR_FOTO = /\b(agreg\w*|a[ñn]ad\w*|adjunt\w*|sub\w*|pon\w*|olvid\w*)\b[\s\w]*\b(foto|imagen)\b|\b(foto|imagen)\b[\s\w]*\b(ultim\w*|anterior|olvid\w*|esa\s+observ\w*)\b/i;

// ── Entrada principal ───────────────────────────────────────────────────────────
// Devuelve el texto a responder por WhatsApp. Maneja la sesión internamente.
export async function manejarMensaje({
  tecnico, from, texto, imagenB64 = null, mime = null,
  guardar,                              // (borrador, tecnico, foto) => {id,...}  (escribe + avisos)
  analizar = estructurarObservacion,    // (texto, imgB64, mime, guiaTexto) => {tienda,equipo,observacion,estado,faltaDetalle,pregunta}
  adjuntarFoto = agregarFotoAObservacion, // (obsId, foto) => bool  (adjunta foto a una obs ya guardada)
  registrarOp = registrarOperatividad,  // (datos) => evento  (evento + estado vivo en inventario)
}) {
  const t = (texto || '').trim();
  let ses = await getSesion(from);

  // Si no hay sesión viva (inexistente o expirada por TTL), descarta cualquier foto pendiente
  // huérfana de una conversación anterior: NO debe adjuntarse a la observación que empiece ahora.
  // La foto de ESTE turno se guarda más abajo, después de esta limpieza.
  if (!ses) await limpiarFotoPendiente(from);

  // Saludo / ayuda sin conversación en curso (y sin foto).
  if (!ses && !imagenB64 && RE_AYUDA.test(t)) return bienvenida(tecnico);

  // ── Agregar foto a la ÚLTIMA observación guardada (la olvidó al registrar) ──────
  if (ses && ses.fase === 'ADJUNTAR_FOTO') {
    return manejarAdjuntarFoto(ses, tecnico, from, { t, imagenB64, mime, adjuntarFoto, analizar });
  }

  // ── Operatividad del equipo tras registrar la observación (opcional) ────────────
  if (ses && ses.fase === 'OPERATIVIDAD') {
    return manejarOperatividad(ses, tecnico, from, { t, imagenB64, mime, registrarOp, adjuntarFoto });
  }
  if (!ses) {
    const ult = await getUltimaObs(from);
    if (ult) {
      // Foto SIN texto justo después de guardar → casi seguro la que olvidó.
      if (imagenB64 && !t) {
        await guardarFotoPendiente(from, imagenB64, mime);
        const s = nuevaSesion(from, tecnico);
        s.fase = 'ADJUNTAR_FOTO'; s.ultimaObs = ult;
        await guardarSesion(from, s);
        return `📷 ¿Adjunto esta foto a tu última observación (*${ult.etiqueta}*)? Responde *SÍ*.\n_(o si es de un equipo nuevo, descríbela)_`;
      }
      // Pidió "agregar foto a la última" (aún sin mandarla).
      if (!imagenB64 && RE_AGREGAR_FOTO.test(t)) {
        const s = nuevaSesion(from, tecnico);
        s.fase = 'ADJUNTAR_FOTO'; s.ultimaObs = ult; s.esperaFoto = true;
        await guardarSesion(from, s);
        return `📷 Mándame la foto y la adjunto a tu última observación (*${ult.etiqueta}*).`;
      }
    }
  }

  // Cancelar / reiniciar (solo si hay conversación viva).
  if (ses && RE_CANCELA.test(t)) {
    await limpiarTodo(from);
    return '👍 Listo, descarté esa observación. Cuando quieras, mándame otra.';
  }
  if (ses && RE_NUEVA.test(t)) {
    await limpiarTodo(from);
    return '🔄 Empecemos de nuevo. Cuéntame la observación (tienda, equipo y el hallazgo).';
  }

  // Si llegó una foto, la guardamos pendiente (se adjunta al confirmar). Si es muy grande no se
  // guarda (devuelve false) → avisamos al técnico y seguimos con la observación sin la foto.
  let avisoFoto = '';
  if (imagenB64 && !(await guardarFotoPendiente(from, imagenB64, mime))) {
    avisoFoto = '⚠️ Esa foto pesa demasiado, no pude adjuntarla. Compríme y reenvíala. Sigo con la observación.\n\n';
  }

  // "Guardar así": saltar la repregunta de detalle y pasar a confirmar lo que haya.
  if (ses && ses.fase === 'RECOLECTANDO' && ses.faltante === 'detalle' && RE_GUARDA_ASI.test(t)) {
    ses.fase = 'CONFIRMANDO';
    ses.faltante = null;
    await guardarSesion(from, ses);
    return avisoFoto + resumenConfirmar(ses.borrador, await tieneFotoPendiente(from));
  }

  // En confirmación: "SÍ" guarda; cualquier otra cosa se trata como corrección.
  if (ses && ses.fase === 'CONFIRMANDO') {
    if (RE_CONFIRMA.test(t)) {
      const foto = await getFotoPendiente(from);
      let obs;
      try {
        obs = await guardar(ses.borrador, tecnico, foto);
      } catch (e) {
        console.error('[conversacion] error al guardar:', e?.message);
        return '⚠️ No pude guardar la observación ahora mismo. Inténtalo de nuevo en un momento (responde *SÍ*).';
      }
      // La observación YA está guardada. Todo lo que sigue es best-effort: un fallo NO debe
      // dejar la sesión en CONFIRMANDO (un reintento/"SÍ" re-ejecutaría `guardar` y duplicaría la obs).
      const b = ses.borrador;
      await limpiarFotoPendiente(from).catch(() => {});   // la foto pendiente ya se escribió con la obs
      if (obs?.id) await guardarUltimaObs(from, obs.id, b.equipo).catch(() => {});
      // Preguntamos la operatividad del equipo (opcional). La sesión sigue viva en fase OPERATIVIDAD.
      try {
        ses.fase = 'OPERATIVIDAD';
        ses.opObsId = obs?.id || null;
        ses.opEquipo = { eqId: b.eqId, sede: b.sede, cliente: b.cliente, tipo: b.tipo, nombre: b.equipo, area: b.area };
        ses.opConFoto = !!foto;
        ses.opIntentos = 0;
        await guardarSesion(from, ses);
        return guardadoConPreguntaOp(b);
      } catch (e) {
        // No se pudo abrir la fase OPERATIVIDAD: cerramos limpio (la obs está guardada; el % es opcional).
        console.error('[conversacion] no se pudo abrir OPERATIVIDAD:', e?.message);
        await limpiarSesion(from).catch(() => {});
        return cierreTrasOperatividad(!!foto, '');
      }
    }
    if (t) ses.historial.push(t);             // corrección → reextraer con el texto nuevo
    return avisoFoto + await procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
  }

  // Nuevo mensaje o sesión en RECOLECTANDO.
  if (!ses) ses = nuevaSesion(from, tecnico);
  if (t) ses.historial.push(t);
  if (!ses.historial.length && !imagenB64) {
    await guardarSesion(from, ses);
    return 'Cuéntame la observación: en qué *sede* y *equipo*, y qué encontraste. 🛠️';
  }
  return avisoFoto + await procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
}

// ── Núcleo: reextrae el acumulado, resuelve tienda/equipo y decide el siguiente paso ──
async function procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar }) {
  const textoAcum = ses.historial.join('. ');
  let g;
  try {
    const guiaTexto = await textoGuia();
    const contexto = await contextoInventario();
    try {
      g = await analizar(textoAcum, imagenB64, mime, guiaTexto, contexto);
    } catch (e1) {
      // Si falló CON imagen pero hay texto, reintentamos SOLO con el texto: la foto igual se
      // adjunta al guardar (Gemini "verla" es opcional; el caption es la señal principal).
      if (imagenB64 && textoAcum) {
        console.warn('[conversacion] análisis con imagen falló, reintento solo texto:', e1?.message);
        g = await analizar(textoAcum, null, null, guiaTexto, contexto);
      } else {
        throw e1;
      }
    }
  } catch (e) {
    console.error('[conversacion] análisis falló:', e?.message);
    await guardarSesion(from, ses);           // conserva el historial para reintentar
    return '🤔 No pude procesar eso ahora mismo. ¿Puedes repetir la observación?';
  }

  const b = ses.borrador;
  b.observacion = g.observacion || b.observacion || '';
  b.estado = g.estado || b.estado || 'PENDIENTE';

  // Resolver sede/equipo contra el inventario REAL (557 equipos). Pasamos el texto acumulado
  // para detectar el cliente aunque lo haya dicho en una repregunta anterior (multi-cliente).
  const r = await resolverEquipo(g.sede || b.sede, g.equipo, textoAcum);
  if (!r.ok && r.motivo === 'sede') {
    b.sede = ''; b.eqId = ''; b.equipo = '';
    return repreguntar(ses, from, 'sede', preguntarSede(r.candidatosSede));
  }
  if (!r.ok && r.motivo === 'cliente') {
    b.sede = r.sede; b.eqId = ''; b.equipo = '';
    return repreguntar(ses, from, 'cliente', preguntarCliente(r.sede, r.candidatosCliente));
  }
  if (!r.ok && r.motivo === 'equipo') {
    b.sede = r.sede; b.eqId = ''; b.equipo = '';
    return repreguntar(ses, from, 'equipo', preguntarEquipo(r.sede, r.candidatosEquipo));
  }
  b.sede = r.sede;
  b.eqId = r.equipo.eqId;
  b.equipo = r.equipo.nombre;
  b.tipo = r.equipo.tipo;
  b.area = r.equipo.area || '';
  b.cliente = r.equipo.cliente;

  // ¿Gemini sugiere una repregunta útil y aún no la hicimos?
  if (g.faltaDetalle && g.pregunta && !ses.preguntoDetalle && ses.intentos < MAX_REPREGUNTAS) {
    ses.preguntoDetalle = true;
    return repreguntar(ses, from, 'detalle', `${g.pregunta}\n\n_(o responde *guardar así* si no aplica)_`);
  }

  // Borrador completo → confirmar.
  ses.fase = 'CONFIRMANDO';
  ses.faltante = null;
  await guardarSesion(from, ses);
  return resumenConfirmar(b, await tieneFotoPendiente(from));
}

// Marca la sesión como esperando un dato y persiste, devolviendo la pregunta.
async function repreguntar(ses, from, faltante, pregunta) {
  ses.fase = 'RECOLECTANDO';
  ses.faltante = faltante;
  ses.intentos = (ses.intentos || 0) + 1;
  await guardarSesion(from, ses);
  return pregunta;
}

// ── Mensajes ────────────────────────────────────────────────────────────────────
const sinPrefijo = (t) => String(t || '').replace(/^RIPLEY\s+/i, '');

function bienvenida(tecnico) {
  const nombre = (tecnico?.nombre || '').split(' ')[0];
  return `👋 Hola${nombre ? ' ' + nombre : ''}. Soy el asistente de *Observaciones* de MultiAire.\n\n` +
    'Mándame por aquí los hallazgos de los equipos y yo los registro. ' +
    'Por ejemplo:\n_"Atocongo, cortina de aire 1, no enciende"_\n_(o mándame el código del equipo: MA-...)_\n\n' +
    'Te confirmo antes de guardar. Puedes escribir *cancelar* en cualquier momento.';
}

function preguntarSede(cands) {
  const lista = (cands || []).slice(0, 14).map((c) => `• ${sinPrefijo(c)}`).join('\n');
  return `¿En qué *sede* es?${lista ? '\n' + lista : ''}`;
}

function preguntarCliente(sede, clientes) {
  const lista = (clientes || []).map((c) => `• ${c}`).join('\n');
  return `*${sinPrefijo(sede)}* es de más de un cliente. ¿De cuál es?\n${lista}`;
}

function preguntarEquipo(sede, cands) {
  const lista = cands || [];
  if (!lista.length) return `Dame el *código* del equipo de *${sinPrefijo(sede)}* (ej. MA-...).`;
  if (lista.length <= 15) {
    // Mostramos la UBICACIÓN (área) — es lo que el técnico reconoce ("el del comedor").
    const items = lista.map((e) => `• ${e.nombre}${e.area ? ` — ${e.area}` : (e.tipo ? ` (${e.tipo.toLowerCase()})` : '')}`).join('\n');
    return `¿Cuál equipo de *${sinPrefijo(sede)}*?\n${items}\n\n_(dime el nombre, la *ubicación*, el número o el código MA-...)_`;
  }
  // Muchos equipos → agrupar por tipo y pedir tipo+número o código.
  const porTipo = {};
  lista.forEach((e) => { const t = e.tipo || 'OTRO'; porTipo[t] = (porTipo[t] || 0) + 1; });
  const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `• ${t.toLowerCase()} (${n})`).join('\n');
  return `*${sinPrefijo(sede)}* tiene ${lista.length} equipos. ¿De qué *tipo* y número? O dame el *código* (MA-...).\nTipos disponibles:\n${tipos}`;
}

function resumenConfirmar(b, conFoto) {
  return '📝 *Confirma la observación:*\n\n' +
    `🏪 Sede: *${sinPrefijo(b.sede)}*\n` +
    `❄️ Equipo: *${b.equipo}*${b.tipo ? ` (${String(b.tipo).toLowerCase()})` : ''}\n` +
    (b.area ? `📍 Ubicación: ${b.area}\n` : '') +
    (b.eqId ? `🔖 Código: ${b.eqId}\n` : '') +
    `🔧 Observación: ${b.observacion}\n` +
    `📌 Estado: *${ESTADO_LABEL[b.estado] || b.estado}*\n` +
    (conFoto ? '📷 Con foto adjunta\n' : '') +
    '\nResponde *SÍ* para guardar. Si algo está mal, dime la corrección (o el estado correcto), o escribe *cancelar*.';
}

// Acuse tras guardar la observación + la pregunta de operatividad del equipo.
function guardadoConPreguntaOp(b) {
  return '✅ *Observación registrada.* ' +
    `(🏪 ${sinPrefijo(b.sede)} · ❄️ ${b.equipo})\n\n` +
    menuOperatividad();
}

// Cierre del flujo tras responder/omitir la operatividad (incluye el recordatorio de foto si no hubo).
function cierreTrasOperatividad(conFoto, acuseOp) {
  return (acuseOp ? acuseOp + '\n\n' : '') +
    (conFoto
      ? 'Gracias. Mándame otra cuando quieras.'
      : '📷 _¿Olvidaste la foto? Mándamela ahora y la adjunto a esta observación._\n\nGracias. Mándame otra cuando quieras.');
}

// ── Operatividad del equipo tras registrar la observación (estado OPERATIVIDAD) ────
// El técnico responde el % (1..5 / 100/75/50/25/0) u "omitir". Una foto aquí se adjunta
// a la observación (la olvidó al registrar) y se sigue pidiendo el %. Nada bloquea el flujo.
async function manejarOperatividad(ses, tecnico, from, { t, imagenB64, mime, registrarOp, adjuntarFoto }) {
  const conFoto = !!ses.opConFoto;

  // Foto enviada aquí → adjuntar a la observación ya guardada y seguir pidiendo el %.
  if (imagenB64 && ses.opObsId) {
    let ok = false;
    try { ok = await adjuntarFoto(ses.opObsId, { base64: imagenB64, mime }); }
    catch (e) { console.error('[operatividad] adjuntar foto falló:', e?.message); }
    if (ok) { ses.opConFoto = true; await guardarSesion(from, ses); }
    return (ok ? '✅ 📷 Foto agregada a la observación.\n\n' : '') + menuOperatividad();
  }

  // "nueva/otra observación" → cerrar esta (la obs ya se guardó) y arrancar otra de cero.
  if (RE_NUEVA.test(t)) {
    await limpiarTodo(from);
    return '🔄 Empecemos de nuevo. Cuéntame la observación (tienda, equipo y el hallazgo).';
  }

  const val = parsearOperatividad(t);

  // "cancelar" u "omitir" → cerrar sin registrar operatividad (la observación ya quedó guardada).
  if (RE_CANCELA.test(t) || val === 'OMITIR') {
    await limpiarSesion(from);
    return cierreTrasOperatividad(conFoto, '');
  }

  // No entendido → repreguntar una vez; a la 2ª entrada inválida, omitir para no trabar al técnico.
  if (val === null) {
    ses.opIntentos = (ses.opIntentos || 0) + 1;
    if (ses.opIntentos >= 2) {
      await limpiarSesion(from);
      return cierreTrasOperatividad(conFoto, '');
    }
    await guardarSesion(from, ses);
    return 'No te entendí 🤔. Responde el *número* del estado (o escribe *omitir*):\n\n' + menuOperatividad();
  }

  // Valor válido (0/25/50/75/100) → registrar operatividad + estado vivo del equipo.
  await limpiarSesion(from);
  let acuse;
  try {
    const eq = ses.opEquipo || {};
    await registrarOp({
      eqId: eq.eqId, sede: eq.sede, cliente: eq.cliente, tipo: eq.tipo, nombre: eq.nombre, area: eq.area,
      porcentaje: val, obsId: ses.opObsId || null,
      tecnicoId: tecnico?.id || null, registradoPor: tecnico?.nombre || 'WhatsApp', origen: 'WHATSAPP',
    });
    const n = nivelDeOperatividad(val);
    acuse = `✅ Operatividad registrada: *${val} %* ${n.emoji} _(${n.etiqueta})_`;
  } catch (e) {
    console.error('[operatividad] registrar falló:', e?.message);
    acuse = '⚠️ No pude registrar la operatividad, pero la observación quedó guardada.';
  }
  return cierreTrasOperatividad(conFoto, acuse);
}

// ── Adjuntar una foto a la última observación guardada (estado ADJUNTAR_FOTO) ──────
async function manejarAdjuntarFoto(ses, tecnico, from, { t, imagenB64, mime, adjuntarFoto, analizar }) {
  if (RE_CANCELA.test(t)) {
    await limpiarTodo(from);
    await limpiarUltimaObs(from);
    return '👍 Listo, no adjunté nada. La observación quedó como estaba.';
  }
  if (imagenB64) await guardarFotoPendiente(from, imagenB64, mime);
  const foto = await getFotoPendiente(from);
  // Adjuntar: confirmó (SÍ), o pidió "agregar foto" y recién la mandó.
  if (foto && (ses.esperaFoto || RE_CONFIRMA.test(t) || (imagenB64 && !t))) {
    try {
      await adjuntarFoto(ses.ultimaObs.obsId, foto);
    } catch (e) {
      console.error('[conversacion] adjuntar foto falló:', e?.message);
      return '⚠️ No pude adjuntar la foto ahora mismo. Inténtalo de nuevo en un momento.';
    }
    const et = ses.ultimaObs?.etiqueta || '';
    await limpiarSesion(from);
    await limpiarFotoPendiente(from);
    await limpiarUltimaObs(from);
    return `✅ 📷 Foto agregada a tu última observación${et ? ` (*${et}*)` : ''}. ¡Gracias!`;
  }
  // Pidió agregar foto pero mandó texto (no la foto) → seguir esperándola.
  if (ses.esperaFoto && !foto) return '📷 Mándame la *foto* (como imagen) y la adjunto.';
  // No confirmó ni hay foto válida → es una observación NUEVA: arrancamos de cero
  // (la foto pendiente, si la hubiera, se adjuntará a la nueva al guardar).
  await limpiarUltimaObs(from);
  const nueva = nuevaSesion(from, tecnico);
  if (t) nueva.historial.push(t);
  return procesarBorrador(nueva, tecnico, from, { imagenB64, mime, analizar });
}
