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
import { resolverTiendaEquipo } from './manta.js';
import { textoGuia } from './guia.js';
import { getSesion, guardarSesion, limpiarSesion, nuevaSesion } from './sesiones.js';

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
  guardar,                              // (borrador, tecnico) => {id,...}  (Fase 5: foto + avisos)
  analizar = estructurarObservacion,    // (texto, imgB64, mime, guiaTexto) => {tienda,equipo,observacion,estado,faltaDetalle,pregunta}
}) {
  const t = (texto || '').trim();
  let ses = await getSesion(from);

  // Saludo / ayuda sin conversación en curso.
  if (!ses && RE_AYUDA.test(t)) return bienvenida(tecnico);

  // Cancelar / reiniciar (solo si hay conversación viva).
  if (ses && RE_CANCELA.test(t)) {
    await limpiarSesion(from);
    return '👍 Listo, descarté esa observación. Cuando quieras, mándame otra.';
  }
  if (ses && RE_NUEVA.test(t)) {
    await limpiarSesion(from);
    return '🔄 Empecemos de nuevo. Cuéntame la observación (tienda, equipo y el hallazgo).';
  }

  // "Guardar así": saltar la repregunta de detalle y pasar a confirmar lo que haya.
  if (ses && ses.fase === 'RECOLECTANDO' && ses.faltante === 'detalle' && RE_GUARDA_ASI.test(t)) {
    ses.fase = 'CONFIRMANDO';
    ses.faltante = null;
    await guardarSesion(from, ses);
    return resumenConfirmar(ses.borrador);
  }

  // En confirmación: "SÍ" guarda; cualquier otra cosa se trata como corrección.
  if (ses && ses.fase === 'CONFIRMANDO') {
    if (RE_CONFIRMA.test(t)) {
      try {
        await guardar(ses.borrador, tecnico);
      } catch (e) {
        console.error('[conversacion] error al guardar:', e?.message);
        return '⚠️ No pude guardar la observación ahora mismo. Inténtalo de nuevo en un momento (responde *SÍ*).';
      }
      const b = ses.borrador;
      await limpiarSesion(from);
      return resumenGuardado(b);
    }
    if (t) ses.historial.push(t);             // corrección → reextraer con el texto nuevo
    return procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
  }

  // Nuevo mensaje o sesión en RECOLECTANDO.
  if (!ses) ses = nuevaSesion(from, tecnico);
  if (t) ses.historial.push(t);
  if (!ses.historial.length && !imagenB64) {
    await guardarSesion(from, ses);
    return 'Cuéntame la observación: en qué *tienda* y *equipo*, y qué encontraste. 🛠️';
  }
  return procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar });
}

// ── Núcleo: reextrae el acumulado, resuelve tienda/equipo y decide el siguiente paso ──
async function procesarBorrador(ses, tecnico, from, { imagenB64, mime, analizar }) {
  const textoAcum = ses.historial.join('. ');
  let g;
  try {
    const guiaTexto = await textoGuia();
    g = await analizar(textoAcum, imagenB64, mime, guiaTexto);
  } catch (e) {
    console.error('[conversacion] análisis falló:', e?.message);
    await guardarSesion(from, ses);           // conserva el historial para reintentar
    return '🤔 No pude procesar eso ahora mismo. ¿Puedes repetir la observación?';
  }

  const b = ses.borrador;
  b.observacion = g.observacion || b.observacion || '';
  b.estado = g.estado || b.estado || 'PENDIENTE';

  // Resolver tienda/equipo contra el maestro manta_equipos.
  const r = await resolverTiendaEquipo(g.tienda || b.tienda, g.equipo || b.equipo);
  if (!r.ok && r.motivo === 'tienda') {
    b.tienda = ''; b.equipo = '';
    return repreguntar(ses, from, 'tienda', preguntarTienda(r.candidatosTienda));
  }
  if (!r.ok && r.motivo === 'equipo') {
    b.tienda = r.tienda; b.equipo = '';
    return repreguntar(ses, from, 'equipo', preguntarEquipo(r.tienda, r.candidatosEquipo));
  }
  b.tienda = r.tienda;
  b.equipo = r.equipo;

  // ¿Gemini sugiere una repregunta útil y aún no la hicimos?
  if (g.faltaDetalle && g.pregunta && !ses.preguntoDetalle && ses.intentos < MAX_REPREGUNTAS) {
    ses.preguntoDetalle = true;
    return repreguntar(ses, from, 'detalle', `${g.pregunta}\n\n_(o responde *guardar así* si no aplica)_`);
  }

  // Borrador completo → confirmar.
  ses.fase = 'CONFIRMANDO';
  ses.faltante = null;
  await guardarSesion(from, ses);
  return resumenConfirmar(b);
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
  return `👋 Hola${nombre ? ' ' + nombre : ''}. Soy el asistente de la *Manta de Observaciones*.\n\n` +
    'Mándame por aquí los hallazgos de los equipos (Roof Top) y yo los registro. ' +
    'Por ejemplo:\n_"Santa Anita roof top 3, filtros saturados"_\n\n' +
    'Te confirmo antes de guardar. Puedes escribir *cancelar* en cualquier momento.';
}

function preguntarTienda(cands) {
  const lista = (cands || []).slice(0, 8).map((c) => `• ${sinPrefijo(c)}`).join('\n');
  return `¿En qué *tienda* es?${lista ? '\n' + lista : ''}`;
}

function preguntarEquipo(tienda, cands) {
  const lista = (cands || []).slice(0, 14).map((c) => `• ${c}`).join('\n');
  return `¿Qué *equipo* de *${sinPrefijo(tienda)}*?${lista ? '\n' + lista : ''}\n\n_(puedes decir solo el número)_`;
}

function resumenConfirmar(b) {
  return '📝 *Confirma la observación:*\n\n' +
    `🏪 Tienda: *${sinPrefijo(b.tienda)}*\n` +
    `❄️ Equipo: *${b.equipo}*\n` +
    `🔧 Observación: ${b.observacion}\n` +
    `📌 Estado: *${ESTADO_LABEL[b.estado] || b.estado}*\n\n` +
    'Responde *SÍ* para guardar. Si algo está mal, dime la corrección (o el estado correcto), o escribe *cancelar*.';
}

function resumenGuardado(b) {
  return '✅ *Observación registrada.*\n\n' +
    `🏪 ${sinPrefijo(b.tienda)} · ❄️ ${b.equipo}\n` +
    `📌 ${ESTADO_LABEL[b.estado] || b.estado}\n\n` +
    'Gracias. Mándame otra cuando quieras.';
}
