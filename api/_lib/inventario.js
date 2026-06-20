// Acceso al inventario REAL de equipos (colección `inventario`, app inventario_multiaire.html).
// 557 equipos · 12 sedes · 14 tipos. Doc id = eq_id (ej. MA-ATO-CAI-001).
// Reemplaza a `manta_equipos` (Roof Tops Ripley) como master de equipos para el bot.
import { getDb } from './firestore.js';

let _cache = null;

export async function cargarInventario() {
  if (_cache) return _cache;
  const snap = await getDb().collection('inventario').get();
  const equipos = snap.docs.map((d) => ({
    eqId: d.id,
    sede: d.data().sede || '',
    cliente: d.data().cliente || '',
    tipo: d.data().tipo || '',
    nombre: d.data().nombre || '',
    area: d.data().area || '',
  })).filter((e) => e.sede && e.nombre);
  const sedes = [...new Set(equipos.map((e) => e.sede))].sort();
  const clientes = [...new Set(equipos.map((e) => e.cliente).filter(Boolean))].sort();
  _cache = { equipos, sedes, clientes };
  return _cache;
}

export function _invalidarInventario() { _cache = null; }

// Texto compacto de sedes + tipos para dar contexto a Gemini (no los 557 nombres).
export async function contextoInventario() {
  const { sedes, equipos } = await cargarInventario();
  const tipos = [...new Set(equipos.map((e) => e.tipo).filter(Boolean))];
  return `Sedes: ${sedes.join(', ')}.\nTipos de equipo: ${tipos.join(', ')}.`;
}
