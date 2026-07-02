// Acceso al maestro de sedes (maestros_tiendas) para el bot de asistencia.
// Aporta las coordenadas (latitud/longitud/radio) que alimentan el geofencing.
// Caché con TTL corto para no releer en cada mensaje (igual patrón que inventario.js).
import { getDb } from './firestore.js';
import { coordValida } from './geo.js';

const COL = 'maestros_tiendas';
const TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheAt = 0;

// Normaliza un doc de tienda a la forma que usa el bot.
function normalizar(id, d) {
  const lat = d.latitud != null ? Number(d.latitud) : (d.lat != null ? Number(d.lat) : null);
  const lng = d.longitud != null ? Number(d.longitud) : (d.lng != null ? Number(d.lng) : null);
  return {
    id: d.id || id,
    tienda: d.tienda || '',
    sede: d.sede || '',
    cliente: d.cliente || '',
    activo: String(d.activo || 'SI').toUpperCase() !== 'NO',
    latitud: lat,
    longitud: lng,
    radio: d.radio != null ? Number(d.radio) : null,
    tieneGeo: coordValida(lat, lng),
  };
}

// Carga todas las tiendas (cacheadas). `force` salta la caché.
export async function cargarTiendas(force = false) {
  if (!force && _cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const snap = await getDb().collection(COL).get();
  _cache = snap.docs.map((doc) => normalizar(doc.id, doc.data()));
  _cacheAt = Date.now();
  return _cache;
}

// Tienda por id (o null).
export async function tiendaPorId(id) {
  if (!id) return null;
  const ts = await cargarTiendas();
  return ts.find((t) => t.id === id) || null;
}

// Todas las tiendas activas con coordenadas cargadas (candidatas para geovalidar).
export async function tiendasConGeo() {
  const ts = await cargarTiendas();
  return ts.filter((t) => t.activo && t.tieneGeo);
}

// Utilidad de test: inyectar/limpiar la caché sin tocar Firestore.
export function _setCache(tiendas) { _cache = tiendas; _cacheAt = Date.now(); }
export function _clearCache() { _cache = null; _cacheAt = 0; }
