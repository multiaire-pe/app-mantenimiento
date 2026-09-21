// Helpers para hablar con la WhatsApp Cloud API (Graph API).
// Requiere WHATSAPP_TOKEN (token de envío) y WHATSAPP_PHONE_NUMBER_ID (número emisor).
const GRAPH = 'https://graph.facebook.com/v21.0';

const token   = () => process.env.WHATSAPP_TOKEN || '';
const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';

// POR QUÉ HAY UNA VERSIÓN "DETALLE": un `false` a secas no dice si el mensaje NO se envió o
// si NO SE SABE. Meta respondiendo 4xx (token vencido, número inválido) es definitivo: no
// entregó. Pero una excepción de red o un timeout es AMBIGUO — la petición pudo haber
// llegado y el mensaje pudo haberse entregado igual. Quien decida reintentar necesita esa
// diferencia: reintentar tras un fallo definitivo es gratis, tras uno ambiguo duplica.
// Estados: 'ok' | 'rechazado' (definitivo) | 'ambiguo' | 'sin_credenciales' (ni se intentó).
async function enviarDetalle(cuerpo, etiqueta) {
  if (!token() || !phoneId()) {
    console.warn(`[whatsapp] faltan WHATSAPP_TOKEN/PHONE_NUMBER_ID — no se envió ${etiqueta}`);
    return { ok: false, estado: 'sin_credenciales' };
  }
  try {
    const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!res.ok) {
      console.error(`[whatsapp] error al enviar ${etiqueta}:`, res.status, await res.text().catch(() => ''));
      // 5xx: Meta pudo haberlo aceptado y fallado después → se trata como ambiguo.
      return { ok: false, estado: res.status >= 500 ? 'ambiguo' : 'rechazado' };
    }
    return { ok: true, estado: 'ok' };
  } catch (e) {
    console.error(`[whatsapp] excepción al enviar ${etiqueta}:`, e.message);
    return { ok: false, estado: 'ambiguo' };
  }
}

export function cuerpoTexto(to, body) {
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } };
}

export const enviarTextoDetalle = (to, body) => enviarDetalle(cuerpoTexto(to, body), 'el mensaje');

// Envía un mensaje de texto 1:1. Devuelve true si se envió.
// (Contrato histórico intacto: lo consumen los flujos de observaciones/asistencia/mtto.)
export async function enviarTexto(to, body) {
  return (await enviarTextoDetalle(to, body)).ok;
}

// Envía un mensaje de PLANTILLA (template) aprobada — para avisos proactivos fuera de la
// ventana de 24h (ej. avisar a supervisores). `componentes` = array de components de la Graph API.
export function cuerpoPlantilla(to, nombre, idioma, componentes) {
  return {
    messaging_product: 'whatsapp', to, type: 'template',
    template: { name: nombre, language: { code: idioma || 'es' }, components: componentes || [] },
  };
}

export const enviarPlantillaDetalle = (to, nombre, idioma, componentes) =>
  enviarDetalle(cuerpoPlantilla(to, nombre, idioma, componentes), 'la plantilla');

export async function enviarPlantilla(to, nombre, idioma, componentes) {
  return (await enviarPlantillaDetalle(to, nombre, idioma, componentes)).ok;
}

// Mensaje interactivo de BOTONES (hasta 3, título ≤20 caracteres — límite de WhatsApp). El
// técnico puede seguir respondiendo con texto libre igual que siempre: el botón es un atajo,
// no un reemplazo — por eso `id` es siempre el mismo texto que ya reconocen los parsers
// existentes ("1"/"si"/"cancelar"...), así ningún flujo necesita saber que vino de un botón.
export function cuerpoBotones(to, body, botones) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: (botones || []).slice(0, 3).map((b) => ({
        type: 'reply', reply: { id: String(b.id), title: String(b.title).slice(0, 20) },
      })) },
    },
  };
}
export const enviarBotonesDetalle = (to, body, botones) => enviarDetalle(cuerpoBotones(to, body, botones), 'los botones');
export async function enviarBotones(to, body, botones) {
  return (await enviarBotonesDetalle(to, body, botones)).ok;
}
