// Cron de recordatorios de asistencia — a la hora fija configurada en Personal → 🔔 Alertas
// del bot (colección config_recordatorios/default), manda un WhatsApp de recordatorio de
// ENTRADA/SALIDA a quien tenga avisos.recordatorio=true en maestros_personal.
//
// Incondicional a propósito: NO lee asistencia_registros ni regimenAsistencia (decisión
// explícita del usuario) — el bot de marcaje sigue intacto, sin ninguna dependencia nueva.
//
// Disparado por un workflow de GitHub Actions (schedule) contra este endpoint, protegido
// por CRON_SECRET (header x-cron-secret). No usamos Vercel Cron Jobs: el plan Hobby no
// permite un horario editable sin redeploy y solo corre sobre deployments de Producción —
// acá la hora la fija el usuario desde la app, sin tocar código.
import crypto from 'node:crypto';
import { getDb } from './_lib/firestore.js';
import { hoyLima, horaHHMMLima, decimalAHHMM } from './_lib/fecha.js';
import { notificarPorTipo } from './_lib/avisos.js';

function secretoValido(header) {
  const esperado = process.env.CRON_SECRET || '';
  if (!esperado || !header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Hora EXACTA (sin redondear) del momento en Lima, en decimal — a propósito distinta de
// `ahoraDecimalLima()` de fecha.js, que redondea a la media hora (convención de asistencia,
// no sirve acá: "¿ya pasó la hora del recordatorio?" necesita precisión de minuto).
function ahoraExactaLima() {
  const [h, m] = horaHHMMLima().split(':').map(Number);
  return h + m / 60;
}

const TEXTO = {
  entrada: '⏰ *Recordatorio* — no olvides marcar tu *entrada* de hoy.',
  salida: '⏰ *Recordatorio* — no olvides marcar tu *salida* de hoy.',
};

export default async function handler(req, res) {
  if (!secretoValido(req.headers['x-cron-secret'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getDb();
  const ref = db.collection('config_recordatorios').doc('default');
  const snap = await ref.get();
  const cfg = snap.exists ? snap.data() : {};
  const hoy = hoyLima();
  const ahora = ahoraExactaLima();
  const ultimoEnvio = { ...(cfg.ultimoEnvio || {}) };
  const resultados = {};

  for (const tipo of ['entrada', 'salida']) {
    const hora = cfg[tipo === 'entrada' ? 'horaEntrada' : 'horaSalida'];
    if (hora == null || !Number.isFinite(Number(hora))) continue; // sin hora configurada
    if (ultimoEnvio[tipo] === hoy) continue;                      // ya se mandó hoy
    if (ahora < Number(hora)) continue;                           // aún no llega la hora

    const n = await notificarPorTipo('recordatorio', TEXTO[tipo], '', {
      params: [tipo === 'entrada' ? 'Entrada' : 'Salida'],
    });
    ultimoEnvio[tipo] = hoy;
    resultados[tipo] = n;
    console.log(`[cron_recordatorios] ${tipo} · ${n} enviado(s) · hora config ${decimalAHHMM(hora)} · ahora ${decimalAHHMM(ahora)}`);
  }

  if (Object.keys(resultados).length) {
    await ref.set({ ultimoEnvio }, { merge: true });
  }
  return res.status(200).json({ ok: true, hoy, ahora: decimalAHHMM(ahora), resultados });
}
