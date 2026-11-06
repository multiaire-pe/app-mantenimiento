// Confirmación ÚNICA de las fotos de mantenimiento en Telegram. El técnico manda varias fotos seguidas (un álbum,
// o 10 + 1 si eligió 11: Telegram parte los álbumes en 10) y cada foto llega como un mensaje separado. Antes cada
// una contestaba por su lado ("Foto 1 guardada", "1 foto cargada"…) con un conteo que podía no coincidir.
// Ahora la primera foto de la ráfaga manda UN mensaje "✅ N fotos cargadas…" y las siguientes lo EDITAN con el total
// que llevan (nunca baja). Funciona igual si Telegram entrega las fotos en paralelo o una por una, y no obliga a
// esperar nada: el mensaje se corrige solo a medida que llegan.
import { getDb } from './firestore.js';

export const VENTANA_LOTE_MS = 30 * 1000;   // fotos separadas por más de esto son otra ráfaga (mensaje nuevo)

// Lógica pura: dado el estado previo de la ráfaga, qué hacer con esta foto.
export function decidirLote(prev, { clave, n, ahora }, ventana = VENTANA_LOTE_MS) {
  if (!prev || prev.clave !== clave || ahora - (prev.ts || 0) > ventana) {
    return { accion: 'enviar', total: n, nuevo: { clave, ts: ahora, n, msgId: null } };
  }
  const total = Math.max(Number(prev.n) || 0, n);
  return { accion: 'editar', total, msgId: prev.msgId || null, nuevo: { ...prev, ts: ahora, n: total } };
}

// Almacén real: un doc por chat en `wa_mensajes` (la colección transitoria de marcas del bot), con transacción
// para que dos fotos simultáneas no manden dos mensajes.
export function almacenFirestore() {
  const ref = (from) => getDb().collection('wa_mensajes').doc(`lote_${from}`);
  return {
    async reclamar(from, datos) {
      return getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref(from));
        const r = decidirLote(snap.exists ? snap.data() : null, datos);
        tx.set(ref(from), { ...r.nuevo, type: 'lote_fotos_mtto', from });
        return r;
      });
    },
    async leer(from) { const s = await ref(from).get(); return s.exists ? s.data() : null; },
    async fijarMsg(from, msgId) { await ref(from).set({ msgId }, { merge: true }); },
  };
}

// `enviar(texto)` → id del mensaje enviado (o null). `editar(id, texto)`. `texto(n)` arma el mensaje con el total.
export async function confirmarFotos({ from, clave, n, texto, enviar, editar, almacen = almacenFirestore(), esperar = (ms) => new Promise((r) => setTimeout(r, ms)), ahora = Date.now() }) {
  const r = await almacen.reclamar(from, { clave, n, ahora });
  if (r.accion === 'enviar') {
    const id = await enviar(texto(r.total));
    if (id) await almacen.fijarMsg(from, id);
    return 'enviado';
  }
  let id = r.msgId;
  // otra foto está mandando el mensaje justo ahora: se espera a que quede registrado su id
  for (let i = 0; !id && i < 8; i++) { await esperar(400); id = (await almacen.leer(from))?.msgId || null; }
  if (!id) { await enviar(texto(r.total)); return 'enviado'; }   // no apareció: mejor un mensaje de más que ninguno
  await editar(id, texto(r.total));
  const ya = await almacen.leer(from);
  if (ya && ya.n > r.total) await editar(id, texto(ya.n));        // otra foto subió el total mientras editábamos
  return 'editado';
}
