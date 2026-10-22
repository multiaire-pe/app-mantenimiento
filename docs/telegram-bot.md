# Bot de Telegram — puesta en marcha

El bot de Telegram es **otro canal para el mismo bot**: reutiliza sin cambios los flujos de
observaciones, mantenimiento y asistencia (`conversacion.js`, `mtto.js`, `asistencia.js`).
Solo cambia el adaptador de entrada/salida:

| Pieza | Archivo |
|---|---|
| Webhook (valida secret, idempotencia por `update_id`, vinculación, despacho) | `api/telegram.js` |
| Cliente de la Bot API (enviar, botones, descargar fotos, WhatsApp→HTML) | `api/_lib/telegram.js` |
| Identidad por `chat_id` + vinculación | `api/_lib/identidad.js` (`identificarPorTelegram`, `vincularTelegram`) |
| Pruebas (sin red ni Firestore) | `tests/telegram.test.mjs` |

`from` (la llave de las sesiones `wa_*`) es `tg<chat_id>`, así que no choca con un número de
WhatsApp y los dos canales pueden convivir mientras dura la transición.

## 1. Crear el bot (una vez)

1. En Telegram, hablar con `@BotFather` → `/newbot` → elegir nombre y usuario (termina en `bot`).
2. Guardar el **token** que entrega. Es un secreto: no va al repo, ni a un PR, ni a un chat.
   Si se filtra, se regenera con `/revoke` en BotFather.
3. Opcional: `/setdescription`, `/setuserpic`, `/setcommands` (`start - Abrir el menú`, `menu - Abrir el menú`).

## 2. Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Valor | Entornos |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | el token de BotFather | Preview (develop) y Production |
| `TELEGRAM_WEBHOOK_SECRET` | cadena aleatoria larga (`openssl rand -hex 32`) | Preview y Production |

Una variable nueva solo la toma un deployment nuevo: hacer redeploy después de crearla
(`gh workflow run vercel-develop.yml`).

## 3. Registrar el webhook

No necesita acceso a Vercel, solo el token y la URL pública:

```bash
curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://multiaire-peru-app-develop.vercel.app/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

Para producción usar `https://multiaire-peru-app.vercel.app/api/telegram` (la URL de Vercel, no el
dominio propio: el DNS de `multiaire.com.pe` ya se cayó antes). Verificar con
`.../getWebhookInfo` (`last_error_message` debe estar vacío).

## 4. Vincular a cada técnico (una vez por persona)

1. El técnico abre el bot y toca **Iniciar**.
2. El bot le muestra el botón **📱 Compartir mi número**. Al tocarlo, Telegram envía su contacto.
3. El bot compara ese número con `maestros_personal` (mismo `matchTecnico` que WhatsApp:
   E.164 exacto, luego últimos 9 dígitos) y guarda `telegramChatId` en su documento.
4. Desde ahí queda identificado. Se le deja un botón fijo **📍 Compartir ubicación** para el marcaje.

Seguridad: solo se acepta el contacto **propio** (`contact.user_id` debe ser el del remitente);
Telegram deja reenviar la tarjeta de otra persona y sin esa comprobación cualquiera podría
vincularse al número de un compañero.

## 5. Mensajes que el bot envía por iniciativa propia

Quien tenga `telegramChatId` recibe por Telegram; el resto sigue por WhatsApp. Telegram tiene
prioridad si la persona tiene ambos (es gratis).

- `api/_lib/avisos.js` — avisos a supervisores y a los designados en 🔔 Alertas del bot
  (observaciones, asistencia, mtto, recordatorios). Un solo intento por Telegram, sin plantilla ni
  texto de respaldo; un fallo ambiguo se cuenta aparte (no se reintenta, igual que en WhatsApp).
- `api/cron_recordatorios.js` — usa `notificarPorTipo`, así que hereda el cambio sin tocarse.
- `api/enviar_itinerario.js` — a cada técnico vinculado le llega por Telegram (canal `telegram` en el
  historial). El modo prueba sigue siendo un número de WhatsApp a propósito.

El técnico tiene que haber iniciado el bot al menos una vez; si lo bloquea, Telegram responde 403
y queda como `error` (definitivo, no ambiguo).

## 6. Pendiente

- Mostrar en `personal.html` quién ya está vinculado (hoy se ve en Firestore: `telegramChatId`).
- Probar en vivo (falta el token) y recién después apagar WhatsApp.
- Los textos de los avisos dicen "vía WhatsApp"; se cambian al apagar ese canal.
