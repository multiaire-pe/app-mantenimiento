// Helpers para hablar con la WhatsApp Cloud API (Graph API).
// Requiere WHATSAPP_TOKEN (token de envío) y WHATSAPP_PHONE_NUMBER_ID (número emisor).
const GRAPH = 'https://graph.facebook.com/v21.0';

const token   = () => process.env.WHATSAPP_TOKEN || '';
const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';

// Envía un mensaje de texto 1:1. Devuelve true si se envió.
export async function enviarTexto(to, body) {
  if (!token() || !phoneId()) {
    console.warn('[whatsapp] faltan WHATSAPP_TOKEN/PHONE_NUMBER_ID — no se envió el mensaje');
    return false;
  }
  try {
    const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } }),
    });
    if (!res.ok) {
      console.error('[whatsapp] error al enviar:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[whatsapp] excepción al enviar:', e.message);
    return false;
  }
}

// Envía un mensaje de PLANTILLA (template) aprobada — para avisos proactivos fuera de la
// ventana de 24h (ej. avisar a supervisores). `componentes` = array de components de la Graph API.
export async function enviarPlantilla(to, nombre, idioma, componentes) {
  if (!token() || !phoneId()) {
    console.warn('[whatsapp] faltan WHATSAPP_TOKEN/PHONE_NUMBER_ID — no se envió la plantilla');
    return false;
  }
  try {
    const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: nombre, language: { code: idioma || 'es' }, components: componentes || [] },
      }),
    });
    if (!res.ok) {
      console.error('[whatsapp] error al enviar plantilla:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[whatsapp] excepción al enviar plantilla:', e.message);
    return false;
  }
}
