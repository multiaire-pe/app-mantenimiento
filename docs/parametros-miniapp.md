# Toma de parámetros — Mini App de Telegram

Reemplaza el **formato impreso de toma de parámetros** de ventilación mecánica (extractores e inyectores).
El técnico lo llena en el celular, dentro de Telegram, y el registro queda guardado en la colección
`mtto_parametros`. Sin hojas, sin letra ilegible y sin enviar papeles.

## Cómo lo usa el técnico

1. Abre el bot de MultiAire y toca el botón **Parámetros** (junto al campo de texto).
2. Elige la **sede** y el **equipo** (la lista sale del inventario).
3. Completa el formulario. Marca, modelo, serie y potencia vienen del inventario, pero se pueden corregir.
   Cada medición exige un número o marcar **N/A**.
4. Toca **Guardar registro**.

- **Monofásico:** solo se piden las mediciones de L1.
- **Sin internet:** el registro se guarda en el teléfono y se envía solo cuando vuelve la señal. Mientras tanto
  aparece "📤 N por enviar" arriba a la derecha. Para **abrir** la app y cargar los equipos sí se necesita internet.
- No hay firma: el registro queda con el nombre del técnico (el de su cuenta de Telegram vinculada) y la hora.

## Configurar el botón en el bot (una sola vez)

En **@BotFather**:

1. `/mybots` → elegir `@multiaire_pe_bot`
2. **Bot Settings** → **Menu Button** → **Configure menu button**
3. URL: `https://multiaire-peru-app.vercel.app/parametros.html`
4. Texto del botón: `Parámetros`

Mientras se prueba en develop se puede usar `https://multiaire-peru-app-develop.vercel.app/parametros.html`
(comparte el mismo Firestore y el mismo token del bot). El botón es de **todo el bot**: cambiar la URL
cambia lo que ven todos los técnicos.

No requiere variables nuevas: usa `TELEGRAM_BOT_TOKEN` y `FIREBASE_SERVICE_ACCOUNT`, que ya existen.

## Qué se guarda (`mtto_parametros`)

Un documento por registro; el id lo genera la Mini App (`PAR-<fecha>-<azar>`) y se crea con `create()`, así que
reenviar el mismo registro no lo duplica.

| Campo | Contenido |
|---|---|
| `eqId` / `tag`, `cliente`, `sede`, `area`, `tipo`, `nombreEq` | Del inventario (el servidor los toma de ahí, no del cuerpo) |
| `equipo` | `marca`, `modelo`, `serie`, `potencia` tal como los confirmó el técnico |
| `electrico` | `fases` (`1PH`/`3PH`), `voltajeNominal`, `amperajeNominal`, `frecuencia`, `vL1L2`, `vL2L3`, `vL1L3`, `aL1`, `aL2`, `aL3` (número o `"NA"`; L2/L3 = `null` en monofásico), `estadoTablero`, `estadoContactores` |
| `sistema` | `transmision`, `filtros`, `fajas`, `fajasMedida`, `poleas` |
| `observaciones`, `supervisor` | Texto libre |
| `tecnicoId`, `tecnicoNombre` | De la sesión de Telegram |
| `fecha`, `hora` | Hora de Lima de la captura |
| `capturadoEn`, `recibidoEn`, `diferido` | Hora del teléfono, hora del servidor y si llegó más de 2 min después |
| `origen` | `MINIAPP` |

Las mediciones **no se juzgan**: no hay rangos ni comparación con el nominal. Lo que mide el técnico es lo que queda.

## Seguridad

- La Mini App manda `Authorization: tma <initData>`. El endpoint valida la firma con el token del bot (HMAC-SHA256,
  comparación en tiempo constante) y rechaza una sesión de más de 24 horas. De ahí sale quién es el técnico: no hay login aparte.
- Un técnico solo puede registrar a su nombre; la cuenta de Telegram debe estar vinculada a un colaborador activo.
- Firestore no permite escribir `mtto_parametros` desde el navegador (`write: false`); solo escribe el backend.

## Archivos

- `parametros.html` — la pantalla (Mini App).
- `api/parametros.js` — endpoint (`inicio`, `equipos`, `guardar`).
- `api/_lib/parametros.js` — lógica pura: firma de Telegram y validación del registro.
- `tests/parametros.test.mjs` — pruebas (`node tests/parametros.test.mjs`).

## Pendiente

- Ver y exportar los registros (hoy solo quedan guardados y en el backup de Configuración).
- Los formatos de splits, UMA, chiller y cortinas.
