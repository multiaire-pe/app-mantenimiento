# Guía de migración y provisión — Plataforma MultiAire

> Documento interno (NO se publica: excluido en `.vercelignore`).
> Objetivo: pasar toda la infraestructura de cuentas **personales** a la **cuenta corporativa**
> `plataforma@multiaire.com.pe`, y servir la app en **`app.multiaire.com.pe`**, sin perder datos
> ni romper las apps existentes.

## Decisiones tomadas

- **Propiedad concentrada en una sola cuenta funcional:** `plataforma@multiaire.com.pe` (sin grupo).
  El nombre es funcional (no `jose@`) a propósito → transferible a futuro sin rehacer nada, pero
  **quien la administra es José desde Perú** (las credenciales se le entregan a él).
- **Subdominio:** `app.multiaire.com.pe` (vía Vercel + DNS de Chile).
- **Login:** se siguen permitiendo cuentas **Gmail** → NO se migra la colección `usuarios` ni se
  restringe el OAuth. Solo se agrega el dominio nuevo a *Authorized domains*.
- **Notificaciones de observaciones:** aviso por **WhatsApp 1:1 a supervisores** (no a grupos; la
  API oficial de Meta no soporta grupos).

> ⚠️ **Riesgo asumido (single account):** concentrar todo en una cuenta es más simple pero es un
> único punto de fallo. Mitigación: credenciales en un **gestor de contraseñas de la empresa**,
> **2FA con método de respaldo**, y recovery email/teléfono institucional. A futuro se puede sumar
> un grupo `plataforma-admins@` como co-Owner **sin rehacer nada**.

## Estado actual → objetivo

| Recurso | Hoy (depende de una persona) | Objetivo |
|---|---|---|
| Firebase/GCP `multiaire-fee43` | Google personal | Owner = `plataforma@multiaire.com.pe` (ideal: bajo la Organización `multiaire.com.pe`) |
| Vercel (deploy) | Cuenta personal | Cuenta/Team de `plataforma@` |
| Repo GitHub `marchenaangulojoseluis-dev/app-mantenimiento` | Cuenta personal | Organización GitHub de la empresa (ej. `multiaire-pe`) |
| API key Gemini (Rendición de Caja + bot) | Personal | Emitida desde el proyecto GCP corporativo |
| Dominio / DNS `multiaire.com.pe` | Chile (ya corporativo) | Igual + `CNAME app` |
| Meta Business / WhatsApp | — | Meta Business de la empresa (número de empresa ya disponible) |

---

## 1) Lo que hay que PEDIR a Chile (mensaje listo para reenviar a Jonathan)

> Chile solo hace **dos cosas**: crear la cuenta y el registro de DNS. Todo lo demás (poner
> `plataforma@` como Owner del proyecto, transferir Vercel, conectar el dominio, etc.) lo hace
> José desde Perú, porque su cuenta personal es hoy la dueña del proyecto.

```
Hola Jonathan 👋

Como sabes, hoy toda la plataforma corre bajo mi cuenta personal de Google. Para
migrarla a una cuenta corporativa, solo necesito dos cosas de Chile:

1) CUENTA GOOGLE WORKSPACE
Crear plataforma@multiaire.com.pe y entregarme las credenciales.

2) DNS (un solo registro, una sola vez)
Para publicar la app en app.multiaire.com.pe, agregar este registro en el DNS de
multiaire.com.pe:
  • Tipo: CNAME · Nombre: app · Valor: cname.vercel-dns.com

Lo pueden hacer de la forma que les sea más cómoda:
  • Lo agregan ustedes manualmente (es un solo registro), o
  • Me dan acceso al panel de DNS para agregarlo yo (a coordinar con quien
    administra el dominio, jmt.moraga@gmail.com).
Si por privacidad prefieren manejarlo ustedes, perfecto — con que creen ese
registro basta.

(Dominio a nombre de Elizabeth Aedo · DNS en ChileCL.)

Con esas dos cosas, todo lo demás lo hago yo. ¡Gracias! 🙏
```

> Nota (opcional, no incluida en el pedido): si quisieran el proyecto Google Cloud bajo la
> **Organización** corporativa, eso sí requeriría a un admin de la Org. No es necesario para migrar.
> Y más adelante, para el bot de WhatsApp en producción, Meta podría pedir un `TXT` de verificación
> (puntual) — se solicitará en su momento.

---

## 2) Lo que hay que CREAR bajo multiaire.com.pe (para solicitar de una vez)

1. Cuenta funcional `plataforma@multiaire.com.pe` *(Chile)*.
2. Owner del proyecto Firebase/GCP `multiaire-fee43` → `plataforma@` *(lo hace **José**: su cuenta personal es el Owner actual y puede invitar a `plataforma@`)*.
3. Cuenta/Team **Vercel** con `plataforma@` *(José)*.
4. Subdominio `app.multiaire.com.pe` (CNAME en DNS) *(Chile, o acceso a José — ver §1)*.
5. **Organización GitHub** de la empresa + transferir el repo.
6. **API key Gemini** desde el proyecto GCP corporativo.
7. **Meta Business Manager** + app de WhatsApp + número de empresa registrado.
8. (Opcional) Alias/lista de correo si en el futuro se quiere notificación por email.

---

## 3) Pasos de migración (en orden recomendado)

> Cada paso es reversible y no toca los datos de Firestore. Hacer fuera de horario pico.

### Paso 1 — Firebase / Google Cloud (sin migrar datos)
1. Que exista `plataforma@multiaire.com.pe`.
2. GCP Console → **IAM & Admin → IAM** → *Grant access* → agregar `plataforma@multiaire.com.pe`
   con rol **Owner**. (Lo puede hacer el owner actual; no requiere Chile salvo que se mueva a la Org.)
3. (Ideal) Que un admin de la Organización **mueva el proyecto** a `multiaire.com.pe`.
4. Verificar que `plataforma@` es Owner **antes** de quitar la cuenta personal (un proyecto siempre
   debe tener al menos un Owner).
5. Firebase Console → **Authentication → Settings → Authorized domains** → agregar
   `app.multiaire.com.pe` (para que el login con Google funcione en el dominio nuevo).
   - Los dominios actuales (`*.vercel.app`, `localhost`, etc.) se mantienen.

### Paso 2 — Vercel + dominio
1. Crear cuenta/Team Vercel con `plataforma@` y **transferir el proyecto** (Project → Settings →
   *Transfer*), o crear el proyecto nuevo y reconectarlo al repo.
2. Project → **Settings → Domains** → *Add* `app.multiaire.com.pe`. Vercel mostrará el registro DNS
   exacto (normalmente **CNAME** `app` → `cname.vercel-dns.com`).
3. Pasar ese valor a Chile para que lo creen en el DNS. Vercel emite el **SSL** automáticamente.
4. Las URLs `*.vercel.app` siguen funcionando; el dominio nuevo se suma.
5. Actualizar los **secrets del GitHub Action** (`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`)
   a los del Team corporativo (en *Repo → Settings → Secrets*).

### Paso 3 — GitHub
1. Crear **Organización GitHub** de la empresa (ej. `multiaire-pe`).
2. **Transferir** el repo `app-mantenimiento` a la Org. Tú quedas como admin/miembro.
3. Reapuntar el remoto local: `git remote set-url origin <nueva-url>`.
4. Nota: si se usaba GitHub Pages (`marchenaangulojoseluis-dev.github.io`), esa URL cambia; revisar
   *Authorized domains* de Firebase si aplica.

### Paso 4 — Gemini API key
1. Con el proyecto GCP ya en `plataforma@`, generar una **nueva API key** de Gemini desde el proyecto
   corporativo (Google AI Studio / `Generative Language API`).
2. Reemplazar la key personal en: Rendición de Caja (`localStorage cs_gemini_key`) y en las **env vars**
   del bot (Vercel).

### Paso 5 — Meta Business + WhatsApp (cuando se construya el bot)
1. Crear **Meta Business Manager** para MultiAire (business.facebook.com).
   - ⚠️ Meta exige una **cuenta personal de Facebook** como admin inicial (no hay "cuenta funcional"
     como en Google). Usar una controlada por la empresa y agregar varios admins; los **assets** los
     posee el Business, no la persona.
2. Crear la **app** en developers.facebook.com con el producto **WhatsApp**.
3. Registrar el **número de la empresa** (no debe estar activo en el WhatsApp normal).
4. Guardar `PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `APP_SECRET` como **env vars en Vercel** (nunca en el front).
5. Para avisos proactivos a supervisores fuera de la ventana de 24h: crear una **plantilla "utility"**
   aprobada, ej. `🔧 Nueva observación · {{tienda}} · {{equipo}} · {{estado}}`.

---

## 4) Notificación a supervisores (resumen)
- El bot envía **1:1** a los supervisores marcados (un flag "recibe avisos" en `usuarios`/`maestros_personal`,
  editable desde la app → sin hardcodear).
- Requiere **plantilla aprobada** en Meta para mensajes proactivos (ver Paso 5).

## 5) Datos de referencia
- Proyecto Firebase/GCP: `multiaire-fee43`
- Cuenta funcional objetivo: `plataforma@multiaire.com.pe`
- Subdominio objetivo: `app.multiaire.com.pe` → CNAME `cname.vercel-dns.com`
- URLs Vercel actuales: prod `multiaire-peru-app.vercel.app` · develop `multiaire-peru-app-develop.vercel.app`
- Repo actual: `marchenaangulojoseluis-dev/app-mantenimiento`

### Dominio `multiaire.com.pe` (datos del WHOIS, 2026-06-18)
- **Titular / admin:** Elizabeth Aedo · contacto admin `jmt.moraga@gmail.com`
- **Registrador:** KEY-SYSTEMS GmbH · estado `clientTransferProhibited` (bloqueado contra transferencia — normal)
- **DNS hospedado en:** **ChileCL** (`dns1-4.chilecl.cl`); ahí cuelgan también la web y el correo del dominio
- **Conclusión:** el dominio es y debe seguir siendo **de la empresa** (gestionado en Chile). Para la app
  **NO** hace falta transferirlo ni pedir accesos: basta que **Chile agregue el CNAME una sola vez**.
  El registro a tocar para el DNS es `jmt.moraga@gmail.com` (o a quien deleguen en ChileCL).

## 6) Qué hace quién
- **Gestión (tú / Chile):** crear `plataforma@`, DNS, Owner de GCP, Org de GitHub, alta en Meta.
- **Código/config (Claude Code):** dominio en Vercel, *Authorized domains*, env vars del bot, el bot y
  las notificaciones. Te guío paso a paso en cada uno.

---

## 7) GUÍA CLICABLE — estado y pasos restantes (al 2026-06-19)

### ✅ Ya hecho (no tocar)
- **DNS:** `app.multiaire.com.pe` → CNAME `cname.vercel-dns.com` activo en ChileCL (serial `2026062002`).
- **Vercel:** dominio conectado al proyecto **`app-mantenimiento`** (producción/main), **SSL OK**, sirviendo en `https://app.multiaire.com.pe` (HTTP 200).
- **Firebase Authorized domains:** `app.multiaire.com.pe` ya agregado (login con Google funciona en el dominio nuevo).

> ⚠️ **Antes de empezar:** confirma que `plataforma@multiaire.com.pe` ya puede **iniciar sesión con Google** (el upgrade a Gmail quedó pendiente por el límite de verificación). Sin ese login no se puede ser Owner de Vercel/GCP. Probar en https://accounts.google.com con esa cuenta.

### Orden recomendado: A → C → B → D → E (B y C rompen el link Vercel↔GitHub; se reconecta una vez al final).

---

#### A) GCP / Firebase — `plataforma@` como **Owner**  *(5 min)*
1. Abrir IAM del proyecto: **https://console.cloud.google.com/iam-admin/iam?project=multiaire-fee43**
2. Botón **「＋ GRANT ACCESS / Conceder acceso」** → *New principals* = `plataforma@multiaire.com.pe` → *Role* = **Owner** → **Save**.
3. `plataforma@` recibe un **email de invitación a Owner** → debe **aceptarlo** (revisar https://webmail.multiaire.com.pe o el Gmail si ya está activo). El rol Owner no queda activo hasta aceptar.
4. (Espejo en Firebase, mismo efecto): **https://console.firebase.google.com/project/multiaire-fee43/settings/iam**
5. **No** quites tu cuenta personal como Owner hasta confirmar que `plataforma@` ya es Owner activo.

#### C) GitHub — Organización + transferir el repo  *(10 min)*
1. Crear org (plan Free): **https://github.com/account/organizations/new** → nombre ej. `multiaire-pe`.
2. Transferir el repo: **https://github.com/marchenaangulojoseluis-dev/app-mantenimiento/settings** → al final, *Danger Zone* → **「Transfer ownership」** → nuevo owner = la org `multiaire-pe` → confirmar escribiendo el nombre del repo.
3. Reapuntar el remoto local (te lo hago yo):
   `git remote set-url origin git@github.com:multiaire-pe/app-mantenimiento.git`
4. Reconectar la integración Git en Vercel (ver paso B.4).

#### B) Vercel — Team de `plataforma@` + transferir el proyecto  *(10 min)*
1. Inicia sesión en Vercel con `plataforma@`: **https://vercel.com/login** (botón *Continue with Google*).
2. Crear Team: **https://vercel.com/teams/create** (nombre ej. `MultiAire`, plan Hobby/Free).
3. Invitar tu cuenta personal a ese Team como **Owner** (Team → Settings → Members) — así puedes mover el proyecto. Luego, desde tu cuenta personal:
   **https://vercel.com/marchenaangulojoseluis-4484s-projects/app-mantenimiento/settings** → *Advanced* → **「Transfer Project」** → destino = Team `MultiAire`.
4. Reconectar el repo: proyecto → **Settings → Git** → conectar a `multiaire-pe/app-mantenimiento` (si C ya se hizo).
5. **Actualizar los secrets del GitHub Action** (repo → Settings → Secrets → Actions:
   **https://github.com/multiaire-pe/app-mantenimiento/settings/secrets/actions**): `VERCEL_ORG_ID` (nuevo id del Team), `VERCEL_PROJECT_ID`, `VERCEL_TOKEN` (token creado en el Team). → **Esto lo hago yo** una vez tengas el Team y un token.
6. Verifica que `app.multiaire.com.pe` y las URLs `*.vercel.app` siguen sirviendo tras el traspaso.

#### D) Gemini API key (corporativa)  *(5 min)*
1. AI Studio con `plataforma@`: **https://aistudio.google.com/apikey** → *Create API key* → en el proyecto `multiaire-fee43` → copiar.
2. Guardarla en el **gestor de contraseñas** de la empresa.
3. Ponerla en Vercel (env var del bot, Production): proyecto → **Settings → Environment Variables** → `GEMINI_API_KEY`. → **Esto lo hago yo** cuando me pases la key (o la pegas tú).
4. (Rendición de Caja usa `localStorage cs_gemini_key` por usuario; ahí cada quien pega la suya, no es env var.)

#### E) Meta Business + WhatsApp (para el bot, Fase 5)  *(30-40 min)*
1. Crear Business: **https://business.facebook.com** → *Create account*.
   - ⚠️ Meta exige un **Facebook personal** como admin inicial (no hay cuenta funcional como en Google). Los *assets* los posee el Business, no la persona; agrega varios admins.
2. Crear app con WhatsApp: **https://developers.facebook.com/apps** → *Create app* (tipo Business) → agregar producto **WhatsApp**.
3. Registrar el **número de la empresa** (no debe estar activo en WhatsApp normal).
4. Copiar `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN` (System User token permanente), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (lo inventas) → **env vars en Vercel** (te ayudo a ponerlas).
5. Webhook: Callback URL `https://app.multiaire.com.pe/api/whatsapp`, suscribir campo **messages**.
6. Plantilla "utility" aprobada para avisos a supervisores (Fase 5).

### Lo que hago yo (config dentro de las cuentas, una vez tengas acceso)
- `git remote set-url` al nuevo repo · reconectar/verificar el deploy · actualizar los **secrets** del Action · poner las **env vars** (`GEMINI_API_KEY`, `WHATSAPP_*`, `FIREBASE_SERVICE_ACCOUNT`) en Vercel · verificar dominios y login.

---

## 8) CHECKLIST META — WhatsApp Business API (para poner el bot EN VIVO)

> El código del bot (Fases 1-5 + Observaciones v2) está listo y probado (lógica + Gemini en vivo).
> Lo único que falta es el transporte por WhatsApp: esto. **Tu parte:** pasos 1-5 y 8 (consola de Meta).
> **Parte de Claude:** las env vars (paso 6) + verificar el webhook.

### ⚠️ Antes de empezar
- Meta exige un **Facebook personal** como admin (no hay cuenta funcional como Google). Usar uno controlado por la empresa.
- El **número de la empresa** para el bot **no debe estar activo en WhatsApp normal** (la API lo reclama).
- Los **técnicos** deben tener su teléfono en `maestros_personal.telefono` (el bot identifica por número).

### 1) Crear el Business
- **https://business.facebook.com** → *Crear cuenta* → nombre empresa, tu nombre, email.

### 2) Crear la App + producto WhatsApp
- **https://developers.facebook.com/apps** → *Crear app* → tipo **Business** → nombre (ej. "MultiAire Bot").
- En la app → *Agregar producto* → **WhatsApp** → *Configurar*.

### 3) Registrar el número de la empresa
- WhatsApp → **API Setup / Configuración de la API** → *Agregar número de teléfono* → verificar por SMS/llamada.

### 4) Credenciales (Claude las pone en Vercel)
| Dónde sacarlo | → env var |
|---|---|
| WhatsApp → API Setup → **Phone number ID** | `WHATSAPP_PHONE_NUMBER_ID` |
| App → Settings → Basic → **App Secret** | `WHATSAPP_APP_SECRET` |
| **Token permanente** (ver abajo) | `WHATSAPP_TOKEN` |
| Lo inventas tú (ej. `multiaire-bot-2026`) | `WHATSAPP_VERIFY_TOKEN` |

**Token permanente** (mejor que el temporal de 24 h): **business.facebook.com → Configuración del negocio → Usuarios → Usuarios del sistema** → crear uno → *Agregar activos* (la app de WhatsApp) → **Generar token** con permisos `whatsapp_business_messaging` + `whatsapp_business_management`.

### 5) Configurar el webhook
- WhatsApp → **Configuration / Configuración** → Webhook → *Editar*:
  - **Callback URL:** `https://multiaire-peru-app-develop.vercel.app/api/whatsapp` (develop, para probar; tras merge a main + cutover → `https://app.multiaire.com.pe/api/whatsapp`).
  - **Verify token:** el mismo `WHATSAPP_VERIFY_TOKEN` que inventaste.
  - Meta hace un **GET** → si el token coincide, queda verificado (el webhook ya lo soporta).
  - **Suscribirse al campo `messages`.**

### 6) Env vars en Vercel — **lo hace Claude**
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `GEMINI_API_KEY` (la key "Multiaire Bot"), `FIREBASE_SERVICE_ACCOUNT` (Claude tiene el JSON), opcional `WHATSAPP_TEMPLATE_AVISO`. Ojo a en qué entorno (Preview para develop / Production para main) y en qué proyecto Vercel (según el estado del cutover).

### 7) Probar en vivo 🎉
- Desde el WhatsApp de un técnico registrado, mandar un mensaje al número de la empresa → el bot debe responder y registrar la observación.

### 8) Plantilla de avisos (para notificar a supervisores)
- **WhatsApp Manager → Message Templates → Crear**: categoría **Utility**, nombre ej. `nueva_observacion`, cuerpo con variables `🔧 Nueva observación · {{1}} · {{2}} · {{3}}: {{4}}` (sede, equipo, estado, observación) → enviar a aprobación. Cuando la aprueben, pasar el **nombre** → Claude lo pone en `WHATSAPP_TEMPLATE_AVISO`.

### Notas
- **Sin plantilla aprobada** el bot igual responde a quien le escribe (ventana de 24 h); los **avisos proactivos a supervisores** fuera de esa ventana necesitan la plantilla.
- Para límites altos Meta pide **verificación del negocio**; para probar / poco volumen, la app sin verificar funciona con números limitados.
- Recordar marcar quién **recibe avisos** (botón 📣 en el editor de personal de `configuracion.html`).

---

## 9) PLAN DE RECUPERACIÓN DEL HOSTING (Vercel) — y cierre de la centralización

> **Decisión (2026-06-20):** el "cutover" de Vercel a la cuenta corporativa se **deprioriza**. La centralización
> de lo que importa ya está hecha (ver tabla abajo); Vercel es solo hosting **sin estado y 100% recreatable**,
> así que no justifica el riesgo de migrarlo con el bot en vivo ni la espera del TXT de ChileCL.
> Este plan permite **recrear el hosting en una cuenta corporativa en ~30-60 min** si alguna vez hace falta.

### Estado de la centralización (lo que de verdad importa YA es corporativo)
| Pieza | Contenido | Estado |
|---|---|---|
| Firebase/GCP `multiaire-fee43` | **Todos los datos** + Auth + billing Gemini | ✅ Owner = `plataforma@multiaire.com.pe` |
| GitHub `multiaire-pe/app-mantenimiento` | **El código** | ✅ Org corp + cuenta corp Owner |
| Dominio `multiaire.com.pe` | URL pública | ✅ De la empresa (ChileCL) |
| Gemini | IA del bot | ✅ Key + billing en el proyecto corp |
| Meta/WhatsApp | El bot | ✅ Assets del Business "MultiAire" (José solo admin) |
| **Vercel** | **Solo hosting/deploy — NADA de datos** | ⚠️ Cuenta personal de José — recreatable (este plan) |

### Cómo se sirve hoy (referencia)
- **Deploy:** GitHub Actions (`.github/workflows/vercel-*.yml`) → `vercel deploy` + alias a URLs fijas. NO hay auto-deploy de la integración Git (`vercel.json` tiene `git.deploymentEnabled:false`).
- **Secrets del Action** (repo → Settings → Secrets → Actions): `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
- **URLs:** prod `multiaire-peru-app.vercel.app` (rama `main`) · develop `multiaire-peru-app-develop.vercel.app` (rama `develop`) · dominio `app.multiaire.com.pe` (CNAME `cname.vercel-dns.com` en ChileCL, apunta a prod).
- **El BOT corre en `develop`** (webhook de Meta → `https://multiaire-peru-app-develop.vercel.app/api/whatsapp`).

### Receta para recrear el hosting en una cuenta Vercel nueva (corp)
1. **Crear/loguear** la cuenta Vercel destino (ideal `plataforma@multiaire.com.pe`, plan Hobby gratis).
2. **Importar el repo** `multiaire-pe/app-mantenimiento` como proyecto nuevo. Framework: **Other** (sitio estático + funciones en `/api`, sin build). Confirmar que respeta `vercel.json` y `.vercelignore`.
3. **Anotar** el `VERCEL_ORG_ID` (id del team) y `VERCEL_PROJECT_ID` del proyecto nuevo, y **crear un `VERCEL_TOKEN`** en esa cuenta.
4. **Actualizar los 3 secrets** del GitHub Action con esos valores nuevos.
5. **Re-crear las env vars del BOT** (entorno **Preview**, rama **develop**) — `vercel env add NAME preview develop --value … --yes` (correr en foreground con `| head`; el CLI del plugin exige la rama como 3er arg):
   - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL` (=`gemini-2.5-flash`), `FIREBASE_SERVICE_ACCOUNT` (base64 del serviceAccount.json).
   - **Valores:** en el **gestor de contraseñas** de la empresa / `~/Documents/migrar_db/serviceAccount.json` (Firebase) / consola de Meta (WhatsApp) / AI Studio (Gemini). NUNCA en el repo.
   - *(Si se mueve también producción a este proyecto, replicar las que apliquen en entorno Production.)*
6. **Dominio `app.multiaire.com.pe`:** agregarlo al proyecto nuevo (Settings → Domains). El CNAME ya apunta a `cname.vercel-dns.com`. Si Vercel pide verificación TXT anti-hijack (porque el dominio está reclamado por otra cuenta): pedir a ChileCL un **TXT `_vercel` = `vc-domain-verify=app.multiaire.com.pe,<token que muestre Vercel>` en la zona DNS ACTIVA del cPanel** (NO en WHMCS). Alternativa sin TXT si controlas ambas cuentas: **quitar el dominio de la cuenta vieja primero** y luego agregarlo a la nueva (hay unos minutos de downtime).
7. **Aliases fijos:** reapuntar `multiaire-peru-app.vercel.app` y `multiaire-peru-app-develop.vercel.app` al proyecto nuevo (o ajustar el paso de alias del Action). El bot usa el alias de develop, así que su webhook sigue igual.
8. **Firebase Authorized domains:** confirmar que estén `app.multiaire.com.pe` + las `*.vercel.app` (Authentication → Settings → Authorized domains). Script de apoyo: `migrar_db/add_authorized_domain.js`.
9. **Verificar:** `git push origin develop` → deploy OK; el sitio carga; `GET …/api/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=ok` devuelve el challenge (200); mandar un WhatsApp al número del bot y que responda.

### Conclusión
Con esto, **la dependencia de la cuenta personal de Vercel deja de ser un riesgo**: el hosting es reproducible desde el repo + este plan. La **centralización corporativa se da por CERRADA** en lo sustancial; el cutover de Vercel queda como tarea **opcional** para un momento tranquilo.
