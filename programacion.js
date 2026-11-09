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

  // Días (YYYY-MM-DD) del bimestre, de corrido.
  function diasDelPeriodo(periodo, anio) {
    const i = PERIODOS.indexOf(periodo);
    if (i < 0) return [];
    const out = [];
    for (const m of [i * 2, i * 2 + 1]) {
      const n = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= n; d++) out.push(iso(anio, m, d));
    }
    return out;
  }

  const dow = (f) => new Date(f + 'T12:00:00Z').getUTCDay();   // 0 = domingo

  // '' si la visita es válida; si no, el motivo (para mostrarlo en el formulario).
  function validarVisita(v, periodo, anio) {
    const dias = diasDelPeriodo(periodo, anio);
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

  const api = { PERIODOS, CUADRILLAS, diasDelPeriodo, dow, validarVisita, choques, tramo, filas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PROG = api;
})(typeof window !== 'undefined' ? window : globalThis);
