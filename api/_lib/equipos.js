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
  // 2) por palabra clave del propio tipo (ej. CORTINA, EXTRACTOR, SPLIT, UMA, CHILLER…).
  //    Si la palabra es keyword de MÁS DE UN tipo (ej. "split" → SPLIT DUCTO y SPLIT CONSOLA
  //    comparten "SPLIT"), "matchea alguna keyword" no alcanza para decidir solo: antes se
  //    quedaba con el primer tipo que aparecía en `tiposSede` (orden de carga del inventario,
  //    no lo que el técnico quiso decir) y el pool quedaba tan angosto (a veces 1 solo equipo)
  //    que resolvía sin preguntar. Ahora gana el tipo con MÁS keywords propias dentro de lo
  //    dicho (especificidad: "split ducto" completo sí debe resolver directo, a diferencia de
  //    "split" a secas); a igual cantidad de keywords calzadas, empate real → null y el pool
  //    sigue sin filtrar por tipo (mismo criterio que usa `unicoMejor` para las sedes).
  const porKw = unicoMejor(tiposSede, (t) => {
    const kws = norm(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
    const n = kws.filter((kw) => q.includes(' ' + kw)).length;
    return n > 0 ? -n : null;
  });
  if (porKw) return porKw;
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

function matchEquipo(equipoRaw, sede, equipos, cliente, mensajeNuevo, sedePrevia = false) {
  // Filtra por sede y, si se nombró un cliente, por ese cliente (desambigua sedes compartidas).
  let delSede = equipos.filter((e) => e.sede === sede && (!cliente || e.cliente === cliente));
  if (!delSede.length) delSede = equipos.filter((e) => e.sede === sede);
  if (!delSede.length) return { ok: false, candidatos: [] };
  const q = norm(equipoRaw);
  // `sinInfo: true` = el técnico no dio NINGUNA pista de equipo (ni tipo, ni ubicación, ni
  // nombre) — a diferencia de una ambigüedad real (varios equipos calzan igual de bien). El
  // caller lo usa para no dejar que Gemini "corrija" un equipo que no tiene nada que corregir:
  // sin esto, ante un mensaje vago Gemini terminaba inventando un tipo de equipo concreto, y
  // `elegirRescate` lo aceptaba solo por dar una lista más corta (bug real, Mall del Sur/TOTTUS,
  // 2026-09-21: "solo aparece inyector y extractor" con la sede sola, sin importar qué se
  // escribiera después).
  if (!q) return { ok: false, candidatos: delSede, sinInfo: true };

  // 1) eq_id exacto (ej. "MA-ATO-CAI-001" o "maatocai001")
  const qId = q.replace(/[^A-Z0-9]/g, '');
  if (qId.length >= 6) {
    const porId = delSede.find((e) => e.eqId.replace(/[^A-Z0-9]/gi, '').toUpperCase() === qId);
    if (porId) return { ok: true, equipo: porId };
  }

  // 1b) código PROPIO de la tienda (ej. "EC-005"): algunas sedes catalogan sus equipos con su
  // propia numeración, además del eq_id de MultiAire (inventario_multiaire.html, campo opcional,
  // editable solo desde la ficha del equipo). Se compara igual que el eq_id (solo alfanuméricos,
  // sin distinguir mayúsculas) contra TODO el mensaje compactado — por eso exige coincidencia
  // EXACTA (no substring): un mensaje largo con contenido de más no puede "reducirse por azar" a
  // un código corto. El mínimo de 4 (vs. 6 del eq_id, que es largo y fijo) es el piso razonable
  // para un código libre y corto tipeado por el cliente — por debajo de eso ("b2", "2") el riesgo
  // de que el técnico haya escrito solo eso sin querer decir el código sube demasiado. En
  // sedes/equipos sin este campo cargado, este paso no encuentra nada y el flujo sigue exactamente
  // igual que antes.
  // A diferencia del eq_id (clave del documento, no puede repetirse), el código de tienda es texto
  // libre sin validación de unicidad al cargarlo — dos equipos de la misma sede podrían quedar con
  // el mismo código por error de tipeo. Por eso NO se toma "el primero que calce" (`.find`): con un
  // solo match resuelve directo; con más de uno, no se adivina cuál — se acota el pool de las
  // siguientes etapas a esos candidatos (en vez de toda la sede) y se sigue afinando por tipo/
  // ubicación/número, igual que si el técnico solo hubiera dicho el código.
  let poolBase = delSede;
  if (qId.length >= 4) {
    const porCodTienda = delSede.filter((e) => e.codigoTienda
      && e.codigoTienda.replace(/[^A-Z0-9]/gi, '').toUpperCase() === qId);
    if (porCodTienda.length === 1) return { ok: true, equipo: porCodTienda[0] };
    if (porCodTienda.length > 1) poolBase = porCodTienda;
  }

  // 2) si el técnico nombra un TIPO, restringimos a ese tipo (respeta "extractor …" → solo extractores).
  const tiposSede = [...new Set(poolBase.map((e) => e.tipo).filter(Boolean))];
  const tipo = tipoMencionado(equipoRaw, tiposSede);
  let pool = tipo ? poolBase.filter((e) => e.tipo === tipo) : poolBase;
  if (!pool.length) pool = poolBase;

  // 3) scoring por NOMBRE + ÁREA (ubicación) + número. El tipo ya filtró el pool;
  //    NO se puntúa por eq_id (su prefijo "MA" y su numeración de IMPORTACIÓN están en
  //    todos los códigos y no tienen por qué coincidir con el número que el técnico ve
  //    en el nombre — mezclarlos generaba empates falsos entre dos equipos del mismo
  //    tipo, ej. "Cortina de aire 04" contra el eq_id de "Cortina de aire 02").
  const qNum = conNumeros(equipoRaw);                    // "extractor uno" → "extractor 1"
  // Las palabras de la SEDE (y del CLIENTE, si lo nombró) NO son pistas del equipo: `equipoRaw`
  // suele ser la frase completa del técnico ("Mall del Sur", "tottus mall del sur extractor…"),
  // repetida tal cual como descripción del equipo, y esas palabras entraban al scoring como si
  // fueran ubicación. Bug real (TOTTUS Mall del Sur, 2026-09-21): con la sede sola, "SUR" calzaba
  // por substring dentro de "CUARTO DE BA-SUR-A" → +2 a los 2 equipos de ese cuarto → el bot
  // ofrecía solo "Extractor 21" e "Inyector 6" en vez de los 92 equipos / 10 tipos de la sede.
  // (El #179 lo atribuyó a Gemini, pero el matcher solo ya lo producía: 2 candidatos empatados no
  // son `sinInfo`, así que ni se salteaba el rescate ni Gemini tenía permitido desempatarlos.)
  // Excepción (Council): si la sede ya estaba resuelta ANTES de este mensaje (`sedePrevia`), lo que
  // el técnico dice AHORA no es la mención de la sede sino una pista más ("sur" para el ala sur,
  // "norte"…) y se conserva — salvo que el mensaje REPITA la sede (o el cliente) completa ("el
  // extractor de mall del sur"): eso sí es una mención, y sus palabras se descartan igual. Solo se
  // descarta, entonces, lo que arrastran los turnos anteriores y las menciones enteras.
  const sedeWords = new Set([...norm(sede).split(' '), ...(cliente ? norm(cliente).split(' ') : [])]);
  let enElNuevo = null;
  if (sedePrevia && mensajeNuevo) {
    let n = ' ' + norm(mensajeNuevo) + ' ';
    for (const m of [sede, cliente]) { const mn = norm(m); if (mn) n = n.split(' ' + mn + ' ').join(' '); }
    enElNuevo = new Set(tokens(conNumeros(n)));
  }
  const qToks = tokens(qNum).filter((t) => !sedeWords.has(t) || (enElNuevo && enElNuevo.has(t)));
  // El NÚMERO del equipo prioriza el ÚLTIMO mensaje del técnico sobre el resto de la conversación
  // acumulada (`equipoRaw` puede traer varios turnos juntos — así resuelve un equipo descrito de a
  // poco, ej. "el extractor" + "del comedor"). Pero un dígito dicho ANTES en la charla ("quiero
  // registrar mantenimiento de las 8 cortinas de aire...") NO debe competir con el número que el
  // técnico específica AHORA ("cortina de aire 01"): sin esto, "8" y "01" empataban en el match
  // fuerte y el bot repreguntaba como si no hubiera entendido una respuesta que sí era específica
  // (reporte real, Jockey Plaza, RIPLEY — 2026-09-11). Si el último mensaje no trae NINGÚN dígito
  // (p.ej. solo aporta la ubicación), se sigue usando lo acumulado: el número pudo haber llegado en
  // un turno anterior y no hay que perderlo.
  const qNumFuente = (mensajeNuevo && /\d/.test(mensajeNuevo)) ? conNumeros(mensajeNuevo) : qNum;
  const qNumsTodos = (qNumFuente.match(/\d+/g) || []).map((n) => parseInt(n, 10));
  // Números que acompañan una palabra de UBICACIÓN ("piso 2", "1er nivel", "piso nro 2",
  // "piso n° 2") no compiten por el match FUERTE del número propio del equipo — solo por el
  // de área (más débil). Sin esto, repetir la ubicación que el propio bot sugirió ("Cortina
  // 04 — Piso 2") podía coincidir por azar con el número de OTRO equipo y producir un empate
  // (bucle de repregunta). El conector cubre n°/no/nro/numero (norm() deja "n°"→"N", "nro"→"NRO").
  // OJO: "NRO/NUMERO + número" a secas ("cortina numero 4") es el número DEL EQUIPO — solo
  // cuenta como ubicación pegado a PISO/NIVEL. Orden de los replace: primero "palabra + número"
  // para que en "extractor 1 nivel 2" el 1 (equipo) sobreviva al 2º regex.
  const qNumsFuertes = (qNumFuente
    .replace(/\b(PISO|NIVEL)\s+((N|NO|NRO|NUMERO)\s+)?\d+/g, ' ')   // "piso 2", "nivel nro 3", "piso n° 2"
    .replace(/\b\d+[A-Z]{0,3}\s+(PISO|NIVEL)\b/g, ' ')         // "2do piso", "1 nivel" (de "1° nivel")
    .match(/\d+/g) || [])
    .map((n) => parseInt(n, 10));
  // La palabra del técnico tiene que calzar como PREFIJO de una palabra del área/nombre: ' COMEDOR'
  // calza "COMEDORES" y "BANO" calza "BANOS" (plurales y abreviaturas siguen andando), pero "SUR"
  // ya no calza "BASURA" ni "MP" "EMPLEADOS". Mismo criterio que `tipoMencionado` usa con las
  // keywords del tipo. Un substring suelto de 2-4 letras cae adentro de casi cualquier palabra, y
  // ahí una coincidencia por azar valía +2 — más que una palabra del nombre dicha a propósito.
  // Lo que se pierde, a propósito: fragmentos INTERIORES ("hh" ya no calza "SSHH" pegado; sí "SS HH").
  const enPalabra = (txt, t) => (' ' + txt).includes(' ' + t);
  const scored = pool.map((e) => {
    const nombreTxt = norm(e.nombre);
    const areaTxt = norm(e.area);
    let s = 0;
    for (const t of qToks) {
      if (/^\d+$/.test(t)) continue;                       // los números se puntúan aparte
      if (enPalabra(areaTxt, t)) s += 2;                   // palabra de UBICACIÓN: distintiva e intencional
      else if (enPalabra(nombreTxt, t)) s += 1;            // palabra del nombre: poco distintiva
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
  // mencionó un tipo pero sin pista de número/ubicación → ofrecer los de ese tipo como candidatos.
  //
  // `sinInfo` acá NO es "no hubo match" (un typo real como "resepcion" tampoco matchea nada y SÍ
  // vale la pena que Gemini lo corrija) — es específicamente "lo que sobra de `equipoRaw` después
  // de sacarle las palabras de la SEDE (y del CLIENTE) es nada": `qToks` ya viene filtrado así
  // (ver arriba), y `qNum` ya convirtió "uno" → "1", de modo que un número —aunque sea de 1 sola
  // cifra, que `tokens()` descarta— SIEMPRE cuenta como pista real. Con contenido real de por
  // medio (aunque no matchee, aunque sea typo), queda algo — y ahí Gemini sigue teniendo margen.
  // Las palabras de la sede que `sedePrevia` conservó tampoco cuentan como pista si no puntuaron
  // (llegar acá es que no lo hicieron): repetir "mall del sur" en un turno posterior no habilita el
  // rescate de Gemini — y ahí Gemini volvía a "acortar" la lista con un tipo inventado (Council, ronda 2).
  const sinInfo = !/\d/.test(qNum) && !qToks.some((t) => !sedeWords.has(t));
  return { ok: false, candidatos: pool, sinInfo };
}

// Único lugar que decide "¿vale la pena pedirle a Gemini que corrija el equipo?" a partir de lo
// que devolvió `resolverEquipo`. Compartida por mtto y observaciones a propósito — la duplicación
// de esta regla es justo cómo se corrige un flujo y el otro se queda con el bug (mismo criterio
// que `elegirRescate`, y la misma lección: ver el fix de `etiquetaSes` del changelog de este repo).
export function sinPistaDeEquipo(r) {
  return !r.ok && r.motivo === 'equipo' && !!r.sinInfoEquipo;
}

// Resuelve {sede, equipo} contra `inventario`. `equipo` = objeto {eqId, sede, cliente, tipo, nombre, area}.
// Multi-cliente: detecta el cliente nombrado (si lo hay) para desambiguar sedes compartidas.
// `textoCompleto` (opcional) = todo lo que dijo el técnico; se usa para detectar el cliente aunque
// no esté en sedeRaw/equipoRaw (p.ej. lo respondió a una repregunta). Cae a sedeRaw+equipoRaw.
// Cómo se le nombra un equipo AL TÉCNICO: siempre con su UBICACIÓN.
// Los técnicos no dicen "Extractor 04": dicen "el extractor del comedor". Si el bot le contesta
// solo el número, no tiene forma de saber si eligió el equipo correcto — y el número del nombre
// ni siquiera coincide con el del código (el eq_id numera por orden de carga del Excel).
// Úsese en TODO mensaje que nombre un equipo (listas de candidatos, confirmaciones, acuses).
export function etiquetaEquipo(eq) {
  if (!eq) return '';
  const nombre = eq.nombre || eq.equipo || '';
  const area = eq.area || '';
  return area ? `${nombre} · 📍 ${area}` : nombre;
}

// Qué hacer con la corrección de Gemini (el RESCATE) cuando el matcher no resolvió solo.
//   `r`  = lo que resolvió el matcher determinístico — MANDA.
//   `rg` = lo que resuelve el matcher usando lo que Gemini entendió — es la red, no la autoridad.
//
// Compartida por observaciones y mtto a propósito: la regla de cuándo una corrección PROBABILÍSTICA
// puede sustituir a un resultado DETERMINÍSTICO es la misma en los dos flujos, y tenerla duplicada
// es justamente cómo se arregla uno y el otro se queda con el bucle (pasó: el fix del 2026-07-13 fue
// solo a mtto y observaciones quedó registrando contra la sede equivocada seis meses).
export function elegirRescate(r, rg) {
  const cand = (x) => (x.candidatosEquipo || []).length;

  // (1) La sede que el matcher YA resolvió es intocable. Si lo que falta es el equipo, Gemini ayuda
  // con el equipo, pero no puede llevarse el registro a otra tienda. Ojo con lo pérfido del caso: su
  // corrección puede hasta PARECER un avance —una sede con menos equipos de ese tipo "acorta" la
  // lista de candidatos— y ser un desastre igual.
  if (r.sede && rg.sede && rg.sede !== r.sede) return r;

  // (2) Gemini tampoco DESEMPATA entre equipos reales. Si el matcher dejó varios candidatos es que
  // el texto era ambiguo de verdad ("la cortina de aire", a secas): que Gemini elija una con aplomo
  // es el mismo pecado que elegir la sede — un dato falso en el histórico del cliente. Se repregunta,
  // que ahora además es barato: la lista le muestra la ubicación de cada equipo.
  if (rg.ok && cand(r) > 1) return r;

  if (rg.ok) return rg;                          // resolvió y no había ambigüedad: la corrección sirvió
  if (rg.motivo === 'sede') return r;            // retrocede a "no sé la sede": se descarta
  if (r.motivo === 'sede') return rg;            // ganamos la sede que el matcher no tenía: es un avance
  if (rg.motivo !== 'equipo' || r.motivo !== 'equipo') return r;

  // (3) Y no puede ENSANCHAR la lista. El técnico responde con la ubicación ("ingreso tienda 2do
  // nivel"), el matcher ya acotó a las 9 cortinas de ese ingreso, pero Gemini extrae el equipo en
  // genérico ("cortina de aire") y su "corrección" devolvería las 27 — repitiéndole la misma lista
  // que acaba de contestar. Eso no es corregir: es el bucle.
  return cand(rg) < cand(r) ? rg : r;
}

// El tope de la lista: en el inventario real, el grupo (sede, tipo) más grande son 28 equipos
// (las cortinas de SAN JUAN DE LURIGANCHO). Con 30 caben TODOS de una: cuando el técnico ya dijo el
// tipo, nunca hace falta acotar más — se le muestran sus equipos y elige.
const MAX_LISTA = 30;
// Cuándo conviene agrupar bajo el encabezado de la ubicación en vez de repetirla en cada línea.
const MIN_POR_AREA = 3;
// Límite de WhatsApp para una lista interactiva (botones de un toque): máximo 10 filas.
const MAX_FILAS_LISTA = 10;

const SIN_UBICACION = '(sin ubicación)';

// Agrupa los equipos por su área, preservando el orden de aparición.
function porArea(lista) {
  const g = new Map();
  for (const e of lista) {
    const a = e.area || SIN_UBICACION;
    if (!g.has(a)) g.set(a, []);
    g.get(a).push(e);
  }
  return [...g.entries()];
}

// Cómo ofrecerle al técnico que ELIJA entre varios equipos. Devuelve el CUERPO de la lista (cada
// flujo le pone su encabezado). Compartido por observaciones y mtto a propósito: si divergen, uno
// de los dos vuelve a pedir "el tipo y el número", que es justo lo que el técnico NO usa.
//
// El criterio, en una línea: la lista se organiza por UBICACIÓN, porque es como el técnico piensa
// el equipo ("el extractor del comedor"). Cómo se presenta depende de qué tanto discrimina el área:
//   - modo 'equipos' → caben todos. Si la ubicación se REPITE (9 cortinas en el mismo ingreso) se
//     agrupan bajo ella y el técnico elige el número dentro de su sitio; si cada equipo tiene la
//     suya (los extractores, ~1 por área), repetir el encabezado sería ruido → una línea por equipo.
//   - modo 'tipos'   → son muchos y variados (96 en ATOCONGO): primero acotamos por tipo.
//   - modo 'equipos' (ya sabido el tipo) → se muestran TODOS agrupados por ubicación, sea cual sea
//     el tamaño del grupo. Antes, pasado MAX_LISTA, se caía a un resumen de solo nombres de área
//     ("modo 'areas'") pensado como paso intermedio para "cuando entre un cliente más grande" — y
//     TOTTUS ya lo dispara (grupos (sede,tipo) de más de 28, a diferencia de RIPLEY): el técnico
//     veía una lista en bruto sin viñetas ni equipos, distinta de la de RIPLEY. WhatsApp aguanta de
//     sobra un texto más largo, así que ya no hace falta el paso intermedio: se muestra todo de una,
//     igual para cualquier cliente.
export function opcionesEquipo(cands) {
  const lista = cands || [];
  if (!lista.length) return null;

  const areas = porArea(lista);
  const cuenta = {};
  lista.forEach((e) => { const t = e.tipo || 'OTRO'; cuenta[t] = (cuenta[t] || 0) + 1; });
  const tipos = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);

  if (lista.length <= MAX_LISTA || tipos.length <= 1) {
    const texto = lista.length >= areas.length * MIN_POR_AREA
      ? areas.map(([a, eqs]) => `📍 *${a}*\n${eqs.map((e) => `   • ${e.nombre || e.equipo || ''}`).join('\n')}`).join('\n')
      : lista.map((e) => `• ${etiquetaEquipo(e)}`).join('\n');
    return { modo: 'equipos', total: lista.length, texto };
  }

  // Varios tipos y demasiados para mostrar todos de una: primero acotamos por tipo.
  // Botones de WhatsApp (lista) solo si entran en su límite de 10 filas — con más, se
  // queda en el texto de siempre (el técnico escribe el tipo, como hoy).
  const botones = tipos.length <= MAX_FILAS_LISTA
    ? tipos.map(([t, n]) => ({ id: t, title: t.length > 24 ? t.slice(0, 24) : t, description: `${n} equipo(s)` }))
    : null;
  return {
    modo: 'tipos', total: lista.length,
    texto: tipos.map(([t, n]) => `• ${t.toLowerCase()} (${n})`).join('\n'),
    ...(botones ? { lista: botones } : {}),
  };
}

// Arma el mensaje "¿de qué tipo es?" a partir de un `opcionesEquipo(...)` con `modo:'tipos'`.
// Compartido por mtto y observaciones (cada flujo redacta su propia frase inicial en `prefijo`)
// para que la decisión de "lista de un toque vs texto de siempre" viva en un solo lugar.
export function mensajeTipos(o, prefijo) {
  const pie = '\n\n_(o dime la *ubicación* o el *código* MA-...)_';
  if (o.lista) return { texto: `${prefijo}${pie}`, lista: o.lista, boton: 'Elegir tipo' };
  return `${prefijo}\n${o.texto}${pie}`;
}

// `mensajeNuevo` (opcional) = solo lo ÚLTIMO que dijo el técnico, cuando `equipoRaw`/`textoCompleto`
// traen varios turnos acumulados — ver el comentario en `matchEquipo` sobre por qué el número
// prioriza el último mensaje. Los llamadores existentes que no lo pasan (`undefined`) se comportan
// exactamente igual que antes (usan el texto completo para todo, incluidos los números).
// `opts.sedePrevia` = la sede ya estaba resuelta ANTES de `mensajeNuevo` (ver `matchEquipo`).
export async function resolverEquipo(sedeRaw, equipoRaw, textoCompleto, mensajeNuevo, opts = {}) {
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
  const e = matchEquipo(equipoRaw, t.sede, equipos, cliente, mensajeNuevo, !!opts.sedePrevia);
  if (!e.ok) return { ok: false, motivo: 'equipo', sede: t.sede, candidatosEquipo: e.candidatos, sinInfoEquipo: !!e.sinInfo };
  return { ok: true, sede: t.sede, equipo: e.equipo };
}
