# Bot de WhatsApp — Manta de Observaciones (backend serverless)

> Documento interno (no se publica). El bot vive en `/api/whatsapp.js` (Vercel Function).
> Alimenta la colección `manta_observaciones` desde WhatsApp. Las apps web siguen siendo HTML/JS estático.

## Estado: FASE 1
Webhook con **verificación de Meta (GET)** + **validación de firma `X-Hub-Signature-256` (POST)** + parseo.
El procesamiento real (identidad del técnico, Gemini, conversación, escritura) llega en las fases 2-5.

## Endpoint
```
GET/POST  https://<dominio>/api/whatsapp
```
- En develop: `https://multiaire-peru-app-develop.vercel.app/api/whatsapp`
- En producción (cuando el dominio esté): `https://app.multiaire.com.pe/api/whatsapp`

## Variables de entorno (en Vercel → Project → Settings → Environment Variables)
> NUNCA en el front. Se configuran en Vercel, no en el repo.

| Variable | Para qué | Fase |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | String que tú inventas; Meta lo usa en el GET de verificación | 1 |
| `WHATSAPP_APP_SECRET` | App Secret de la app de Meta; valida la firma de los POST | 1 |
| `WHATSAPP_TOKEN` | Token para **enviar** mensajes (System User token, permanente) | 2+ |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número emisor | 2+ |
| `GEMINI_API_KEY` | API key de Gemini (mismo patrón que comprobantes.html) | 3+ |
| `FIREBASE_SERVICE_ACCOUNT` | JSON del service account de `multiaire-fee43` (como string o base64) | 5+ |

## Configurar el webhook en Meta (resumen — pasos detallados en fases posteriores)
1. **developers.facebook.com** → crear app tipo *Business* → agregar producto **WhatsApp**.
2. Anotar `PHONE_NUMBER_ID`, generar `WHATSAPP_TOKEN`, copiar el **App Secret** (Configuración → Básica).
3. En WhatsApp → *Configuración* → **Webhook**:
   - **Callback URL:** `https://.../api/whatsapp`
   - **Verify token:** el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`
   - Suscribirse al campo **messages**.
4. Meta hará un **GET** a la URL; si el token coincide, el webhook queda verificado (✅ esta Fase 1 ya lo soporta).

## Cómo probar la Fase 1
- **Verificación:** abrir en el navegador
  `https://.../api/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=hola123`
  → debe responder `hola123` (si el token coincide); con token incorrecto → `Forbidden`.
- **Firma:** un POST sin la cabecera `X-Hub-Signature-256` correcta → responde `401 Firma inválida`.
- Los mensajes reales se ven en los **logs de la función** en Vercel (Fase 1 solo loguea).

## Notas técnicas
- Se usa el **body crudo** (no parseado) para calcular el HMAC → `export const config = { api: { bodyParser: false } }`.
- Comparación de firma en **tiempo constante** (`crypto.timingSafeEqual`).
- El bot es la **única pieza server-side**; no toca el funcionamiento de las apps estáticas.
