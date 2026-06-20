# Estado de la sesión — MultiAire (handoff)

> Documento interno (excluido del deploy en `.vercelignore`). Resumen de TODO lo que está en curso
> para poder retomar después de un reseteo de contexto. Fecha base: **2026-06-19**.
> Trabajo en `~/Documents/GitHub/app-mantenimiento`, rama **develop**. Sin merge a main sin autorización.

## Hilos en curso (visión rápida)
1. **Observaciones (Parte A)** — ✅ LISTO en develop (pendiente verificación del usuario + merge a main).
2. **Bot WhatsApp (Parte B)** — 🔧 Fases 1-3 listas; faltan Fase 4 (conversacional) y Fase 5 (escritura + avisos).
3. **Migración corporativa** — 🔧 cuenta creada; **DNS de `app.multiaire.com.pe` pendiente en ChileCL** (bloqueante del dominio).
4. **Monitoreo DNS** — wakeup activo cada ~30 min.

---

## 1) Observaciones — `observaciones.html` (Parte A) ✅
- "Manta de Observaciones" de mantenimiento Ripley, sobre el scaffold de `proveedores.html`.
- Commits: `12b8d13` (módulo), `3d9516b` (backup), `d05eb2b` (docs). **En develop, sin merge a main.**
- Colecciones: `manta_observaciones` (log, 1 doc = 1 obs), `manta_observaciones_fotos` (base64), `manta_equipos`
  (maestro: **56 equipos en 8 tiendas Ripley**, sembrado del Excel con `migrar_db/seed_manta_equipos.js`).
- Estados: PENDIENTE/EN_PROCESO/OK. Roles: `isObsAdmin()` (ADMIN/SUPER_ADMIN editan; SUPERVISOR solo lectura).
- Card en index.html, en `ALL_APPS` de proveedores/comprobantes, backup en configuracion.html.
- **Pendiente:** que el usuario lo verifique en develop y, si aprueba, merge a main.

## 2) Bot WhatsApp — backend Vercel `/api/whatsapp.js` (Parte B) 🔧
Backend serverless en el MISMO repo (no Firebase, sin Blaze). Módulos en `api/_lib/`.
- **Fase 1** ✅ (`4872b49`) — webhook GET (verificación Meta) + POST (firma X-Hub-Signature-256, body crudo, timingSafeEqual).
- **Fase 2** ✅ (`d4b6850`) — identidad por `maestros_personal.telefono` (últimos 9 dígitos) + idempotencia `wa_mensajes` (`doc.create()` atómico). Número desconocido → responde pidiendo registro. `api/_lib/`: firestore, identidad, idempotencia, whatsapp.
- **Fase 3** ✅ (`46bbc53`, `d7a9719`) — `gemini.js` (`estructurarObservacion`, gemini-2.5-flash + responseSchema → `{tienda,equipo,observacion,estado}`, redacta profesional, infiere estado) + `manta.js` (`resolverTiendaEquipo` empareja contra `manta_equipos` o pide aclarar). **Probado en vivo.**
- **Fase 4 (PENDIENTE)** — motor **conversacional**: si falta info, repregunta inteligente (máx 1-2); guía editable **`manta_guia`** (checklist por tipo de hallazgo, editable por admin); siempre opción "guardar así"; **confirmar antes de guardar**; el técnico fija el estado; estado de conversación en **`wa_sesiones`** (con TTL).
- **Fase 5 (PENDIENTE)** — escribir en `manta_observaciones` (origen WHATSAPP) + foto en `manta_observaciones_fotos` + responder confirmación por WhatsApp + **avisar a supervisores** (mensaje 1:1; requiere plantilla "utility" aprobada en Meta; flag "recibe avisos" en usuarios/maestros_personal).
- **Después:** deploy + setup Meta (Business Manager + número) + prueba en vivo. Guía: `api/README.md`.
- **Env vars en Vercel** (NO en el front): `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_MODEL` (opcional, def gemini-2.5-flash).
- **GEMINI_API_KEY:** ya obtenida en AI Studio con la cuenta corporativa (formato nuevo `AQ.Ab8...`, validada, funciona con gemini-2.5-flash). **Guárdala en el gestor de contraseñas + Vercel.** (No se escribe aquí por seguridad; está en el chat de la sesión / rotar si se quiere.)
- **Decisiones del bot:** conversacional con feedback; confirmar antes de escribir; técnico fija estado; canal = número dedicado 1:1 (la API oficial NO funciona en grupos); "expertise" vía `manta_guia` + RAG sobre histórico (NO fine-tuning); modelo por niveles (flash-lite barato + flash/pro para razonar).
- **Pruebas sin Meta:** cada fase se prueba con tests unitarios contra Firestore real / Gemini en vivo (no hace falta el número de Meta hasta la prueba end-to-end final). `node_modules` y `package-lock.json` en `.gitignore`.

## 3) Migración corporativa 🔧 (ver `GUIA_MIGRACION.md`)
- Objetivo: mover la infra de cuentas personales a **`plataforma@multiaire.com.pe`** (cuenta funcional única, sin grupo). Subdominio **`app.multiaire.com.pe`** → **producción/main** en Vercel.
- **Cuenta Google `plataforma@multiaire.com.pe`:** creada como **cuenta de Google con email existente** (NO Workspace — el dominio NO usa Workspace; el correo es un buzón cPanel de ChileCL). Webmail: **https://webmail.multiaire.com.pe**. El upgrade a Gmail quedó **pendiente** (el teléfono pegó el límite de verificaciones de Google; se hace luego con otro número). La cuenta YA sirve para AI Studio/GCP/Vercel.
- **DNS (BLOQUEANTE):** falta que ChileCL/HostingMásFácil agregue el registro en el **cPanel** (zona activa: `dns1-4.chilecl.cl`):
  `Tipo: CNAME · Nombre: app · Valor: cname.vercel-dns.com`. **Pedido por WhatsApp** (+56 9 7643 2796), escalado a "infraestructura", **aún no aplicado** (serial de la zona seguía en `2026051801`). La chica de Chile lo había puesto antes en el panel de **dominios (WHMCS)** equivocado (no activo).
- **Cuando el DNS resuelva:** conectar `app.multiaire.com.pe` en Vercel (CLI logueado como **marchenaangulojoseluis-4484**; va a **producción/main**) + agregarlo a **Authorized domains** de Firebase Auth.
- **Logins Gmail se MANTIENEN** (no se migra `usuarios`). **Avisos** de observaciones por WhatsApp 1:1 a supervisores.
- Datos del dominio (WHOIS): titular Elizabeth Aedo · admin jmt.moraga@gmail.com · registrador KEY-SYSTEMS · DNS en ChileCL (HostingMásFácil, masfacil.cl).

## 4) Monitoreo DNS
- Wakeup recurrente (~30 min) revisa el CNAME en los nameservers de ChileCL. Cuando aparezca: avisar al usuario + conectar el dominio en Vercel (producción/main).

---

## Próximos pasos (orden sugerido)
1. **Bot Fase 4** (motor conversacional + `manta_guia` + `wa_sesiones`).
2. **Bot Fase 5** (escritura en `manta_observaciones` + avisos a supervisores).
3. **Deploy + setup Meta** (Business + número) + prueba end-to-end del bot.
4. **DNS** (cuando ChileCL responda) → conectar `app.multiaire.com.pe` en Vercel + Authorized domains.
5. **Verificar Observaciones** en develop + **merge a main** (cuando el usuario apruebe).
