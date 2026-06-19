// Empareja lo que el técnico menciona ("roof top 3 de santa anita") con el maestro
// manta_equipos → devuelve la tienda y el equipo CANÓNICOS, o pide aclaración con candidatos.
import { getDb } from './firestore.js';

let _cache = null;

export async function cargarManta() {
  if (_cache) return _cache;
  const snap = await getDb().collection('manta_equipos').get();
  const equipos = snap.docs.map(d => d.data())
    .filter(e => String(e.activo === undefined ? 'SI' : e.activo).toUpperCase() !== 'NO');
  const tiendas = [...new Set(equipos.map(e => e.tienda).filter(Boolean))];
  _cache = { equipos, tiendas };
  return _cache;
}

const norm = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// "RIPLEY SANTA ANITA" → "SANTA ANITA" (la palabra RIPLEY no distingue entre tiendas)
const sinRipley = (s) => norm(s).replace(/\bRIPLEY\b/g, '').trim();

function matchTienda(tiendaRaw, tiendas) {
  const q = sinRipley(tiendaRaw);
  if (!q) return { ok: false, candidatos: tiendas };
  const exact = tiendas.find((t) => sinRipley(t) === q);
  if (exact) return { ok: true, tienda: exact };
  const contiene = tiendas.filter((t) => {
    const n = sinRipley(t);
    return n.includes(q) || q.includes(n);
  });
  if (contiene.length === 1) return { ok: true, tienda: contiene[0] };
  if (contiene.length > 1) return { ok: false, candidatos: contiene };
  return { ok: false, candidatos: tiendas };
}

function matchEquipo(equipoRaw, tienda, equipos) {
  const delTienda = equipos.filter((e) => e.tienda === tienda);
  const q = norm(equipoRaw);
  const exact = delTienda.find((e) => norm(e.equipo) === q);
  if (exact) return { ok: true, equipo: exact.equipo };
  // por número: "roof top 3", "rt 3", "12" → el número del equipo
  const m = q.match(/(\d+)/);
  if (m) {
    const num = parseInt(m[1], 10);
    const porNum = delTienda.filter((e) => {
      const em = norm(e.equipo).match(/(\d+)/);
      return em && parseInt(em[1], 10) === num;
    });
    if (porNum.length === 1) return { ok: true, equipo: porNum[0].equipo };
    if (porNum.length > 1) return { ok: false, candidatos: porNum.map((e) => e.equipo) };
  }
  return { ok: false, candidatos: delTienda.map((e) => e.equipo) };
}

// Resuelve {tienda, equipo} canónicos a partir de lo que extrajo Gemini.
// Si no puede, devuelve { ok:false, motivo:'tienda'|'equipo', candidatos... } para repreguntar.
export async function resolverTiendaEquipo(tiendaRaw, equipoRaw) {
  const { equipos, tiendas } = await cargarManta();
  const t = matchTienda(tiendaRaw, tiendas);
  if (!t.ok) return { ok: false, motivo: 'tienda', candidatosTienda: t.candidatos };
  const e = matchEquipo(equipoRaw, t.tienda, equipos);
  if (!e.ok) return { ok: false, motivo: 'equipo', tienda: t.tienda, candidatosEquipo: e.candidatos };
  return { ok: true, tienda: t.tienda, equipo: e.equipo };
}
