// Inventario: el cliente de un equipo NO cambia al editarlo, y en una sede compartida entre clientes
// (Miraflores, Jockey Plaza) el cliente de un equipo nuevo se elige de forma explícita.
// Extrae el código REAL de inventario_multiaire.html. Uso: node tests/inventario_cliente.test.mjs
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../inventario_multiaire.html', import.meta.url), 'utf8');

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new Function(m[1]); ok++; } catch (e) { mal++; console.log('✗ script', i, e.message); } });

const bloque = (re) => html.match(re)?.[0];
const decl = bloque(/const sedeClientes=\{\};/);
const reg = bloque(/function registrarSedeCliente\(sede,cliente\)\{[\s\S]*?\n\}/);
const cds = bloque(/const clientesDeSede=[^\n]+/);
const res = bloque(/function resolverClienteGuardado\(\{[\s\S]*?\n\}(?=\r?\n)/);
t('existe el conjunto sede→clientes', !!decl && !!reg && !!cds);
t('existe resolverClienteGuardado', !!res);
const mod = new Function(`${decl}\n${reg}\n${cds}\n${res}\nreturn { sedeClientes, registrarSedeCliente, clientesDeSede, resolverClienteGuardado };`)();
const { registrarSedeCliente, clientesDeSede, resolverClienteGuardado } = mod;

// ── una sede puede tener varios clientes (el caso real: Miraflores) ──
// El orden de carga NO debe importar: antes ganaba el último y el equipo se iba a ese cliente.
for (const orden of [['RIPLEY', 'TOTTUS'], ['TOTTUS', 'RIPLEY']]) {
  orden.forEach((c) => registrarSedeCliente('MIRAFLORES', c));
  t(`Miraflores guarda los dos clientes (carga ${orden.join('→')})`, clientesDeSede('MIRAFLORES').join() === 'RIPLEY,TOTTUS', clientesDeSede('MIRAFLORES').join());
}
registrarSedeCliente('ATOCONGO', 'RIPLEY');
registrarSedeCliente('ATOCONGO', 'RIPLEY');   // repetido: no duplica
registrarSedeCliente('X', '-'); registrarSedeCliente('X', ''); registrarSedeCliente('', 'TOTTUS'); registrarSedeCliente(null, 'TOTTUS');
t('sede de un solo cliente', clientesDeSede('ATOCONGO').join() === 'RIPLEY');
t('"-", vacío o sin sede no cuentan como cliente', clientesDeSede('X').length === 0 && clientesDeSede('').length === 0);
t('sede desconocida → ninguno', clientesDeSede('NO EXISTE').length === 0);

// ── EL BUG: editar un equipo de Tottus en la sede compartida ──
const mir = clientesDeSede('MIRAFLORES');
const edit = resolverClienteGuardado({ editando: true, clienteEquipo: 'TOTTUS', clienteElegido: 'RIPLEY', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('EDITAR guarda lo que diga el selector (cambiarlo a mano es válido; guardar pide confirmación)', edit.ok && edit.cliente === 'RIPLEY', JSON.stringify(edit));
// …y lo que evita el bug original (el formulario arrastraba el cliente del filtro): al abrir la ficha el selector arranca
// con el cliente del equipo, y un valor viejo solo se respeta si el usuario lo tocó en ESTA edición.
t('al abrir la ficha de edición se reinicia el "tocado" del selector de cliente', /editRow=row;document\.getElementById\('f_cliente'\)\.dataset\.tocado='';/.test(html));
t('solo un cambio manual del selector se conserva al refrescar', /if\(eq&&sel\.dataset\.tocado&&opciones\.includes\(prev\)\) valor=prev;\s*else if\(actual&&actual!=='-'\) valor=actual;/.test(html) && /id="f_cliente"[^>]*onchange="this\.dataset\.tocado=1"/.test(html));
t('ya no existe el botón "Corregir cliente"', !/f_reasignar|Corregir cliente/.test(html));
const edit2 = resolverClienteGuardado({ editando: true, clienteEquipo: 'RIPLEY', clienteElegido: '', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('EDITAR un equipo de Ripley también conserva su cliente', edit2.ok && edit2.cliente === 'RIPLEY');
// cambiar el área (u otro campo) no toca el cliente: con cualquiera de las dos órdenes de carga
for (const orden of [['RIPLEY', 'TOTTUS'], ['TOTTUS', 'RIPLEY']]) {
  const m2 = new Function(`${decl}\n${reg}\n${cds}\n${res}\nreturn { registrarSedeCliente, clientesDeSede, resolverClienteGuardado };`)();
  orden.forEach((c) => m2.registrarSedeCliente('MIRAFLORES', c));
  const r = m2.resolverClienteGuardado({ editando: true, clienteEquipo: 'TOTTUS', clienteElegido: '', sede: 'MIRAFLORES', clientesDeLaSede: m2.clientesDeSede('MIRAFLORES') });
  t(`editar el área de un equipo de Tottus lo deja en Tottus (carga ${orden.join('→')})`, r.ok && r.cliente === 'TOTTUS');
}
// mover un equipo a una sede que no tiene a su cliente se rechaza (no se reasigna en silencio)
const mover = resolverClienteGuardado({ editando: true, clienteEquipo: 'TOTTUS', clienteElegido: '', sede: 'ATOCONGO', clientesDeLaSede: clientesDeSede('ATOCONGO') });
t('mover un equipo de Tottus a una sede sin Tottus → rechazado', !mover.ok && /no tiene al cliente "TOTTUS"/.test(mover.error), JSON.stringify(mover));
// equipo viejo sin cliente: hay que elegirlo
const sinCli = resolverClienteGuardado({ editando: true, clienteEquipo: '', clienteElegido: '', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('editar un equipo sin cliente pide elegirlo', !sinCli.ok && /no tiene cliente/.test(sinCli.error));
const sinCli2 = resolverClienteGuardado({ editando: true, clienteEquipo: '', clienteElegido: 'TOTTUS', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('…y si lo elige, se guarda', sinCli2.ok && sinCli2.cliente === 'TOTTUS');

// ── corregir el cliente de un equipo mal asignado (se cambia a mano en el selector, sin checkbox) ──
const corr = resolverClienteGuardado({ editando: true, clienteEquipo: 'RIPLEY', clienteElegido: 'TOTTUS', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('editar y elegir otro cliente de la sede → manda el elegido', corr.ok && corr.cliente === 'TOTTUS', JSON.stringify(corr));
const corrVacio = resolverClienteGuardado({ editando: true, clienteEquipo: 'RIPLEY', clienteElegido: '', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('editar sin elegir nada → conserva el del equipo', corrVacio.ok && corrVacio.cliente === 'RIPLEY');
const corrAjeno = resolverClienteGuardado({ editando: true, clienteEquipo: 'RIPLEY', clienteElegido: 'TOTTUS', sede: 'ATOCONGO', clientesDeLaSede: clientesDeSede('ATOCONGO') });
t('pasarlo a un cliente que no tiene la sede → rechazado', !corrAjeno.ok);
const sinCambio = resolverClienteGuardado({ editando: true, clienteEquipo: 'RIPLEY', clienteElegido: 'RIPLEY', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('el selector con el mismo cliente → sigue igual', sinCambio.ok && sinCambio.cliente === 'RIPLEY');

// ── crear ──
const nuevoComp = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: '', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('CREAR en sede compartida SIN elegir cliente → rechazado (no se adivina)', !nuevoComp.ok && /varios clientes/.test(nuevoComp.error), JSON.stringify(nuevoComp));
const nuevoElegido = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: 'TOTTUS', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('CREAR en sede compartida eligiendo cliente → ok', nuevoElegido.ok && nuevoElegido.cliente === 'TOTTUS');
const nuevoSolo = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: 'RIPLEY', sede: 'ATOCONGO', clientesDeLaSede: clientesDeSede('ATOCONGO') });
t('CREAR en sede de un solo cliente → ok', nuevoSolo.ok && nuevoSolo.cliente === 'RIPLEY');
const ajeno = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: 'TOTTUS', sede: 'ATOCONGO', clientesDeLaSede: clientesDeSede('ATOCONGO') });
t('CREAR con un cliente que no tiene esa sede → rechazado', !ajeno.ok && /no tiene al cliente "TOTTUS"/.test(ajeno.error));
const sinSede = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: '', sede: 'ZZZ', clientesDeLaSede: [] });
t('sede sin ningún cliente → pide asignarlo en Clientes', !sinSede.ok && /app de Clientes/.test(sinSede.error));
const guion = resolverClienteGuardado({ editando: false, clienteEquipo: '', clienteElegido: '-', sede: 'MIRAFLORES', clientesDeLaSede: mir });
t('"-" como cliente no vale (se trata como sin cliente)', !guion.ok && /varios clientes/.test(guion.error), JSON.stringify(guion));

// ── el código del formulario usa todo esto ──
t('saveItem usa resolverClienteGuardado y ya no deriva el cliente de la sede', /const rc=resolverClienteGuardado\(\{editando:editRow!==null/.test(html) && !/sedeCliente\[/.test(html));
t('el cliente que se guarda sale de ese resultado', /const cliente_val=rc\.cliente;/.test(html));
t('el formulario tiene el selector de cliente', /<select id="f_cliente"[ >]/.test(html));
t('al elegir la sede del desplegable se propone el cliente del encabezado', /onPick\(h\?h\.textContent:''\)/.test(html) && /sddInit\('f_sede', \(cli\)=>refrescarClienteForm\(cli\)\)/.test(html));
t('abrir "Editar" y "Nuevo" refrescan el selector', /document\.getElementById\('f_sede'\)\.value=r\.sede;refrescarClienteForm\(\)/.test(html) && /refrescarClienteForm\(\);\s*\n\s*document\.getElementById\('mov'\)\.classList\.add\('open'\)/.test(html));
t('la lista de clientes por sede se alimenta de los datos y de maestros', /data\.forEach\(r=>registrarSedeCliente\(r\.sede,r\.cliente\)\)/.test(html) && /tiendas\.forEach\(t=>registrarSedeCliente\(t\.sede,t\.cliente\)\)/.test(html));

// la ficha se separa en bloques con `.bloque` (no `.sec`: esa clase ya existe para encabezados y encogía/corría los campos)
t('la ficha usa .bloque (4 campos) y ninguno usa la clase .sec', (html.match(/<div class="fgg bloque">/g) || []).length === 4 && !/class="fgg sec"/.test(html));
t('los campos de la ficha conservan el tamaño original (sin relleno propio)', !/\.fg2 select,\.fg2 input\[type=text\]\{/.test(html));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
