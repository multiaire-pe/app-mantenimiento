// Endpoint de la Mini App "Toma de parámetros" (Split, Fan coil/UMA, ventilación mecánica y cortinas de aire).
// La Mini App manda `Authorization: tma <Telegram.WebApp.initData>`; se valida la firma con el token del
// bot (TELEGRAM_BOT_TOKEN, ya configurado para el bot) y de ahí sale QUIÉN es el técnico: no hay login
// aparte. Escribe en `mtto_parametros` con Admin SDK (las reglas de Firestore no permiten escribir
// desde el navegador). La lógica está en _lib/parametros.js.
//
// POST /api/parametros   { accion: 'inicio' | 'equipos' | 'guardar', ... }
import { getDb } from './_lib/firestore.js';
import { identificarPorTelegram } from './_lib/identidad.js';
import { procesar, TIPOS, rangoPeriodo } from './_lib/parametros.js';
import { periodoEfectivo } from './_lib/mtto.js';

const CACHE_MS = 5 * 60 * 1000;
let _cache = null, _cacheAt = 0;

// Equipos del inventario que tienen formato de parámetros (ver FORMATOS). Se cachea 5 min: es la lista que la Mini App pide al
// abrir y al elegir sede, y no cambia con frecuencia.
async function equipos() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;
  const snap = await getDb().collection('inventario').where('tipo', 'in', TIPOS).get();
  _cache = snap.docs.map((doc) => {
    const x = doc.data();
    return {
      eqId: doc.id, nombre: x.nombre || '', tipo: x.tipo || '', cliente: x.cliente || '', sede: x.sede || '',
      area: x.area || '', marca: x.marca || '', modelo: x.modelo || '', serie: x.serie || '', capacidad: x.capacidad || '',
    };
  }).filter((e) => e.sede && e.nombre);
  _cacheAt = Date.now();
  return _cache;
}

// ── Tomas de un equipo en un período: las nuevas (traen `periodo`+`anio`) y las viejas de antes de esta regla (solo
// traen `fecha`, se reconocen por el rango del bimestre). Un solo criterio para listar y para no dejar duplicados. ──
const col = () => getDb().collection('mtto_parametros');
const docs = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

async function registros({ cliente, sede, periodo, anio }) {
  const nuevos = docs(await col().where('periodo', '==', periodo).where('anio', '==', Number(anio)).get());
  const rango = rangoPeriodo(periodo, anio);
  const viejos = rango ? docs(await col().where('fecha', '>=', rango.desde).where('fecha', '<=', rango.hasta).get()).filter((r) => !r.periodo) : [];
  return [...nuevos, ...viejos].filter((r) => r.cliente === cliente && r.sede === sede);
}

async function previos(eqId, periodo, anio) {
  const todos = docs(await col().where('eqId', '==', eqId).get());
  const rango = rangoPeriodo(periodo, anio);
  return todos.filter((r) => (r.periodo ? (r.periodo === periodo && Number(r.anio) === Number(anio)) : (rango && r.fecha >= rango.desde && r.fecha <= rango.hasta)));
}

// set() sobre el id determinístico: crea o ACTUALIZA. Los duplicados viejos del mismo equipo y período se borran en el mismo lote.
async function guardar(doc, borrarIds) {
  const db = getDb(), batch = db.batch();
  batch.set(col().doc(doc.id), doc);
  for (const id of borrarIds || []) batch.delete(col().doc(id));
  await batch.commit();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const h = req.headers.authorization || '';
  const initData = h.startsWith('tma ') ? h.slice(4) : '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Solicitud inválida.' });
  try {
    const r = await procesar(body, initData, {
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      ahora: () => Date.now(),
      identificar: identificarPorTelegram,
      equipos,
      crear,
    });
    return res.status(r.status).json(r.json);
  } catch (e) {
    console.error('[parametros] error:', e?.message);
    return res.status(500).json({ error: 'No se pudo procesar. Inténtalo de nuevo.' });
  }
}
