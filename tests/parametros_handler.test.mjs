// El endpoint REAL de la Mini App (api/parametros.js) tiene cableadas todas las dependencias que usa la lógica
// (api/_lib/parametros.js). Un cambio anterior dejó `crear` en el handler y quitó lo nuevo: la Mini App respondía 500 y
// los tests de la lógica (que inyectan sus propias dependencias) no lo vieron. Uso: node tests/parametros_handler.test.mjs
import fs from 'node:fs';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

const lib = fs.readFileSync(new URL('../api/_lib/parametros.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../api/parametros.js', import.meta.url), 'utf8');

// Todo `d.<nombre>` que usa procesar() debe llegar en el objeto de dependencias del handler.
const procesar = lib.slice(lib.indexOf('export async function procesar'));
const usadas = [...new Set([...procesar.matchAll(/\bd\.(\w+)/g)].map((m) => m[1]))];
const bloque = handler.slice(handler.indexOf('await procesar('), handler.indexOf('return res.status(r.status)'));
t('procesar() usa dependencias', usadas.length >= 8, usadas.join());
for (const k of usadas) t(`el handler entrega la dependencia "${k}"`, new RegExp(`\\b${k}\\b`).test(bloque), k);
t('el handler no referencia funciones que ya no existen', !/\bcrear\b/.test(handler));

// Y de verdad: sin sesión de Telegram debe contestar 401 (firma inválida), nunca 500.
const m = await import('../api/parametros.js');
const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { this.j = j; return this; } };
await m.default({ method: 'POST', headers: {}, body: { accion: 'inicio' } }, res);
t('sin sesión de Telegram → 401 (no 500)', res.c === 401, JSON.stringify([res.c, res.j]));
const res2 = { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { this.j = j; return this; } };
await m.default({ method: 'GET', headers: {}, body: {} }, res2);
t('GET → 405', res2.c === 405);

// El endpoint de borrado también carga (y exige token: en producción sin Authorization responde 401).
const b = await import('../api/parametros_borrar.js');
t('parametros_borrar carga y exporta el handler', typeof b.default === 'function');
t('parametros_borrar verifica el token antes de borrar', /verifyIdToken/.test(fs.readFileSync(new URL('../api/parametros_borrar.js', import.meta.url), 'utf8')) && /puedeBorrarParametros/.test(fs.readFileSync(new URL('../api/parametros_borrar.js', import.meta.url), 'utf8')));

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
