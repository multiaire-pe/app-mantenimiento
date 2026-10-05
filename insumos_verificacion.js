// ─────────────────────────────────────────────────────────────────────────────
// Verificación de material por persona (Insumos › Por Persona)
//
// Checklist para validar en tienda lo que cada persona tiene asignado. Cada verificación
// se guarda como historial por persona. Un ítem que falta/está dañado NO toca el inventario:
// queda "Por validar" y el inventario cambia recién cuando se confirma desde la bandeja.
//
// Colecciones:
//   insumos_verificaciones/{id}            { persona, fechaIso, verificador, items[], extras[], resumen }
//   insumos_verificaciones_fotos/{id__inst} { verifId, instId, foto }   (foto de un ítem dañado)
// Se apoya en los globales de insumos.html: db, maUser, instanciasData, paquetesData, personalData,
// movimientosData, sedes, can(), toast(), closeModal(), escB(), escJ(), optHtml(), fotoSrc(),
// openFotoSrc(), compressFit(), sedeOpts(), renderAll().
// ─────────────────────────────────────────────────────────────────────────────

let verifData = [];          // verificaciones cargadas (más recientes primero)
let vfFotos = {};            // cache de fotos: `${verifId}__${instId}` → dataURL
let vfSes = null;            // sesión de verificación en curso
let vfBandejaSel = new Set();// pendientes seleccionados en la bandeja: `${verifId}|${instId}`

const VF_MOTIVOS = {
  DEVUELTO_OFICINA: '📦 Devuelto a oficina',
  CONSUMIDO: '🔚 Se acabó / consumido',
  OTRA_SEDE: '🏪 Lo dejó en otra tienda',
  NO_SABE: '❓ No sabe dónde está'
};
const VF_ESTADO_TXT = { OK: 'Lo tiene', FALTA: 'Falta', DANADO: 'Dañado' };

// ── estilos + modales (se inyectan una sola vez) ─────────────────────────────
function vfInit() {
  if (document.getElementById('vf-style')) return;
  const st = document.createElement('style');
  st.id = 'vf-style';
  st.textContent = `
  .vf-prog{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--muted2)}
  .vf-bar{flex:1;height:8px;border-radius:99px;background:var(--surface3,#e8ecf4);overflow:hidden}
  .vf-bar>i{display:block;height:100%;background:var(--green);width:0;transition:width .2s}
  .vf-group{font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 6px}
  .vf-row{border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--surface)}
  .vf-row.s-OK{border-color:var(--green-border);background:var(--green-bg)}
  .vf-row.s-FALTA{border-color:var(--red-border);background:var(--red-bg)}
  .vf-row.s-DANADO{border-color:var(--yellow-border);background:var(--yellow-bg)}
  .vf-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:13px}
  .vf-main code{font-family:var(--mono);font-size:10px;color:var(--muted2)}
  .vf-tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;background:var(--yellow-bg);color:var(--yellow);border:1px solid var(--yellow-border)}
  .vf-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .vf-b{min-height:44px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);font-size:13px;font-weight:600;cursor:pointer;touch-action:manipulation;font-family:var(--font)}
  .vf-b.on.ok{background:var(--green);border-color:var(--green);color:#fff}
  .vf-b.on.falta{background:var(--red);border-color:var(--red);color:#fff}
  .vf-b.on.danado{background:var(--yellow);border-color:var(--yellow);color:#fff}
  .vf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .vf-chip{min-height:40px;padding:6px 10px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;touch-action:manipulation;font-family:var(--font)}
  .vf-chip.on{background:#1B3F8B;border-color:#1B3F8B;color:#fff}
  .vf-sub{margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .vf-sub input[type=text],.vf-sub select{flex:1;min-width:140px;font-size:12px}
  .vf-foto{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in}
  .vf-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);flex-shrink:0}
  .vf-card{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--surface)}
  .vf-card-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between}
  .vf-det{margin-top:8px;font-size:12px;border-top:1px dashed var(--border);padding-top:8px;display:none}
  .vf-det.open{display:block}
  .vf-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid var(--border)}
  .vf-pill.ok{background:var(--green-bg);color:var(--green);border-color:var(--green-border)}
  .vf-pill.falta{background:var(--red-bg);color:var(--red);border-color:var(--red-border)}
  .vf-pill.danado{background:var(--yellow-bg);color:var(--yellow);border-color:var(--yellow-border)}
  .vf-pend{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--surface)}
  .vf-pend input[type=checkbox]{width:20px;height:20px;margin-top:2px;flex-shrink:0}
  .vf-pend-b{flex:1;min-width:0;font-size:12px}
  .vf-pend-act{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  .vf-pend-act .btn{min-height:38px}
  `;
  document.head.appendChild(st);
  ['modal-vf-check', 'modal-vf-hist', 'modal-vf-bandeja'].forEach(id => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = id;
    ov.innerHTML = `<div class="modal" style="max-width:640px;display:flex;flex-direction:column;max-height:92vh">
      <div class="modal-header" style="flex-shrink:0">
        <div class="modal-title" id="${id}-title"></div>
        <div class="modal-close" onclick="closeModal('${id}')">✕</div>
      </div>
      <div id="${id}-body" style="overflow-y:auto;flex:1;min-height:0"></div>
      <div id="${id}-foot" class="vf-foot"></div>
    </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(id); });
    document.body.appendChild(ov);
  });
}

// ── carga ────────────────────────────────────────────────────────────────────
async function vfCargar() {
  try {
    const s = await db.collection('insumos_verificaciones').orderBy('fechaIso', 'desc').limit(400).get();
    verifData = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Colección aún sin reglas desplegadas / sin permiso: el resto de Insumos sigue funcionando.
    verifData = [];
    console.warn('[verificación] no se pudo cargar el historial:', e.message);
  }
  vfActualizarBadge();
}

function vfPuedeVerificar() { return !!(can('transferencia') || can('salida')); }

// ── helpers de datos ─────────────────────────────────────────────────────────
// Material que la persona tiene asignado: sueltas a su nombre + todo lo que va en sus paquetes
function vfItemsPersona(tec) {
  const pkgs = paquetesData.filter(p => p.responsable === tec);
  const pkgIds = new Set(pkgs.map(p => p.id));
  return instanciasData.filter(i => i.estado !== 'BAJA' && ((i.responsable === tec && !i.paqueteId) || (i.paqueteId && pkgIds.has(i.paqueteId))))
    .sort((a, b) => (a.paqueteId ? 0 : 1) - (b.paqueteId ? 0 : 1) || String(a.paqueteId || '').localeCompare(String(b.paqueteId || '')) || String(a.nombre).localeCompare(String(b.nombre)) || String(a.id).localeCompare(String(b.id)));   // paquetes primero, material suelto al final
}

// Faltantes/dañados todavía sin resolver (de todas las verificaciones)
function vfPendientes(persona) {
  const out = [];
  verifData.forEach(v => {
    if (persona && v.persona !== persona) return;
    (v.items || []).forEach(it => {
      if ((it.estado === 'FALTA' || it.estado === 'DANADO') && !it.resolucion) out.push({ v, it });
    });
  });
  return out;
}

function vfActualizarBadge() {
  const n = vfPendientes().length;
  const b = document.getElementById('vf-badge');
  if (b) { b.textContent = n || ''; b.style.display = n ? 'inline-block' : 'none'; }
}

function vfFecha(iso) { try { return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso || ''; } }
function vfFechaCorta(iso) { try { return new Date(iso).toLocaleDateString('es-PE'); } catch (e) { return iso || ''; } }

// Botones que se inyectan en el detalle de una persona (renderTecnicoDetalle)
function vfBotonesPersona(tec) {
  const n = verifData.filter(v => v.persona === tec).length;
  const np = vfPendientes(tec).length;
  const t = escJ(tec);
  return (vfPuedeVerificar() ? `<button class="btn btn-sm btn-green" onclick="vfAbrir('${t}')" title="Abrir el checklist para validar el material en tienda">✅ Verificar material</button>` : '')
    + `<button class="btn btn-sm" onclick="vfHistorial('${t}')" title="Verificaciones anteriores de esta persona">🗂 Historial (${n})</button>`
    + (np ? `<button class="btn btn-sm" style="color:var(--yellow);border-color:var(--yellow-border)" onclick="vfBandeja('${t}')">⏳ Por validar (${np})</button>` : '');
}

// ── CHECKLIST ────────────────────────────────────────────────────────────────
const vfDraftKey = tec => 'vf_draft_' + tec;
function vfGuardarBorrador() {
  if (!vfSes) return;
  try {
    const d = { items: {}, extras: vfSes.extras };
    vfSes.items.forEach(x => { if (x.estado) d.items[x.instId] = { estado: x.estado, motivo: x.motivo || null, sedeDestino: x.sedeDestino || '', nota: x.nota || '' }; });
    localStorage.setItem(vfDraftKey(vfSes.persona), JSON.stringify(d));
  } catch (e) { /* sin localStorage: el borrador es solo una comodidad */ }
}

function vfAbrir(tec) {
  if (!vfPuedeVerificar()) { toast('Sin permisos', 'err'); return; }
  vfInit();
  const insts = vfItemsPersona(tec);
  if (!insts.length) { toast('Esta persona no tiene material asignado', 'warn'); return; }
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(vfDraftKey(tec)) || 'null'); } catch (e) { draft = null; }
  const pend = {};
  vfPendientes(tec).forEach(p => { pend[p.it.instId] = p; });
  vfSes = {
    persona: tec, extras: (draft && draft.extras) || [],
    items: insts.map(i => {
      const d = (draft && draft.items && draft.items[i.id]) || {};
      return {
        instId: i.id, nombre: i.nombre || '', paqueteId: i.paqueteId || '', nivel: i.nivel != null ? i.nivel : null,
        estado: d.estado || null, motivo: d.motivo || null, sedeDestino: d.sedeDestino || '', nota: d.nota || '', foto: null,
        pendiente: pend[i.id] ? { fechaIso: pend[i.id].v.fechaIso, estado: pend[i.id].it.estado, motivo: pend[i.id].it.motivo } : null
      };
    })
  };
  document.getElementById('modal-vf-check-title').textContent = '✅ Verificar material — ' + tec;
  vfRender();
  document.getElementById('modal-vf-check').classList.add('open');
  if (draft && Object.keys(draft.items || {}).length) toast('Se recuperó tu borrador sin terminar (las fotos no se guardan en el borrador)', 'warn');
}

function vfStats() {
  const c = { OK: 0, FALTA: 0, DANADO: 0, SIN: 0 };
  vfSes.items.forEach(x => { c[x.estado || 'SIN']++; });
  return c;
}

function vfRender() {
  if (!vfSes) return;
  const c = vfStats();
  const total = vfSes.items.length;
  const hechos = total - c.SIN;
  let h = `<div class="vf-prog"><span>${hechos}/${total} verificados</span><div class="vf-bar"><i style="width:${total ? Math.round(hechos / total * 100) : 0}%"></i></div>
    <span style="color:var(--red)">${c.FALTA ? '❌ ' + c.FALTA : ''}</span><span style="color:var(--yellow)">${c.DANADO ? '⚠️ ' + c.DANADO : ''}</span></div>`;
  let grupo = null;
  vfSes.items.forEach((x, i) => {
    const g = x.paqueteId || '';
    if (g !== grupo) {
      grupo = g;
      const pkg = g ? paquetesData.find(p => p.id === g) : null;
      h += `<div class="vf-group">${g ? '🎒 ' + escB(g) + (pkg && pkg.nombre ? ' · ' + escB(pkg.nombre) : '') : '🏷️ Material suelto'}</div>`;
    }
    h += vfRowHtml(x, i);
  });
  h += `<div class="vf-group">➕ Tiene algo que no figura en el sistema</div>`;
  h += vfSes.extras.map((e, k) => `<div class="vf-row"><div class="vf-sub"><input type="text" class="form-input" placeholder="Nombre / descripción" value="${escB(e.nombre)}" oninput="vfSes.extras[${k}].nombre=this.value;vfGuardarBorrador()"><input type="text" class="form-input" placeholder="Nota (opcional)" value="${escB(e.nota || '')}" oninput="vfSes.extras[${k}].nota=this.value;vfGuardarBorrador()"><button class="btn btn-sm btn-red" onclick="vfSes.extras.splice(${k},1);vfGuardarBorrador();vfRender()">🗑</button></div></div>`).join('');
  h += `<button class="btn btn-sm" onclick="vfSes.extras.push({nombre:'',nota:''});vfRender()">＋ Agregar</button>`;
  document.getElementById('modal-vf-check-body').innerHTML = h;
  document.getElementById('modal-vf-check-foot').innerHTML =
    `<button class="btn btn-sm" onclick="vfTodoOk()">✅ Marcar lo que falta como OK</button>
     <button class="btn btn-sm" onclick="vfPdfChecklist()">⬇ PDF checklist</button>
     <span style="flex:1"></span>
     <button class="btn btn-sm btn-primary" id="btn-vf-cerrar" onclick="vfCerrar()">💾 Cerrar y guardar</button>`;
}

function vfRowHtml(x, i) {
  const s = x.estado || '';
  let h = `<div class="vf-row${s ? ' s-' + s : ''}" id="vf-r-${i}"><div class="vf-main"><b>${escB(x.nombre)}</b><code>${escB(x.instId)}</code>${x.nivel != null ? `<span style="font-size:11px;color:var(--muted2)">nivel ${x.nivel}%</span>` : ''}${x.pendiente ? `<span class="vf-tag" title="Quedó pendiente en la verificación anterior">⏳ pendiente desde ${vfFechaCorta(x.pendiente.fechaIso)}${x.pendiente.motivo ? ' · ' + escB((VF_MOTIVOS[x.pendiente.motivo] || '').replace(/^\S+\s/, '')) : ''}</span>` : ''}</div>
    <div class="vf-btns">
      <button class="vf-b ok${s === 'OK' ? ' on' : ''}" onclick="vfSet(${i},'OK')">✅ Lo tiene</button>
      <button class="vf-b falta${s === 'FALTA' ? ' on' : ''}" onclick="vfSet(${i},'FALTA')">❌ Falta</button>
      <button class="vf-b danado${s === 'DANADO' ? ' on' : ''}" onclick="vfSet(${i},'DANADO')">⚠️ Dañado</button>
    </div>`;
  if (s === 'FALTA') {
    h += `<div class="vf-chips">${Object.entries(VF_MOTIVOS).map(([k, l]) => `<button class="vf-chip${x.motivo === k ? ' on' : ''}" onclick="vfMotivo(${i},'${k}')">${l}</button>`).join('')}</div>`;
    if (x.motivo === 'OTRA_SEDE') h += `<div class="vf-sub"><select class="form-select" onchange="vfSes.items[${i}].sedeDestino=this.value;vfGuardarBorrador()">${sedeOpts(false).replace(`value="${escB(x.sedeDestino)}"`, `value="${escB(x.sedeDestino)}" selected`)}</select></div>`;
  }
  if (s === 'FALTA' || s === 'DANADO') {
    h += `<div class="vf-sub"><input type="text" class="form-input" placeholder="Nota (opcional)" value="${escB(x.nota)}" oninput="vfSes.items[${i}].nota=this.value;vfGuardarBorrador()">`;
    if (s === 'DANADO') {
      h += x.foto ? `<img class="vf-foto" src="${fotoSrc(x.foto)}" onclick="openFotoSrc(vfSes.items[${i}].foto)" alt=""><button class="btn btn-sm" onclick="vfSes.items[${i}].foto=null;vfRender()">🗑</button>`
        : `<label class="btn btn-sm" style="cursor:pointer">📷 Foto<input type="file" accept="image/*" capture="environment" style="display:none" onchange="vfFoto(${i},this.files[0])"></label>`;
    }
    h += `</div>`;
  }
  return h + '</div>';
}

function vfSet(i, estado) {
  const x = vfSes.items[i];
  x.estado = x.estado === estado ? null : estado;   // tocar de nuevo = desmarcar
  if (x.estado !== 'FALTA') { x.motivo = null; x.sedeDestino = ''; }
  if (x.estado !== 'DANADO') x.foto = null;
  if (!x.estado || x.estado === 'OK') x.nota = '';
  vfGuardarBorrador(); vfRender();
}
function vfMotivo(i, m) { const x = vfSes.items[i]; x.motivo = x.motivo === m ? null : m; if (x.motivo !== 'OTRA_SEDE') x.sedeDestino = ''; vfGuardarBorrador(); vfRender(); }
async function vfFoto(i, file) {
  if (!file) return;
  try { vfSes.items[i].foto = await compressFit(file, 1100, 0.7); vfRender(); }
  catch (e) { toast('Error con la imagen: ' + e.message, 'err'); }
}
function vfTodoOk() { vfSes.items.forEach(x => { if (!x.estado) x.estado = 'OK'; }); vfGuardarBorrador(); vfRender(); }

async function vfCerrar() {
  if (!vfSes) return;
  const btn = document.getElementById('btn-vf-cerrar');
  if (btn && btn.disabled) return;
  const c = vfStats();
  const sinMotivo = vfSes.items.filter(x => x.estado === 'FALTA' && !x.motivo).length;
  if (sinMotivo && !confirm(`${sinMotivo} faltante(s) sin motivo. Quedarán como "por validar" sin motivo.\n¿Guardar igual?`)) return;
  const sinSede = vfSes.items.filter(x => x.estado === 'FALTA' && x.motivo === 'OTRA_SEDE' && !x.sedeDestino).length;
  if (sinSede) { toast('Elige la tienda en los ítems "dejó en otra tienda"', 'err'); return; }
  if (c.SIN && !confirm(`${c.SIN} ítem(s) sin verificar. Quedarán registrados como "no verificado".\n¿Guardar igual?`)) return;
  if (btn) { btn.disabled = true; btn._o = btn.textContent; btn.textContent = '⏳ Guardando...'; }
  try {
    const fechaIso = new Date().toISOString();
    const items = vfSes.items.map(x => {
      const o = { instId: x.instId, nombre: x.nombre, paqueteId: x.paqueteId, estado: x.estado || 'SIN' };
      if (x.nivel != null) o.nivel = x.nivel;
      if (x.estado === 'FALTA') { o.motivo = x.motivo || null; if (x.sedeDestino) o.sedeDestino = x.sedeDestino; }
      if (x.nota && x.estado !== 'OK') o.nota = x.nota;
      if (x.foto) o.tieneFoto = true;
      return o;
    });
    const extras = vfSes.extras.filter(e => String(e.nombre || '').trim()).map(e => ({ nombre: e.nombre.trim(), nota: (e.nota || '').trim() }));
    const doc = {
      persona: vfSes.persona, fechaIso, verificador: maUser.email, items, extras,
      resumen: { total: items.length, ok: c.OK, falta: c.FALTA, danado: c.DANADO, sin: c.SIN }
    };
    const ref = db.collection('insumos_verificaciones').doc();
    const batch = db.batch();
    batch.set(ref, doc);
    // Pendientes anteriores que ahora aparecen OK → se cierran solos (sin tocar el inventario)
    const okAhora = new Set(items.filter(x => x.estado === 'OK').map(x => x.instId));
    const actualizados = [];
    verifData.filter(v => v.persona === vfSes.persona).forEach(v => {
      let cambio = false;
      const nuevos = (v.items || []).map(it => {
        if ((it.estado === 'FALTA' || it.estado === 'DANADO') && !it.resolucion && okAhora.has(it.instId)) {
          cambio = true;
          return { ...it, resolucion: { tipo: 'DESCARTADO', nota: 'Verificado OK en una revisión posterior', fechaIso, usuario: maUser.email } };
        }
        return it;
      });
      if (cambio) { batch.update(db.collection('insumos_verificaciones').doc(v.id), { items: nuevos }); actualizados.push({ v, nuevos }); }
    });
    await batch.commit();
    actualizados.forEach(a => { a.v.items = a.nuevos; });
    verifData.unshift({ id: ref.id, ...doc });
    // Fotos de dañados (un doc por foto: no se acerca al límite de 1 MB)
    let fallaFoto = 0;
    for (const x of vfSes.items) {
      if (!x.foto) continue;
      const key = `${ref.id}__${x.instId}`;
      try {
        await db.collection('insumos_verificaciones_fotos').doc(key).set({ verifId: ref.id, instId: x.instId, foto: x.foto, createdAt: fechaIso, createdBy: maUser.email });
        vfFotos[key] = x.foto;
      } catch (e) { fallaFoto++; }
    }
    try { localStorage.removeItem(vfDraftKey(vfSes.persona)); } catch (e) { }
    const nPend = items.filter(x => x.estado === 'FALTA' || x.estado === 'DANADO').length;
    toast(`✓ Verificación guardada${nPend ? ` — ${nPend} por validar` : ''}${fallaFoto ? ` (${fallaFoto} foto(s) no se pudieron guardar)` : ''}`, fallaFoto ? 'warn' : 'ok');
    closeModal('modal-vf-check');
    vfSes = null;
    vfActualizarBadge();
    renderAll();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn._o || '💾 Cerrar y guardar'; }
  }
}

// ── HISTORIAL ────────────────────────────────────────────────────────────────
function vfResolTxt(it) {
  if (!it.resolucion) return (it.estado === 'FALTA' || it.estado === 'DANADO') ? '⏳ por validar' : '';
  const r = it.resolucion;
  return (r.tipo === 'CONFIRMADO' ? '✔ confirmado' : '✖ descartado') + (r.accion ? ' (' + r.accion + ')' : '') + ' el ' + vfFechaCorta(r.fechaIso) + (r.nota ? ' · ' + r.nota : '');
}

function vfHistorial(tec) {
  vfInit();
  const lista = verifData.filter(v => v.persona === tec);
  document.getElementById('modal-vf-hist-title').textContent = '🗂 Historial — ' + tec;
  let h = '';
  if (!lista.length) h = '<div class="empty"><div class="empty-icon">🗂</div>Aún no hay verificaciones de esta persona</div>';
  lista.forEach((v, k) => {
    const r = v.resumen || {};
    const malos = (v.items || []).filter(it => it.estado === 'FALTA' || it.estado === 'DANADO' || it.estado === 'SIN');
    h += `<div class="vf-card"><div class="vf-card-h"><div><b>${vfFecha(v.fechaIso)}</b><div style="font-size:11px;color:var(--muted2)">por ${escB(v.verificador || '—')}</div></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap"><span class="vf-pill ok">✅ ${r.ok || 0}</span>${r.falta ? `<span class="vf-pill falta">❌ ${r.falta}</span>` : ''}${r.danado ? `<span class="vf-pill danado">⚠️ ${r.danado}</span>` : ''}${r.sin ? `<span class="vf-pill">sin verificar ${r.sin}</span>` : ''}</div></div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-sm" onclick="document.getElementById('vf-det-${k}').classList.toggle('open')">Ver detalle</button><button class="btn btn-sm" onclick="vfPdfVerif('${escJ(v.id)}')">⬇ PDF</button></div>
      <div class="vf-det" id="vf-det-${k}">`;
    if (!malos.length) h += '<div style="color:var(--green)">Todo en orden: sin faltantes ni dañados.</div>';
    malos.forEach(it => {
      h += `<div style="margin-bottom:6px"><b>${escB(it.nombre)}</b> <code style="font-size:10px">${escB(it.instId)}</code> — ${it.estado === 'SIN' ? 'no verificado' : VF_ESTADO_TXT[it.estado]}${it.motivo ? ' · ' + escB((VF_MOTIVOS[it.motivo] || '').replace(/^\S+\s/, '')) : ''}${it.sedeDestino ? ' → ' + escB(it.sedeDestino) : ''}${it.nota ? `<div style="color:var(--muted2)">“${escB(it.nota)}”</div>` : ''}
        <div style="color:var(--muted2);font-size:11px">${escB(vfResolTxt(it))}</div>${it.tieneFoto ? `<button class="btn btn-sm" onclick="vfVerFoto('${escJ(v.id)}','${escJ(it.instId)}')">📷 Ver foto</button>` : ''}</div>`;
    });
    if ((v.extras || []).length) h += `<div style="margin-top:6px"><b>Tenía y no figura:</b> ${v.extras.map(e => escB(e.nombre) + (e.nota ? ' (' + escB(e.nota) + ')' : '')).join(', ')}</div>`;
    h += '</div></div>';
  });
  document.getElementById('modal-vf-hist-body').innerHTML = h;
  document.getElementById('modal-vf-hist-foot').innerHTML = lista.length ? `<button class="btn btn-sm btn-primary" onclick="vfPdfHistorial('${escJ(tec)}')">⬇ PDF del historial completo</button>` : '';
  document.getElementById('modal-vf-hist').classList.add('open');
}

async function vfFotoDe(verifId, instId) {
  const key = `${verifId}__${instId}`;
  if (vfFotos[key]) return vfFotos[key];
  try {
    const d = await db.collection('insumos_verificaciones_fotos').doc(key).get();
    if (d.exists && d.data().foto) { vfFotos[key] = d.data().foto; return vfFotos[key]; }
  } catch (e) { }
  return null;
}
async function vfVerFoto(verifId, instId) {
  const f = await vfFotoDe(verifId, instId);
  if (f) openFotoSrc(f); else toast('Foto no disponible', 'warn');
}

// ── BANDEJA "POR VALIDAR" ────────────────────────────────────────────────────
function vfAccionTxt(p) {
  const { it } = p;
  if (it.estado === 'DANADO') return 'Marcar como deteriorado';
  if (it.motivo === 'DEVUELTO_OFICINA') return 'Confirmar: vuelve a OFICINA';
  if (it.motivo === 'OTRA_SEDE') return 'Confirmar: pasa a ' + (it.sedeDestino || 'otra sede');
  if (it.motivo === 'CONSUMIDO') return 'Confirmar: baja por consumo';
  if (it.motivo === 'NO_SABE') return 'Dar de baja por pérdida';
  return 'Dar de baja';
}
function vfAccionPermitida(p) {
  const m = p.it.motivo;
  if (p.it.estado === 'DANADO' || m === 'DEVUELTO_OFICINA' || m === 'OTRA_SEDE') return can('transferencia');
  return can('salida');
}

function vfBandeja(persona) {
  vfInit();
  const pend = vfPendientes(persona || null);
  document.getElementById('modal-vf-bandeja-title').textContent = '⏳ Por validar' + (persona ? ' — ' + persona : '');
  let h = '';
  if (!pend.length) h = '<div class="empty"><div class="empty-icon">✅</div>No hay nada por validar</div>';
  else {
    h += `<div style="font-size:12px;color:var(--muted2);margin-bottom:10px">Nada de esto ha cambiado todavía en el inventario. <b>Confirmar</b> aplica el cambio y deja el movimiento registrado; <b>Descartar</b> lo cierra sin tocar el inventario.</div>`;
    let ult = null;
    pend.forEach(p => {
      if (p.v.persona !== ult) { ult = p.v.persona; h += `<div class="vf-group">👤 ${escB(ult)}</div>`; }
      const key = `${p.v.id}|${p.it.instId}`;
      const inst = instanciasData.find(x => x.id === p.it.instId);
      h += `<div class="vf-pend"><input type="checkbox" ${vfBandejaSel.has(key) ? 'checked' : ''} onchange="vfSelPend('${escJ(key)}',this.checked)">
        <div class="vf-pend-b"><b>${escB(p.it.nombre)}</b> <code style="font-size:10px">${escB(p.it.instId)}</code>
        <div>${p.it.estado === 'DANADO' ? '<span class="vf-pill danado">⚠️ Dañado</span>' : '<span class="vf-pill falta">❌ Falta</span>'} ${p.it.motivo ? escB(VF_MOTIVOS[p.it.motivo] || '') : ''}${p.it.sedeDestino ? ' → ' + escB(p.it.sedeDestino) : ''}</div>
        ${p.it.nota ? `<div style="color:var(--muted2)">“${escB(p.it.nota)}”</div>` : ''}
        <div style="color:var(--muted2);font-size:11px">Reportado ${vfFecha(p.v.fechaIso)}${inst ? '' : ' · ⚠ la instancia ya no existe en el inventario'}</div>
        <div class="vf-pend-act">
          ${vfAccionPermitida(p) ? `<button class="btn btn-sm btn-primary" onclick="vfResolver('${escJ(key)}','CONFIRMAR')">${escB(inst ? vfAccionTxt(p) : 'Cerrar (ya no existe)')}</button><button class="btn btn-sm" onclick="vfResolver('${escJ(key)}','DESCARTAR')">Descartar</button>` : '<span style="color:var(--muted2)">Sin permiso para validar</span>'}
          ${p.it.tieneFoto ? `<button class="btn btn-sm" onclick="vfVerFoto('${escJ(p.v.id)}','${escJ(p.it.instId)}')">📷 Foto</button>` : ''}
        </div></div></div>`;
    });
  }
  document.getElementById('modal-vf-bandeja-body').innerHTML = h;
  document.getElementById('modal-vf-bandeja-foot').innerHTML = pend.length
    ? `<button class="btn btn-sm" onclick="vfSelTodos(${persona ? `'${escJ(persona)}'` : 'null'})">Seleccionar todos</button><span style="flex:1"></span><button class="btn btn-sm btn-primary" onclick="vfConfirmarSel(${persona ? `'${escJ(persona)}'` : 'null'})">Confirmar seleccionados</button>` : '';
  document.getElementById('modal-vf-bandeja').classList.add('open');
  window._vfBandejaPersona = persona || null;
}
function vfSelPend(key, on) { if (on) vfBandejaSel.add(key); else vfBandejaSel.delete(key); }
function vfSelTodos(persona) {
  vfPendientes(persona).forEach(p => vfBandejaSel.add(`${p.v.id}|${p.it.instId}`));
  vfBandeja(persona);
}
async function vfConfirmarSel(persona) {
  const keys = vfPendientes(persona).map(p => `${p.v.id}|${p.it.instId}`).filter(k => vfBandejaSel.has(k));
  if (!keys.length) { toast('Selecciona al menos uno', 'warn'); return; }
  if (!confirm(`¿Confirmar ${keys.length} pendiente(s)? Se aplicarán los cambios al inventario.`)) return;
  let ok = 0;
  for (const k of keys) { if (await vfAplicar(k, 'CONFIRMAR', true)) ok++; }
  vfBandejaSel.clear();
  toast(`✓ ${ok} de ${keys.length} confirmado(s)`, ok === keys.length ? 'ok' : 'warn');
  vfActualizarBadge(); renderAll(); vfBandeja(persona);
}
async function vfResolver(key, modo) {
  const p = vfBuscar(key);
  if (!p) return;
  if (modo === 'CONFIRMAR' && (p.it.motivo === 'NO_SABE' || p.it.motivo === 'CONSUMIDO') && instanciasData.some(x => x.id === p.it.instId)) {
    if (!confirm(`Se dará de baja "${p.it.nombre}" (${p.it.instId}) del inventario.\n¿Continuar?`)) return;
  }
  const ok = await vfAplicar(key, modo, false);
  if (ok) { vfBandejaSel.delete(key); vfActualizarBadge(); renderAll(); vfBandeja(window._vfBandejaPersona); }
}
function vfBuscar(key) {
  const [vid, iid] = key.split('|');
  const v = verifData.find(x => x.id === vid);
  const it = v && (v.items || []).find(x => x.instId === iid);
  return it ? { v, it } : null;
}

// Aplica (o descarta) UN pendiente: cambios en inventario + movimiento + resolución, todo en un batch.
async function vfAplicar(key, modo, silencioso) {
  const p = vfBuscar(key);
  if (!p) return false;
  const { v, it } = p;
  const inst = instanciasData.find(x => x.id === it.instId);
  const fechaIso = new Date().toISOString();
  const ts = fechaIso;
  const batch = db.batch();
  let accion = '', movLocal = null, instUpd = null, instDel = false, pkgUpd = null;
  try {
    if (modo === 'CONFIRMAR' && inst) {
      if (!vfAccionPermitida(p)) { toast('Sin permisos', 'err'); return false; }
      const base = { itemId: inst.itemId, itemNombre: inst.nombre, usuario: maUser.email, estado: 'CONFIRMADO', fecha: new Date(), responsable: v.persona };
      const movRef = db.collection('insumos_movimientos').doc();
      const instRef = db.collection('insumos_instancias').doc(inst.id);
      if (it.estado === 'DANADO') {
        accion = 'marcado deteriorado';
        instUpd = { estado: 'DETERIORADO', updatedAt: ts, updatedBy: maUser.email };
        if (it.nota) instUpd.notas = it.nota;
        const diffs = [{ campo: 'estado', de: inst.estado || 'DISPONIBLE', a: 'DETERIORADO' }];
        movLocal = { ...base, tipo: 'ACTUALIZACION', instanciaId: inst.id, sede: inst.sede, cambios: `Estado: ${diffs[0].de} → DETERIORADO (verificación de ${v.persona})`, diffsData: diffs };
        batch.update(instRef, instUpd);
        batch.set(movRef, movLocal);
      } else if (it.motivo === 'DEVUELTO_OFICINA' || it.motivo === 'OTRA_SEDE') {
        const oficina = it.motivo === 'DEVUELTO_OFICINA';
        const destino = oficina ? 'OFICINA' : it.sedeDestino;
        if (!destino) { toast('Falta la sede destino de ' + it.instId, 'err'); return false; }
        accion = oficina ? 'devuelto a OFICINA' : 'pasó a ' + destino;
        const campos = oficina ? ['sede', 'responsable'] : ['sede'];
        const snap = { id: inst.id, sede: inst.sede || '' };
        instUpd = { sede: destino, updatedAt: ts, updatedBy: maUser.email };
        if (oficina) { snap.responsable = inst.responsable || ''; instUpd.responsable = ''; }
        if (oficina && inst.paqueteId) {
          instUpd.paqueteId = null;
          const pkg = paquetesData.find(x => x.id === inst.paqueteId);
          if (pkg) { pkgUpd = { id: pkg.id, newInsts: (pkg.instancias || []).filter(x => x !== inst.id) }; batch.update(db.collection('insumos_paquetes').doc(pkg.id), { instancias: pkgUpd.newInsts, updatedAt: ts }); }
        }
        movLocal = { ...base, tipo: 'TRANSFERENCIA', instancias: [inst.id], instanciasSnapshot: [snap], camposTransferidos: campos, sedeDestino: destino, respDestino: '', cantidad: 1,
          cambios: `→ ${destino}${oficina ? ' | Resp → (sin responsable)' : ''}`, motivo: `Verificación de material — ${v.persona}: ${oficina ? 'devuelto a oficina' : 'lo dejó en otra tienda'}` };
        batch.update(instRef, instUpd);
        batch.set(movRef, movLocal);
      } else {
        const motivoTxt = it.motivo === 'CONSUMIDO' ? 'Consumido / se acabó' : (it.motivo === 'NO_SABE' ? 'Pérdida (no se sabe dónde está)' : 'Faltante');
        accion = 'baja: ' + motivoTxt.toLowerCase();
        instDel = true;
        if (inst.paqueteId) {
          const pkg = paquetesData.find(x => x.id === inst.paqueteId);
          if (pkg) { pkgUpd = { id: pkg.id, newInsts: (pkg.instancias || []).filter(x => x !== inst.id) }; batch.update(db.collection('insumos_paquetes').doc(pkg.id), { instancias: pkgUpd.newInsts, updatedAt: ts }); }
        }
        movLocal = { ...base, tipo: 'BAJA', instancias: [inst.id], instanciasSnapshot: [{ ...inst }], instanciaId: inst.id, sede: inst.sede || '', cantidad: 1, unidad: 'UND',
          motivo: `Verificación de material — ${v.persona}: ${motivoTxt}${it.nota ? ' (' + it.nota + ')' : ''}` };
        batch.delete(instRef);
        batch.set(movRef, movLocal);
      }
      if (movLocal) movLocal._ref = movRef;
    }
    const resolucion = modo === 'CONFIRMAR'
      ? { tipo: 'CONFIRMADO', accion: inst ? accion : 'la instancia ya no existía', fechaIso, usuario: maUser.email }
      : { tipo: 'DESCARTADO', fechaIso, usuario: maUser.email };
    const nuevos = (v.items || []).map(x => x.instId === it.instId ? { ...x, resolucion } : x);
    batch.update(db.collection('insumos_verificaciones').doc(v.id), { items: nuevos });
    await batch.commit();
    // memoria
    v.items = nuevos;
    if (instUpd) { const ix = instanciasData.findIndex(x => x.id === it.instId); if (ix >= 0) Object.assign(instanciasData[ix], instUpd); }
    if (instDel) instanciasData = instanciasData.filter(x => x.id !== it.instId);
    if (pkgUpd) { const px = paquetesData.findIndex(x => x.id === pkgUpd.id); if (px >= 0) paquetesData[px].instancias = pkgUpd.newInsts; }
    if (movLocal) { const { _ref, ...m } = movLocal; movimientosData.unshift({ id: _ref.id, ...m }); }
    if (!silencioso) toast(modo === 'CONFIRMAR' ? `✓ ${it.instId}: ${accion || 'cerrado'}` : '✓ Descartado', 'ok');
    return true;
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    return false;
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
// Texto compatible con la fuente base de jsPDF (sin emoji / símbolos fuera de Latin-1)
const vfTxt = s => String(s == null ? '' : s).replace(/[^\x20-\x7E -ÿ]/g, '').replace(/\s+/g, ' ').trim();

function vfPdfNuevo(titulo, sub) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const ctx = { pdf, y: 0, W: 210, H: 297, M: 12 };
  ctx.cabecera = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(27, 63, 139);
    pdf.text(vfTxt(titulo), ctx.M, 16);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 90, 90);
    pdf.text(vfTxt(sub), ctx.M, 22);
    ctx.y = 28;
  };
  ctx.pie = () => {
    const n = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120); pdf.text('MultiAire · Insumos · ' + new Date().toLocaleString('es-PE') + ' · pág. ' + i + '/' + n, ctx.M, ctx.H - 6); }
  };
  ctx.salto = (h) => { if (ctx.y + h > ctx.H - 14) { pdf.addPage(); ctx.cabecera(); } };
  ctx.cabecera();
  return ctx;
}
function vfCaja(pdf, x, y, marcada) {
  pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.3); pdf.rect(x, y, 4, 4);
  if (marcada) { pdf.setLineWidth(0.6); pdf.line(x + 0.7, y + 0.7, x + 3.3, y + 3.3); pdf.line(x + 3.3, y + 0.7, x + 0.7, y + 3.3); }
}
const vfSlug = s => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'X';

// Checklist actual (sesión abierta): sirve impreso (cajas vacías) o con lo ya marcado
function vfPdfChecklist() {
  if (!vfSes) return;
  const c = vfStats();
  const ctx = vfPdfNuevo('Checklist de material — ' + vfSes.persona, `${vfSes.items.length} ítems · ${new Date().toLocaleDateString('es-PE')} · verifica: ${maUser.email}`);
  const { pdf, M } = ctx;
  const xTiene = 118, xFalta = 140, xDan = 162;
  const cab = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(60, 60, 60);
    pdf.text('ÍTEM / CÓDIGO', M, ctx.y); pdf.text('TIENE', xTiene - 1, ctx.y); pdf.text('FALTA', xFalta - 1, ctx.y); pdf.text('DAÑADO', xDan - 2, ctx.y); pdf.text('NOTA', 185, ctx.y);
    pdf.setDrawColor(150); pdf.line(M, ctx.y + 1.5, ctx.W - M, ctx.y + 1.5); ctx.y += 6;
  };
  cab();
  let grupo = null;
  vfSes.items.forEach(x => {
    if ((x.paqueteId || '') !== grupo) {
      grupo = x.paqueteId || '';
      ctx.salto(14);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(27, 63, 139);
      pdf.text(grupo ? 'Paquete ' + vfTxt(grupo) : 'Material suelto', M, ctx.y + 1); ctx.y += 6;
    }
    ctx.salto(9);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(20, 20, 20);
    pdf.text(vfTxt(x.nombre).slice(0, 48), M, ctx.y + 3);
    pdf.setFontSize(7); pdf.setTextColor(110, 110, 110); pdf.text(vfTxt(x.instId), M, ctx.y + 6.2);
    vfCaja(pdf, xTiene, ctx.y, x.estado === 'OK'); vfCaja(pdf, xFalta, ctx.y, x.estado === 'FALTA'); vfCaja(pdf, xDan, ctx.y, x.estado === 'DANADO');
    const nota = [x.estado === 'FALTA' && x.motivo ? (VF_MOTIVOS[x.motivo] || '').replace(/^\S+\s/, '') : '', x.nota].filter(Boolean).join(': ');
    if (nota) { pdf.setFontSize(7); pdf.setTextColor(90, 90, 90); pdf.text(vfTxt(nota).slice(0, 38), xDan + 8, ctx.y + 3, { maxWidth: 28 }); }
    pdf.setDrawColor(225); pdf.line(M, ctx.y + 7.5, ctx.W - M, ctx.y + 7.5);
    ctx.y += 9;
  });
  if (vfSes.extras.length) {
    ctx.salto(14); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(27, 63, 139);
    pdf.text('Tiene y no figura en el sistema', M, ctx.y + 1); ctx.y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(20, 20, 20);
    vfSes.extras.forEach(e => { ctx.salto(6); pdf.text('- ' + vfTxt(e.nombre) + (e.nota ? ' (' + vfTxt(e.nota) + ')' : ''), M, ctx.y + 2); ctx.y += 5; });
  }
  ctx.pie();
  pdf.save('checklist_' + vfSlug(vfSes.persona) + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
  toast('✓ PDF descargado', 'ok');
}

async function vfPdfEscribirVerif(ctx, v, conFotos) {
  const { pdf, M } = ctx;
  const r = v.resumen || {};
  ctx.salto(22);
  pdf.setFillColor(240, 242, 250); pdf.rect(M, ctx.y - 3, ctx.W - 2 * M, 12, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(27, 63, 139);
  pdf.text(vfTxt(vfFecha(v.fechaIso)) + '  -  ' + vfTxt(v.verificador || ''), M + 2, ctx.y + 2);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(60, 60, 60);
  pdf.text(`OK: ${r.ok || 0}   Faltan: ${r.falta || 0}   Dañados: ${r.danado || 0}${r.sin ? '   Sin verificar: ' + r.sin : ''}`, M + 2, ctx.y + 7);
  ctx.y += 13;
  const malos = (v.items || []).filter(it => it.estado === 'FALTA' || it.estado === 'DANADO' || it.estado === 'SIN');
  if (!malos.length) { pdf.setTextColor(26, 158, 90); pdf.text('Todo en orden: sin faltantes ni dañados.', M + 2, ctx.y); ctx.y += 6; }
  for (const it of malos) {
    ctx.salto(14);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(20, 20, 20);
    pdf.text(vfTxt(it.nombre).slice(0, 55) + '  (' + vfTxt(it.instId) + ')', M + 2, ctx.y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
    const det = [it.estado === 'SIN' ? 'No verificado' : VF_ESTADO_TXT[it.estado], it.motivo ? (VF_MOTIVOS[it.motivo] || '').replace(/^\S+\s/, '') : '', it.sedeDestino ? '-> ' + it.sedeDestino : '', it.nota ? '"' + it.nota + '"' : ''].filter(Boolean).join(' · ');
    pdf.setTextColor(70, 70, 70); pdf.text(vfTxt(det), M + 2, ctx.y + 4.5, { maxWidth: ctx.W - 2 * M - 4 });
    pdf.setTextColor(120, 120, 120); pdf.text(vfTxt(vfResolTxt(it)), M + 2, ctx.y + 9, { maxWidth: ctx.W - 2 * M - 4 });
    ctx.y += 12;
    if (conFotos && it.tieneFoto) {
      const f = await vfFotoDe(v.id, it.instId);
      if (f) {
        ctx.salto(34);
        try { pdf.addImage(f, /^data:image\/png/.test(f) ? 'PNG' : 'JPEG', M + 2, ctx.y, 40, 30); ctx.y += 33; } catch (e) { }
      }
    }
  }
  if ((v.extras || []).length) {
    ctx.salto(8); pdf.setTextColor(60, 60, 60);
    pdf.text('Tenía y no figura: ' + v.extras.map(e => vfTxt(e.nombre) + (e.nota ? ' (' + vfTxt(e.nota) + ')' : '')).join(', '), M + 2, ctx.y, { maxWidth: ctx.W - 2 * M - 4 }); ctx.y += 7;
  }
  ctx.y += 4;
}

async function vfPdfVerif(id) {
  const v = verifData.find(x => x.id === id);
  if (!v) return;
  toast('Generando PDF…', 'ok');
  const ctx = vfPdfNuevo('Verificación de material — ' + v.persona, 'Registro del ' + vfFecha(v.fechaIso));
  await vfPdfEscribirVerif(ctx, v, true);
  ctx.pie();
  ctx.pdf.save('verificacion_' + vfSlug(v.persona) + '_' + String(v.fechaIso).slice(0, 10) + '.pdf');
}
async function vfPdfHistorial(tec) {
  const lista = verifData.filter(v => v.persona === tec);
  if (!lista.length) return;
  toast('Generando PDF…', 'ok');
  const ctx = vfPdfNuevo('Historial de verificaciones — ' + tec, `${lista.length} verificación(es) · emitido ${new Date().toLocaleDateString('es-PE')}`);
  for (const v of lista) await vfPdfEscribirVerif(ctx, v, true);
  ctx.pie();
  ctx.pdf.save('historial_verificaciones_' + vfSlug(tec) + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
}
