// Descarga un archivo multimedia (foto) de WhatsApp Cloud API.
// Flujo Graph API: GET /{media-id} → devuelve una URL temporal; luego se descarga el binario
// con el mismo token. Devuelve { base64, mime, bytes } o null si no se pudo.
const GRAPH = 'https://graph.facebook.com/v21.0';
const token = () => process.env.WHATSAPP_TOKEN || '';

export async function descargarMedia(mediaId) {
  if (!mediaId) return null;
  if (!token()) { console.warn('[media] falta WHATSAPP_TOKEN — no se descarga la imagen'); return null; }
  try {
    // 1) metadatos: URL temporal + mime
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!metaRes.ok) { console.error('[media] meta', metaRes.status, await metaRes.text().catch(() => '')); return null; }
    const meta = await metaRes.json();
    const url = meta?.url;
    const mime = meta?.mime_type || 'image/jpeg';
    if (!url) return null;
    // 2) binario (requiere el mismo token de autorización)
    const binRes = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!binRes.ok) { console.error('[media] bin', binRes.status); return null; }
    const buf = Buffer.from(await binRes.arrayBuffer());
    return { base64: buf.toString('base64'), mime, bytes: buf.length };
  } catch (e) {
    console.error('[media] excepción al descargar:', e.message);
    return null;
  }
}
