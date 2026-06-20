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
import { getSesion, guardarSesion, limpiarSesion, nuevaSesion } from './sesiones.js';
import { guardarFotoPendiente, getFotoPendiente, tieneFotoPendiente, limpiarFotoPendiente } from './fotos.js';

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

// ── Entrada principal ───────────────────────────────────────────────────────────
// Devuelve el texto a responder por WhatsApp. Maneja la sesión internamente.
export async function manejarMensaje({
  tecnico, from, texto, imagenB64 = null, mime = null,
  guardar,                              // (borrador, tecnico, foto) => {id,...}  (escribe + avisos)
  analizar = estructurarObservacion,    // (texto, imgB64, mime, guiaTexto) => {tienda,equipo,observacion,estado,faltaDetalle,pregunta}
}) {
  const t = (texto || '').trim();
  let ses = await getSesion(from);

  // Si no hay sesión viva (inexistente o expirada por TTL), descarta cualquier foto pendiente
  // huérfana de una conversación anterior: NO debe adjuntarse a la observación que empiece ahora.
  // La foto de ESTE turno se guarda más abajo, después de esta limpieza.
  if (!ses) await limpiarFotoPendiente(from);

  // Saludo / ayuda sin conversación en curso (y sin foto).
  if (!ses && !imagenB64 && RE_AYUDA.test(t)) return bienvenida(tecnico);

  // Cancelar / reiniciar (solo si hay conversación viva).
  if (ses && RE_CANCELA.test(t)) {
    await limpiarTodo(from);
    return '👍 Listo, descarté esa observación. Cuando quieras, mándame otra.';
  }
  if (ses && RE_NUEVA.test(t)) {
    await limpiarTodo(from);
    return '🔄 Empecemos de nuevo. Cuéntame la observación (tienda, equipo y el hallazgo).';
  }

  // Si llegó una foto, la guardamos pendiente (se adjunta al confirmar).
  if (imagenB64) await guardarFotoPendiente(from, imagenB64, mime);

  // "Guardar así": saltar la repregunta de detalle y pasar a confirmar lo que haya.
  if (ses && ses.fase === 'RECOLECTANDO' && ses.faltante === 'detalle' && RE_GUARDA_ASI.test(t)) {
    ses.fase = 'CONFIRMANDO';
    ses.faltante = null;
    await guardarSesion(from, ses);
    return resumenConfirmar(ses.borrador, await tieneFotoPendiente(from));
  }

  // En confirmación: "SÍ" guarda; cualquier otra cosa se trata como corrección.
  if (ses && ses.fase === 'CONFIRMANDO') {
    if (RE_CONFIRMA.test(t)) {
      const foto = await getFotoPendiente(from);
      try {
        await guardar(ses.borrador, tecnico, foto);
      } catch (e) {
        console.error('[conversacion] error al guardar:', e?.message);
        return '⚠️ No pude guardar la observación ahora mismo. Inténtalo de nuevo en un momento (responde *SÍ*).';
      }
      const b = ses.borrador;
      await limpiarTodo(from);
      return resumenGuardado(b, !!foto);
    }
    if (t) ses.historial.push(t);             // corrección → reextraer con el texto nuevo
    return procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
  }

  // Nuevo mensaje o sesión en RECOLECTANDO.
  if (!ses) ses = nuevaSesion(from, tecnico);
  if (t) ses.historial.push(t);
  if (!ses.historial.length && !imagenB64) {
    await guardarSesion(from, ses);
    return 'Cuéntame la observación: en qué *sede* y *equipo*, y qué encontraste. 🛠️';
  }
  return procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
}

// ── Núcleo: reextrae el acumulado, resuelve tienda/equipo y decide el siguiente paso ──
async function procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar }) {
  const textoAcum = ses.historial.join('. ');
  let g;
  try {
    const guiaTexto = await textoGuia();
    const contexto = await contextoInventario();
    g = await analizar(textoAcum, imagenB64, mime, guiaTexto, contexto);
  } catch (e) {
    console.error('[conversacion] análisis falló:', e?.message);
    await guardarSesion(from, ses);           // conserva el historial para reintentar
    return '🤔 No pude procesar eso ahora mismo. ¿Puedes repetir la observación?';
  }

  const b = ses.borrador;
  b.observacion = g.observacion || b.observacion || '';
  b.estado = g.estado || b.estado || 'PENDIENTE';

  // Resolver sede/equipo contra el inventario REAL (557 equipos).
  const r = await resolverEquipo(g.sede || b.sede, g.equipo);
  if (!r.ok && r.motivo === 'sede') {
    b.sede = ''; b.eqId = ''; b.equipo = '';
    return repreguntar(ses, from, 'sede', preguntarSede(r.candidatosSede));
  }
  if (!r.ok && r.motivo === 'equipo') {
    b.sede = r.sede; b.eqId = ''; b.equipo = '';
    return repreguntar(ses, from, 'equipo', preguntarEquipo(r.sede, r.candidatosEquipo));
  }
  b.sede = r.sede;
  b.eqId = r.equipo.eqId;
  b.equipo = r.equipo.nombre;
  b.tipo = r.equipo.tipo;
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

function preguntarEquipo(sede, cands) {
  const lista = cands || [];
  if (!lista.length) return `Dame el *código* del equipo de *${sinPrefijo(sede)}* (ej. MA-...).`;
  if (lista.length <= 15) {
    const items = lista.map((e) => `• ${e.nombre}${e.tipo ? ` (${e.tipo.toLowerCase()})` : ''}`).join('\n');
    return `¿Cuál equipo de *${sinPrefijo(sede)}*?\n${items}\n\n_(dime el nombre, el número o el código MA-...)_`;
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
    (b.eqId ? `🔖 Código: ${b.eqId}\n` : '') +
    `🔧 Observación: ${b.observacion}\n` +
    `📌 Estado: *${ESTADO_LABEL[b.estado] || b.estado}*\n` +
    (conFoto ? '📷 Con foto adjunta\n' : '') +
    '\nResponde *SÍ* para guardar. Si algo está mal, dime la corrección (o el estado correcto), o escribe *cancelar*.';
}

function resumenGuardado(b, conFoto) {
  return '✅ *Observación registrada.*\n\n' +
    `🏪 ${sinPrefijo(b.sede)} · ❄️ ${b.equipo}\n` +
    `📌 ${ESTADO_LABEL[b.estado] || b.estado}${conFoto ? ' · 📷' : ''}\n\n` +
    'Gracias. Mándame otra cuando quieras.';
}
