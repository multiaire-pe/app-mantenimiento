// Lógica pura del Gantt de programación de mantenimientos (pestaña "Programación" de Mantenimiento).
// Sin DOM ni Firestore: recibe datos y devuelve datos, así se prueba aparte (tests/programacion.test.mjs).
// Colección `mtto_programacion`: 1 doc por visita {cliente, sede, periodo, anio, desde, hasta, cuadrilla, notas}.
// `sede` es la sede PLANA del inventario; la clave de fila es cliente|sede, así RIPLEY y TOTTUS no se mezclan en
// las sedes compartidas (Miraflores, Jockey Plaza).
(function (root) {
  const PERIODOS = ['ENE-FEB', 'MAR-ABR', 'MAY-JUN', 'JUL-AGO', 'SEP-OCT', 'NOV-DIC'];
  const CUADRILLAS = ['1', '2'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  // ── Períodos DEFINIBLES (clientes que no trabajan por bimestre, hoy TOTTUS) ─────────────────────────
  // RIPLEY usa los 6 bimestres de siempre. Un cliente con períodos definibles tiene períodos T1, T2… que un
  // admin crea en la app (colección `mtto_periodos`, doc `CLIENTE|AÑO|Tn` = {cliente, anio, periodo, mesInicio,
  // mesFin}; meses 1-12, de 1 a N meses consecutivos dentro del mismo año). Sus claves (`sede|T1|2026`) nunca
  // chocan con las bimestrales (`sede|ENE-FEB|2026`).
  // T1 2026 de TOTTUS viene PRECARGADO como sep-oct: es el período donde ya están sus datos.
  const DEFAULT_PERIODOS = [{ cliente: 'TOTTUS', anio: 2026, periodo: 'T1', mesInicio: 9, mesFin: 10 }];
  // Mientras los datos de ese período sigan guardados con la clave bimestral vieja, T1 LEE de ahí (sin copiar ni
  // reetiquetar nada). Cuando se migren, se quita esta línea. Mismo mapa en api/_lib/mtto.js (lo cubre un test).
  const ALIAS_LEGACY = { 'TOTTUS|2026|T1': 'SEP-OCT' };
  const periodoDatos = (cliente, anio, periodo) => ALIAS_LEGACY[`${cliente}|${anio}|${periodo}`] || periodo;

  const defKey = (d) => `${d.cliente}|${d.anio}|${d.periodo}`;
  const numT = (p) => Number(String(p).replace(/^T/, ''));
  // Definiciones del cliente en ese año (las guardadas pisan a las precargadas), ordenadas por mes de inicio.
  function periodosDe(defs, cliente, anio) {
    const m = new Map();
    for (const d of [...DEFAULT_PERIODOS, ...(defs || [])]) if (d.cliente === cliente && Number(d.anio) === Number(anio)) m.set(defKey(d), { ...d, anio: Number(d.anio) });
    return [...m.values()].sort((a, b) => a.mesInicio - b.mesInicio || numT(a.periodo) - numT(b.periodo));
  }
  // ¿Qué período rige en una fecha (YYYY-MM-DD)? El que contiene su mes; si ninguno, el último que ya empezó;
  // si aún no empezó ninguno, el primero; null si el cliente no tiene períodos ese año.
  function periodoDeFecha(defs, cliente, fecha) {
    const anio = Number(String(fecha).slice(0, 4)), mes = Number(String(fecha).slice(5, 7));
    const lista = periodosDe(defs, cliente, anio);
    if (!lista.length) return null;
    return lista.find((d) => mes >= d.mesInicio && mes <= d.mesFin) || [...lista].reverse().find((d) => d.mesInicio <= mes) || lista[0];
  }
  const siguienteNombre = (defs, cliente, anio) => 'T' + (periodosDe(defs, cliente, anio).reduce((m, d) => Math.max(m, numT(d.periodo) || 0), 0) + 1);
  // '' si el período nuevo es válido; si no, el motivo.
  function validarPeriodoNuevo(defs, n) {
    const mi = Number(n.mesInicio), mf = Number(n.mesFin);
    if (!n.cliente || !/^T\d+$/.test(n.periodo || '')) return 'Período no válido.';
    if (!Number.isInteger(mi) || !Number.isInteger(mf) || mi < 1 || mf > 12) return 'Elige el mes de inicio y el de fin.';
    if (mf < mi) return 'El mes final no puede ser anterior al inicial.';
    const lista = periodosDe(defs, n.cliente, n.anio);
    if (lista.some((d) => d.periodo === n.periodo)) return `${n.periodo} ya existe en ${n.anio}.`;
    const choca = lista.find((d) => mi <= d.mesFin && mf >= d.mesInicio);
    if (choca) return `Se cruza con ${choca.periodo} (${choca.mesInicio}–${choca.mesFin}).`;
    return '';
  }

  // Meses (0-based) que abarca un período: bimestre fijo, o los de su definición (`def`) si es un T1, T2…. [] si no existe.
  function mesesDelPeriodo(periodo, def) {
    const b = PERIODOS.indexOf(periodo);
    if (b >= 0) return [b * 2, b * 2 + 1];
    if (def && def.periodo === periodo && def.mesInicio >= 1 && def.mesFin <= 12 && def.mesFin >= def.mesInicio) {
      const out = [];
      for (let m = def.mesInicio - 1; m <= def.mesFin - 1; m++) out.push(m);
      return out;
    }
    return [];
  }

  // Días (YYYY-MM-DD) del período, de corrido. `def` solo hace falta para los períodos T1, T2….
  function diasDelPeriodo(periodo, anio, def) {
    const out = [];
    for (const m of mesesDelPeriodo(periodo, def)) {
      const n = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= n; d++) out.push(iso(anio, m, d));
    }
    return out;
  }

  const dow = (f) => new Date(f + 'T12:00:00Z').getUTCDay();   // 0 = domingo

  // '' si la visita es válida; si no, el motivo (para mostrarlo en el formulario).
  function validarVisita(v, periodo, anio, def) {
    const dias = diasDelPeriodo(periodo, anio, def);
    if (!v.cliente || !v.sede) return 'Falta la sede.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(v.hasta || '')) return 'Indica fecha de inicio y de fin.';
    if (v.hasta < v.desde) return 'La fecha de fin es anterior a la de inicio.';
    if (!dias.includes(v.desde) || !dias.includes(v.hasta)) return `Las fechas deben estar dentro de ${periodo} ${anio}.`;
    if (v.cuadrilla && !CUADRILLAS.includes(String(v.cuadrilla))) return 'Cuadrilla no válida.';
    return '';
  }

  // Visitas de OTRAS filas que usan la misma cuadrilla en días que se cruzan (aviso, no bloqueo).
  function choques(visitas, nueva) {
    if (!nueva.cuadrilla) return [];
    return visitas.filter((x) => x.id !== nueva.id && x.cuadrilla === nueva.cuadrilla &&
      !(x.cliente === nueva.cliente && x.sede === nueva.sede) && x.desde <= nueva.hasta && x.hasta >= nueva.desde);
  }

  // Posición de una visita en la grilla de días: {ini, n} (0-based, n = días). null si no cae en el período.
  function tramo(v, dias) {
    if (!dias.length || v.hasta < dias[0] || v.desde > dias[dias.length - 1]) return null;
    const ini = Math.max(0, dias.indexOf(v.desde) >= 0 ? dias.indexOf(v.desde) : 0);
    let fin = dias.indexOf(v.hasta);
    if (fin < 0) fin = dias.length - 1;
    return { ini, n: fin - ini + 1 };
  }

  // Filas del Gantt: toda sede con equipos aparece (tenga o no visitas). Filtra por cliente y cuadrilla.
  function filas(equipos, visitas, { cliente = '', cuadrilla = '' } = {}) {
    const mapa = new Map();
    for (const e of equipos) {
      if (!e.cliente || !e.sede || (cliente && e.cliente !== cliente)) continue;
      const k = e.cliente + '|' + e.sede;
      if (!mapa.has(k)) mapa.set(k, { cliente: e.cliente, sede: e.sede, visitas: [] });
    }
    for (const v of visitas) {
      const k = v.cliente + '|' + v.sede;
      if (cliente && v.cliente !== cliente) continue;
      if (!mapa.has(k)) mapa.set(k, { cliente: v.cliente, sede: v.sede, visitas: [] });
      mapa.get(k).visitas.push(v);
    }
    let rows = [...mapa.values()];
    if (cuadrilla === '-') rows = rows.filter((r) => !r.visitas.length);
    else if (cuadrilla) rows = rows.filter((r) => r.visitas.some((v) => v.cuadrilla === cuadrilla));
    rows.forEach((r) => r.visitas.sort((a, b) => a.desde.localeCompare(b.desde)));
    return rows.sort((a, b) => a.cliente.localeCompare(b.cliente) || a.sede.localeCompare(b.sede));
  }

  const api = { PERIODOS, DEFAULT_PERIODOS, ALIAS_LEGACY, periodoDatos, periodosDe, periodoDeFecha, siguienteNombre, validarPeriodoNuevo, mesesDelPeriodo, CUADRILLAS, diasDelPeriodo, dow, validarVisita, choques, tramo, filas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PROG = api;
})(typeof window !== 'undefined' ? window : globalThis);
