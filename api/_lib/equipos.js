// Empareja lo que el técnico dice ("atocongo cortina de aire 1", "MA-ATO-CAI-001",
// "extractor de la azotea de comas") con un equipo concreto del `inventario`.
// Devuelve {sede, equipo} canónicos o pide aclarar (sede o equipo) con candidatos.
import { cargarInventario } from './inventario.js';

const norm = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Quita el nombre del cliente del texto (RIPLEY, TOTTUS…), genérico → multi-cliente.
const sinClientes = (s, clientes) => {
  let n = norm(s);
  for (const c of (clientes || [])) { const cn = norm(c); if (cn) n = n.split(cn).join(' '); }
  return n.replace(/\s+/g, ' ').trim();
};
// ¿el técnico nombró un cliente? (para desambiguar si dos clientes comparten nombre de sede)
const clienteMencionado = (raw, clientes) => {
  const n = ' ' + norm(raw) + ' ';
  return (clientes || []).find((c) => { const cn = norm(c); return cn && n.includes(' ' + cn + ' '); }) || null;
};

// Palabras que no aportan a la identificación del equipo.
const STOP = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'AA', 'AIRE', 'ACONDICIONADO',
  'EQUIPO', 'UNIDAD', 'EN', 'PISO', 'NIVEL', 'Nº', 'NRO', 'NUMERO', 'QUE', 'UN', 'UNA']);
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

// Palabras-número coloquiales → dígito ("extractor uno" → "extractor 1"). Excluye UN/UNA
// (artículos: "una cortina" NO debe volverse "1 cortina" e inyectar un número falso).
const NUM_PALABRA = { UNO: '1', DOS: '2', TRES: '3', CUATRO: '4', CINCO: '5', SEIS: '6',
  SIETE: '7', OCHO: '8', NUEVE: '9', DIEZ: '10', ONCE: '11', DOCE: '12' };
const conNumeros = (s) => norm(s).split(' ').map((w) => NUM_PALABRA[w] || w).join(' ');

function matchSede(sedeRaw, sedes, clientes) {
  const q = sinClientes(sedeRaw, clientes);
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

function matchEquipo(equipoRaw, sede, equipos, cliente) {
  // Filtra por sede y, si se nombró un cliente, por ese cliente (desambigua sedes compartidas).
  let delSede = equipos.filter((e) => e.sede === sede && (!cliente || e.cliente === cliente));
  if (!delSede.length) delSede = equipos.filter((e) => e.sede === sede);
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
  //    NO se puntúa por eq_id (su prefijo "MA" y su numeración de IMPORTACIÓN están en
  //    todos los códigos y no tienen por qué coincidir con el número que el técnico ve
  //    en el nombre — mezclarlos generaba empates falsos entre dos equipos del mismo
  //    tipo, ej. "Cortina de aire 04" contra el eq_id de "Cortina de aire 02").
  const qNum = conNumeros(equipoRaw);                    // "extractor uno" → "extractor 1"
  const qToks = tokens(qNum);
  const qNumsTodos = (qNum.match(/\d+/g) || []).map((n) => parseInt(n, 10));
  // Números que acompañan una palabra de UBICACIÓN ("piso 2", "1er nivel", "piso nro 2") no
  // compiten por el match FUERTE del número propio del equipo — solo por el de área (más
  // débil). Sin esto, repetir la ubicación que el propio bot sugirió ("Cortina 04 — Piso 2")
  // podía coincidir por azar con el número de OTRO equipo y producir un empate (bucle de
  // repregunta). OJO: "NRO/NUMERO + número" a secas ("cortina numero 4") es el número DEL
  // EQUIPO — solo cuenta como ubicación pegado a PISO/NIVEL. Orden de los replace: primero
  // "palabra + número" para que en "extractor 1 nivel 2" el 1 (equipo) sobreviva al 2º regex.
  const qNumsFuertes = (qNum
    .replace(/\b(PISO|NIVEL)\s+((NRO|NUMERO)\s+)?\d+/g, ' ')   // "piso 2", "nivel nro 3"
    .replace(/\b\d+[A-Z]{0,3}\s+(PISO|NIVEL)\b/g, ' ')         // "2do piso", "1 nivel" (de "1° nivel")
    .match(/\d+/g) || [])
    .map((n) => parseInt(n, 10));
  const scored = pool.map((e) => {
    const nombreTxt = norm(e.nombre);
    const areaTxt = norm(e.area);
    let s = 0;
    for (const t of qToks) {
      if (/^\d+$/.test(t)) continue;                       // los números se puntúan aparte
      if (areaTxt.includes(t)) s += 2;                     // palabra de UBICACIÓN: distintiva e intencional
      else if (nombreTxt.includes(t)) s += 1;              // palabra del nombre: poco distintiva
    }
    if (qNumsTodos.length) {
      // Número canónico: SOLO del propio NOMBRE ("Extractor 02"); el de la ubicación
      // ("GRAN VOLUMEN 01", "1° Nivel") solo desempata, para no confundir "extractor 2".
      const nombreNums = (nombreTxt.match(/\d+/g) || []).map((n) => parseInt(n, 10));
      const areaNums = (areaTxt.match(/\d+/g) || []).map((n) => parseInt(n, 10));
      if (qNumsFuertes.some((n) => nombreNums.includes(n))) s += 3;
      else if (qNumsTodos.some((n) => areaNums.includes(n))) s += 1;
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

// Resuelve {sede, equipo} contra `inventario`. `equipo` = objeto {eqId, sede, cliente, tipo, nombre, area}.
// Multi-cliente: detecta el cliente nombrado (si lo hay) para desambiguar sedes compartidas.
// `textoCompleto` (opcional) = todo lo que dijo el técnico; se usa para detectar el cliente aunque
// no esté en sedeRaw/equipoRaw (p.ej. lo respondió a una repregunta). Cae a sedeRaw+equipoRaw.
export async function resolverEquipo(sedeRaw, equipoRaw, textoCompleto) {
  const { equipos, sedes, clientes } = await cargarInventario();
  const cliente = clienteMencionado(textoCompleto || `${sedeRaw || ''} ${equipoRaw || ''}`, clientes);
  const t = matchSede(sedeRaw, sedes, clientes);
  if (!t.ok) return { ok: false, motivo: 'sede', candidatosSede: t.candidatos };
  // Multi-cliente: si esa sede existe para >1 cliente y el técnico no dijo cuál, preguntamos
  // (evita emparejar silenciosamente con el equipo del cliente equivocado). Con un solo cliente
  // —caso de hoy: solo RIPLEY— esta rama nunca dispara.
  const clientesSede = [...new Set(equipos.filter((e) => e.sede === t.sede).map((e) => e.cliente).filter(Boolean))];
  if (clientesSede.length > 1 && !cliente) {
    return { ok: false, motivo: 'cliente', sede: t.sede, candidatosCliente: clientesSede };
  }
  const e = matchEquipo(equipoRaw, t.sede, equipos, cliente);
  if (!e.ok) return { ok: false, motivo: 'equipo', sede: t.sede, candidatosEquipo: e.candidatos };
  return { ok: true, sede: t.sede, equipo: e.equipo };
}
