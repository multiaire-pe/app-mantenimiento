// Operatividad de equipos (Etapa 1). Tras registrar una observación, el bot le pregunta al
// técnico en qué PORCENTAJE quedó operativo el equipo. Guardamos 1 evento en
// `operatividad_eventos` (historial) y el estado vivo en el doc del equipo en `inventario`.
// Escala discreta de 5 niveles. Contrato compartido con el panel: docs/operatividad-spec.md.
import { getDb } from './firestore.js';

// Escala % → nivel → emoji → etiqueta → color. MISMA tabla que usa el panel (Frente B).
// Firma compartida (docs/operatividad-spec.md): incluye `color` aunque el bot solo use emoji/etiqueta.
const NIVELES = [
  { porcentaje: 100, nivel: 'OPERATIVO',   emoji: '🟢', etiqueta: 'Operativo',                 color: '#16a34a' },
  { porcentaje: 75,  nivel: 'OBSERVADO',   emoji: '🟡', etiqueta: 'Operativo c/observaciones', color: '#eab308' },
  { porcentaje: 50,  nivel: 'PARCIAL',     emoji: '🟠', etiqueta: 'Parcial',                   color: '#f97316' },
  { porcentaje: 25,  nivel: 'CRITICO',     emoji: '🔴', etiqueta: 'Crítico',                   color: '#dc2626' },
  { porcentaje: 0,   nivel: 'INOPERATIVO', emoji: '⚫', etiqueta: 'Inoperativo',               color: '#1f2937' },
];

const VALORES = NIVELES.map((n) => n.porcentaje); // [100,75,50,25,0]

// Devuelve {porcentaje, nivel, emoji, etiqueta} del nivel de la escala más cercano a `pct`.
// (En Etapa 1 solo llegan valores exactos de la escala; el redondeo es defensa.)
export function nivelDeOperatividad(pct) {
  const n = Number(pct);
  let best = NIVELES[0];
  let bestD = Infinity;
  for (const it of NIVELES) {
    const d = Math.abs(it.porcentaje - n);
    if (d < bestD) { bestD = d; best = it; }
  }
  return { ...best };
}

// Texto del menú que el bot envía para pedir el % por WhatsApp.
export function menuOperatividad() {
  return '¿En qué estado quedó el equipo? Responde el número:\n' +
    '1️⃣ 100 % Operativo 🟢\n' +
    '2️⃣ 75 % Operativo c/observaciones 🟡\n' +
    '3️⃣ 50 % Parcial 🟠\n' +
    '4️⃣ 25 % Crítico 🔴\n' +
    '5️⃣ 0 % Inoperativo ⚫\n' +
    '_(o escribe "omitir")_';
}

// Mapea la opción del menú (1..5) al porcentaje. Ojo: '1' es la OPCIÓN 1 (=100 %), no 1 %.
const OPCION_A_PCT = { '1': 100, '2': 75, '3': 50, '4': 25, '5': 0 };
const RE_OMITIR = /^\s*(omit\w*|salt\w*|skip|luego|despu[eé]s|ahora\s+no|no\s+s[eé]|no|-{1,2})\s*$/i;

// Interpreta la respuesta del técnico → 100|75|50|25|0 (número), 'OMITIR', o null (no entendido).
export function parsearOperatividad(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  if (RE_OMITIR.test(t)) return 'OMITIR';
  // Opción del menú 1..5 (mensaje que es SOLO ese dígito).
  if (Object.prototype.hasOwnProperty.call(OPCION_A_PCT, t)) return OPCION_A_PCT[t];
  // Porcentaje explícito de la escala, con o sin "%" (ej. "75", "50 %", "100%"). Anclado: el mensaje
  // debe ser SOLO el número (no extraer un dígito de una frase) y estar EN la escala — un valor
  // fuera de escala (p.ej. "80") devuelve null → el bot repregunta en vez de redondear en silencio.
  const m = t.match(/^\s*(\d{1,3})\s*%?\s*$/);
  if (m && VALORES.includes(Number(m[1]))) return Number(m[1]);
  return null;
}

// Persiste el reporte de operatividad: 1 evento en `operatividad_eventos` (historial, append-only)
// + estado vivo en `inventario/{eqId}` (merge). Inyectable como `registrarOp` en el motor del bot.
export async function registrarOperatividad({
  eqId, sede = '', cliente = '', tipo = '', nombre = '', area = '',
  porcentaje, obsId = null, tecnicoId = null, registradoPor = 'WhatsApp', origen = 'WHATSAPP',
}) {
  if (!eqId) throw new Error('registrarOperatividad: falta eqId');
  const db = getDb();
  const now = new Date().toISOString();
  const fecha = now.slice(0, 10); // YYYY-MM-DD
  const pct = Number(porcentaje);
  const { nivel } = nivelDeOperatividad(pct);
  const evento = {
    eqId, sede, cliente, tipo, nombre, area,
    porcentaje: pct, nivel,
    origen, obsId: obsId || null,
    tecnicoId: tecnicoId || null, registradoPor,
    fecha, createdAt: now, createdBy: registradoPor,
  };
  // Evento (historial) + estado vivo del equipo en UNA escritura atómica: nunca queda un
  // evento en operatividad_eventos con el inventario desactualizado (contrato "1 evento + estado vivo").
  const batch = db.batch();
  batch.set(db.collection('operatividad_eventos').doc(), evento);
  batch.set(db.collection('inventario').doc(String(eqId)), {
    operatividad: pct,
    operatividadFecha: fecha,
    operatividadPor: registradoPor,
    operatividadObsId: obsId || null,
    operatividadOrigen: origen,
  }, { merge: true }); // merge: no toca los demás campos del inventario
  await batch.commit();
  return evento;
}
