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
import { getSesion as getSesionObs } from './sesiones.js';
import { RE_ASISTENCIA } from './asistencia.js';

export async function decidirFlujo({ from, tipo, texto }) {
  if (await getSesionAsist(from)) return 'asistencia';
  if (await getSesionObs(from)) return 'observaciones';
  if (tipo === 'location') return 'asistencia';
  if (texto && RE_ASISTENCIA.test(texto)) return 'asistencia';
  return 'observaciones';
}
