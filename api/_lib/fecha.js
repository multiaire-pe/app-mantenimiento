// Fecha y hora en horario de Lima (UTC-5, sin horario de verano) para el bot, que corre en UTC.
// La app de asistencia usa la fecha/hora local del navegador (Lima); el bot debe coincidir.

const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000; // Lima = UTC-5 fijo

function ahoraLima(base = Date.now()) {
  return new Date(base - OFFSET_LIMA_MS); // desplaza a "hora de pared" de Lima leída como UTC
}

// 'YYYY-MM-DD' del día en Lima.
export function hoyLima(base = Date.now()) {
  return ahoraLima(base).toISOString().slice(0, 10);
}

// Hora decimal del momento en Lima, redondeada a la media hora (convención de asistencia
// del proyecto: 8.5 = 08:30). Ej. 08:14 → 8.0, 08:16 → 8.5. Se capa a 23.5 para que un marcaje
// cerca de medianoche (23:46) no redondee a 24 (hora inválida que rompería vistas/HE).
export function ahoraDecimalLima(base = Date.now()) {
  const d = ahoraLima(base);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return Math.min(23.5, Math.round(h * 2) / 2);
}

// Hora "HH:MM" exacta en Lima (para mostrar el momento real del marcaje).
export function horaHHMMLima(base = Date.now()) {
  const d = ahoraLima(base);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Decimal (8.5) → "08:30".
export function decimalAHHMM(dec) {
  if (dec == null || !Number.isFinite(Number(dec))) return '—';
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
