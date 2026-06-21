// Aviso por WhatsApp 1:1 a los supervisores cuando se registra una observación.
// Destinatarios = maestros_personal con `recibeAvisos` (true/"SI") + teléfono válido.
// En producción requiere una plantilla "utility" aprobada en Meta (env WHATSAPP_TEMPLATE_AVISO),
// porque el supervisor suele estar fuera de la ventana de 24h. Sin plantilla → texto libre
// (sirve dentro de la ventana de 24h y para pruebas).
import { getDb } from './firestore.js';
import { enviarTexto, enviarPlantilla } from './whatsapp.js';

const ESTADO_LABEL = { PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', OK: 'Resuelto (OK)' };
const sinRipley = (t) => String(t || '').replace(/^RIPLEY\s+/i, '');

// Lista de destinatarios: maestros_personal activos, con recibeAvisos y teléfono usable.
export async function destinatariosAviso() {
  const snap = await getDb().collection('maestros_personal').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.recibeAvisos === true || String(p.recibeAvisos || '').toUpperCase() === 'SI')
    .filter((p) => String(p.activo === undefined ? 'SI' : p.activo).toUpperCase() !== 'NO')
    .filter((p) => String(p.telefono || '').replace(/\D/g, '').length >= 9);
}

function textoAviso(obs, tecnico) {
  return '🔧 *Nueva observación* (vía WhatsApp)\n' +
    `🏪 ${sinRipley(obs.tienda)} · ❄️ ${obs.equipo}\n` +
    (obs.area ? `📍 Ubicación: ${obs.area}\n` : '') +
    `📌 ${ESTADO_LABEL[obs.estado] || obs.estado}\n` +
    `📝 ${obs.observacion}\n` +
    `👤 Reportó: ${tecnico?.nombre || '—'}`;
}

// Notifica a los supervisores. `opts.destinos` y `opts.enviar` se inyectan en pruebas.
// Devuelve cuántos avisos se enviaron.
export async function notificarSupervisores({ obs, tecnico }, opts = {}) {
  const destinos = opts.destinos || await destinatariosAviso();
  if (!destinos.length) console.log('[avisos] 0 supervisores con recibeAvisos — nadie será notificado · obs', obs.id || '');
  const plantilla = process.env.WHATSAPP_TEMPLATE_AVISO || '';
  const idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || 'es';
  const _enviarPlantilla = opts.enviarPlantilla || enviarPlantilla;  // inyectables en pruebas
  const _enviarTexto = opts.enviarTexto || enviarTexto;
  let n = 0;
  for (const p of destinos) {
    if (tecnico && p.id === tecnico.id) continue;             // no avisar a quien reportó
    const to = String(p.telefono).replace(/\D/g, '');
    let ok;
    if (opts.enviar) {
      ok = await opts.enviar(p, obs, tecnico);                // pruebas
    } else if (plantilla) {
      // Orden de la plantilla `nueva_observacion`: {{1}}sede {{2}}equipo {{3}}ubicación {{4}}estado {{5}}detalle.
      // Meta rechaza parámetros vacíos o con saltos de línea → placeholder "—" y se colapsa el whitespace.
      ok = await _enviarPlantilla(to, plantilla, idioma, [{
        type: 'body',
        parameters: [sinRipley(obs.tienda), obs.equipo, obs.area, ESTADO_LABEL[obs.estado] || obs.estado, obs.observacion]
          .map((x) => ({ type: 'text', text: (String(x || '').replace(/\s+/g, ' ').trim() || '—').slice(0, 600) })),
      }]);
      // Si la plantilla falla (typo en el nombre, pausada, error transitorio), caer a texto libre:
      // le llega igual al supervisor que esté dentro de su ventana de 24h.
      if (!ok) {
        console.warn('[avisos] plantilla falló, intento texto libre ·', to);
        ok = await _enviarTexto(to, textoAviso(obs, tecnico));
      }
    } else {
      ok = await _enviarTexto(to, textoAviso(obs, tecnico));  // sin plantilla → texto (ventana 24h / pruebas)
    }
    if (ok) n++;
  }
  if (n) console.log(`[avisos] ${n} supervisor(es) notificado(s) · obs ${obs.id || ''}`);
  return n;
}
