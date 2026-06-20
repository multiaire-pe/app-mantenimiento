// Empareja lo que el técnico dice ("atocongo cortina de aire 1", "MA-ATO-CAI-001",
// "extractor de la azotea de comas") con un equipo concreto del `inventario`.
// Devuelve {sede, equipo} canónicos o pide aclarar (sede o equipo) con candidatos.
import { cargarInventario } from './inventario.js';

const norm = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sinRipley = (s) => norm(s).replace(/\bRIPLEY\b/g, '').trim();

// Palabras que no aportan a la identificación del equipo.
const STOP = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'AA', 'AIRE', 'ACONDICIONADO',
  'EQUIPO', 'UNIDAD', 'EN', 'PISO', 'NIVEL', 'Nº', 'NRO', 'NUMERO', 'QUE', 'UN', 'UNA']);
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

function matchSede(sedeRaw, sedes) {
  const q = sinRipley(sedeRaw);
  if (!q) return { ok: false, candidatos: sedes };
  const exact = sedes.find((s) => norm(s) === q);
  if (exact) return { ok: true, sede: exact };
  const contiene = sedes.filter((s) => { const n = norm(s); return n.includes(q) || q.includes(n); });
  if (contiene.length === 1) return { ok: true, sede: contiene[0] };
  if (contiene.length > 1) return { ok: false, candidatos: contiene };
  // por tokens (ej. "san juan" → SAN JUAN DE LURIGANCHO)
  const qToks = q.split(' ').filter((t) => t.length > 2);
  const porTok = sedes.filter((s) => { const n = norm(s); return qToks.length && qToks.every((t) => n.includes(t)); });
  if (porTok.length === 1) return { ok: true, sede: porTok[0] };
  if (porTok.length > 1) return { ok: false, candidatos: porTok };
  return { ok: false, candidatos: sedes };
}

function matchEquipo(equipoRaw, sede, equipos) {
  const delSede = equipos.filter((e) => e.sede === sede);
  if (!delSede.length) return { ok: false, candidatos: [] };
  const q = norm(equipoRaw);
  if (!q) return { ok: false, candidatos: delSede };

  // 1) eq_id exacto (ej. "MA-ATO-CAI-001" o "maatocai001")
  const qId = q.replace(/[^A-Z0-9]/g, '');
  if (qId.length >= 6) {
    const porId = delSede.find((e) => e.eqId.replace(/[^A-Z0-9]/gi, '').toUpperCase() === qId);
    if (porId) return { ok: true, equipo: porId };
  }

  // 2) scoring por tokens (tipo/nombre/área) + número
  const qToks = tokens(equipoRaw);
  const qNums = (q.match(/\d+/g) || []).map((n) => parseInt(n, 10));
  const scored = delSede.map((e) => {
    // Scoring por tipo/nombre/área — NO por eq_id (su prefijo "MA" y abreviaturas
    // ensuciarían: "MA" está en todos los códigos). El eq_id solo cuenta para el match exacto.
    const hay = norm(`${e.tipo} ${e.nombre} ${e.area}`);
    let s = 0;
    for (const t of qToks) if (!/^\d+$/.test(t) && hay.includes(t)) s += 1;   // los números van aparte
    if (qNums.length) {
      const eNums = (norm(`${e.nombre} ${e.eqId}`).match(/\d+/g) || []).map((n) => parseInt(n, 10));
      if (qNums.some((n) => eNums.includes(n))) s += 3;
    }
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  if (scored.length) {
    if (scored.length === 1 || scored[0].s > scored[1].s) return { ok: true, equipo: scored[0].e };
    const top = scored.filter((x) => x.s === scored[0].s).map((x) => x.e);     // empate
    return { ok: false, candidatos: top };
  }
  return { ok: false, candidatos: delSede };
}

// Resuelve {sede, equipo} contra `inventario`. `equipo` = objeto {eqId, sede, tipo, nombre, area}.
export async function resolverEquipo(sedeRaw, equipoRaw) {
  const { equipos, sedes } = await cargarInventario();
  const t = matchSede(sedeRaw, sedes);
  if (!t.ok) return { ok: false, motivo: 'sede', candidatosSede: t.candidatos };
  const e = matchEquipo(equipoRaw, t.sede, equipos);
  if (!e.ok) return { ok: false, motivo: 'equipo', sede: t.sede, candidatosEquipo: e.candidatos };
  return { ok: true, sede: t.sede, equipo: e.equipo };
}
