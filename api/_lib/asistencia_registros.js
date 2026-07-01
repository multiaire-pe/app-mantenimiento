// Escritura de marcajes en asistencia_registros (origen WHATSAPP).
// Replica EXACTAMENTE el upsert de asistencia_multiaire.html:
//   - 1 doc por (colabId, fecha); se localiza por query where fecha==fecha → find(colabId).
//   - ENTRADA crea el doc (o completa uno existente sin entrada); SALIDA hace set({...existing,horaSalida}).
//   - el doc guarda su propio `id`; heManual:false + horasExtra:null → la app calcula la HE.
// Extiende el doc con EVIDENCIA del bot (marcajeEntrada/marcajeSalida) y guarda la selfie en
// asistencia_registros_fotos (dataURL, colección aparte, igual criterio que las demás fotos).
import { getDb } from './firestore.js';
import { fmtDistancia } from './geo.js';

// Nota humana (columna Comentario de la app) SOLO cuando hay algo que revisar; si el marcaje
// es limpio (en el radio y en el plan), queda vacía como un registro normal.
function notaMarca(ubic, fueraDePlan) {
  const partes = [];
  if (fueraDePlan) partes.push('fuera de plan');
  if (ubic && ubic.valida === false) partes.push('sede sin coordenadas');
  else if (ubic && ubic.dentro === false && ubic.distancia != null) partes.push(`fuera de radio (${fmtDistancia(ubic.distancia)})`);
  return partes.length ? `WhatsApp · ⚠️ ${partes.join(' · ')}` : '';
}

// Objeto de evidencia de un marcaje (entrada o salida).
function evidencia({ sede, ubic, fueraDePlan, horaExacta, ts }) {
  return {
    sedeId: sede?.idTienda || sede?.id || '',
    sede: sede?.sede || sede?.tienda || '',
    cliente: sede?.cliente || '',
    lat: ubic?.lat ?? null,
    lng: ubic?.lng ?? null,
    distancia: ubic?.distancia ?? null,
    radio: ubic?.radio ?? null,
    dentroRadio: ubic?.dentro ?? null,
    geovalidada: ubic?.valida !== false,   // false si la sede no tenía coords
    fueraDePlan: !!fueraDePlan,
    hora: horaExacta || '',
    ts: ts || '',
  };
}

// LÓGICA PURA (testeable): a partir del registro existente (o null) construye el doc a escribir.
// Devuelve { data } o { error } con error ∈ ya_entrada | sin_entrada | ya_salida | salida_antes.
export function construirRegistro(existing, m) {
  const { tipo, tecnico, fecha, horaDecimal, horaExacta, ts, sede, ubic, fueraDePlan } = m;
  const ev = evidencia({ sede, ubic, fueraDePlan, horaExacta, ts });
  const nota = notaMarca(ubic, fueraDePlan);
  const autor = `wa:${tecnico?.id || 'desconocido'}`;

  if (tipo === 'ENTRADA') {
    if (existing && existing.horaEntrada != null) return { error: 'ya_entrada', existing };
    // Igual que la app (registrar ENTRADA): parte del existente pero FUERZA estado A + HE auto + obs
    // limpia. Así, si el día tenía un DM/Permiso/Falta, no arrastra su observación ni una HE manual.
    const data = {
      ...(existing || {}),
      colabId: tecnico.id,
      nombre: tecnico.nombre || existing?.nombre || '',
      cargo: tecnico.cargo || existing?.cargo || '',
      fecha,
      horaEntrada: horaDecimal,
      horaSalida: null,
      estado: 'A',
      observacion: nota || '',
      heManual: false,
      horasExtra: null,
      registradoPor: autor,
      timestamp: ts,
      origen: 'WHATSAPP',
      marcajeEntrada: ev,
    };
    delete data.marcajeSalida; // por si el existente traía una salida de otro contexto
    return { data };
  }

  // SALIDA
  if (!existing || existing.horaEntrada == null) return { error: 'sin_entrada' };
  if (existing.horaSalida != null) return { error: 'ya_salida' };
  if (horaDecimal <= existing.horaEntrada) return { error: 'salida_antes' };
  const data = {
    ...existing,
    horaSalida: horaDecimal,
    observacion: nota || existing.observacion || '',
    timestamp: ts,
    // `origen` a nivel de registro solo es WHATSAPP si la ENTRADA también fue del bot (hay marcajeEntrada).
    // Si la entrada fue por app y la salida por el bot, se respeta el origen de la entrada; la salida-por-bot
    // queda evidenciada por marcajeSalida (la vista usa la presencia del marcaje, no este campo grueso).
    origen: existing.marcajeEntrada ? 'WHATSAPP' : (existing.origen || 'APP'),
    marcajeSalida: ev,
  };
  return { data };
}

// Registro de asistencia del colaborador para una fecha (o null). Para autodetectar entrada/salida.
export async function registroDelDia(colabId, fecha, deps = {}) {
  const db = deps.db || getDb();
  const snap = await db.collection('asistencia_registros').where('fecha', '==', fecha).get();
  const regs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return regs.find((r) => r.colabId === colabId) || null;
}

// Escribe el marcaje en Firestore (upsert por colabId+fecha). `deps` inyectable para tests.
export async function registrarMarcaje(m, deps = {}) {
  const db = deps.db || getDb();
  const fecha = m.fecha;
  const snap = await db.collection('asistencia_registros').where('fecha', '==', fecha).get();
  const regs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const existing = regs.find((r) => r.colabId === m.tecnico.id) || null;

  const { data, error } = construirRegistro(existing, m);
  if (error) return { ok: false, error, existing };

  let regId;
  if (existing?.id) {
    // Ya hay registro del día (creado por la app o el bot) → se actualiza ESE doc, sea cual sea su id.
    regId = existing.id;
    await db.collection('asistencia_registros').doc(regId).set({ ...data, id: regId });
  } else {
    // Registro NUEVO: doc id DETERMINÍSTICO por colab+fecha. Así, dos escrituras concurrentes colisionan
    // en el MISMO doc en vez de crear dos. La app (asistencia_multiaire.html) usa EXACTAMENTE el mismo
    // esquema al crear, de modo que app y bot nunca duplican un registro del mismo colab+fecha.
    regId = `AST-${m.tecnico.id}-${fecha}`;
    await db.collection('asistencia_registros').doc(regId).set({ ...data, id: regId });
  }

  // Selfie (evidencia) en colección aparte, doc id = id del registro.
  if (m.selfie && m.selfie.base64) {
    const dataUrl = `data:${m.selfie.mime || 'image/jpeg'};base64,${m.selfie.base64}`;
    const campo = m.tipo === 'ENTRADA' ? 'fotoEntrada' : 'fotoSalida';
    await db.collection('asistencia_registros_fotos').doc(regId).set(
      { [campo]: dataUrl, registroId: regId, updatedAt: m.ts },
      { merge: true }
    );
  }

  return { ok: true, id: regId, registro: { ...data, id: regId } };
}
