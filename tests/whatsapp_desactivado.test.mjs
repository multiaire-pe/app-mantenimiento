// El canal de WhatsApp debe estar APAGADO salvo WHATSAPP_BOT_ACTIVO === 'true'.
// Uso: node tests/whatsapp_desactivado.test.mjs   (sin red ni Firestore: fetch simulado)
import { enviarTextoDetalle, enviarPlantillaDetalle, enviarBotonesDetalle, enviarListaDetalle, enviarTexto, whatsappActivo } from '../api/_lib/whatsapp.js';
import handler from '../api/whatsapp.js';

let ok = 0, mal = 0;
const t = (n, c, e = '') => { if (c) ok++; else { mal++; console.log('✗', n, e); } };

let llamadas = 0;
globalThis.fetch = async () => { llamadas++; return { ok: true, status: 200, text: async () => '', json: async () => ({}) }; };
process.env.WHATSAPP_TOKEN = 'T'; process.env.WHATSAPP_PHONE_NUMBER_ID = 'P';

for (const valor of [undefined, '', 'false', 'TRUE', '1', 'si']) {
  if (valor === undefined) delete process.env.WHATSAPP_BOT_ACTIVO; else process.env.WHATSAPP_BOT_ACTIVO = valor;
  llamadas = 0;
  const rs = [
    await enviarTextoDetalle('51999', 'x'), await enviarPlantillaDetalle('51999', 'p', 'es', []),
    await enviarBotonesDetalle('51999', 'x', [{ id: 'a', title: 'A' }]), await enviarListaDetalle('51999', 'x', 'B', [{ id: 'a', title: 'A' }]),
  ];
  t(`apagado con ${JSON.stringify(valor)}: no llama a Meta`, llamadas === 0 && !whatsappActivo());
  t(`apagado con ${JSON.stringify(valor)}: es rechazo definitivo (no ambiguo)`, rs.every((r) => !r.ok && r.estado === 'rechazado' && r.detalle === 'canal_desactivado'));
  t(`apagado con ${JSON.stringify(valor)}: el contrato booleano sigue siendo false`, (await enviarTexto('51999', 'x')) === false);
}

process.env.WHATSAPP_BOT_ACTIVO = 'true';
llamadas = 0;
t('encendido con "true": envía', (await enviarTextoDetalle('51999', 'x')).ok && llamadas === 1 && whatsappActivo());

// Webhook: apagado → 200 sin procesar nada
const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r; }, send(b) { r.body = b; return r; }, setHeader() {} }; return r; };
delete process.env.WHATSAPP_BOT_ACTIVO;
const rp = res();
await handler({ method: 'POST', headers: {}, on() { throw new Error('no debe leer el body'); } }, rp);
t('webhook apagado: 200 y no toca el body', rp.code === 200 && rp.body === 'DESACTIVADO');

process.env.WHATSAPP_BOT_ACTIVO = 'true';
const rq = res();
await handler({ method: 'POST', headers: {}, on(ev, fn) { if (ev === 'end') fn(); } }, rq);
t('webhook encendido: sigue exigiendo la firma de Meta', rq.code === 401);

console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
