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
