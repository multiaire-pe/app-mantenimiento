// Guía editable por el admin: qué debe cubrir una buena observación según el tipo de
// hallazgo (checklist por tema). Vive en la colección manta_guia y la edita el admin
// desde observaciones.html. El bot la inyecta en el prompt de Gemini para decidir si
// conviene repreguntar UN dato que falta.
//
// Esquema de cada doc manta_guia:
//   { tipo, titulo, palabrasClave[], checklist[], activo(bool), orden }
import { getDb } from './firestore.js';

let _cache = null;

export async function cargarGuia() {
  if (_cache) return _cache;
  const snap = await getDb().collection('manta_guia').get();
  _cache = snap.docs.map((d) => d.data())
    .filter((g) => g.activo !== false && String(g.activo ?? 'SI').toUpperCase() !== 'NO')
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return _cache;
}

// Para tests / refresco tras editar la guía: invalida la caché en memoria.
export function _invalidarGuia() { _cache = null; }

// Texto compacto para el prompt de Gemini (puede ir vacío si no hay guía configurada).
export async function textoGuia() {
  const guia = await cargarGuia();
  if (!guia.length) return '';
  return guia.map((g) => {
    const claves = (g.palabrasClave || []).join(', ');
    const items = (g.checklist || []).map((c) => `  - ${c}`).join('\n');
    return `• ${g.titulo || g.tipo}${claves ? ` (palabras clave: ${claves})` : ''}:\n${items}`;
  }).join('\n');
}
