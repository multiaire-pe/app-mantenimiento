// Escribe una observación confirmada en manta_observaciones (origen WHATSAPP).
// Mismo esquema que produce observaciones.html (Parte A), para que la app la muestre igual.
// Fase 5: si llega una foto, se guarda en manta_observaciones_fotos (mismo formato dataURL
// que la app) y se marca tieneFoto. El aviso a supervisores lo dispara el handler tras guardar.
import { getDb } from './firestore.js';

export async function guardarObservacion(borrador, tecnico, foto = null) {
  const db = getDb();
  const now = new Date().toISOString();
  const fecha = now.slice(0, 10); // YYYY-MM-DD
  const autor = `wa:${tecnico?.id || 'desconocido'}`;
  const tieneFoto = !!(foto && foto.base64);
  const doc = {
    tienda: borrador.tienda,
    equipo: borrador.equipo,
    observacion: borrador.observacion,
    estado: borrador.estado || 'PENDIENTE',
    fecha,
    tieneFoto,
    tecnicoId: tecnico?.id || null,
    origen: 'WHATSAPP',
    registradoPor: tecnico?.nombre || 'WhatsApp',
    createdAt: now,
    createdBy: autor,
    updatedAt: now,
    updatedBy: autor,
  };
  const ref = await db.collection('manta_observaciones').add(doc);
  if (tieneFoto) {
    const dataUrl = `data:${foto.mime || 'image/jpeg'};base64,${foto.base64}`;
    await db.collection('manta_observaciones_fotos').doc(ref.id).set({
      foto: dataUrl, observacionId: ref.id, updatedAt: now, updatedBy: autor,
    });
  }
  return { id: ref.id, ...doc };
}
