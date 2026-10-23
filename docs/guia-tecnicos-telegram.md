# Guía rápida para técnicos — Bot de MultiAire en Telegram

El bot hace lo mismo que hacía en WhatsApp: **registrar mantenimiento**, **reportar observaciones** y
**marcar asistencia**. Ahora vive en Telegram (gratis).

**Enlace del bot:** https://t.me/multiaire_pe_bot  (o busca **@multiaire_pe_bot** en Telegram)

## 1. Primera vez: vincular tu cuenta (1 minuto, una sola vez)

1. Instala Telegram y abre el enlace del bot.
2. Toca **Iniciar**.
3. Toca el botón **📱 Compartir mi número**.
4. Debe responder *"Listo, TU NOMBRE. Ya estás vinculado"* y mostrarte el menú.

⚠️ Tiene que ser **el mismo número** que la oficina tiene registrado para ti. Si dice *"No encuentro ese
número"*, avisa a la oficina para que revisen tu teléfono en Personal.
Si Telegram te pregunta por permisos de ubicación o notificaciones, **acéptalos**.

## 2. El menú

Toca **Menú** (el botón junto al campo de texto) o escribe `/menu` cuando quieras volver al inicio; corta lo que estabas haciendo. Tiene 3 botones:
**Mantenimiento · Observación · Asistencia**. También puedes escribirle directo, como antes.

## 3. Reportar una observación 📝

Escribe sede, equipo y el problema. Puedes mandar una **foto** (con o sin texto).

> *"fuga de gas en el rooftop 6 de megaplaza"*
> *"el extractor del comedor hace ruido, los Olivos"*

- Si falta algo, el bot **te pregunta** (la sede, qué equipo, o un detalle). Responde con una frase corta.
- Al final te muestra un resumen: toca **✅ Sí, guardar**, **✏️ Corregir** o **❌ Cancelar**.
- Luego te pregunta **en qué estado quedó el equipo** (de operativo a inoperativo). Elige una opción o
  toca *omitir*.
- ¿Olvidaste la foto? Mándala justo después y el bot la pega a tu última observación.

## 4. Registrar mantenimiento 🔧

Escribe, por ejemplo: *"mantenimiento preventivo del chiller 1 de atocongo"*.

1. El bot encuentra el equipo y te muestra sus **actividades**.
2. Responde con los números que hiciste (*"1, 3"*) o **todas**.
3. Toca **✅ Sí, guardar**. Se guarda enseguida.
4. Después te pide **fotos** de cada actividad. Manda las que quieras y toca **➡️ Siguiente** para pasar a
   la siguiente actividad o **🏁 Fin** para terminar. Si no mandas fotos, el registro igual queda guardado.

## 5. Marcar asistencia 🕐

1. Escribe **entrada** o **salida**.
2. Toca el botón **📍 Compartir ubicación** (te queda fijo abajo) y confirma.
3. Si te lo pide, manda tu **selfie**.

El bot ubica la sede **por donde estás**, no por lo que diga tu itinerario. Si no logra saber en qué
tienda estás, te pregunta cuál (responde con el número de la lista).

## 6. Consejos para que el bot te entienda mejor

- Nombra el equipo por **dónde está**: *"extractor del comedor"*, *"cortina del ingreso de clientes"*.
- Escribe la **sede bien escrita**. Ante la duda, usa el **código del equipo + la sede**:
  *"MA-ATO-CHI-001 de atocongo"*.
- Para **salir** de lo que estés haciendo: `/cancelar` (lo que no alcanzaste a guardar se pierde; lo ya guardado se queda). Para empezar de nuevo: `/menu`.
- Solo existen esos dos comandos: **/menu** y **/cancelar**.
- Un mensaje por vez; espera la respuesta del bot antes de mandar el siguiente.

## 7. Si algo falla

| Qué pasa | Qué hacer |
|---|---|
| El bot no contesta | Espera 1 minuto y escribe **menú**. Si sigue igual, avisa a la oficina. |
| "No encuentro ese número" | Tu teléfono no está en Personal, o abriste Telegram con otro número. Avisa a la oficina. |
| No me llegan recordatorios o avisos | Aún no vinculaste tu cuenta (paso 1) o silenciaste/bloqueaste el bot. |
| Se me cortó a medias | Escribe `/cancelar`, luego `/menu` y vuelve a empezar; lo ya guardado no se pierde. |
| La foto no subió | Reenvíala; si pesa mucho, mándala como foto (no como archivo). |
