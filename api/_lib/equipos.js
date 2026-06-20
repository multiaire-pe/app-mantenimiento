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

// Alias coloquiales → tipo del inventario (lo que el técnico dice ≠ cómo está catalogado).
const ALIAS_TIPO = [['ROOF TOP', 'PAQUETE'], ['ROOFTOP', 'PAQUETE'], ['FANCOIL', 'FAN COIL']];

// Detecta qué TIPO de equipo menciona el técnico ("extractor", "cortina", "split"…),
// contra los tipos que existen en esa sede. Devuelve el tipo canónico o null.
function tipoMencionado(equipoRaw, tiposSede) {
  const q = ' ' + norm(equipoRaw) + ' ';
  const tieneTipo = (canon) => tiposSede.find((t) => norm(t) === norm(canon));
  // 1) alias coloquiales
  for (const [ali, canon] of ALIAS_TIPO) {
    if (q.includes(' ' + norm(ali) + ' ') && tieneTipo(canon)) return tieneTipo(canon);
  }
  // 2) por palabra clave del propio tipo (ej. CORTINA, EXTRACTOR, SPLIT, UMA, CHILLER…)
  for (const t of tiposSede) {
    const kws = norm(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
    if (kws.some((kw) => q.includes(' ' + kw))) return t;
  }
  return null;
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

  // 2) si el técnico nombra un TIPO, restringimos a ese tipo (respeta "extractor …" → solo extractores).
  const tiposSede = [...new Set(delSede.map((e) => e.tipo).filter(Boolean))];
  const tipo = tipoMencionado(equipoRaw, tiposSede);
  let pool = tipo ? delSede.filter((e) => e.tipo === tipo) : delSede;
  if (!pool.length) pool = delSede;

  // 3) scoring por NOMBRE + ÁREA (ubicación) + número. El tipo ya filtró el pool;
  //    NO se puntúa por eq_id (su prefijo "MA" está en todos los códigos).
  const qToks = tokens(equipoRaw);
  const qNums = (q.match(/\d+/g) || []).map((n) => parseInt(n, 10));
  const scored = pool.map((e) => {
    const nombreTxt = norm(e.nombre);
    const areaTxt = norm(e.area);
    let s = 0;
    for (const t of qToks) {
      if (/^\d+$/.test(t)) continue;                       // los números se puntúan aparte
      if (areaTxt.includes(t)) s += 2;                     // palabra de UBICACIÓN: distintiva e intencional
      else if (nombreTxt.includes(t)) s += 1;              // palabra del nombre: poco distintiva
    }
    if (qNums.length) {
      // Número canónico del equipo (nombre/eq_id, "Extractor 02") pesa fuerte; el de la
      // ubicación ("GRAN VOLUMEN 01", "1° Nivel") solo desempata, para no confundir "extractor 2".
      const nombreNums = (norm(`${e.nombre} ${e.eqId}`).match(/\d+/g) || []).map((n) => parseInt(n, 10));
      const areaNums = (areaTxt.match(/\d+/g) || []).map((n) => parseInt(n, 10));
      if (qNums.some((n) => nombreNums.includes(n))) s += 3;
      else if (qNums.some((n) => areaNums.includes(n))) s += 1;
    }
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  if (scored.length) {
    if (scored.length === 1 || scored[0].s > scored[1].s) return { ok: true, equipo: scored[0].e };
    const top = scored.filter((x) => x.s === scored[0].s).map((x) => x.e);     // empate
    return { ok: false, candidatos: top };
  }
  // mencionó un tipo pero sin pista de número/ubicación → ofrecer los de ese tipo como candidatos
  return { ok: false, candidatos: pool };
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
