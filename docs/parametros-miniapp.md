# Toma de parámetros — Mini App de Telegram

Reemplaza las **hojas impresas de toma de parámetros** de TOTTUS (archivo `Formatos de parametros TOTTUS.xlsx`).
El técnico las llena en el celular, dentro de Telegram, y cada registro queda guardado en la colección
`mtto_parametros` con **la misma estructura de columnas de esas hojas**, para exportarlo después a ese Excel
sin transformar nada. Sin hojas, sin letra ilegible y sin enviar papeles.

## Los 4 formatos

El formulario se arma solo según el **tipo del equipo** (la definición vive en `FORMATOS`, `api/_lib/parametros.js`,
y el servidor se la manda a la Mini App):

| Formato | Tipos de equipo del inventario | Campos propios (además de Voltaje L1-L2-L3, Amperaje L1-L2-L3 y Estado) |
|---|---|---|
| **Split** | Split decorativo / consola / ducto / portátil, Unidad evaporadora, Unidad condensador | Presión de baja (psi), presión de alta (psi), temperatura de salida de aire (°C) |
| **Fan coil y UMA** | Fan coil, UMA | Potencia del motor (hp/W), modelo/serie del motor, modelo/cantidad de faja, temp. entrada y salida de agua helada (°C) |
| **Ventilación mecánica** | Extractor, Inyector | Potencia del motor, modelo/serie del motor, modelo/cantidad de faja, tipo de extractor (Axial, Centrífuga, Humo, Hongo, Cajón) |
| **Cortinas de aire** | Cortina de aire | Medida de cortina, potencia del motor, modelo/serie del motor |

Los tipos sin formato (chiller, paquete, escalera, bombas, variador, VRV, TVR) no aparecen en la lista.

## Cómo lo usa el técnico

1. Abre el bot de MultiAire y toca el botón **Parámetros** (junto al campo de texto).
2. Elige la **sede** y el **equipo** (la lista sale del inventario; si la sede mezcla tipos, hay botones para filtrar por formato).
3. Revisa los datos del equipo: **marca, modelo y número de serie vienen ya completos del sistema** (solo lectura; el lápiz ✏️
   permite corregirlos y lo corregido es lo que se guarda). La **potencia del motor** se precarga con la capacidad del inventario
   (en extractores, UMA y cortinas la capacidad es la potencia: `1.5 HP`, `870 W`); en splits no aplica.
4. Completa las mediciones: voltaje y amperaje de las 3 líneas y los campos de su formato. Cada medición exige un número o **N/A**.
   Los campos de texto (placa del motor, faja, medida) son opcionales.
5. Indica el **estado**: OP (operativo), OO (operativo con observación) o FS (fuera de funcionamiento), y toca **Guardar registro**.

- **Monofásico:** solo se piden las mediciones de L1.
- **N.º de OS:** opcional, se recuerda de un registro al siguiente.
- **Sin internet:** el registro se guarda en el teléfono y se envía solo cuando vuelve la señal. Mientras tanto
  aparece "📤 N por enviar" arriba a la derecha. Para **abrir** la app y cargar los equipos sí se necesita internet.
- No hay firma: el registro queda con el nombre del técnico (el de su cuenta de Telegram vinculada) y la hora.

## Ver y exportar los registros (módulo Mantenimiento → pestaña 📋 Parámetros)

Los registros que guardan los técnicos se ven en **Mantenimiento → 📋 Parámetros**:

- Filtros: rango de fechas (por defecto, el mes en curso), sede y formato. La lista trae fecha/hora, equipo, ubicación, formato,
  técnico y estado (OP/OO/FS); **Ver** abre el detalle completo del registro. 📶 indica que se capturó sin señal y se envió después.
- **👁 Ver formato / PDF:** arma los registros seleccionados en el **formato de la hoja impresa** (A4 horizontal, 10 equipos por hoja)
  y se imprime o se guarda como PDF desde el navegador.
- **⬇ Excel:** descarga un `.xlsx` con el mismo diseño de `Formatos de parametros TOTTUS.xlsx` (una hoja por sede + formato + fecha,
  de a 10 equipos; A4 horizontal ajustado a una página). Requiere el permiso `exportar` de Mantenimiento.
- Cabecera de cada hoja: cliente, sede, fecha, periodo (bimestre), técnico(s) y N.º de OS salen de los registros; las filas que sobran
  quedan en blanco para completar a mano. Las observaciones salen numeradas por equipo.

## Para que los técnicos puedan guardar

1. **Vincular a cada técnico con su Telegram:** en el bot, el técnico comparte **su propio contacto** (botón *Compartir mi número*);
   el número debe estar en su ficha de Personal. Sin eso la Mini App responde "tu cuenta no está vinculada".
2. **Botón del bot:** en @BotFather → Menu Button, la URL de producción de abajo (o `/parametros` para ver una vista previa).
3. Las reglas de `mtto_parametros` ya están publicadas (lectura autorizada, escritura solo del servidor).

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

## Vista previa sin BotFather (comando oculto)

Para ver la Mini App sin tocar BotFather, el bot tiene el comando **`/parametros`** (no aparece en ninguna lista de
comandos y solo funciona para colaboradores autorizados). Al escribirlo:

- Pone el botón **Parámetros** en el menú **de ese chat** (Telegram permite un botón de menú por chat desde el propio
  bot con `setChatMenuButton`; no afecta a nadie más).
- Manda un mensaje con un botón que abre la Mini App.
- Se abre en **modo vista previa** (`?demo=1`): se recorre y se valida todo igual, pero **no se guarda ni se envía nada**.

`/parametros quitar` devuelve el botón normal de ese chat.

Quién puede usarlo: por defecto `PER942454` (Adrián). Para sumar más colaboradores, la variable de entorno
`PARAMETROS_IDS` (ej. `PER009,PER781233`); la URL se puede cambiar con `PARAMETROS_URL`. Cuando se configure el botón
global en BotFather, este comando deja de ser necesario.

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
