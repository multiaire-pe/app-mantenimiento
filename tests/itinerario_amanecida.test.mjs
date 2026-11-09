// Itinerario: turnos de AMANECIDA (hora fin menor que la de inicio = termina al día siguiente). Antes el formulario
// rechazaba "fin ≤ inicio". Uso: node tests/itinerario_amanecida.test.mjs
import fs from 'node:fs';
import { mensajesPorTecnico } from '../api/_lib/itinerario_envio.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };
const html = fs.readFileSync(new URL('../itinerario.html', import.meta.url), 'utf8');
const hd = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m) / 1440; };   // = horaToDecimal

// ── validación del formulario
t('ya no se rechaza fin < inicio', !/hFin <= hIni/.test(html) && !/fin ≤ inicio/.test(html));
t('solo se rechaza inicio = fin', /if \(hIni && hFin && hFin === hIni\)/.test(html));

// ── helpers de la tarjeta, ejecutados tal cual
const fn = (nombre) => { const m = html.match(new RegExp(`function ${nombre}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`)); return m ? m[0] : ''; };
const lib = new Function(`${fn('fmtHora')}\n${fn('esAmanecida')}\n${fn('fmtHoraFin')}\nreturn { fmtHora, esAmanecida, fmtHoraFin };`)();
const dia = { horaInicio: hd('08:30'), horaFin: hd('18:00') };
const noche = { horaInicio: hd('22:00'), horaFin: hd('06:00') };
const medianoche = { horaInicio: hd('18:00'), horaFin: 0 };
t('turno de día no es amanecida', lib.esAmanecida(dia) === false);
t('22:00 → 06:00 es amanecida', lib.esAmanecida(noche) === true);
t('18:00 → 00:00 es amanecida y se ve "00:00" (no "--:--")', lib.esAmanecida(medianoche) === true && lib.fmtHoraFin(medianoche) === '00:00');
t('un bloque sin horas (datos viejos con 0) no es amanecida ni inventa 00:00', lib.esAmanecida({ horaInicio: 0, horaFin: 0 }) === false && lib.fmtHoraFin({ horaInicio: 0, horaFin: 0 }) === '--:--');
t('la hora fin normal se formatea igual que antes', lib.fmtHoraFin(dia) === '18:00' && lib.fmtHoraFin(noche) === '06:00');
t('al abrir "Editar" la hora fin 00:00 no se pierde (usa fmtHoraFin)', (html.match(/horaFin: fmtHoraFin\(b\)/g) || []).length === 2);
t('la tarjeta marca el turno de amanecida', /\$\{esAmanecida\(b\) \? ' <span class="amanecida-tag"/.test(html));
t('el formulario avisa en vivo (inicio y fin)', /oninput="avisoAmanecida\(' \+ i \+ '\)"/.test(html) && /function avisoAmanecida\(i\)/.test(html));

// ── mensaje de WhatsApp al técnico
const bloque = (hi, hf) => ({ nBloque: 1, tienda: 'RIPLEY ATOCONGO', horaInicio: hi, horaFin: hf, detalle: 'x', estado: 'PROGRAMADO', personal: [{ id: 'T1', nombre: 'Ana' }] });
const texto = (b) => mensajesPorTecnico([b], [], { fechaStr: 'lunes' })[0].texto;
t('el mensaje de un turno normal queda igual (sin "día siguiente")', /⏰ 08:30 – 18:00(?! \(día)/.test(texto(bloque(hd('08:30'), hd('18:00')))));
t('el mensaje de una amanecida dice "(día siguiente)"', /⏰ 22:00 – 06:00 \(día siguiente\)/.test(texto(bloque(hd('22:00'), hd('06:00')))));
t('terminar a las 00:00 también dice "(día siguiente)"', /⏰ 18:00 – 00:00 \(día siguiente\)/.test(texto(bloque(hd('18:00'), 0))));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
