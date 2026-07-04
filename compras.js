// ═══════════════════════════════════════════════════════════════════════════════
//  compras.js — Historial de compras a proveedores (capa de datos, sin UI)
//  Implementación provisional: vive dentro del módulo de Proveedores, pero se
//  escribe desacoplada a propósito — no lee variables globales de proveedores.html,
//  recibe `db` explícito en cada función — para poder reutilizarse tal cual si en
//  el futuro existe un módulo Compras independiente (mismo criterio de separación
//  que auth-guard.js). Colección Firestore: `compras` (top-level, NO anidada en
//  `proveedores`: el historial no es un campo del proveedor).
//
//  Doc `compras`: { proveedorId, proveedorRazonSocial, fecha:'YYYY-MM-DD',
//    numeroComprobante, items:[{tipo:'ARTICULO'|'SERVICIO', catalogoId, nombre,
//    cantidad, precioUnitario, subtotal}], total, origen, createdAt, createdBy }
//  `catalogoId` solo se guarda en ítems ARTICULO (referencia a `insumos_catalogo`,
//  preparación para una futura relación con Inventario); los SERVICIO nunca la
//  llevan.
// ═══════════════════════════════════════════════════════════════════════════════
window.COMPRAS = (function () {
  'use strict';

  var COL = 'compras';
  var CAT_COL = 'insumos_catalogo';
  var _porProveedor = {}; // { [proveedorId]: compra[] }
  var _catalogo = null;   // insumos_catalogo cacheado

  function claveItem(it) {
    return (it.tipo === 'ARTICULO' && it.catalogoId)
      ? 'A:' + it.catalogoId
      : 'S:' + String(it.nombre || '').trim().toUpperCase();
  }

  async function porProveedor(db, proveedorId, force) {
    if (!force && _porProveedor[proveedorId]) return _porProveedor[proveedorId];
    const snap = await db.collection(COL).where('proveedorId', '==', proveedorId).get();
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    _porProveedor[proveedorId] = lista;
    return lista;
  }

  function invalidar(proveedorId) { delete _porProveedor[proveedorId]; }

  // Borra en cascada todas las compras de un proveedor (se usa al eliminar el
  // proveedor, para no dejar historial huérfano). Trocea en bloques de 450
  // (límite de un batch de Firestore), igual criterio que insumos.html.
  async function eliminarPorProveedor(db, proveedorId) {
    const lista = await porProveedor(db, proveedorId, true);
    if (!lista.length) return 0;
    let batch = db.batch(), n = 0;
    for (const c of lista) {
      batch.delete(db.collection(COL).doc(c.id));
      n++;
      if (n % 450 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    invalidar(proveedorId);
    return lista.length;
  }

  // Indicadores de consulta rápida (Vista rápida y Detalles comparten esta forma).
  function indicadores(compras) {
    const claves = new Set();
    let montoTotal = 0, ultimaCompra = '';
    compras.forEach(c => {
      montoTotal += Number(c.total || 0);
      if (String(c.fecha || '') > ultimaCompra) ultimaCompra = c.fecha || '';
      (c.items || []).forEach(it => claves.add(claveItem(it)));
    });
    return {
      productosDistintos: claves.size,
      comprasRealizadas: compras.length,
      ultimaCompra,
      montoTotal,
    };
  }

  // Ítems más frecuentes (por defecto los 5 con más compras registradas).
  function topProductos(compras, top) {
    top = top || 5;
    const mapa = {};
    compras.forEach(c => {
      (c.items || []).forEach(it => {
        const k = claveItem(it);
        const precio = Number(it.precioUnitario || 0);
        const e = mapa[k] || { nombre: it.nombre, tipo: it.tipo, veces: 0, ultimoPrecio: 0, ultimaCompra: '', precioMinimo: precio };
        e.veces += 1;
        if (String(c.fecha || '') >= e.ultimaCompra) {
          e.ultimaCompra = c.fecha || '';
          e.ultimoPrecio = precio;
        }
        if (precio < e.precioMinimo) e.precioMinimo = precio;
        mapa[k] = e;
      });
    });
    return Object.values(mapa).sort((a, b) => b.veces - a.veces).slice(0, top);
  }

  async function crear(db, data) {
    const items = (data.items || []).map(it => {
      const tipo = it.tipo === 'ARTICULO' ? 'ARTICULO' : 'SERVICIO';
      const cantidad = Number(it.cantidad || 0);
      const precioUnitario = Number(it.precioUnitario || 0);
      return {
        tipo,
        catalogoId: tipo === 'ARTICULO' ? (it.catalogoId || null) : null,
        nombre: String(it.nombre || '').trim(),
        cantidad,
        precioUnitario,
        subtotal: cantidad * precioUnitario,
      };
    });
    const total = items.reduce((s, it) => s + it.subtotal, 0);
    const doc = {
      proveedorId: data.proveedorId,
      proveedorRazonSocial: data.proveedorRazonSocial || '',
      fecha: data.fecha,
      numeroComprobante: data.numeroComprobante || '',
      items,
      total,
      origen: 'PROVEEDORES',
      createdAt: new Date().toISOString(),
      createdBy: data.createdBy || '',
    };
    const ref = await db.collection(COL).add(doc);
    invalidar(data.proveedorId);
    return { id: ref.id, ...doc };
  }

  // Catálogo de insumos (para el buscador de "artículo del catálogo" al registrar
  // una compra). Cacheado en memoria — se recarga solo si force===true.
  async function catalogo(db, force) {
    if (!force && _catalogo) return _catalogo;
    const snap = await db.collection(CAT_COL).get();
    _catalogo = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return _catalogo;
  }

  return { COL, claveItem, porProveedor, invalidar, eliminarPorProveedor, indicadores, topProductos, crear, catalogo };
})();
