# Para José — poner en marcha el bot de Telegram y apagar el de WhatsApp

> **Cómo usar este archivo:** ábrelo en tu Claude Code (dentro del repo `app-mantenimiento`) y dile:
> *"Lee `docs/telegram-setup-jose.md` y ejecuta los pasos, pidiéndome confirmación antes de cada
> cambio en Vercel, GitHub o Google Cloud. No imprimas ni pegues ningún token en el chat."*
> Todo lo que toca tus cuentas (Vercel, Meta, Google Cloud) lo haces tú; este archivo está escrito
> para que tu Claude te guíe y ejecute los comandos.

## Contexto (1 minuto)

- Adrián construyó el bot de **Telegram** como otro canal del mismo bot (PR #230, rama `feature/bot-telegram`).
  Reutiliza los flujos de observaciones, mantenimiento y asistencia; no cuesta nada (no hay plantillas ni
  ventana de 24 h).
- El bot de **WhatsApp** está enviando mensajes —sobre todo plantillas fuera de la ventana de 24 h— y
  **Meta se los cobra a José**. Ese gasto **no está autorizado**. Hay que cortarlo ya y dejar Telegram
  como canal.
- Dos PRs preparados (ninguno mergeado):
  - **#231 → develop / #232 → main**: interruptor `WHATSAPP_BOT_ACTIVO`. El canal queda **apagado por defecto**
    (solo envía si vale exactamente `true`) y el webhook ignora los mensajes entrantes.
  - **#230 → develop**: bot de Telegram (adaptador de entrada + avisos salientes).

## Parte A — Cortar el gasto de WhatsApp (hacer HOY, son 5 minutos)

Lo más urgente no necesita código: se puede cortar desde fuera mientras se revisan los PRs.

1. **Pausar el disparador de recordatorios** (es lo que dispara plantillas de pago cada día):
   ```bash
   gcloud scheduler jobs pause recordatorios-asistencia --location us-central1 --project multiaire-fee43
   gcloud scheduler jobs describe recordatorios-asistencia --location us-central1 --project multiaire-fee43 | grep state   # → PAUSED
   ```
   El respaldo en GitHub Actions (`.github/workflows/cron-recordatorios.yml`, cada 30 min) también
   dispara el mismo endpoint: desactívalo con
   `gh workflow disable cron-recordatorios.yml --repo multiaire-pe/app-mantenimiento`.
   Hay una alerta por email que avisa si el disparador falla; con el job pausado no se dispara.

2. **Cortar el envío en Vercel** (proyecto `app-mantenimiento`): quita o renombra `WHATSAPP_TOKEN` en
   **Production y Preview**. Sin token, `enviarDetalle` devuelve `sin_credenciales` y no llama a Meta.
   ```bash
   vercel env rm WHATSAPP_TOKEN production
   vercel env rm WHATSAPP_TOKEN preview
   ```
   Un valor nuevo de variable solo lo toma un deployment nuevo: redeploy después
   (`gh workflow run vercel-production.yml` y `vercel-develop.yml`). **Antes de borrarlo, guarda su
   valor** si algún día quieres reactivar WhatsApp (el token es *sensitive*: no se puede volver a
   leer desde Vercel).

3. **Corte definitivo en Meta** (opcional, es tu decisión): en Meta Business → WhatsApp Manager,
   quita el método de pago de la cuenta o pausa el número. Es la única forma de garantizar que no
   se cobre nada aunque algo vuelva a enviar.

4. **Revisar cuánto se gastó**: Meta Business → Facturación → conversaciones de WhatsApp. Las
   plantillas que envía el sistema son `nueva_observacion`, `marcaje_asistencia`, `registro_mtto`,
   `itinerario_tecnico` y `recordatorio_asistencia`.

5. **Mergear el interruptor en código** (después de pasar el Council como siempre):
   - PR **#231** (a `develop`) y PR **#232** (a `main`).
   - Tras el merge a `main`, WhatsApp queda apagado **por defecto**, sin depender de tocar variables.
   - Para reactivarlo algún día: `WHATSAPP_BOT_ACTIVO=true` en Vercel + redeploy.
   - Verificar: `curl -s -o /dev/null -w "%{http_code}" -X POST https://multiaire-peru-app.vercel.app/api/whatsapp`
     debe responder `200` (con el canal apagado acusa recibo sin procesar).

> Mientras WhatsApp esté apagado, los técnicos que dependan de él **no reciben nada y sus mensajes se
> ignoran**. Conviene avisarles por otro medio y llevarlos a Telegram (Parte B).

## Parte B — Poner Telegram en marcha

### B1. Crear el bot (lo haces tú en la app de Telegram)
1. Habla con **@BotFather** → `/newbot` → nombre (p. ej. "MultiAire Perú") y usuario terminado en `bot`.
2. Guarda el **token** que te entrega. Es un secreto: no lo pegues en el chat, en un PR ni en el repo.
   Si se filtra: `/revoke` en BotFather.
3. Opcional: `/setcommands` → `start - Abrir el menú` y `menu - Abrir el menú`; `/setuserpic` con el logo.

### B2. Variables en Vercel (proyecto `app-mantenimiento`, Production **y** Preview)
```bash
SECRET=$(openssl rand -hex 32)                       # guárdalo en tu gestor de contraseñas
printf '%s' "$TOKEN"  | vercel env add TELEGRAM_BOT_TOKEN production
printf '%s' "$TOKEN"  | vercel env add TELEGRAM_BOT_TOKEN preview
printf '%s' "$SECRET" | vercel env add TELEGRAM_WEBHOOK_SECRET production
printf '%s' "$SECRET" | vercel env add TELEGRAM_WEBHOOK_SECRET preview
```
(`$TOKEN` léelo de un archivo o de una variable de tu terminal; que no pase por el chat.)
Luego redeploy: `gh workflow run vercel-develop.yml` (y `vercel-production.yml` cuando toque).

### B3. Mergear el bot de Telegram
- PR **#230** (rama `feature/bot-telegram`) a `develop`, tras el Council. Se prueba en
  `https://multiaire-peru-app-develop.vercel.app`.
- No toca `firestore.rules` y no reemplaza nada de WhatsApp (solo añade archivos y ramas "si tiene
  `telegramChatId`").

### B4. Registrar el webhook (primero en develop)
```bash
curl -sS "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://multiaire-peru-app-develop.vercel.app/api/telegram" \
  -d "secret_token=$SECRET" \
  -d 'allowed_updates=["message","callback_query"]'
curl -sS "https://api.telegram.org/bot$TOKEN/getWebhookInfo"     # last_error_message debe venir vacío
```
Un bot de Telegram tiene **un solo webhook**: apunta a develop para probar y, cuando esté probado,
vuelve a correr `setWebhook` con `https://multiaire-peru-app.vercel.app/api/telegram` (la URL de
Vercel, **no** el dominio propio: el DNS de `multiaire.com.pe` ya se cayó antes).

### B5. Probar de punta a punta (con tu propio Telegram)
1. Abre el bot → **Iniciar** → toca **📱 Compartir mi número**. Debe responder "Listo, <nombre>".
   (Tu número tiene que estar en `maestros_personal`.)
2. Verifica en Firestore que tu doc tiene `telegramChatId`.
3. Manda una observación de prueba (texto + foto) y revisa que aparezca en `observaciones.html`.
4. Registra una actividad de mantenimiento y un marcaje de asistencia (botón **📍 Compartir ubicación**).
5. Que otra persona de prueba con alertas activadas reciba el aviso por Telegram.
   *Borra después los datos de prueba (en Firestore hay un solo entorno: develop y producción comparten datos).*

### B6. Pasar a producción y vincular al equipo
1. Merge a `main` (Council) → `setWebhook` apuntando a producción (B4).
2. Cada técnico: abre el bot, **Iniciar**, **Compartir mi número**. Es una sola vez.
3. Los recordatorios, avisos a supervisores e itinerario salen por Telegram a quien esté vinculado
   (sin costo). Quien no se haya vinculado no recibe nada mientras WhatsApp esté apagado.
4. Reanudar el recordatorio **solo cuando haya técnicos vinculados**:
   `gcloud scheduler jobs resume recordatorios-asistencia --location us-central1 --project multiaire-fee43`
   (y `gh workflow enable cron-recordatorios.yml`). Con WhatsApp apagado, un destinatario sin
   Telegram cuenta como fallo y el cron lo reportará por email: vincula primero.

## Verificación final (checklist)

- [ ] `gcloud scheduler jobs describe recordatorios-asistencia …` → `PAUSED` (o `ENABLED` solo tras B6.4)
- [ ] `WHATSAPP_TOKEN` fuera de Vercel o `WHATSAPP_BOT_ACTIVO` sin definir → WhatsApp no envía
- [ ] Meta Business: sin cargos nuevos en las conversaciones de WhatsApp
- [ ] `getWebhookInfo` de Telegram sin `last_error_message`
- [ ] Técnicos clave vinculados (campo `telegramChatId` en `maestros_personal`)
- [ ] Documentación detallada del bot: `docs/telegram-bot.md`

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Telegram responde 401 al webhook | `TELEGRAM_WEBHOOK_SECRET` distinto entre `setWebhook` y Vercel, o falta el redeploy |
| El bot no contesta | `TELEGRAM_BOT_TOKEN` ausente en el entorno que atiende esa URL; revisar `getWebhookInfo` |
| "No encuentro ese número" | El teléfono no está en `maestros_personal` (o está inactivo) |
| Un técnico no recibe avisos | No abrió el bot, o lo bloqueó (Telegram responde 403: queda como error definitivo) |
| Llegan emails de alerta del cron | Está disparando con WhatsApp apagado y destinatarios sin Telegram: pausar el job o vincular |
