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

// ─────────────────────────────────────────────────────────────────────────────
// Tolerancia a typos SIN IA. El registro de mtto pasa el texto por Gemini antes de
// resolver, pero si Gemini está caído, sin cuota o su key rotó, este matcher es lo
// único que queda: tiene que aguantar solo. Ninguna capa adivina — si dos sedes
// empatan, se devuelven como candidatas y el bot repregunta (que es el estado de hoy).

// Clave fonética del español: colapsa las confusiones que se escriben "al oído"
// (atokongo→atocongo, plasa→plaza, megaplasa→megaplaza). Deja las VOCALES intactas:
// son las que separan sedes parecidas, y tocarlas dispararía falsos positivos.
const fonetica = (s) => norm(s)
  .replace(/CH/g, '1').replace(/LL/g, '2')            // dígrafos primero (antes de tocar C y L)
  .replace(/QU/g, 'K').replace(/GU([EI])/g, 'G$1')
  .replace(/C([EI])/g, 'S$1').replace(/[CQK]/g, 'K')  // ce/ci suenan S; el resto de C/Q/K suenan K
  .replace(/Z/g, 'S').replace(/V/g, 'B').replace(/H/g, '')
  .replace(/([BDFGJKLMNPRSTX12])\1+/g, '$1')          // dobles consonantes: RR→R, KK→K…
  .replace(/\s+/g, ' ').trim();

// El texto llega de WhatsApp (no confiable, hasta 4096 chars) y el fuzzy es O(m·n): se acota
// por dónde duele — cuántas ventanas se comparan (acá) y cuánto se calcula de cada distancia
// (el `max` de abajo). Medido con el tope de WhatsApp pegado entero: 3 ms.
const MAX_TOKENS = 40;

// Distancia de edición (Levenshtein) para los typos que no son fonéticos: una letra
// cambiada, faltante o de más ("plaza nortr", "megapalza"). `max` corta por lo sano:
// como lev(a,b) ≥ |len(a)−len(b)|, un largo muy distinto se descarta sin calcular nada.
function distancia(a, b, max = Infinity) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let fila = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,                                     // borrar
        cur[j - 1] + 1,                                  // insertar
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),   // sustituir
      );
      if (cur[j] < fila) fila = cur[j];
    }
    if (fila > max) return max + 1;                      // ya no puede bajar del umbral
    prev = cur;
  }
  return prev[n];
}
// Cuánto typo se tolera según el largo: en textos cortos un solo error ya cambia
// la palabra a otra distinta, así que ahí no se perdona nada.
const tolerancia = (len) => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

// Sigla de una sede multi-palabra: SAN JUAN DE LURIGANCHO → SJL (los conectores no cuentan).
const CONECTOR = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y']);
const sigla = (s) => norm(s).split(' ').filter((w) => w && !CONECTOR.has(w)).map((w) => w[0]).join('');

// Devuelve la única sede que gana por `puntaje` (menor = mejor), o null si hay empate
// —empatar significa que no sabemos cuál quiso decir, y adivinar sería peor que preguntar.
function unicoMejor(sedes, puntaje) {
  const con = sedes.map((s) => ({ s, d: puntaje(s) })).filter((x) => x.d != null).sort((a, b) => a.d - b.d);
  if (!con.length) return null;
  if (con.length > 1 && con[0].d === con[1].d) return null;
  return con[0].s;
}

function matchSede(sedeRaw, sedes, clientes) {
  const q = sinClientes(sedeRaw, clientes);
  if (!q) return { ok: false, candidatos: sedes };
  // 1) Lo dicho ES la sede, tal cual.
  const exact = sedes.find((s) => norm(s) === q);
  if (exact) return { ok: true, sede: exact };

  // 2) Sede escrita a medias ("san juan" → SAN JUAN DE LURIGANCHO): la SEDE contiene lo dicho.
  //    (El caso inverso —la sede va dentro de una frase más larga— NO se resuelve acá: cae al
  //    scoring de abajo, que es el único que sabe de especificidad y contención. Si se resolviera
  //    acá por substring, "m plaza norte" daría PLAZA NORTE en silencio pudiendo ser MAC PLAZA
  //    NORTE, y "chiller de mac plaza norte" repreguntaría por empatar consigo misma.)
  const parcial = sedes.filter((s) => norm(s).includes(q));
  if (parcial.length === 1) return { ok: true, sede: parcial[0] };
  if (parcial.length > 1) return { ok: false, candidatos: parcial, ambiguo: true };

  // 3) por tokens sueltos (ej. "juan lurigancho" → SAN JUAN DE LURIGANCHO)
  const qToks = q.split(' ').filter((t) => t.length > 2);
  const porTok = sedes.filter((s) => { const n = norm(s); return qToks.length && qToks.every((t) => n.includes(t)); });
  if (porTok.length === 1) return { ok: true, sede: porTok[0] };
  if (porTok.length > 1) return { ok: false, candidatos: porTok, ambiguo: true };

  // ── Desde acá, lo que escribió el técnico NO calza literal con ninguna sede ──
  // (hasta ayer, esto era siempre "no entendí, ¿de qué sede?").

  // 4) Sigla: "sjl" → SAN JUAN DE LURIGANCHO. Mínimo 3 letras — con 2, el riesgo de
  //    pegarle a la sede equivocada supera lo que ahorra.
  const siglas = q.split(' ').filter((t) => /^[A-Z]{3,5}$/.test(t));
  if (siglas.length) {
    const porSigla = sedes.filter((s) => siglas.includes(sigla(s)));
    if (porSigla.length === 1) return { ok: true, sede: porSigla[0] };
    if (porSigla.length > 1) return { ok: false, candidatos: porSigla, ambiguo: true };
  }

  // 5) Sede escrita al oído o con typo ("plasa norte", "atokongo", "plaza nortr"), sola o
  //    embebida en la frase ("chiller 1 de atokongo"): se busca la mejor ventana de palabras
  //    del largo de cada sede. Este es el ÚNICO camino para "la sede está dentro de la frase",
  //    a propósito: es el único que pondera especificidad y contención, y tener un segundo
  //    camino que resolviera por su cuenta (substring o fonética exacta) dejaba justamente el
  //    agujero por el que "m plaza norte" se resolvía como PLAZA NORTE sin preguntar.
  const tol = (a, b) => tolerancia(Math.max(a.length, b.length));
  const toks = q.split(' ').filter(Boolean).slice(0, MAX_TOKENS).map(fonetica);
  const dentroDeLaFrase = (sf) => {
    const n = sf.split(' ').length;
    let mejor = null;
    for (let i = 0; i + n <= toks.length; i++) {
      const win = toks.slice(i, i + n).join(' ');
      const t = tol(win, sf);
      const d = distancia(win, sf, t);
      if (d <= t && (mejor == null || d < mejor)) mejor = d;
    }
    return mejor;
  };
  const viables = sedes.map((s) => ({ s, f: fonetica(s) })).map((x) => ({ ...x, d: dentroDeLaFrase(x.f) }))
    .filter((x) => x.d != null)
    // menor distancia gana; a IGUAL distancia gana la sede más específica (la más larga):
    // en "mac plasa norte", MAC PLAZA NORTE y PLAZA NORTE calzan ambas con distancia 0, y la
    // que el técnico escribió entera es la larga.
    .sort((a, b) => a.d - b.d || b.f.length - a.f.length);
  if (viables.length) {
    const [g, ...resto] = viables;
    const empate = resto.some((x) => x.d === g.d && x.f.length === g.f.length);
    // Una sede que es subfrase de OTRA sede real (PLAZA NORTE ⊂ MAC PLAZA NORTE) no se resuelve
    // sola mientras la larga también calce: "m plasa norte" puede ser cualquiera de las dos, y
    // escribir el registro contra la sede equivocada es peor que volver a preguntar.
    const contenida = resto.filter((x) => x.f.includes(g.f));
    if (empate || contenida.length) {
      return {
        ok: false,
        ambiguo: true,   // ← ambigüedad REAL entre sedes concretas, no un "no entendí"
        candidatos: [g.s, ...contenida.map((x) => x.s), ...resto.filter((x) => x.d === g.d).map((x) => x.s)].filter((s, i, a) => a.indexOf(s) === i),
      };
    }
    return { ok: true, sede: g.s };
  }

  return { ok: false, candidatos: sedes };
}

// Alias coloquiales → tipo del inventario (lo que el técnico dice ≠ cómo está catalogado).
// "rutop"/"ruftop" son como suena "roof top" dicho en obra, y es lo que llega escrito.
const ALIAS_TIPO = [['ROOF TOP', 'PAQUETE'], ['ROOFTOP', 'PAQUETE'], ['RUF TOP', 'PAQUETE'],
  ['RUFTOP', 'PAQUETE'], ['RUTOP', 'PAQUETE'], ['FANCOIL', 'FAN COIL']];

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
  // 3) con typo ("chiler", "extraktor", "cortna"): misma fonética + distancia de edición
  //    que las sedes. Solo resuelve si UN tipo queda más cerca que los demás; ante empate
  //    devuelve null y el pool queda sin filtrar por tipo (comportamiento de siempre).
  const qToks = norm(equipoRaw).split(' ').filter((t) => t.length >= 4 && !STOP.has(t))
    .slice(0, MAX_TOKENS).map(fonetica);
  if (!qToks.length) return null;
  return unicoMejor(tiposSede, (t) => {
    const kws = norm(t).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)).map(fonetica);
    let mejor = null;
    for (const kw of kws) {
      for (const tok of qToks) {
        const tl = tolerancia(Math.max(tok.length, kw.length));
        const d = distancia(tok, kw, tl);
        if (d <= tl && (mejor == null || d < mejor)) mejor = d;
      }
    }
    return mejor;
  });
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
  // Números que acompañan una palabra de UBICACIÓN ("piso 2", "1er nivel", "piso nro 2",
  // "piso n° 2") no compiten por el match FUERTE del número propio del equipo — solo por el
  // de área (más débil). Sin esto, repetir la ubicación que el propio bot sugirió ("Cortina
  // 04 — Piso 2") podía coincidir por azar con el número de OTRO equipo y producir un empate
  // (bucle de repregunta). El conector cubre n°/no/nro/numero (norm() deja "n°"→"N", "nro"→"NRO").
  // OJO: "NRO/NUMERO + número" a secas ("cortina numero 4") es el número DEL EQUIPO — solo
  // cuenta como ubicación pegado a PISO/NIVEL. Orden de los replace: primero "palabra + número"
  // para que en "extractor 1 nivel 2" el 1 (equipo) sobreviva al 2º regex.
  const qNumsFuertes = (qNum
    .replace(/\b(PISO|NIVEL)\s+((N|NO|NRO|NUMERO)\s+)?\d+/g, ' ')   // "piso 2", "nivel nro 3", "piso n° 2"
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
  // `sedeAmbigua` = el texto apunta a DOS SEDES REALES concretas (PLAZA NORTE vs MAC PLAZA
  // NORTE), distinto de "no reconocí ninguna sede". Lo consume mtto.js: ante una ambigüedad
  // así, la corrección de Gemini NO puede desempatar — hay que repreguntarle al técnico.
  if (!t.ok) return { ok: false, motivo: 'sede', candidatosSede: t.candidatos, sedeAmbigua: !!t.ambiguo };
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
