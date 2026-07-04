// Router del número único de WhatsApp: decide si un mensaje va al bot de ASISTENCIA
// (marcaje geolocalizado) o al de OBSERVACIONES (comportamiento histórico).
//
// Prioridad (una conversación EN CURSO manda sobre la clasificación por tipo/texto, para no
// interrumpir un flujo a medias):
//   1) sesión de asistencia viva → seguir en asistencia.
//   2) sesión de observaciones viva → seguir en observaciones (una ubicación suelta NO la corta).
//   3) mensaje de ubicación → asistencia (observaciones no usa ubicación).
//   4) intención de marcaje por texto → asistencia.
//   5) por defecto → observaciones.
import { getSesion as getSesionAsist } from './asistencia_sesiones.js';
import { getSesion as getSesionObs, limpiarSesion as limpiarSesionObs } from './sesiones.js';
import { getSesion as getSesionMtto } from './mtto_sesiones.js';
import { RE_ASISTENCIA } from './asistencia.js';
import { esIntencionMtto, esActividadConocida, esSaludo } from './mtto.js';

// Flujos: 'asistencia' | 'mtto' | 'observaciones' | 'menu' (saludo en frío) |
// 'hint-obs' / 'hint-asistencia' (elección 2/3 del menú: instrucción sin sesión).
export async function decidirFlujo({ from, tipo, texto }) {
  if (await getSesionAsist(from)) return 'asistencia';
  const sesMtto = await getSesionMtto(from);
  if (sesMtto) {
    // En FOTOS el registro YA está guardado: un marcaje urgente (texto o ubicación)
    // no debe quedar atrapado en el pedido de fotos (hallazgo del Council).
    if (sesMtto.fase === 'FOTOS' && ((texto && RE_ASISTENCIA.test(texto)) || tipo === 'location')) return 'asistencia';
    return 'mtto';
  }
  const sesObs = await getSesionObs(from);
  if (sesObs) {
    // Escapes: una sesión de observaciones a medias no debe tragarse un saludo (menú)
    // ni una intención clara de registrar actividades (hallazgo de la prueba en vivo).
    if (texto && esSaludo(texto)) { await limpiarSesionObs(from); return 'menu'; }
    if (texto && (esIntencionMtto(texto) || await esActividadConocida(texto))) { await limpiarSesionObs(from); return 'mtto'; }
    return 'observaciones';
  }
  if (tipo === 'location') return 'asistencia';
  const t = (texto || '').trim();
  if (t === '1') return 'mtto';            // elección del menú (sin sesión viva)
  if (t === '2') return 'hint-obs';
  if (t === '3') return 'hint-asistencia';
  if (texto && esSaludo(texto)) return 'menu';
  if (texto && RE_ASISTENCIA.test(texto)) return 'asistencia';
  if (texto && esIntencionMtto(texto)) return 'mtto';
  if (texto && await esActividadConocida(texto)) return 'mtto';
  return 'observaciones';
}
