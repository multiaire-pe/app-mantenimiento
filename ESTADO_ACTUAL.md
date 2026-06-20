# Estado de la sesión — MultiAire (handoff)

> Documento interno (excluido del deploy en `.vercelignore`). Resumen de TODO lo que está en curso
> para poder retomar después de un reseteo de contexto. Fecha base: **2026-06-19**.
> Trabajo en `~/Documents/GitHub/app-mantenimiento`, rama **develop**. Sin merge a main sin autorización.

## Hilos en curso (visión rápida)
1. **Observaciones (Parte A)** — ✅ LISTO en develop (pendiente verificación del usuario + merge a main).
2. **Bot WhatsApp (Parte B)** — 🔧 **Fases 1-4 listas** (Fase 4 ya escribe en `manta_observaciones`); falta **Fase 5** (foto desde WhatsApp + avisos a supervisores) + deploy + setup Meta.
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
- **Fase 4** ✅ — motor **conversacional** (`conversacion.js`) sobre **`wa_sesiones`** (RECOLECTANDO→CONFIRMANDO, TTL 30 min). Repregunta lo mínimo (tienda/equipo o **un** detalle sugerido por la guía editable **`manta_guia`**, máx 1-2); siempre "guardar así"; **confirma antes de guardar**; el técnico fija/corrige el estado; comandos cancelar/nueva/ayuda. Nuevos `sesiones.js`, `guia.js`, `escritura.js`; `gemini.js` añade `faltaDetalle`/`pregunta`. **Al confirmar escribe en `manta_observaciones` (origen WHATSAPP).** `manejarMensaje` con `analizar`/`guardar` inyectables. Guía sembrada (`migrar_db/seed_manta_guia.js`, 7 temas). **Probado contra Firestore real** (`migrar_db/test_fase4.mjs`, 17/17). *(Nota: la escritura se adelantó a la Fase 4 para tenerla testeable de punta a punta; la Fase 5 queda = foto + avisos.)*
- **Fase 5 (PENDIENTE)** — **foto** desde WhatsApp (descarga vía Graph API → `manta_observaciones_fotos` + `tieneFoto:true`) + **avisar a supervisores** (mensaje 1:1; requiere plantilla "utility" aprobada en Meta; flag "recibe avisos" en usuarios/maestros_personal).
- **Después:** deploy + setup Meta (Business Manager + número) + prueba en vivo. Guía: `api/README.md`.
- **Env vars en Vercel** (NO en el front): `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_MODEL` (opcional, def gemini-2.5-flash).
- **GEMINI_API_KEY:** ⚠️ **se perdió** (no quedó guardada en ningún archivo ni gestor). Hay que **regenerarla** en AI Studio (aistudio.google.com con `plataforma@multiaire.com.pe`) cuando se vaya a configurar Vercel, y esta vez guardarla en el gestor de contraseñas de la empresa. La key valida `gemini-2.5-flash`.
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
1. **Bot Fase 5** (foto desde WhatsApp + avisos a supervisores con plantilla "utility").
2. **Regenerar `GEMINI_API_KEY`** en AI Studio (aistudio.google.com con `plataforma@multiaire.com.pe`) — la anterior se perdió — y ponerla en Vercel junto al resto de env vars + **deploy + setup Meta** (Business + número) + prueba end-to-end del bot.
3. **DNS** (cuando ChileCL responda) → conectar `app.multiaire.com.pe` en Vercel + Authorized domains.
4. **Verificar Observaciones** en develop + **merge a main** (cuando el usuario apruebe).

> ✅ Hecho 2026-06-19: editor de `manta_guia` en observaciones.html (menú → 🤖 Guía del bot) + `manta_guia` en el backup de configuracion.html.
> ⚠️ `GEMINI_API_KEY`: **se perdió** — hay que regenerarla en AI Studio al configurar Vercel (no está guardada en ningún lado).
