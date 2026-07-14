// Geofencing puro (sin Firestore ni red): distancia entre coordenadas y validación de radio.
// Base del bot de asistencia geolocalizada. Todo aquí es testeable en aislamiento.

const R_TIERRA_M = 6371000; // radio medio de la Tierra en metros
const RADIO_DEFAULT_M = 250; // radio de marcaje por defecto si la sede no lo define

const rad = (g) => (g * Math.PI) / 180;

// ¿Es una coordenada usable? (número finito en rango válido, no 0,0 accidental)
export function coordValida(lat, lng) {
  const a = Number(lat), o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return false;
  if (a < -90 || a > 90 || o < -180 || o > 180) return false;
  if (a === 0 && o === 0) return false; // (0,0) = dato faltante, no el golfo de Guinea
  return true;
}

// Distancia haversine en METROS entre dos puntos {lat,lng}. Redondeada al metro.
export function distanciaM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R_TIERRA_M * c);
}

// Radio efectivo de una sede (metros), con default y saneo.
export function radioDe(sede) {
  const r = Number(sede && sede.radio);
  return Number.isFinite(r) && r > 0 ? r : RADIO_DEFAULT_M;
}

// Evalúa un punto {lat,lng} contra una sede con coords. Devuelve:
//   { valida:bool, distancia:m|null, radio:m, dentro:bool }
// `valida` es false si la sede no tiene coords cargadas (no se puede geovalidar).
export function evaluarSede(punto, sede) {
  const radio = radioDe(sede);
  if (!sede || !coordValida(sede.latitud, sede.longitud) || !coordValida(punto && punto.lat, punto && punto.lng)) {
    return { valida: false, distancia: null, radio, dentro: false };
  }
  const distancia = distanciaM(punto.lat, punto.lng, Number(sede.latitud), Number(sede.longitud));
  return { valida: true, distancia, radio, dentro: distancia <= radio };
}

// De una lista de sedes con coords, elige la MÁS CERCANA al punto.
// Devuelve { sede, distancia, radio, dentro } o null si ninguna tiene coords válidas.
export function sedeMasCercana(punto, sedes) {
  let mejor = null;
  for (const sede of sedes || []) {
    const ev = evaluarSede(punto, sede);
    if (!ev.valida) continue;
    if (!mejor || ev.distancia < mejor.distancia) mejor = { sede, ...ev };
  }
  return mejor;
}

// La sede que CONTIENE al punto (está dentro de su radio); si varias lo contienen, la más cercana.
// Distinto de `sedeMasCercana`: esta nunca devuelve una sede que no contenga al punto.
// No basta con filtrar el resultado de `sedeMasCercana` por `dentro` — cada sede tiene su propio
// radio, así que la más cercana puede quedar fuera del suyo mientras otra más lejana sí lo contiene.
export function sedeQueContiene(punto, sedes) {
  let mejor = null;
  for (const sede of sedes || []) {
    const ev = evaluarSede(punto, sede);
    if (!ev.valida || !ev.dentro) continue;
    if (!mejor || ev.distancia < mejor.distancia) mejor = { sede, ...ev };
  }
  return mejor;
}

// Formatea metros para el mensaje al técnico ("120 m", "1.3 km").
export function fmtDistancia(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const _consts = { R_TIERRA_M, RADIO_DEFAULT_M };
