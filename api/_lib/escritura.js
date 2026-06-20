// Escribe una observación confirmada en manta_observaciones (origen WHATSAPP).
// Mismo esquema que produce observaciones.html (Parte A), para que la app la muestre igual.
// La foto desde WhatsApp y el aviso a supervisores se agregan en la Fase 5.
import { getDb } from './firestore.js';

export async function guardarObservacion(borrador, tecnico) {
  const db = getDb();
  const now = new Date().toISOString();
  const fecha = now.slice(0, 10); // YYYY-MM-DD
  const autor = `wa:${tecnico?.id || 'desconocido'}`;
  const doc = {
    tienda: borrador.tienda,
    equipo: borrador.equipo,
    observacion: borrador.observacion,
    estado: borrador.estado || 'PENDIENTE',
    fecha,
    tieneFoto: false,                         // Fase 5: foto adjunta desde WhatsApp
    tecnicoId: tecnico?.id || null,
    origen: 'WHATSAPP',
    registradoPor: tecnico?.nombre || 'WhatsApp',
    createdAt: now,
    createdBy: autor,
    updatedAt: now,
    updatedBy: autor,
  };
  const ref = await db.collection('manta_observaciones').add(doc);
  return { id: ref.id, ...doc };
}
