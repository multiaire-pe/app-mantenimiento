# Bot de WhatsApp — Manta de Observaciones (backend serverless)

> Documento interno (no se publica). El bot vive en `/api/whatsapp.js` (Vercel Function).
> Alimenta la colección `manta_observaciones` desde WhatsApp. Las apps web siguen siendo HTML/JS estático.

## Estado: FASE 4
- **Fase 1** ✅ — verificación de Meta (GET) + validación de firma `X-Hub-Signature-256` (POST) + parseo.
- **Fase 2** ✅ — **identidad** del técnico (`maestros_personal.telefono`, últimos 9 dígitos) + **idempotencia** (`wa_mensajes`).
- **Fase 3** ✅ — **Gemini** (`gemini-2.5-flash`, `responseSchema`) estructura el mensaje/foto en `{tienda, equipo, observacion, estado}` y redacta la observación de forma profesional + infiere el estado (PENDIENTE/EN_PROCESO/OK). **Emparejamiento** (`manta.js`) resuelve tienda/equipo contra `manta_equipos` o pide aclaración. Probado en vivo.
- **Fase 4** ✅ — **motor conversacional** (`conversacion.js`): máquina de estados sobre **`wa_sesiones`** (RECOLECTANDO→CONFIRMANDO, TTL 30 min). Repregunta lo mínimo (tienda/equipo no resueltos, o **un** detalle sugerido por la guía editable **`manta_guia`** vía `guia.js`); siempre permite *guardar así*; **confirma antes de escribir** y el técnico fija/corrige el estado; comandos *cancelar* / *nueva* / *ayuda*. Al confirmar, `escritura.js` crea la observación en `manta_observaciones` (origen WHATSAPP). `manejarMensaje` recibe `analizar`/`guardar` inyectables → testeable sin Meta ni Gemini (`migrar_db/test_fase4.mjs`, contra Firestore real). `gemini.js` ahora devuelve además `faltaDetalle`/`pregunta` guiados por la guía.
- Pendiente **Fase 5**: foto desde WhatsApp (Graph API → `manta_observaciones_fotos` + `tieneFoto`) + **aviso a supervisores** (plantilla "utility" + flag) + deploy + setup Meta.
- Módulos en `api/_lib/`: `firestore.js`, `identidad.js`, `idempotencia.js`, `whatsapp.js`, `manta.js`, `gemini.js`, `sesiones.js`, `guia.js`, `conversacion.js`, `escritura.js`.

> **Guía editable (`manta_guia`)**: checklist por tipo de hallazgo que orienta la repregunta del bot. Se siembra con `migrar_db/seed_manta_guia.js` (7 temas) y se edita por script/consola (UI admin en observaciones.html pendiente).

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
| `GEMINI_API_KEY` | API key de Gemini (AI Studio con la cuenta corporativa) | 3+ |
| `GEMINI_MODEL` | (opcional) modelo a usar; por defecto `gemini-2.5-flash` | 3+ |
| `FIREBASE_SERVICE_ACCOUNT` | JSON del service account de `multiaire-fee43` (como string o base64) | 2+ |

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
